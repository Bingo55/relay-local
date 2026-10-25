// Formatting helpers: color, display width, wrapping, labels and plain copy.
// Everything user-facing goes through here so the CLI and TUI stay consistent.

export const COPY = Object.freeze({
  activeRun: 'Something is already running. Wait for it, type /stop to stop it, or /btw for a side question.',
  sessionBusy: 'Finish or stop the current run before switching chats.',
  sideBusy: 'A side answer is still running — wait a moment or stop it.',
  unknownChat: "That chat doesn't exist any more.",
  unknownPlan: "That plan isn't in this chat any more. Ask for a new one.",
  noSideAgent: 'No assistant is free for a side answer right now.',
  serverDown: "Relay isn't running. Starting it…",
  plannerStopped: 'Planning was stopped.',
  noPlanSteps: "The planner didn't suggest any steps. Try rephrasing.",
  stopped: 'Stopped. Nothing else will run.',
  skipped: 'Skipped. Nothing ran.',
  disconnected: 'Lost connection to Relay — retrying. Your chat is saved.',
  reconnected: 'Reconnected.',
  noChanges: 'No file changes were reported.',
  tuiTooSmall: 'Make the window bigger (at least 40 × 12).',
  noTui: "This terminal can't run the full-screen view. Use: relay chat",
  noTty: 'This command needs an interactive terminal. Try: relay "your task"',
  sideTooLong: 'Side questions are limited to 4000 characters.',
  noAgents: 'No assistants are available right now.',
})

export const STATUS_LABELS = Object.freeze({
  running: 'working…',
  done: 'done',
  stopped: 'stopped',
  failed: "didn't finish",
  timeout: 'took too long',
  quota: 'out of free credits',
})

export function statusLabel(status) {
  return STATUS_LABELS[status] || "didn't finish"
}

export function plannerFailed(error) { return `The planner couldn't make a plan: ${error}` }
export function startFailed(where) { return `Couldn't start Relay. In a terminal, run:  cd ${where}  then  npm start` }
export function portBusy(port) { return `Port ${port} is being used by something that isn't answering. Close it, or start Relay yourself.` }
export function sessionChanged(title) { return `This chat was changed in another window — now showing "${title}".` }
export function unknownCommand(name) { return `I don't know ${name}. Type /help.` }
export function stepFailed(label) { return `${label} didn't finish. The last lines are above.` }
export function quotaFallback(from, to) { return `${from} ran out of free credits — Relay switched to ${to} for you.` }
export function quotaNoFallback(label) { return `${label} ran out of free credits. Try again later, or pick another assistant.` }
export function coolingFallback(from, to) { return `${from} was cooling — Relay switched to ${to}.` }

const ANSI_RE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)|[@-_])/g
export function stripAnsi(text) { return String(text ?? '').replace(ANSI_RE, '') }

export function detectColorDepth(env = process.env) {
  if (env.NO_COLOR !== undefined) return 1
  if (env.TERM === 'dumb') return 1
  if (env.COLORTERM) return 256
  if (String(env.TERM || '').includes('256')) return 256
  if (process.platform === 'win32' && (env.WT_SESSION || env.ANSICON || env.ConEmuANSI === 'ON')) return 256
  return 16
}

export function createColors({ enabled = !!process.stdout.isTTY, depth = detectColorDepth() } = {}) {
  const plain = (s) => String(s ?? '')
  if (!enabled || depth <= 1) {
    return {
      enabled: false, depth: 1, bold: plain, dim: plain, italic: plain, underline: plain,
      inverse: plain, yellow: plain, red: plain, green: plain, amber: plain, cyan: plain,
      magenta: plain, brand: plain, white: plain, gray: plain, bgYellow: plain, bgRed: plain,
    }
  }
  const sgr = (n) => `\x1b[${n}m`
  const wrap = (open) => (s) => `${open}${String(s ?? '')}${sgr(0)}`
  const fg = depth >= 256
    ? (n, n16) => sgr(`38;5;${n}`)
    : (n, n16) => sgr(n16)
  return {
    enabled: true,
    depth,
    bold: wrap(sgr(1)),
    dim: wrap(fg(244, 90)),
    italic: wrap(sgr(3)),
    underline: wrap(sgr(4)),
    inverse: wrap(sgr(7)),
    yellow: wrap(fg(221, 93)),
    red: wrap(fg(203, 91)),
    green: wrap(fg(114, 92)),
    amber: wrap(fg(214, 33)),
    cyan: wrap(fg(117, 96)),
    magenta: wrap(fg(176, 95)),
    brand: wrap(fg(121, 92)),
    white: wrap(fg(255, 97)),
    gray: wrap(fg(245, 90)),
    bgYellow: wrap(sgr(43)),
    bgRed: wrap(sgr(41)),
  }
}

