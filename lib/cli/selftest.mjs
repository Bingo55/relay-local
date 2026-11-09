// Plain Node assertions for the Relay terminal client. No framework.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { runInNewContext } from 'node:vm'
import { createSseParser, parseSseFrame } from './client.mjs'
import { createState, applyBootstrap, applyEvent, lastRunGroup, summarizeGroup } from './state.mjs'
import {
  createColors, stripAnsi, normalizeText, displayWidth, wrapText, truncate,
  formatDuration, statusLabel, planLines, summarySentence, changedFiles,
  sanitizeAgent, agentLines, agentLabel, quotaLines, COPY,
} from './format.mjs'
import { QuotaStore } from '../quota.mjs'
import { parseArgs } from './args.mjs'
import { caretCell, composerWindow, windowInputLine, Tui } from './tui.mjs'
import { renderMarkdown } from './markdown.mjs'
import { filterPalette, paletteWindow } from './palette.mjs'

let n = 0
const ok = (name, fn) => {
  try { fn(); n++; }
  catch (e) {
    console.error(`not ok ${n + 1} - ${name}`)
    console.error(e?.stack || e)
    process.exit(1)
  }
}

const plain = createColors({ enabled: false })

ok('SSE: one frame per chunk', () => {
  const seen = []
  const p = createSseParser((e) => seen.push(e))
  p.push('data: {"type":"hello","busy":false}\n\n')
  assert.deepEqual(seen, [{ type: 'hello', busy: false }])
})

ok('SSE: frame split across chunks', () => {
  const seen = []
  const p = createSseParser((e) => seen.push(e))
  p.push('data: {"type":"delta","id":"st_1","te')
  p.push('xt":"hi"}\n\n')
  assert.deepEqual(seen, [{ type: 'delta', id: 'st_1', text: 'hi' }])
})

ok('SSE: CRLF and multi-line data', () => {
  const seen = []
  const p = createSseParser((e) => seen.push(e))
  p.push('event: x\r\ndata: {"type":"note",\r\ndata: "text":"a"}\r\n\r\n')
  assert.deepEqual(seen, [{ type: 'note', text: 'a' }])
})

ok('SSE: comments and unknown fields ignored', () => {
  assert.equal(parseSseFrame(': ping'), null)
  assert.deepEqual(parseSseFrame(': ping\nid: 4\ndata: {"type":"busy","busy":true}'), { type: 'busy', busy: true })
})

ok('SSE: multiple frames in one chunk', () => {
  const seen = []
  const p = createSseParser((e) => seen.push(e))
  p.push('data: {"type":"busy","busy":true}\n\ndata: {"type":"busy","busy":false}\n\n')
  assert.equal(seen.length, 2)
})

const baseSession = () => ({
  id: 'ses_a', title: 'api work', cwd: 'C:\\work', messages: [], instructor: 'opencode',
})
const stateWith = () => {
  const s = createState()
  applyBootstrap(s, {
    session: baseSession(), sessions: [], agents: [], roles: {}, instructors: [], busy: false,
  })
  return s
}

ok('state: hello seeds the session', () => {
  const s = createState()
  applyEvent(s, { type: 'hello', session: { ...baseSession(), messages: [{ id: 'm1', role: 'user', text: 'hi' }] }, busy: true })
  assert.equal(s.session.id, 'ses_a')
  assert.equal(s.session.messages.length, 1)
  assert.equal(s.busy, true)
})

ok('state: message adds, update replaces without duplicating', () => {
  const s = stateWith()
  applyEvent(s, { type: 'message', sessionId: 'ses_a', message: { id: 'st1', role: 'step', status: 'running', text: '' } })
  applyEvent(s, { type: 'message.update', sessionId: 'ses_a', message: { id: 'st1', role: 'step', status: 'done', text: 'ok' } })
  assert.equal(s.session.messages.length, 1)
  assert.equal(s.session.messages[0].status, 'done')
})

ok('state: delta is cumulative, not appended', () => {
  const s = stateWith()
  applyEvent(s, { type: 'message', sessionId: 'ses_a', message: { id: 'st1', role: 'step', status: 'running', text: '' } })
  applyEvent(s, { type: 'delta', sessionId: 'ses_a', id: 'st1', text: 'a' })
  applyEvent(s, { type: 'delta', sessionId: 'ses_a', id: 'st1', text: 'ab' })
  assert.equal(s.session.messages[0].text, 'ab')
})

