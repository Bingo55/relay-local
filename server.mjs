// Relay server: static UI, JSON API, SSE stream. Localhost only.
import http from 'node:http'
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Store, Bus, rid } from './lib/store.mjs'
import { makePlan, resolveAgent, readConfig, INSTRUCTOR, isCooling, orchestratePlan } from './lib/plan.mjs'
import { runSteps } from './lib/execute.mjs'
import { quota } from './lib/quota.mjs'
import { connections } from './lib/connections.mjs'
import { publicProviders } from './lib/providers.mjs'
import { registry } from './lib/registry.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const cfg = readConfig(join(here, 'agents.json'))
connections.apply(cfg)
const store = new Store(join(here, 'sessions'))
const bus = new Bus()
const active = new Map()
const control = { stopped: false }
const liveSessions = new Map()
const runningCounts = new Map()
let busy = false
let btwRuns = 0

// Keep the in-memory copy of every session the user opens. A run holds its own
// session object; switching views must not swap the object out from under it.
function getSession(id) {
  if (liveSessions.has(id)) return liveSessions.get(id)
  const s = store.get(id)
  if (!s) return null
  s.instructor ||= cfg.defaultInstructor || 'opencode'
  s.notes ||= []
  liveSessions.set(s.id, s)
  return s
}

function markRunning(id, delta) {
  const n = (runningCounts.get(id) || 0) + delta
  if (n > 0) runningCounts.set(id, n)
  else runningCounts.delete(id)
}

function broadcastStatus() {
  bus.emit({
    type: 'busy',
    busy,
    btwRuns,
    runningSessionIds: [...runningCounts.keys()],
  })
}

const newSession = () => {
  // Default to the disposable scratch repo, never the relay app itself: agents
  // with permission bypass enabled can write wherever cwd points.
  const scratch = join(here, 'scratch')
  mkdirSync(scratch, { recursive: true })
  const s = store.create({ cwd: scratch })
  s.instructor = cfg.defaultInstructor || 'opencode'
  s.notes = []
  store.save(s)
  store.setActive(s.id)
  liveSessions.set(s.id, s)
  return s
}

let session = (store.activeId() && getSession(store.activeId())) || newSession()

const json = (res, code, data) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(data))
}

const body = (req) =>
  new Promise((resolve) => {
    let d = ''
    req.on('data', (c) => (d += c))
    req.on('end', () => {
      try { resolve(JSON.parse(d || '{}')) } catch { resolve({}) }
    })
  })

// Connected agents carry a raw API key in memory. Never let that reach the
// browser; the connection list exposes only a hint.
const publicAgents = () => cfg.agents.map(({ apiKey, ...agent }) => agent)

// If the user picked a specific connected model, make the planner use it for
// the final non-fan-out step unless the plan already routed to that agent.
function preferModelAgent(plan, agentId, model, cfg) {
  if (!agentId || !plan?.steps?.length) return plan
  const agent = cfg.agents.find((a) => a.id === agentId && !a.disabled)
  if (!agent) return plan
  const used = plan.steps.some((s) => (s.agents?.length ? s.agents : [s.agent]).includes(agentId))
  if (!used) {
    const idx = [...plan.steps].map((s, i) => ({ s, i })).reverse().find(({ s }) => !s.agents?.length)?.i
    if (idx != null) plan.steps[idx].agent = agentId
  }
  if (model && agent.models?.includes(model)) {
    for (const step of plan.steps) {
      const names = step.agents?.length ? step.agents : [step.agent]
      if (names.includes(agentId)) step.model = model
    }
  }
  return plan
}

// Route every event to the session that owns the run, not whichever session
// the sidebar currently has selected. Switching views must not misroute output.
const emitFor = (target, event) => {
  if (!target) return
  if (event.type === 'notice') {
    const note = { id: rid('msg'), role: 'note', text: event.text, at: new Date().toISOString() }
    target.messages.push(note)
    store.save(target)
    bus.emit({ type: 'message', message: note, sessionId: target.id })
  }
  // Keep the partial streamed answer in memory so switching back to a running
  // session restores it instead of starting from an empty step.
  if (event.type === 'delta') {
    const msg = target.messages.find((m) => m.id === event.id)
    if (msg) msg.text = event.text
  }
  bus.emit({ ...event, sessionId: target.id })
  // Keep open dashboards current without another request loop. These events
  // are cheap to build and only fire around agent lifecycle changes.
  if (event.type === 'agent' || event.type === 'message.update') {
    bus.emit({ type: 'quota', quota: quota.snapshot(cfg, { isCooling }), sessionId: target.id })
  }
}