export function isWide(cp) {
  return cp >= 0x1100 && (
    cp <= 0x115f || cp === 0x2329 || cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f000 && cp <= 0x1faff) ||
    (cp >= 0x2600 && cp <= 0x27bf)
  )
}

export function isZeroWidth(cp) {
  return (
    (cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) || (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xfe20 && cp <= 0xfe2f) ||
    cp === 0x200b || cp === 0x200c || cp === 0x200d ||
    (cp >= 0x1f3fb && cp <= 0x1f3ff) || cp === 0x20e3
  )
}

export function charWidth(ch) {
  const cp = typeof ch === 'number' ? ch : String(ch).codePointAt(0)
  if (!cp) return 0
  if (cp < 32 || cp === 0x7f) return 0
  if (isZeroWidth(cp)) return 0
  if (isWide(cp)) return 2
  return 1
}

export function displayWidth(text) {
  let w = 0
  for (const ch of stripAnsi(text)) {
    if (ch === '\t') { w += 4; continue }
    w += charWidth(ch)
  }
  return w
}

export function normalizeText(text) {
  let s = String(text ?? '').replace(/\r\n/g, '\n')
  s = s.split('\n').map((line) => {
    const i = line.lastIndexOf('\r')
    return i >= 0 ? line.slice(i + 1) : line
  }).join('\n')
  s = stripAnsi(s)
  return s.split('\n').map((line) => line.replace(/\t/g, '    ').replace(/[ \t]+$/g, '')).join('\n')
}

export function sliceByWidth(text, start, width) {
  if (width <= 0) return ''
  const s = String(text ?? '')
  let col = 0
  let out = ''
  let outW = 0
  for (const ch of s) {
    const cw = charWidth(ch)
    if (col + cw <= start) { col += cw; continue }
    if (col < start) { col += cw; continue }
    if (outW + cw > width) break
    out += ch
    outW += cw
    col += cw
  }
  return out
}

export function cellToIndex(line, targetCol) {
  const s = String(line ?? '')
  let col = 0
  let index = 0
  for (const ch of s) {
    const cw = charWidth(ch)
    if (targetCol < col + cw) {
      return targetCol - col < cw / 2 ? index : index + ch.length
    }
    col += cw
    index += ch.length
  }
  return s.length
}

export function truncate(text, width, ellipsis = '…') {
  const s = String(text ?? '')
  if (width <= 0) return ''
  if (displayWidth(s) <= width) return s
  const ell = displayWidth(ellipsis) <= width ? ellipsis : ''
  const room = width - displayWidth(ell)
  return sliceByWidth(s, 0, room) + ell
}

export function truncateAnsi(text, width, ellipsis = '…') {
  const s = String(text ?? '')
  if (displayWidth(s) <= width) return s
  const target = Math.max(0, width - displayWidth(ellipsis))
  let out = ''
  let w = 0
  let styled = false
  for (let i = 0; i < s.length;) {
    if (s[i] === '\x1b') {
      const m = s.slice(i).match(/^\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)|[@-_])/)
      if (m) { out += m[0]; styled = true; i += m[0].length; continue }
    }
    const ch = s[i]
    const cp = s.codePointAt(i)
    const cw = charWidth(cp)
    if (w + cw > target) break
    out += ch
    w += cw
    i += ch.length
  }
  return out + ellipsis + (styled ? '\x1b[0m' : '')
}

export function padTo(text, width) {
  const s = String(text ?? '')
  const w = displayWidth(s)
  if (w > width) return truncateAnsi(s, width)
  return s + ' '.repeat(Math.max(0, width - w))
}

export function centerLine(text, width) {
  const w = displayWidth(text)
  const left = Math.max(0, Math.floor((width - w) / 2))
  return ' '.repeat(left) + text
}

export function twoSides(left, right, width) {
  const lw = displayWidth(left)
  const rw = displayWidth(right)
  if (lw + rw + 1 > width) {
    const room = Math.max(0, width - rw - 1)
    return truncateAnsi(left, room) + ' '.repeat(Math.max(0, width - room - rw)) + right
  }
  return left + ' '.repeat(width - lw - rw) + right
}