ok('state: bootstrap keeps the quota snapshot', () => {
  const s = createState()
  applyBootstrap(s, {
    session: baseSession(), sessions: [], agents: [], roles: {}, instructors: [], busy: false,
    quota: { mode: 'local-observed', agents: [], route: null },
  })
  assert.equal(s.quota.mode, 'local-observed')
})

ok('quota: least-used skips an out agent and respects 95%', () => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-quota-selftest-'))
  const file = join(dir, 'quota.json')
  const q = new QuotaStore(file)
  const cfg = {
    agents: [
      { id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' },
    ],
    roles: { build: ['a', 'b', 'c'] },
  }
  for (const id of ['a', 'b', 'c']) q.configure(id, { limit: 10, window: 'day' }, cfg)
  for (let i = 0; i < 10; i++) q.recordCall('a', cfg)
  q.recordCall('b', cfg)
  assert.equal(q.leastUsed(['a', 'b', 'c'], cfg), 'c')
  q.recordQuota('c', cfg, { minutes: 30 })
  assert.equal(q.leastUsed(['a', 'b', 'c'], cfg), 'b')
  assert.equal(q.status('a', cfg).level, 'out')
  rmSync(dir, { recursive: true, force: true })
})

ok('quota: 50/80/95 color thresholds and bars', () => {
  const state = {
    quota: {
      route: { label: 'Red', percent: 90, level: 'red' },
      agents: [
        { id: 'g', label: 'Green', limit: 100, used: 10, percent: 10, level: 'green', window: 'day' },
        { id: 'o', label: 'Orange', limit: 100, used: 60, percent: 60, level: 'orange', window: 'day' },
        { id: 'r', label: 'Red', limit: 100, used: 90, percent: 90, level: 'red', window: 'day' },
        { id: 'w', label: 'White', limit: 100, used: 96, percent: 96, level: 'out', window: 'day', out: true },
      ],
    },
  }
  const text = quotaLines(state, createColors({ enabled: false })).join('\n')
  assert.match(text, /Green\s+█+░*\s+10%/)
  assert.match(text, /White\s+█+░*\s+96%.*out/)
  const colored = quotaLines(state, createColors({ enabled: true, depth: 16 })).join('\n')
  assert.match(colored, /\x1b\[92m/)
  assert.match(colored, /\x1b\[33m/)
  assert.match(colored, /\x1b\[91m/)
  assert.match(colored, /\x1b\[97m/)
})

ok('state: note renders once while notice only toasts', () => {
  const s = stateWith()
  applyEvent(s, { type: 'message', sessionId: 'ses_a', message: { id: 'n1', role: 'note', text: 'careful' } })
  const r = applyEvent(s, { type: 'notice', sessionId: 'ses_a', text: 'careful' })
  assert.equal(s.session.messages.filter((m) => m.role === 'note').length, 1)
  assert.equal(r.notice, 'careful')
})

ok('state: btw excluded from main steps', () => {
  const s = stateWith()
  applyEvent(s, { type: 'message', sessionId: 'ses_a', message: { id: 'u', role: 'user', text: 'x' } })
  applyEvent(s, { type: 'message', sessionId: 'ses_a', message: { id: 's1', role: 'step', kind: '', n: 1, status: 'done' } })
  applyEvent(s, { type: 'message', sessionId: 'ses_a', message: { id: 'b1', role: 'step', kind: 'btw', n: 1, status: 'done' } })
  const g = lastRunGroup(s)
  assert.equal(g.steps.length, 1)
  assert.equal(g.btw.length, 1)
})

ok('state: session mismatch asks for resync', () => {
  const s = stateWith()
  const r = applyEvent(s, { type: 'message', sessionId: 'ses_b', message: { id: 'x', role: 'user', text: 'x' } })
  assert.equal(r.resync, true)
})

const step = (n, status, extra = {}) => ({ id: `st${n}${status}`, role: 'step', n, status, ...extra })

ok('summary: plan plus two finished steps', () => {
  const s = stateWith()
  s.session.messages = [
    { id: 'u', role: 'user', text: 'do it' },
    { id: 'p', role: 'plan', task: 'do it', steps: [{ agent: 'a', prompt: 'x' }, { agent: 'b', prompt: 'y' }] },
    step(1, 'done', { durationMs: 3000, git: { after: { files: [' M src/a.js'] } } }),
    step(2, 'done', { durationMs: 4000, git: { after: { files: [' M src/a.js', '?? new.txt'] } } }),
  ]
  const sum = summarizeGroup(lastRunGroup(s))
  assert.equal(sum.total, 2)
  assert.equal(sum.finished, 2)
  assert.equal(sum.problems, 0)
  assert.deepEqual(sum.files, ['src/a.js', 'new.txt'])
  assert.equal(summarySentence(sum), '2 of 2 steps finished · 2 files changed · no problems')
})

ok('summary: direct dispatch has no plan', () => {
  const s = stateWith()
  s.session.messages = [{ id: 'u', role: 'user', text: 'x' }, step(1, 'done', { durationMs: 1000 })]
  const sum = summarizeGroup(lastRunGroup(s))
  assert.equal(sum.total, 1)
  assert.equal(sum.finished, 1)
  assert.equal(summarySentence(sum), '1 of 1 steps finished · no problems')
})

ok('summary: stopped mid-run', () => {
  const s = stateWith()
  s.session.messages = [
    { id: 'u', role: 'user', text: 'x' },
    { id: 'p', role: 'plan', task: 'x', steps: [{ agent: 'a', prompt: 'x' }, { agent: 'b', prompt: 'y' }] },
    step(1, 'done'), step(2, 'stopped'),
  ]
  const sum = summarizeGroup(lastRunGroup(s))
  assert.equal(sum.stopped, 1)
  assert.equal(summarySentence(sum), 'Stopped after 1 of 2 steps.')
})

ok('summary: quota fallback and no git', () => {
  const s = stateWith()
  s.session.messages = [
    { id: 'u', role: 'user', text: 'x' }, step(1, 'quota', { fallback: [{ from: 'A', to: 'B', reason: 'quota' }] }),
  ]
  const sum = summarizeGroup(lastRunGroup(s))
  assert.equal(sum.problems, 1)
  assert.equal(sum.fallbacks.length, 1)
  assert.deepEqual(sum.files, [])
  assert.match(summarySentence(sum), /1 problem/)
})

ok('summary: btw interleaved and deduped files', () => {
  const s = stateWith()
  s.session.messages = [
    { id: 'u', role: 'user', text: 'x' },
    step(1, 'done', { git: { after: { files: [' M a', ' M a', '?? b'] } } }),
    { id: 'b', role: 'step', kind: 'btw', status: 'done', text: 'answer' },
  ]
  const g = lastRunGroup(s)
  const sum = summarizeGroup(g)
  assert.equal(sum.btw, 1)
  assert.equal(sum.total, 1)
  assert.deepEqual(sum.files, ['a', 'b'])
})

ok('format: strip ANSI, tabs, CR progress', () => {
  assert.equal(stripAnsi('\x1b[31mred\x1b[0m'), 'red')
  assert.equal(normalizeText('a\tb'), 'a    b')
  assert.equal(normalizeText('one\rtwo'), 'two')
  assert.equal(normalizeText('a\r\nb'), 'a\nb')
})

ok('format: display width ASCII, CJK, emoji', () => {
  assert.equal(displayWidth('abc'), 3)
  assert.equal(displayWidth('你好'), 4)
  assert.equal(displayWidth('😀'), 2)
  assert.equal(displayWidth('\t'), 4)
})

ok('format: wrapping ASCII, CJK, long words', () => {
  assert.deepEqual(wrapText('hello 你好 world', 5), ['hello', '你好', 'world'])
  assert.deepEqual(wrapText('你好你好', 4), ['你好', '你好'])
  assert.deepEqual(wrapText('abcdefgh', 3), ['abc', 'def', 'gh'])
})

ok('format: truncate and durations', () => {
  assert.equal(truncate('hello', 4), 'hel…')
  assert.equal(truncate('hi', 4), 'hi')
  assert.equal(formatDuration(0), '0s')
  assert.equal(formatDuration(999), '999ms')
  assert.equal(formatDuration(61_000), '1m 1s')
})

ok('format: plan renders fan-out and no raw ids as the main label', () => {
  const state = { agents: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }], roles: {}, instructors: [] }
  const lines = planLines(state, { steps: [{ agents: ['a', 'b'], prompt: 'p', why: 'two views' }], via: 'manual' }, plain)
  assert.match(lines.join('\n'), /Alpha \+ Beta/)
})

ok('labels: an id or a friendly label both resolve without an extra suffix', () => {
  const state = { agents: [{ id: 'agy-flash', label: 'Antigravity · Gemini' }], roles: {} }
  assert.equal(agentLabel(state, 'agy-flash'), 'Antigravity · Gemini')
  assert.equal(agentLabel(state, 'Antigravity · Gemini'), 'Antigravity · Gemini')
  assert.equal(agentLabel(state, ''), 'assistant')
})

ok('redaction: agent display whitelist never shows env/cmd/args', () => {
  const state = {
    agents: [{ id: 'a', label: 'Alpha', cmd: 'secret-cmd', args: ['--token', 'x'], env: { SECRET: 'x' }, caps: 'fast' }],
    roles: { build: ['a'] },
  }
  const text = agentLines(state, plain).join('\n')
  assert.doesNotMatch(text, /SECRET|env|secret-cmd|--token/)
  const sanitized = sanitizeAgent(state.agents[0])
  assert.equal(sanitized.env, undefined)
  assert.equal(sanitized.cmd, undefined)
})

ok('status copy maps every status', () => {
  assert.equal(statusLabel('running'), 'working…')
  assert.equal(statusLabel('done'), 'done')
  assert.equal(statusLabel('stopped'), 'stopped')
  assert.equal(statusLabel('failed'), "didn't finish")
  assert.equal(statusLabel('timeout'), 'took too long')
  assert.equal(statusLabel('quota'), 'out of free credits')
  assert.equal(statusLabel('weird'), "didn't finish")
})

ok('caret: ASCII, CJK, newline, end', () => {
  assert.deepEqual(caretCell('abc', 2, 80), { lineIndex: 0, column: 2, windowStart: 0, caretColumn: 2 })
  assert.equal(caretCell('你好', 1, 80).column, 2)
  assert.deepEqual(caretCell('ab\ncd', 5, 80), { lineIndex: 1, column: 2, windowStart: 0, caretColumn: 2 })
  assert.equal(caretCell('ab', 2, 80).column, 2)
})

ok('caret: horizontal window keeps the caret inside', () => {
  const w = windowInputLine('abcdefghij', 9, 5)
  assert.equal(w.prefix, true)
  assert.ok(w.caret <= 5)
  assert.equal(displayWidth(w.text), 5)
})

ok('caret: tabs and composer vertical scroll', () => {
  assert.equal(caretCell('\tab', 3, 80).column, 6)
  const cw = composerWindow('1\n2\n3\n4\n5\n6\n7', 13, 20, 3)
  assert.equal(cw.caretLine, 2)
  assert.equal(cw.start, 4)
})

ok('args: task forms, flags anywhere, terminator, missing value', () => {
  assert.equal(parseArgs(['task', 'a', 'b']).task, 'a b')
  assert.equal(parseArgs(['--auto', 'x']).command, 'task')
  assert.equal(parseArgs(['--model', 'm', 'x']).flags.model, 'm')
  assert.equal(parseArgs(['x', '--model', 'm']).flags.model, 'm')
  assert.equal(parseArgs(['--', '--auto']).task, '--auto')
  assert.equal(parseArgs(['use', '2']).command, 'use')
  assert.deepEqual(parseArgs(['use', '2']).args, ['2'])
  assert.match(parseArgs(['--wat']).errors[0], /Unknown option/)
  assert.match(parseArgs(['--model']).errors[0], /needs a value/)
})

ok('copy deck stays plain', () => {
  assert.equal(COPY.skipped, 'Skipped. Nothing ran.')
  assert.equal(COPY.noChanges, 'No file changes were reported.')
})

ok('changed files parse porcelain codes', () => {
  const s = { session: { messages: [step(1, 'done', { git: { after: { files: [' M a.js', '?? b.txt', 'D  c.txt'] } } })] } }
  const files = changedFiles(s)
  assert.deepEqual(files.map((f) => f.label), ['changed', 'new', 'deleted'])
})

ok('markdown: headings, lists, inline code and links', () => {
  const lines = renderMarkdown('# Title\n\n- one **bold**\n- two `code`\n\n[link](https://example.com)', 44, plain)
  const text = lines.join('\n')
  assert.match(text, /Title/)
  assert.match(text, /• one bold/)
  assert.match(text, /• two code/)
  assert.match(text, /link/)
  assert.doesNotMatch(text, /\*\*|`|https:\/\/example\.com/)
})

ok('markdown: fenced code is boxed and fits the width', () => {
  const lines = renderMarkdown('```js\nconst answer = "hello"\n```', 36, plain)
  assert.ok(lines.some((line) => line.includes('╭─ js')))
  assert.ok(lines.some((line) => line.includes('const answer = "hello"')))
  assert.ok(lines.every((line) => displayWidth(stripAnsi(line)) <= 36))
})

ok('markdown: quotes, tildes and rules', () => {
  const lines = renderMarkdown('~~~sh\necho hi\n~~~\n\n> quoted\n\n---', 40, plain)
  const text = lines.join('\n')
  assert.match(text, /╭─ sh/)
  assert.match(text, /quoted/)
  assert.match(text, /─{6,}/)
})

ok('palette: search ranks labels and keeps original order', () => {
  const items = [
    { label: 'New chat', hint: 'Ctrl+N', keywords: 'session' },
    { label: 'Switch chat', hint: 'Ctrl+O', keywords: 'session resume' },
    { label: 'Status', hint: '/status' },
  ]
  assert.deepEqual(filterPalette(items, 'chat').map((x) => x.label), ['New chat', 'Switch chat'])
  assert.deepEqual(filterPalette(items, 'resume').map((x) => x.label), ['Switch chat'])
  assert.deepEqual(filterPalette(items, '').map((x) => x.label), items.map((x) => x.label))
})

ok('palette: window follows the selection', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ label: `item ${i}` }))
  const first = paletteWindow(items, 1, 4)
  assert.deepEqual(first.rows.map((x) => x.label), ['item 0', 'item 1', 'item 2', 'item 3'])
  const last = paletteWindow(items, 9, 4)
  assert.deepEqual(last.rows.map((x) => x.label), ['item 6', 'item 7', 'item 8', 'item 9'])
  assert.equal(last.hasAfter, false)
})

ok('tui: composer caret geometry and click placement', () => {
  const state = createState({ session: { id: 's', title: 't', messages: [] } })
  const tui = new Tui({ client: {}, state, flags: { noColor: true, noMouse: true } })
  tui.requestRender = () => {}
  tui.C = 80
  tui.R = 24
  tui.input = 'abc'
  tui.caret = 1
  const data = tui.composerData(80)
  assert.equal(data.caretColumn, 1)
  const composer = tui.composerLines(80)
  const bodyH = 24 - 2 - composer.length
  const lines = ['header', 'folder', ...Array(bodyH).fill(''), ...composer]
  const oldWrite = process.stdout.write
  let out = ''
  process.stdout.write = (s) => { out += s; return true }
  try { tui.writeFrame(lines, 80, 24, bodyH, 2, 1) } finally { process.stdout.write = oldWrite }
  assert.match(out, /\x1b\[22;8H\x1b\[\?25h/)
  tui.lastLayout = { inputTop: 22, inputCount: 1, data }
  tui.handleMouse(0, 9, 22, 'M')
  assert.equal(tui.caret, 2)
})

ok('tui: slash suggestions narrow to the typed command', () => {
  const state = createState({ session: { id: 's', title: 't', messages: [] } })
  const tui = new Tui({ client: {}, state, flags: { noColor: true, noMouse: true } })
  tui.requestRender = () => {}
  tui.input = '/mo'
  tui.caret = 3
  assert.deepEqual(tui.slashSuggestions().map((x) => x.cmd), ['/model', '/models'])
  tui.input = '/model '
  assert.deepEqual(tui.slashSuggestions(), [])
  tui.input = '/'
  const composer = tui.composerLines(80)
  assert.equal(tui.suggestCount, 5)
  assert.ok(composer.length > 4)
})

ok('tui: wheel moves overlays in the expected direction', () => {
  const state = createState({ session: { id: 's', title: 't', messages: [] } })
  const tui = new Tui({ client: {}, state, flags: { noColor: true, noMouse: true } })
  tui.requestRender = () => {}
  tui.overlay = { type: 'info', title: 'HELP', lines: Array.from({ length: 40 }, (_, i) => `line ${i}`), scroll: 10 }
  tui.handleMouse(64, 1, 1, 'M')
  assert.equal(tui.overlay.scroll, 7)
  tui.handleMouse(65, 1, 1, 'M')
  assert.equal(tui.overlay.scroll, 10)
  tui.overlay = { type: 'palette', mode: 'commands', title: 'COMMANDS', query: '', index: 5 }
  tui.handleMouse(64, 1, 1, 'M')
  assert.equal(tui.overlay.index, 2)
})

// Evaluate only the real static handler: importing server.mjs would create sessions and listen.
const serverSource = readFileSync(new URL('../../server.mjs', import.meta.url), 'utf8')
const staticSource = serverSource.match(/^function serveStatic\(req, res, root\) \{[\s\S]*?^\}/m)
assert.ok(staticSource, 'static handler must remain independently testable')
const serveStatic = runInNewContext(`(${staticSource[0]})`, { readFileSync, realpathSync, statSync, extname, isAbsolute, relative, resolve, sep })
const staticFixture = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-static-selftest-'))
  const root = join(dir, 'public')
  mkdirSync(join(root, 'assets'), { recursive: true })
  mkdirSync(join(root, 'fonts'))
  const request = (url, method = 'GET') => {
    const response = { code: null, headers: {}, data: null }
    const handled = serveStatic({ url, method }, {
      writeHead: (code, headers) => { response.code = code; response.headers = headers },
      end: (data) => { response.data = data?.toString() },
    }, root)
    return { ...response, handled }
  }
  try { fn({ dir, root, request }) } finally { rmSync(dir, { recursive: true, force: true }) }
}

ok('static: index and build-first fallback are HTML with no-store', () => staticFixture(({ root, request }) => {
  for (const url of ['/', '/index.html?refresh=1']) {
    const missing = request(url)
    assert.equal(missing.code, 200)
    assert.equal(missing.headers['content-type'], 'text/html; charset=utf-8')
    assert.equal(missing.headers['cache-control'], 'no-store')
    assert.match(missing.data, /npm run build/)
  }
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>fixture</title>')
  for (const url of ['/', '/index.html']) {
    const found = request(url)
    assert.equal(found.code, 200)
    assert.equal(found.headers['cache-control'], 'no-store')
    assert.equal(found.data, '<!doctype html><title>fixture</title>')
  }
}))

ok('static: MIME types, decoded filenames, queries, and hash-only immutable caching', () => staticFixture(({ root, request }) => {
  const files = [
    ['assets/index-Ab1Cd2Ef.js', 'text/javascript; charset=utf-8', true],
    ['assets/index-Ab1Cd2Ef.css', 'text/css; charset=utf-8', true],
    ['assets/plain.js', 'text/javascript; charset=utf-8', false],
    ['assets/icon.svg', 'image/svg+xml', false],
    ['assets/picture.png', 'image/png', false],
    ['fonts/relay-Ab1Cd2Ef.woff2', 'font/woff2', false],
  ]
  for (const [file, mime, hashed] of files) {
    writeFileSync(join(root, file), `fixture:${file}`)
    const found = request(`/${file}?cache=1`)
    assert.equal(found.handled, true)
    assert.equal(found.code, 200)
    assert.equal(found.headers['content-type'], mime)
    assert.equal(found.headers['cache-control'], hashed ? 'public, max-age=31536000, immutable' : 'no-store')
    assert.equal(found.data, `fixture:${file}`)
  }
  writeFileSync(join(root, 'assets', 'hello world.js'), 'space')
  assert.equal(request('/%61ssets/hello%20world.js').data, 'space')
  assert.equal(request('/fonts/relay-Ab1Cd2Ef.woff2?bad=%ZZ').code, 200)
}))

ok('static: reject raw/encoded traversal, backslashes, malformed escapes, NUL and Windows aliases', () => staticFixture(({ request }) => {
  const bad = [
    '/assets/../index.html', '/assets/../api/bootstrap', '/fonts/../../agents.json',
    '/assets/%2e%2e/index.html', '/assets/.%2e/index.html', '/assets/%2e%2e%2findex.html',
    '/%61ssets/%2e%2e/index.html', '/assets%2f..%2findex.html',
    '/assets/..\\index.html', '/assets\\..\\index.html', '/fonts/%5c..%5cagents.json',
    '/assets/%252e%252e/index.html', '/assets/%255cindex.js', '/assets/%',
    '/fonts/%GG.woff2', '/assets/%E0%A4%A.js', '/assets/%00.js', '/assets/\0.js',
    '/assets/%0a.js', '/assets/..%20/index.html', '/assets/file.js:secret',
    '/assets/file.js.', '/assets/./plain.js',
  ]
  for (const url of bad) {
    const result = request(url)
    assert.equal(result.handled, true, url)
    assert.equal(result.code, 400, url)
    assert.equal(result.headers['cache-control'], 'no-store', url)
  }
}))

ok('static: missing/unsupported files and directories never return index HTML', () => staticFixture(({ root, request }) => {
  writeFileSync(join(root, 'index.html'), 'index must not leak')
  writeFileSync(join(root, 'assets', 'secret.json'), '{"secret":true}')
  mkdirSync(join(root, 'assets', 'folder.js'))
  for (const url of ['/assets/missing.js', '/fonts/missing.woff2', '/assets/secret.json', '/assets/folder.js', '/assets/', '/fonts/']) {
    const result = request(url)
    assert.equal(result.code, 404, url)
    assert.equal(result.data, 'Not found', url)
    assert.equal(result.headers['cache-control'], 'no-store', url)
  }
}))

ok('static: realpath containment blocks outside junctions, including sibling-prefix roots', () => staticFixture(({ dir, root, request }) => {
  const outside = join(dir, 'public-secret')
  mkdirSync(outside)
  writeFileSync(join(outside, 'secret.js'), 'must never leak')
  symlinkSync(outside, join(root, 'assets', 'escape'), 'junction')
  symlinkSync(outside, join(root, 'fonts', 'escape'), 'junction')
  for (const url of ['/assets/escape/secret.js', '/fonts/escape/secret.js']) {
    const result = request(url)
    assert.equal(result.code, 403, url)
    assert.equal(result.data, 'Forbidden', url)
    assert.equal(result.headers['cache-control'], 'no-store', url)
  }
  mkdirSync(join(root, 'shared'))
  writeFileSync(join(root, 'shared', 'safe.js'), 'inside')
  symlinkSync(join(root, 'shared'), join(root, 'assets', 'inside'), 'junction')
  assert.equal(request('/assets/inside/safe.js').data, 'inside')
}))

ok('static: unrelated API routes and non-GET assets remain untouched', () => staticFixture(({ request }) => {
  for (const [url, method] of [['/api/bootstrap', 'GET'], ['/api/connections', 'POST'], ['/api/%ZZ', 'GET'], ['/assets/plain.js', 'POST'], ['/fonts/plain.woff2', 'HEAD'], ['/other.js', 'GET']]) {
    const result = request(url, method)
    assert.equal(result.handled, false, `${method} ${url}`)
    assert.equal(result.code, null)
    assert.equal(result.data, null)
  }
  const staticAt = serverSource.indexOf('if (serveStatic(req, res, join(here')
  assert.ok(staticAt > 0)
  for (const gate of ['if (!ALLOWED_HOSTS.has(host))', 'if (origin && !ALLOWED_ORIGINS.has(origin))']) {
    assert.ok(serverSource.indexOf(gate) >= 0 && serverSource.indexOf(gate) < staticAt)
  }
  assert.ok(staticAt < serverSource.indexOf('const url = new URL(req.url'))
}))

console.log(`ok ${n} tests`)