const emit = (event) => emitFor(session, event)

function setBusy(v) {
  busy = v
  broadcastStatus()
}

function parseChain(text, cfg) {
  const steps = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:fanout\[\s*([a-z0-9_,\s-]+)\s*\]|([a-z0-9_-]+))\s*:\s*(.+)$/i)
    if (m && m[1]) {
      const agents = [...new Set(m[1].split(',').map((x) => x.trim()).filter(Boolean))]
      if (agents.length === 1) {
        steps.push({ agent: agents[0], prompt: m[3].trim(), why: 'manual chain' })
        continue
      }
      if (agents.length >= 2) {
        steps.push({ agents, prompt: m[3].trim(), why: 'manual chain (fan-out)' })
        continue
      }
    } else if (m && (cfg.roles?.[m[2]] || cfg.agents.some((a) => a.id === m[2]))) {
      steps.push({ agent: m[2], prompt: m[3].trim(), why: 'manual chain' })
    } else if (steps.length && line.trim()) {
      steps[steps.length - 1].prompt += `\n${line}`
    } else if (line.trim() && !line.trim().startsWith('#')) {
      steps.push({ agent: 'plan', prompt: line.trim(), why: 'manual chain' })
    }
  }
  return steps
}

const PRESETS = join(here, 'presets.json')
const readPresets = () => {
  try { return JSON.parse(readFileSync(PRESETS, 'utf8')) } catch { return {} }
}

async function executePlan(plan, task, model, runSession = session) {
  if (busy) return { error: 'another run is active' }
  busy = true
  markRunning(runSession.id, 1)
  broadcastStatus()
  const runEmit = (event) => emitFor(runSession, event)
  try {
    await runSteps({ cfg, store, session: runSession, steps: plan.steps, task, model, emit: runEmit, active, control })
  } catch (e) {
    runEmit({ type: 'notice', text: `run failed: ${e.message}` })
  } finally {
    markRunning(runSession.id, -1)
    busy = false
    broadcastStatus()
  }
  return { ok: true }
}

const clip = (s, n) => String(s || '').slice(0, n)

function sidePrompt({ text, mainTask, latest }) {
  return `You are answering a quick side question while another agent may be working on the main task. Answer in 1-3 short sentences. Do not use tools, read files, make edits, or restate the whole task.

${mainTask ? `MAIN TASK:\n${clip(mainTask, 2000)}\n\n` : ''}${latest ? `LATEST COMPLETED OUTPUT:\n${clip(latest, 4000)}\n\n` : ''}SIDE QUESTION OR FINAL OBJECTIVE:
${clip(text, 4000)}

If this is an instruction or objective, confirm it briefly; it is saved as a side note for the remaining steps.`
}

function startBtw({ text, agent, mainTask, latest }, runSession = session) {
  btwRuns++
  markRunning(runSession.id, 1)
  broadcastStatus()
  const prompt = sidePrompt({ text, mainTask, latest })
  const sideControl = { stopped: false }
  const runEmit = (event) => emitFor(runSession, event)
  ;(async () => {
    try {
      await runSteps({
        cfg,
        store,
        session: runSession,
        steps: [{ agent: agent.id, prompt, why: 'btw · side answer', kind: 'btw', question: text }],
        task: mainTask || text,
        emit: runEmit,
        active,
        control: sideControl,
      })
    } catch (e) {
      runEmit({ type: 'notice', text: `btw failed: ${e.message}` })
    } finally {
      btwRuns--
      markRunning(runSession.id, -1)
      broadcastStatus()
    }
  })()
}