function hardSplit(word, width) {
  const parts = []
  let rest = word
  while (displayWidth(rest) > width) {
    let piece = sliceByWidth(rest, 0, width)
    if (!piece) break
    parts.push(piece)
    rest = rest.slice(piece.length)
  }
  if (rest) parts.push(rest)
  return parts
}

export function wrapText(text, width = 80) {
  const w = Math.max(1, Math.floor(width))
  const lines = normalizeText(text).split('\n')
  const out = []
  for (const line of lines) {
    if (line === '') { out.push(''); continue }
    const indent = (line.match(/^ +/) || [''])[0]
    const body = line.slice(indent.length)
    const tokens = body.match(/\s+|\S+/g) || []
    let current = indent
    let currentW = displayWidth(indent)
    const push = () => {
      out.push(current.replace(/ +$/g, ''))
      current = ''
      currentW = 0
    }
    for (const token of tokens) {
      const tw = displayWidth(token)
      if (/^\s+$/.test(token)) {
        if (currentW === 0) continue
        if (currentW + 1 > w) { push(); continue }
        current += ' '
        currentW += 1
        continue
      }
      if (currentW + tw <= w) {
        current += token
        currentW += tw
        continue
      }
      if (currentW > 0) push()
      if (tw <= w) {
        current = token
        currentW = tw
        continue
      }
      const parts = hardSplit(token, w)
      for (let i = 0; i < parts.length; i++) {
        if (i < parts.length - 1) out.push(parts[i])
        else { current = parts[i]; currentW = displayWidth(parts[i]) }
      }
    }
    if (currentW > 0 || out.length === 0 || lines.length === 1) out.push(current.replace(/ +$/g, ''))
  }
  return out.length ? out : ['']
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm ? `${h}h ${rm}m` : `${h}h`
}

export function timeOf(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

export function relTime(iso, now = Date.now()) {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Math.max(0, now - t)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  const date = new Date(t)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

export function prettyRole(role) {
  const s = String(role || '').replace(/[_-]+/g, ' ').trim()
  if (!s) return 'assistant'
  if (s === 'plan') return 'planner'
  return `${s[0].toUpperCase()}${s.slice(1)} assistant`
}

export function agentLabel(state, ref) {
  const id = String(ref || '')
  if (!id) return 'assistant'
  const found = (state?.agents || []).find((a) => a.id === id || a.label === id)
  if (found?.label) return found.label
  if (state?.roles?.[id]) return prettyRole(id)
  return prettyRole(id)
}

export function planStepLabel(state, step) {
  if (step?.agents?.length) return step.agents.map((a) => agentLabel(state, a)).join(' + ')
  return agentLabel(state, step?.agent)
}

export function instructorName(state, via) {
  if (!via) return 'unknown'
  if (via === 'fast-chat') return 'quick reply'
  if (via === 'manual') return 'you'
  if (via === 'rules') return 'fallback planner'
  const found = (state?.instructors || []).find((i) => i.id === via)
  return found?.label || String(via)
}

export function parsePorcelainLine(line) {
  const raw = String(line ?? '')
  const code = raw.slice(0, 2)
  let path = raw.slice(3)
  if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1).replace(/\\"/g, '"')
  if (/[RC]/.test(code)) {
    const parts = path.split(' -> ')
    path = parts[1] || parts[0] || path
  }
  let label = 'changed'
  if (code === '??' || code.includes('A')) label = 'new'
  else if (code.includes('D')) label = 'deleted'
  else if (code.includes('R')) label = 'moved'
  else if (code.includes('C')) label = 'copied'
  return { code, path, label }
}

export function changedFiles(state, max = 50) {
  const msgs = state?.session?.messages || []
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.role !== 'step' || m.kind === 'btw') continue
    if (!m.git?.after || !Array.isArray(m.git.after.files)) continue
    const seen = new Set()
    const out = []
    for (const raw of m.git.after.files) {
      const f = parsePorcelainLine(raw)
      if (!f.path || seen.has(f.path)) continue
      seen.add(f.path)
      out.push(f)
      if (out.length >= max) break
    }
    return out
  }
  return []
}

export function stepStatusText(m, now = Date.now()) {
  if (!m) return ''
  if (m.status === 'running') {
    const started = new Date(m.startedAt).getTime()
    const elapsed = Number.isFinite(started) ? Math.max(0, now - started) : 0
    return `working… ${formatDuration(elapsed)}`
  }
  if (m.status === 'done') return `done in ${formatDuration(m.durationMs)}`
  if (m.status === 'failed') return m.exitCode != null ? `didn't finish (exit ${m.exitCode})` : "didn't finish"
  return statusLabel(m.status)
}

