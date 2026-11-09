// Isolated, in-memory API for browser verification. Never starts an agent or writes chat data.
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../public')
const streams = new Set()
const date = new Date().toISOString()
const agent = { id: 'test-agent', label: 'Test agent', model: 'test-model', models: ['test-model', 'second-model'] }
const quotaAgent = { id: agent.id, label: agent.label, disabled: false, limit: 100, window: 'day', used: 3, calls: 3, errors: 0, quotaHits: 0, percent: 3, level: 'ok', out: false, cooling: false, outUntil: null, outReason: '' }
const makeSession = (id, title) => ({ id, title, cwd: `C:/scratch/${id}`, instructor: 'auto', messages: [], pinned: [], notes: [], updatedAt: date })
let sessions, selected, busy, btwRuns, runningSessionIds, connections, registry, presets, quotas, requests
let id = 0
function reset() {
  sessions = [makeSession('sample-chat', 'Sample workspace'), makeSession('other-chat', 'Another sample')]
  selected = sessions[0]; busy = false; btwRuns = 0; runningSessionIds = []
  connections = []; registry = { mcp: [], plugins: [] }; presets = { Review: { note: 'Review a change', steps: [{ agent: agent.id, prompt: 'Review the change', why: 'Check correctness' }] } }
  quotas = { mode: 'local-observed', agents: [{ ...quotaAgent }], route: { ...quotaAgent } }; requests = []
}
reset()
function bootstrap() { return { session: selected, sessions: sessions.map(({ messages, pinned, notes, ...s }) => s), agents: [agent, ...connections.map(c => ({ id: c.agentId, label: c.name, models: c.models, model: c.defaultModel, connectionId: c.id }))], roles: { build: [agent.id], chat: [agent.id] }, instructors: [{ id: 'auto', label: 'Automatic' }, { id: agent.id, label: agent.label }], busy, btwRuns, runningSessionIds, root: 'C:/relay-fixture', quota: quotas, connections, registry } }
function event(value, session = selected) { const data = `data: ${JSON.stringify({ ...value, sessionId: session.id })}\n\n`; for (const res of streams) res.write(data) }
function busyEvent() { event({ type: 'busy', busy, btwRuns, runningSessionIds }) }
function push(message, session = selected) { session.messages.push(message); event({ type: 'message', message }, session) }
function start(steps, session = selected, side = false) {
  if (side) btwRuns++; else busy = true
  runningSessionIds = [...new Set([...runningSessionIds, session.id])]; busyEvent()
  steps.forEach((s, index) => {
    const message = { id: `step-${++id}`, role: 'step', n: index + 1, agent: s.agent || agent.id, label: agent.label, model: s.model || agent.model, prompt: s.prompt, text: '', kind: side ? 'btw' : undefined, question: side ? s.prompt : undefined, status: 'running', startedAt: new Date().toISOString() }
    push(message, session)
    event({ type: 'agent', agent: agent.id, state: 'running' }, session)
  })
}
function finish(status = 'done') {
  for (const session of sessions) for (const message of session.messages) if (message.role === 'step' && message.status === 'running') {
    Object.assign(message, { status, text: status === 'done' ? '## Result\n\nThe sample change is ready.\n\n```js\nconst safe = "<img src=x onerror=window.pwned=1>"\n```\n\n<img src=x onerror=window.pwned=1>\n\n| Check | Result |\n| --- | --- |\n| Tests | Passed |' : 'Sample agent error: try a smaller task.', endedAt: new Date().toISOString(), durationMs: 1400, git: { before: { files: [] }, after: { files: [' M src/sample.ts'] } } })
    event({ type: 'message.update', message }, session)
  }
  busy = false; btwRuns = 0; runningSessionIds = []; busyEvent(); event({ type: 'agent', agent: agent.id, state: 'idle' })
}
const json = (res, data, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)) }
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname
  let input = {}; if (req.method === 'POST') { let raw = ''; for await (const chunk of req) raw += chunk; input = raw ? JSON.parse(raw) : {} }
  if (path === '/__test/reset') { reset(); return json(res, { ok: true }) }
  if (path === '/__test/seed') {
    selected.messages = Array.from({ length: 200 }, (_, n) => n % 2 === 0
      ? { id: `sample-user-${n}`, role: 'user', text: `Sample task ${n / 2 + 1}`, at: date }
      : { id: `sample-step-${n}`, role: 'step', n: 1, agent: agent.id, label: agent.label, model: agent.model, prompt: 'Sample task', text: 'Sample completed output.', status: n === 199 ? 'running' : 'done', startedAt: date, endedAt: n === 199 ? undefined : date, durationMs: 0 })
    busy = true; runningSessionIds = [selected.id]; busyEvent()
    return json(res, { ok: true })
  }
  if (path === '/__test/state') return json(res, { ...bootstrap(), requests })
  if (path === '/__test/finish') { finish(input.status); return json(res, { ok: true }) }
  if (path === '/__test/delta') {
    const message = selected.messages.findLast(m => m.role === 'step')
    if (message) { message.text = input.text; event({ type: 'delta', id: message.id, text: input.text }) }
    return json(res, { ok: true })
  }
  if (path.startsWith('/api/')) requests.push({ path, method: req.method, input })
  if (path === '/api/events') { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }); res.write(`data: ${JSON.stringify({ type: 'hello', ...bootstrap() })}\n\n`); streams.add(res); req.on('close', () => streams.delete(res)); return }
  if (path === '/api/bootstrap') return json(res, bootstrap())
  if (path === '/api/session' && req.method === 'POST') { selected = makeSession(`chat-${++id}`, 'Untitled run'); sessions.unshift(selected); return json(res, { session: selected }) }
  if (path.startsWith('/api/session/')) {
    const name = decodeURIComponent(path.split('/').at(-1))
    if (req.method === 'DELETE') { sessions = sessions.filter(s => s.id !== name); return json(res, { deleted: name }) }
    selected = sessions.find(s => s.id === name); return json(res, { session: selected })
  }
  if (path === '/api/rename') { selected.title = input.title; return json(res, { session: selected }) }
  if (path === '/api/cwd') { selected.cwd = input.cwd; return json(res, { cwd: input.cwd }) }
  if (path === '/api/instructor') { selected.instructor = input.instructor; return json(res, { instructor: input.instructor }) }
  if (path === '/api/plan') {
    const session = selected; busy = true; runningSessionIds = [session.id]; busyEvent()
    push({ id: `user-${++id}`, role: 'user', text: input.text, at: date }, session)
    await new Promise(r => setTimeout(r, 150))
    const plan = { id: `plan-${++id}`, role: 'plan', task: input.text, mode: input.mode, note: 'Inspect the change, then report the result.', steps: [{ agent: agent.id, prompt: input.text, why: 'Implement and check the task', ...(input.mode === 'orchestrate' ? { agents: [agent.id, 'build'] } : {}) }] }
    push(plan, session); busy = false; runningSessionIds = []; busyEvent()
    if (input.auto) start(plan.steps, session)
    return json(res, { plan })
  }
  if (path === '/api/run') { start(input.steps); return json(res, { ok: true }) }
  if (path === '/api/dispatch') { start([{ agent: input.agent, prompt: input.prompt }]); return json(res, { ok: true }) }
  if (path === '/api/chain') { start([{ agent: agent.id, prompt: input.text }]); return json(res, { plan: { role: 'plan', steps: [] } }) }
  if (path === '/api/btw') { const note = { id: `note-${++id}`, text: input.text, at: date }; selected.notes.push(note); start([{ agent: agent.id, prompt: input.text }], selected, true); return json(res, { note, notes: selected.notes, agent: agent.id, queued: true }) }
  if (path === '/api/stop') { finish('stopped'); return json(res, { ok: true }) }
  if (path === '/api/pin') {
    selected.pinned = selected.pinned.filter(p => p.stepId !== input.stepId)
    if (input.on) { const message = selected.messages.find(m => m.id === input.stepId); selected.pinned.push({ stepId: input.stepId, agent: message.agent, text: message.text, at: date }) }
    return json(res, { pinned: selected.pinned })
  }
  if (path === '/api/presets') { if (req.method === 'POST') presets[input.name] = { note: input.note, steps: input.steps }; return json(res, { presets }) }
  if (path === '/api/quota/config') { Object.assign(quotas.agents[0], { limit: input.limit, window: input.window }); return json(res, { ok: true, agent: quotas.agents[0], quota: quotas }) }
  if (path === '/api/quota/reset') { quotas.agents[0].used = 0; return json(res, { ok: true, quota: quotas }) }
  if (path === '/api/providers') return json(res, { providers: [{ id: 'sample-provider', name: 'Sample provider', protocol: 'openai', baseUrl: 'https://example.test/v1', models: ['fixture-api-model'] }] })
  if (path === '/api/connections') {
    if (req.method === 'POST') { const connection = { ...input, id: input.id || `connection-${++id}`, hasKey: true, agentId: 'fixture-api', defaultModel: input.defaultModel || input.models[0] }; delete connection.apiKey; connections = [...connections.filter(c => c.id !== connection.id), connection] }
    return json(res, { connection: connections.at(-1), connections, agents: bootstrap().agents })
  }
  if (path.startsWith('/api/connections/')) { connections = connections.filter(c => c.id !== path.split('/').at(-1)); return json(res, { ok: true, connections, agents: bootstrap().agents }) }
  if (path === '/api/mcp' || path === '/api/plugins') {
    if (req.method === 'POST') { const kind = path.endsWith('mcp') ? 'mcp' : 'plugins'; const item = { ...input, id: input.id || `registry-${++id}`, enabled: input.enabled !== false }; registry[kind] = [...registry[kind].filter(r => r.id !== item.id), item]; return json(res, { registry, server: item, plugin: item }) }
    return json(res, registry)
  }
  if (/^\/api\/(mcp|plugins)\//.test(path)) { const [, , kind, itemId] = path.split('/'); if (req.method === 'DELETE') registry[kind] = registry[kind].filter(r => r.id !== itemId); else { const item = registry[kind].find(r => r.id === itemId); item.enabled = input.enabled }; return json(res, { ok: true, registry }) }
  if (path === '/api/health') return json(res, { at: date, results: [{ id: agent.id, label: agent.label, ok: true, durationMs: 1400 }] })
  if (path.startsWith('/api/')) return json(res, { error: 'Fixture route not implemented' }, 404)
  if (path === '/favicon.ico') { res.writeHead(204); res.end(); return }
  try {
    const file = join(publicDir, path === '/' ? 'index.html' : decodeURIComponent(path))
    if (!resolve(file).startsWith(publicDir + '/') && !resolve(file).startsWith(publicDir + '\\')) throw new Error('outside')
    const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' }[extname(file)] || 'application/octet-stream'
    let data = readFileSync(file)
    if (path === '/') data = data.toString().replace('<head>', '<head><script>localStorage.setItem("relay.onboarded","yes");if(!localStorage.getItem("relay.mode"))localStorage.setItem("relay.mode","plan");</script>')
    res.writeHead(200, { 'content-type': type }); res.end(data)
  } catch { res.writeHead(404); res.end('Not found') }
})
const port = Number(process.env.RELAY_FIXTURE_PORT) || 7788
server.listen(port, '127.0.0.1', () => console.log(`Isolated Relay UI fixture: http://127.0.0.1:${port}`))