function serveStatic(req, res, root) {
  const send = (code, data, headers = {}) => {
    res.writeHead(code, { 'cache-control': 'no-store', ...headers })
    res.end(data)
    return true
  }
  // Check the decoded raw path before URL parsing can erase traversal segments.
  const raw = req.url.split(/[?#]/, 1)[0]
  let path
  try { path = decodeURIComponent(raw) } catch {
    return req.method === 'GET' && /^\/(?:assets|fonts)(?:[/\\%]|$)/.test(raw) ? send(400, 'Bad path') : false
  }
  const index = path === '/' || path === '/index.html'
  if (!index && (req.method !== 'GET' || !/^\/(?:assets|fonts)(?:[/\\]|$)/.test(path))) return false
  if (/[\\%\x00-\x1f\x7f:]|(?:^|\/)\.\.?(?:\/|$)|[. ](?:\/|$)/.test(path)) return send(400, 'Bad path')
  const types = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' }
  const type = index ? 'text/html; charset=utf-8' : types[extname(path)]
  if (!type) return send(404, 'Not found')
  try {
    const base = resolve(root)
    const file = resolve(base, `.${index ? '/index.html' : path}`)
    const within = (dir, target) => {
      const rel = relative(dir, target)
      return rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
    }
    if (!within(base, file)) return send(403, 'Forbidden')
    const real = realpathSync(file)
    if (!within(realpathSync(base), real)) return send(403, 'Forbidden')
    if (!statSync(real).isFile()) return send(404, 'Not found')
    const data = readFileSync(real)
    const hashed = !index && path.startsWith('/assets/') && /-[A-Za-z0-9_-]{8}\.[^./]+$/.test(path)
    return send(200, data, { 'content-type': type, 'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-store' })
  } catch (e) {
    if (index && e.code === 'ENOENT') return send(200, '<!doctype html><meta charset="utf-8"><title>Relay</title><p>Build the UI first: <code>npm run build</code></p>', { 'content-type': type })
    return send(404, 'Not found')
  }
}

const PORT = cfg.port || 7777
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`])
const ALLOWED_ORIGINS = new Set([...ALLOWED_HOSTS].map((host) => `http://${host}`))

const server = http.createServer(async (req, res) => {
  try {
    // Reject DNS-rebinding attempts and cross-site writes. The UI and terminal
    // client both talk to loopback; anything else is not a legitimate caller.
    const host = String(req.headers.host || '').toLowerCase()
    if (!ALLOWED_HOSTS.has(host)) return json(res, 403, { error: 'forbidden host' })

    const origin = String(req.headers.origin || '').toLowerCase()
    if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: 'forbidden origin' })

    const hasBody =
      Number(req.headers['content-length'] || 0) > 0 || Boolean(req.headers['transfer-encoding'])
    if (req.method !== 'GET' && req.method !== 'HEAD' && hasBody) {
      const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
      if (type !== 'application/json') {
        return json(res, 415, { error: 'content-type must be application/json' })
      }
    }

    if (serveStatic(req, res, join(here, 'public'))) return
    const url = new URL(req.url, 'http://127.0.0.1')
    const path = url.pathname

    if (path === '/favicon.ico') { res.writeHead(204); return res.end() }

    if (path === '/api/bootstrap') {
      quota.load()
      return json(res, 200, {
        session,
        sessions: store.list(),
        agents: publicAgents(),
        roles: cfg.roles,
        instructors: Object.entries(INSTRUCTOR).map(([id, instructor]) => ({ id, label: instructor.label })),
        busy,
        btwRuns,
        runningSessionIds: [...runningCounts.keys()],
        root: here,
        quota: quota.snapshot(cfg, { isCooling }),
        connections: connections.list(),
        registry: registry.snapshot(),
      })
    }

    if (path === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.write(`data: ${JSON.stringify({ type: 'hello', session, busy, btwRuns, runningSessionIds: [...runningCounts.keys()] })}\n\n`)
      const off = bus.add(res)
      const ping = setInterval(() => { try { res.write(': ping\n\n') } catch {} }, 25_000)
      req.on('close', () => { clearInterval(ping); off() })
      return
    }

    if (path === '/api/session' && req.method === 'POST') {
      // Runs keep their own session object, so switching views is safe while
      // work continues in the background.
      session = newSession()
      return json(res, 200, { session })
    }

    if (path.startsWith('/api/session/') && req.method === 'POST') {
      const id = decodeURIComponent(path.split('/')[3] || '')
      const found = getSession(id)
      if (!found) return json(res, 404, { error: 'no such session' })
      session = found
      store.setActive(id)
      return json(res, 200, { session })
    }

    if (path.startsWith('/api/session/') && req.method === 'DELETE') {
      const id = decodeURIComponent(path.split('/')[3] || '')
      if (!/^ses_[a-z0-9]+$/.test(id)) return json(res, 400, { error: 'bad session id' })
      if (id === session.id) return json(res, 409, { error: 'cannot delete the active session; switch to another first' })
      if (runningCounts.has(id)) return json(res, 409, { error: 'session has an active run; stop it before deleting' })
      if (!getSession(id)) return json(res, 404, { error: 'no such session' })
      store.remove(id)
      liveSessions.delete(id)
      return json(res, 200, { deleted: id })
    }

    if (path === '/api/cwd' && req.method === 'POST') {
      const { cwd } = await body(req)
      if (!cwd) return json(res, 400, { error: 'cwd required' })
      session.cwd = cwd
      store.save(session)
      return json(res, 200, { cwd: session.cwd })
    }

    if (path === '/api/instructor' && req.method === 'POST') {
      const { instructor } = await body(req)
      if (!instructor || (instructor !== 'auto' && !INSTRUCTOR[instructor])) {
        return json(res, 400, { error: `unknown instructor ${instructor || ''}`.trim() })
      }
      session.instructor = instructor
      store.save(session)
      return json(res, 200, { instructor: session.instructor })
    }

    if (path === '/api/rename' && req.method === 'POST') {
      const { title } = await body(req)
      if (!title?.trim()) return json(res, 400, { error: 'title required' })
      session.title = title.trim().slice(0, 120)
      store.save(session)
      return json(res, 200, { session })
    }

    if (path === '/api/btw' && req.method === 'POST') {
      const reqSession = session
      const { text } = await body(req)
      const question = String(text || '').trim().slice(0, 4000)
      if (!question) return json(res, 400, { error: 'text required' })
      const side = resolveAgent('chat', cfg) || resolveAgent('build', cfg)
      if (!side) return json(res, 503, { error: 'no side agent available' })
      reqSession.notes ||= []
      const note = { id: rid('note'), text: question.slice(0, 2000), at: new Date().toISOString() }
      reqSession.notes.push(note)
      store.save(reqSession)
      const recent = [...reqSession.messages].reverse()
      const mainTask = recent.find((m) => m.role === 'plan' && m.task)?.task || recent.find((m) => m.role === 'user')?.text || ''
      const last = recent.find((m) => m.role === 'step' && m.kind !== 'btw' && m.text)
      const latest = last ? `${last.label || last.agent} · ${last.status}\n${last.text}` : ''
      startBtw({ text: question, agent: side, mainTask, latest }, reqSession)
      return json(res, 200, { note, notes: reqSession.notes, agent: side.label, queued: true })
    }

    if (path === '/api/presets' && req.method === 'GET') {
      return json(res, 200, { presets: readPresets() })
    }

    if (path === '/api/presets' && req.method === 'POST') {
      const { name, note, steps } = await body(req)
      if (!name?.trim() || !Array.isArray(steps) || !steps.length) return json(res, 400, { error: 'name and steps required' })
      const all = readPresets()
      all[name.trim()] = { note: String(note || '').slice(0, 200), steps }
      writeFileSync(PRESETS, JSON.stringify(all, null, 2), 'utf8')
      return json(res, 200, { presets: all })
    }

    if (path === '/api/health' && req.method === 'GET') {
      try {
        return json(res, 200, JSON.parse(readFileSync(join(here, 'probe-report.json'), 'utf8')))
      } catch {
        return json(res, 200, { at: null, results: [] })
      }
    }

    if (path === '/api/quota' && req.method === 'GET') {
      quota.load()
      return json(res, 200, quota.snapshot(cfg, { isCooling }))
    }

    if (path === '/api/quota/config' && req.method === 'POST') {
      quota.load()
      const { agent, limit, window } = await body(req)
      if (!agent || !cfg.agents.some((a) => a.id === agent)) return json(res, 404, { error: 'no such agent' })
      const n = Number(limit)
      if (!Number.isFinite(n) || n < 0) return json(res, 400, { error: 'limit must be a number >= 0' })
      const updated = quota.configure(String(agent), { limit: n, window: window ? String(window) : undefined }, cfg)
      if (!updated) return json(res, 404, { error: 'no such agent' })
      return json(res, 200, { ok: true, agent: updated, quota: quota.snapshot(cfg, { isCooling }) })
    }

    if (path === '/api/quota/reset' && req.method === 'POST') {
      quota.load()
      const { agent } = await body(req)
      if (agent && !cfg.agents.some((a) => a.id === agent)) return json(res, 404, { error: 'no such agent' })
      if (agent) quota.reset(String(agent), cfg)
      else quota.resetAll()
      return json(res, 200, { ok: true, quota: quota.snapshot(cfg, { isCooling }) })
    }

    if (path === '/api/providers' && req.method === 'GET') {
      return json(res, 200, { providers: publicProviders() })
    }

    if (path === '/api/connections' && req.method === 'GET') {
      return json(res, 200, { connections: connections.list() })
    }

    if (path === '/api/connections' && req.method === 'POST') {
      try {
        const saved = connections.upsert(await body(req))
        connections.apply(cfg)
        return json(res, 200, { connection: saved, connections: connections.list(), agents: publicAgents() })
      } catch (e) {
        return json(res, 400, { error: e.message })
      }
    }

    if (path.startsWith('/api/connections/') && req.method === 'DELETE') {
      const id = decodeURIComponent(path.split('/')[3] || '')
      if (!connections.remove(id)) return json(res, 404, { error: 'no such connection' })
      connections.apply(cfg)
      return json(res, 200, { ok: true, connections: connections.list(), agents: publicAgents() })
    }

    if (path === '/api/mcp' && req.method === 'GET') {
      return json(res, 200, registry.snapshot())
    }

    if (path === '/api/mcp' && req.method === 'POST') {
      try {
        const saved = registry.upsertMcp(await body(req))
        return json(res, 200, { server: saved, registry: registry.snapshot() })
      } catch (e) {
        return json(res, 400, { error: e.message })
      }
    }

    if (path.startsWith('/api/mcp/') && req.method === 'POST') {
      const id = decodeURIComponent(path.split('/')[3] || '')
      const { enabled } = await body(req)
      const saved = registry.toggleMcp(id, enabled)
      if (!saved) return json(res, 404, { error: 'no such MCP server' })
      return json(res, 200, { server: saved, registry: registry.snapshot() })
    }

    if (path.startsWith('/api/mcp/') && req.method === 'DELETE') {
      const id = decodeURIComponent(path.split('/')[3] || '')
      if (!registry.removeMcp(id)) return json(res, 404, { error: 'no such MCP server' })
      return json(res, 200, { ok: true, registry: registry.snapshot() })
    }

    if (path === '/api/plugins' && req.method === 'GET') {
      return json(res, 200, registry.snapshot())
    }

    if (path === '/api/plugins' && req.method === 'POST') {
      try {
        const saved = registry.upsertPlugin(await body(req))
        return json(res, 200, { plugin: saved, registry: registry.snapshot() })
      } catch (e) {
        return json(res, 400, { error: e.message })
      }
    }

    if (path.startsWith('/api/plugins/') && req.method === 'POST') {
      const id = decodeURIComponent(path.split('/')[3] || '')
      const { enabled } = await body(req)
      const saved = registry.togglePlugin(id, enabled)
      if (!saved) return json(res, 404, { error: 'no such plugin' })
      return json(res, 200, { plugin: saved, registry: registry.snapshot() })
    }

    if (path.startsWith('/api/plugins/') && req.method === 'DELETE') {
      const id = decodeURIComponent(path.split('/')[3] || '')
      if (!registry.removePlugin(id)) return json(res, 404, { error: 'no such plugin' })
      return json(res, 200, { ok: true, registry: registry.snapshot() })
    }

    if (path === '/api/plan' && req.method === 'POST') {
      const reqSession = session
      const { text, auto, model, instructor, mode, modelAgent } = await body(req)
      if (!text?.trim()) return json(res, 400, { error: 'text required' })
      if (instructor && instructor !== 'auto' && !INSTRUCTOR[instructor]) return json(res, 400, { error: `unknown instructor ${instructor}` })
      if (busy) return json(res, 409, { error: 'another run is active' })
      const task = text.trim()
      const runMode = ['plan', 'code', 'orchestrate'].includes(mode) ? mode : 'code'
      const shouldAuto = runMode === 'plan' ? false : runMode === 'code' ? true : !!auto
      control.stopped = false

      // A greeting is not a coding task. Skip the planner and the coding-agent
      // loop so "hi" costs one fast agent call, not a full build pipeline.
      const CHAT_RE = /^(hi|hello|hey|yo|hiya|howdy|thanks|thank you|good (morning|afternoon|evening)|how are you|what'?s up|sup|bye|goodbye|ok|okay|cool|nice)[\s!.?]*$/i
      if (task.length <= 40 && CHAT_RE.test(task)) {
        const preferred = modelAgent ? cfg.agents.find((a) => a.id === modelAgent && !a.disabled) : null
        const agent = preferred || resolveAgent('chat', cfg) || resolveAgent('build', cfg)
        if (!agent) return json(res, 503, { error: 'no agent available for a quick reply' })
        const user = { id: rid('msg'), role: 'user', text: task, at: new Date().toISOString() }
        const plan = {
          note: 'quick reply — greeting, no planning or tools',
          steps: [{ agent: agent.id, prompt: "Reply to the user's greeting in one or two natural sentences. Ignore any prior project context. Do not use tools, read files, or run commands.", why: 'conversational message' }],
        }
        const planMsg = {
          id: rid('plan'),
          role: 'plan',
          task,
          note: plan.note,
          steps: plan.steps,
          via: 'fast-chat',
          mode: runMode,
          model: model || '',
          at: new Date().toISOString(),
        }
        reqSession.messages.push(user, planMsg)
        store.save(reqSession)
        emitFor(reqSession, { type: 'message', message: user })
        emitFor(reqSession, { type: 'message', message: planMsg })
        if (shouldAuto) executePlan(plan, task, model, reqSession)
        return json(res, 200, { plan: planMsg })
      }

      control.stopped = false
      setBusy(true)
      try {
        const user = { id: rid('msg'), role: 'user', text: task, at: new Date().toISOString() }
        reqSession.messages.push(user)
        store.save(reqSession)
        emitFor(reqSession, { type: 'message', message: user })

        const { plan, via, attempts, stopped } = await makePlan({
          task,
          cfg,
          pinned: reqSession.pinned,
          notes: reqSession.notes,
          instructor: instructor || reqSession.instructor || cfg.defaultInstructor,
          emit: (event) => emitFor(reqSession, event),
          routerDir: join(here, 'router'),
          control,
          active,
          mode: runMode,
        })
        if (stopped || control.stopped) {
          setBusy(false)
          return json(res, 200, { stopped: true })
        }
        if (!plan) {
          setBusy(false)
          return json(res, 503, { error: 'no eligible agents — all are disabled, cooling, or out of quota' })
        }
        preferModelAgent(plan, modelAgent, model, cfg)
        const planMsg = {
          id: rid('plan'),
          role: 'plan',
          task,
          note: plan.note,
          steps: plan.steps,
          via,
          detail: attempts,
          mode: runMode,
          model: model || '',
          at: new Date().toISOString(),
        }
        reqSession.messages.push(planMsg)
        store.save(reqSession)
        emitFor(reqSession, { type: 'message', message: planMsg })
        setBusy(false)
        if (shouldAuto && !control.stopped) executePlan(plan, planMsg.task, model, reqSession)
        return json(res, 200, { plan: planMsg })
      } catch (e) {
        setBusy(false)
        return json(res, 500, { error: e.message })
      }
    }

    if (path === '/api/orchestrate' && req.method === 'POST') {
      if (busy) return json(res, 409, { error: 'another run is active' })
      const reqSession = session
      const { text, model, modelAgent } = await body(req)
      if (!text?.trim()) return json(res, 400, { error: 'text required' })
      const task = text.trim()
      const built = orchestratePlan(task, cfg, { model, modelAgent })
      if (!built.plan) return json(res, 503, { error: built.error || 'no eligible agents' })
      control.stopped = false
      const user = { id: rid('msg'), role: 'user', text: task, at: new Date().toISOString() }
      const planMsg = {
        id: rid('plan'),
        role: 'plan',
        task,
        note: built.plan.note,
        steps: built.plan.steps,
        via: built.via,
        mode: 'orchestrate',
        agents: built.agents,
        model: model || '',
        at: new Date().toISOString(),
      }
      reqSession.messages.push(user, planMsg)
      store.save(reqSession)
      emitFor(reqSession, { type: 'message', message: user })
      emitFor(reqSession, { type: 'message', message: planMsg })
      executePlan(built.plan, task, model, reqSession)
      return json(res, 200, { plan: planMsg })
    }

    if (path === '/api/run' && req.method === 'POST') {
      if (busy) return json(res, 409, { error: 'another run is active' })
      const reqSession = session
      const b = await body(req)
      let plan = b.steps?.length ? { steps: b.steps, note: b.note } : null
      let task = b.task
      if (!plan && b.planId) {
        const msg = reqSession.messages.find((m) => m.id === b.planId)
        if (!msg) return json(res, 404, { error: 'no such plan' })
        plan = { steps: msg.steps, note: msg.note }
        task = msg.task
      }
      if (!plan) return json(res, 400, { error: 'steps or planId required' })
      for (const s of plan.steps) {
        for (const name of s.agents?.length ? s.agents : [s.agent]) {
          const named = cfg.agents.find((a) => a.id === name)
          if (named?.disabled) return json(res, 400, { error: `${named.label} is disabled: ${named.note || 'see agents.json'}` })
          if (!resolveAgent(name, cfg) && !cfg.roles?.[name]) return json(res, 400, { error: `unknown agent ${name}` })
        }
      }
      control.stopped = false
      executePlan(plan, task || '', b.model, reqSession)
      return json(res, 200, { ok: true })
    }

    if (path === '/api/chain' && req.method === 'POST') {
      if (busy) return json(res, 409, { error: 'another run is active' })
      const reqSession = session
      const { text, task, model } = await body(req)
      const steps = parseChain(text || '', cfg)
      if (!steps.length) return json(res, 400, { error: 'no steps parsed' })
      for (const s of steps) {
        for (const name of s.agents?.length ? s.agents : [s.agent]) {
          if (!resolveAgent(name, cfg) && !cfg.roles?.[name]) return json(res, 400, { error: `unknown agent ${name}` })
        }
      }
      const user = { id: rid('msg'), role: 'user', text: text.trim(), at: new Date().toISOString() }
      reqSession.messages.push(user)
      store.save(reqSession)
      emitFor(reqSession, { type: 'message', message: user })
      const planMsg = { id: rid('plan'), role: 'plan', task: task || text, note: 'manual chain', steps, via: 'manual', model: model || '', at: new Date().toISOString() }
      reqSession.messages.push(planMsg)
      store.save(reqSession)
      emitFor(reqSession, { type: 'message', message: planMsg })
      control.stopped = false
      executePlan({ steps }, task || text, model, reqSession)
      return json(res, 200, { plan: planMsg })
    }

    if (path === '/api/dispatch' && req.method === 'POST') {
      if (busy) return json(res, 409, { error: 'another run is active' })
      const reqSession = session
      const { agent, prompt, model } = await body(req)
      if (!agent || !prompt) return json(res, 400, { error: 'agent and prompt required' })
      const user = { id: rid('msg'), role: 'user', text: prompt, at: new Date().toISOString() }
      reqSession.messages.push(user)
      store.save(reqSession)
      emitFor(reqSession, { type: 'message', message: user })
      control.stopped = false
      executePlan({ steps: [{ agent, prompt, why: 'manual dispatch' }] }, prompt, model, reqSession)
      return json(res, 200, { ok: true })
    }

    if (path === '/api/stop' && req.method === 'POST') {
      const already = control.stopped
      control.stopped = true
      for (const run of active.values()) run.stop()
      if (!already && (busy || active.size)) emit({ type: 'notice', text: 'stop requested — press Esc again if it is still running' })
      if (!active.size) setBusy(false)
      return json(res, 200, { ok: true })
    }

    if (path === '/api/pin' && req.method === 'POST') {
      const { stepId, on } = await body(req)
      const msg = session.messages.find((m) => m.id === stepId && m.role === 'step')
      if (!msg) return json(res, 404, { error: 'no such step' })
      session.pinned = (session.pinned || []).filter((p) => p.stepId !== stepId)
      if (on) session.pinned.push({ stepId, agent: msg.agent, text: msg.text || '', at: new Date().toISOString() })
      store.save(session)
      return json(res, 200, { pinned: session.pinned })
    }

    if (path.startsWith('/api/step/')) {
      const id = path.split('/')[3]
      const msg = session.messages.find((m) => m.id === id)
      if (!msg) return json(res, 404, { error: 'not found' })
      return json(res, 200, { step: msg })
    }

    json(res, 404, { error: 'not found' })
  } catch (e) {
    json(res, 500, { error: e.message })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`relay  http://127.0.0.1:${PORT}`)
  console.log(`cwd    ${session.cwd}`)
  console.log(`agents ${cfg.agents.map((a) => a.id).join(', ')}`)
})