export function fallbackText(m) {
  const list = m?.fallback || []
  if (!list.length) return ''
  const last = list[list.length - 1]
  return last.reason === 'quota'
    ? quotaFallback(last.from, last.to)
    : coolingFallback(last.from, last.to)
}

export function planLines(state, plan, colors, { width = 80, approval = false } = {}) {
  const c = colors
  const out = [c.bold(c.yellow('WHAT WILL HAPPEN'))]
  if (plan.note) out.push(...wrapText(plan.note, width).map((l) => c.dim(l)))
  const steps = plan.steps || []
  steps.forEach((s, i) => {
    const why = String(s.why || '').trim()
    let line = `  ${i + 1}. ${planStepLabel(state, s)}`
    if (why) line += ` — ${why}`
    const wrapped = wrapText(line, width)
    out.push(...wrapped.map((l, j) => (j === 0 ? l : `     ${l.trim()}`)))
  })
  out.push('')
  const via = plan.via ? ` · planner: ${instructorName(state, plan.via)}` : ''
  out.push(c.dim(`  ${steps.length} step${steps.length === 1 ? '' : 's'}${via}`))
  if (approval) out.push(c.bold(c.yellow('  Run this?  Enter = run · n = skip')))
  return out
}

export function summarySentence(summary) {
  if (!summary) return 'Nothing ran.'
  if (summary.stopped > 0) return `Stopped after ${summary.finished} of ${summary.total} steps.`
  if (!summary.total) return 'Nothing ran.'
  const parts = [`${summary.finished} of ${summary.total} steps finished`]
  const files = summary.files?.length || 0
  if (files) parts.push(`${files} file${files === 1 ? '' : 's'} changed`)
  const problems = summary.problems || 0
  if (problems) parts.push(`${problems} problem${problems === 1 ? '' : 's'}`)
  else parts.push('no problems')
  return parts.join(' · ')
}

export function summaryLines(summary, colors, { maxFiles = 8 } = {}) {
  const c = colors
  const out = [c.bold(c.green('WHAT HAPPENED')), `  ${summarySentence(summary)}`]
  const files = summary?.files || []
  if (files.length) {
    const shown = files.slice(0, maxFiles)
    const more = files.length - shown.length
    out.push(c.dim('  Changed: ') + shown.join(', ') + (more > 0 ? ` +${more} more` : ''))
    out.push(c.dim('  Next: check the changed files.'))
  } else if (summary?.total) {
    out.push(c.dim(`  ${COPY.noChanges}`))
  }
  if (summary?.problems > 0) {
    out.push(c.dim('  Next: read the step above, then ask Relay to try again.'))
  }
  return out
}

const AGENT_FIELDS = ['id', 'label', 'roles', 'model', 'models', 'caps', 'disabled', 'note', 'defaultFor']
export function sanitizeAgent(agent) {
  const out = {}
  for (const k of AGENT_FIELDS) if (agent && agent[k] !== undefined) out[k] = agent[k]
  return out
}

function quotaBar(percent, width = 18) {
  const p = percent == null ? 0 : Math.max(0, Math.min(100, Number(percent) || 0))
  const filled = Math.round((p / 100) * width)
  return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}`
}

function quotaColor(colors, level) {
  if (level === 'green') return colors.green
  if (level === 'orange') return colors.amber
  if (level === 'red') return colors.red
  if (level === 'out') return colors.white
  return colors.gray
}

export function quotaLines(state, colors) {
  const c = colors
  const q = state.quota
  const out = [c.bold('QUOTA')]
  if (!q) {
    out.push(c.dim('  No quota snapshot yet. Start Relay, then try /quota again.'))
    return out
  }
  out.push(c.dim('  Relay-observed calls vs. editable local caps. Provider dashboards win.'))
  if (q.route) {
    const color = quotaColor(c, q.route.level)
    const pct = q.route.percent == null ? 'n/a' : `${q.route.percent}%`
    out.push(`  next route: ${color(q.route.label)} ${c.dim(`(${pct})`)}`)
  } else {
    out.push(c.dim('  next route: none eligible (all cooling/out)'))
  }
  out.push('')
  for (const a of q.agents || []) {
    const bar = quotaBar(a.percent)
    const color = quotaColor(c, a.level)
    const pct = a.percent == null ? ' n/a' : `${String(a.percent).padStart(3)}%`
    const used = a.limit > 0 ? `${a.used}/${a.limit} ${a.window}` : `${a.used} calls`
    let status = ''
    if (a.disabled) status = ' off'
    else if (a.cooling) status = ' cooling'
    else if (a.out) status = ` out: ${a.outReason || 'quota'}`
    else if (a.level === 'out') status = ' out: 95%+'
    const line = `  ${padTo(a.label || a.id, 18)} ${color(bar)} ${pct} ${c.dim(used)}${status ? color(status) : ''}`
    out.push(line)
  }
  out.push('')
  out.push(c.dim('  green <50 · orange 50–79 · red 80–94 · white 95+ / out'))
  out.push(c.dim('  set a cap: relay quota set <agent> <n>   ·   reset: relay quota reset <agent>'))
  return out
}

export function agentLines(state, colors) {
  const c = colors
  const out = [c.bold('ASSISTANTS')]
  const roles = state.roles || {}
  for (const raw of state.agents || []) {
    const a = sanitizeAgent(raw)
    const works = Object.entries(roles).filter(([, list]) => list.includes(a.id)).map(([r]) => r)
    let line = `  ${a.label || a.id}`
    if (a.disabled) line += c.dim(' — unavailable')
    out.push(line)
    if (works.length) out.push(c.dim(`    works on: ${works.join(', ')}`))
    if (a.disabled && a.note) out.push(c.dim(`    ${a.note}`))
    else if (a.caps) out.push(c.dim(`    ${a.caps}`))
  }
  return out
}

export function modelLines(state, colors) {
  const c = colors
  const out = [c.bold('MODELS')]
  for (const raw of state.agents || []) {
    const a = sanitizeAgent(raw)
    if (!a.models?.length) continue
    out.push(`  ${a.label || a.id}${a.disabled ? c.dim(' — unavailable') : ''}`)
    for (const m of a.models) out.push(c.dim(`    ${m}`))
  }
  const roles = state.roles || {}
  if (Object.keys(roles).length) {
    out.push('', c.bold('ROLES'))
    for (const [role, list] of Object.entries(roles)) {
      out.push(`  ${role}: ${list.map((id) => agentLabel(state, id)).join(', ')}`)
    }
  }
  return out
}

export function instructorLines(state, colors) {
  const c = colors
  const out = [c.bold('PLANNER')]
  for (const i of state.instructors || []) {
    out.push(`  ${i.label || i.id}${i.id === state.session?.instructor ? c.dim('  (current)') : ''}`)
  }
  out.push(c.dim('  auto — let Relay pick the best available planner'))
  return out
}

export function sessionLines(state, colors, now = Date.now()) {
  const c = colors
  const rows = []
  rows.push(c.bold('CHATS'))
  rows.push(c.dim('  #   chat                                     updated      messages'))
  const sessions = state.sessions || []
  sessions.forEach((s, i) => {
    const active = s.id === state.session?.id
    const idx = String(i + 1).padStart(2)
    const title = truncate(s.title || 'Untitled run', 38)
    const upd = truncate(relTime(s.updatedAt, now), 10)
    const count = String(s.count ?? 0).padStart(4)
    rows.push(`  ${idx}  ${padTo(title, 38)}  ${padTo(upd, 10)}  ${count}${active ? c.green('  ● active') : ''}`)
  })
  if (!sessions.length) rows.push(c.dim('  No chats yet.'))
  return rows
}

export function statusLines(state, colors) {
  const c = colors
  const s = state.session
  const lastStep = [...(s?.messages || [])].reverse().find((m) => m.role === 'step' && m.kind !== 'btw')
  const files = changedFiles(state)
  const planner = s?.instructor === 'auto'
    ? 'auto (pick the best planner)'
    : instructorName(state, s?.instructor)
  return [
    c.bold('STATUS'),
    `  Chat:     ${s?.title || 'no chat'}`,
    `  Folder:   ${s?.cwd || 'not set'}`,
    `  Planner:  ${planner}`,
    `  Model:    ${state.model || 'each assistant’s default'}`,
    `  State:    ${state.busy ? 'working' : 'ready'}`,
    `  Last:     ${lastStep ? `${lastStep.label || agentLabel(state, lastStep.agent)} — ${statusLabel(lastStep.status)}` : 'Nothing yet.'}`,
    `  Files:    ${files.length ? files.map((f) => f.path).slice(0, 6).join(', ') : COPY.noChanges}`,
  ]
}
