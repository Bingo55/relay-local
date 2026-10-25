// One reducer for bootstrap + SSE, plus run grouping and summary derivation.
import { changedFiles } from './format.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function createState(initial = {}) {
  return {
    session: null,
    sessions: [],
    agents: [],
    roles: {},
    instructors: [],
    quota: null,
    busy: false,
    connected: false,
    reconnecting: false,
    agentStates: {},
    live: new Map(),
    pendingDeltas: new Map(),
    order: [],
    model: '',
    lastNotice: '',
    ...initial,
  }
}

export function messagesOf(state) {
  return state.session?.messages || []
}

function runningAgents(state) {
  const out = {}
  for (const m of messagesOf(state)) {
    if (m.role === 'step' && m.status === 'running' && m.agent) out[m.agent] = 'running'
  }
  return out
}

function applyLive(state) {
  for (const m of messagesOf(state)) {
    if (m.role !== 'step') continue
    if (m.status === 'running' && state.live.has(m.id)) m.text = state.live.get(m.id)
  }
}

export function applyBootstrap(state, data) {
  const oldId = state.session?.id
  state.session = data.session || state.session
  if (data.session && oldId && data.session.id !== oldId) {
    state.live.clear()
    state.pendingDeltas.clear()
  }
  state.sessions = data.sessions || []
  state.agents = data.agents || []
  state.roles = data.roles || {}
  state.instructors = data.instructors || []
  state.quota = data.quota || state.quota || null
  state.busy = !!data.busy
  state.connected = true
  state.reconnecting = false
  state.order = messagesOf(state).map((m) => m.id)
  state.agentStates = { ...runningAgents(state) }
  applyLive(state)
  if (!messagesOf(state).some((m) => m.id === state.pendingPlanId)) state.pendingPlanId = null
  return state
}

export function applyEvent(state, ev) {
  if (!ev || !ev.type) return { changed: false }

  if (ev.type === 'quota') {
    state.quota = ev.quota || state.quota
    return { changed: true }
  }

  if (ev.type === 'hello') {
    const oldId = state.session?.id
    if (ev.session) state.session = ev.session
    if (ev.session && oldId && ev.session.id !== oldId) {
      state.live.clear()
      state.pendingDeltas.clear()
    }
    state.busy = !!ev.busy
    state.connected = true
    state.reconnecting = false
    state.order = messagesOf(state).map((m) => m.id)
    state.agentStates = { ...runningAgents(state) }
    applyLive(state)
    return { changed: true, hello: true }
  }

  if (ev.sessionId && state.session && ev.sessionId !== state.session.id) {
    return { changed: false, resync: true }
  }

  if (ev.type === 'message') {
    const m = ev.message
    if (!m?.id) return { changed: false }
    if (!state.session) state.session = { messages: [] }
    if (!Array.isArray(state.session.messages)) state.session.messages = []
    const at = state.session.messages.findIndex((x) => x.id === m.id)
    if (at >= 0) state.session.messages[at] = { ...state.session.messages[at], ...m }
    else state.session.messages.push(m)
    if (state.pendingDeltas.has(m.id)) {
      m.text = state.pendingDeltas.get(m.id)
      state.live.set(m.id, m.text)
      state.pendingDeltas.delete(m.id)
    }
    if (m.role === 'step' && m.status === 'running' && m.agent) state.agentStates[m.agent] = 'running'
    if (!state.order.includes(m.id)) state.order.push(m.id)
    return { changed: true, message: m }
  }

  if (ev.type === 'message.update') {
    const m = ev.message
    if (!m?.id) return { changed: false }
    const list = messagesOf(state)
    const at = list.findIndex((x) => x.id === m.id)
    if (at < 0) return { changed: false }
    list[at] = { ...list[at], ...m }
    state.live.delete(m.id)
    state.pendingDeltas.delete(m.id)
    if (m.role === 'step' && m.agent) {
      const stillRunning = messagesOf(state).some((x) => x.role === 'step' && x.agent === m.agent && x.status === 'running')
      if (!stillRunning) state.agentStates[m.agent] = m.status === 'quota' ? 'cooling' : 'idle'
    }
    return { changed: true, message: list[at] }
  }

  if (ev.type === 'delta') {
    if (!ev.id) return { changed: false }
    const m = messagesOf(state).find((x) => x.id === ev.id)
    if (!m) {
      state.pendingDeltas.set(ev.id, String(ev.text ?? ''))
      return { changed: false, missing: ev.id }
    }
    const text = String(ev.text ?? '')
    if (m.text === text) return { changed: false }
    m.text = text
    state.live.set(m.id, text)
    return { changed: true, message: m }
  }

  if (ev.type === 'agent') {
    if (!ev.agent) return { changed: false }
    state.agentStates[ev.agent] = ev.state
    return { changed: true }
  }

  if (ev.type === 'busy') {
    const next = !!ev.busy
    if (state.busy === next) return { changed: false }
    state.busy = next
    if (!next) {
      for (const [id, value] of Object.entries(state.agentStates)) {
        if (value === 'running') state.agentStates[id] = 'idle'
      }
    }
    return { changed: true, busy: next }
  }

  if (ev.type === 'notice') {
    state.lastNotice = String(ev.text || '')
    state.lastNoticeAt = Date.now()
    return { changed: false, notice: state.lastNotice }
  }

  return { changed: false }
}

export function lastPlan(state) {
  const msgs = messagesOf(state)
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'plan') return msgs[i]
  return null
}

export function lastRunGroup(state) {
  const msgs = messagesOf(state)
  let userIdx = -1
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'user') { userIdx = i; break }
  const from = userIdx >= 0 ? userIdx : 0
  const slice = msgs.slice(from)
  let plan = null
  for (const m of slice) if (m.role === 'plan') plan = m
  const steps = slice.filter((m) => m.role === 'step' && m.kind !== 'btw')
  const btw = slice.filter((m) => m.role === 'step' && m.kind === 'btw')
  const notes = slice.filter((m) => m.role === 'note')
  const task = plan?.task || (userIdx >= 0 ? msgs[userIdx].text : '')
  return { user: userIdx >= 0 ? msgs[userIdx] : null, plan, steps, btw, notes, task }
}

function stepGroups(steps) {
  const map = new Map()
  for (const s of steps) {
    const n = Number.isFinite(s.n) ? s.n : null
    const key = n == null ? `id:${s.id}` : `n:${n}`
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(s)
  }
  return [...map.values()]
}

export function summarizeGroup(group) {
  const steps = group?.steps || []
  const btw = group?.btw || []
  const groups = stepGroups(steps)
  let finished = 0
  let problems = 0
  let stopped = 0
  for (const list of groups) {
    const statuses = list.map((s) => s.status)
    if (statuses.some((s) => ['failed', 'timeout', 'quota'].includes(s))) problems++
    else if (statuses.every((s) => s === 'done')) finished++
    else if (statuses.some((s) => s === 'stopped')) stopped++
  }
  const total = group?.plan?.steps?.length || groups.length
  const files = changedFiles({ session: { messages: steps } })
  const fallbacks = steps.flatMap((s) => s.fallback || [])
  let durationMs = 0
  const durations = steps.map((s) => Number(s.durationMs)).filter(Number.isFinite)
  if (durations.length) durationMs = durations.reduce((a, b) => a + b, 0)
  else {
    const starts = steps.map((s) => new Date(s.startedAt).getTime()).filter(Number.isFinite)
    const ends = steps.map((s) => new Date(s.endedAt).getTime()).filter(Number.isFinite)
    if (starts.length && ends.length) durationMs = Math.max(0, Math.max(...ends) - Math.min(...starts))
  }
  return {
    total,
    finished,
    problems,
    stopped,
    files: files.map((f) => f.path),
    fileDetails: files,
    durationMs,
    fallbacks,
    btw: btw.length,
    steps,
  }
}

export function lastRunSummary(state) {
  const group = lastRunGroup(state)
  if (!group.steps.length) return null
  return summarizeGroup(group)
}

export function hasRunningStep(state) {
  return messagesOf(state).some((m) => m.role === 'step' && m.status === 'running')
}

export function hasRunningBtw(state) {
  return messagesOf(state).some((m) => m.role === 'step' && m.kind === 'btw' && m.status === 'running')
}

// Wait for a run to finish. Polls the reducer state so it works with the SSE
// handler and with one-shot mode. The busy:false gap after auto-planning is
// covered by a grace window.
export async function waitForRun(state, {
  auto = false,
  planId = null,
  runRequested = true,
  settleMs = 300,
  graceMs = 1500,
  startTimeoutMs = 5000,
  signal = null,
  onTick = null,
} = {}) {
  const started = Date.now()
  let sawBusy = !!state.busy
  let sawStep = false
  let busyFalseAt = null
  let planSeenAt = Date.now()
  let lastTick = 0

  while (true) {
    if (signal?.aborted) return { status: 'interrupted' }
    const now = Date.now()
    const group = lastRunGroup(state)
    const steps = group.steps
    if (steps.length) sawStep = true
    if (state.busy) {
      sawBusy = true
      busyFalseAt = null
    } else if (busyFalseAt === null) {
      busyFalseAt = now
    }
    if (onTick && now - lastTick > 250) { onTick({ group, elapsed: now - started, busy: state.busy }); lastTick = now }

    const planHere = planId ? messagesOf(state).some((m) => m.id === planId) : !!group.plan
    if (!planHere) planSeenAt = now

    if (state.busy) {
      // keep waiting
    } else if (sawStep) {
      if (now - busyFalseAt >= settleMs) {
        return { status: 'finished', group, summary: summarizeGroup(group) }
      }
    } else if (sawBusy) {
      const gap = now - busyFalseAt
      if (auto && planHere && gap < graceMs) {
        // planning finished; wait for the background run to start
      } else if (gap >= settleMs) {
        return { status: 'finished', group, summary: summarizeGroup(group) }
      }
    } else if (runRequested) {
      const waited = now - started
      if (waited > startTimeoutMs) {
        return { status: 'nostart', group, summary: summarizeGroup(group) }
      }
    } else if (planId && now - planSeenAt > graceMs) {
      return { status: 'finished', group, summary: summarizeGroup(group) }
    }

    await sleep(100)
  }
}

export async function waitForBtw(state, { question, afterId = '', afterIds = null, timeoutMs = 120_000, signal = null } = {}) {
  const started = Date.now()
  const q = String(question || '').trim().slice(0, 4000)
  const skip = new Set(afterIds || (afterId ? [afterId] : []))
  while (Date.now() - started < timeoutMs) {
    if (signal?.aborted) return { status: 'interrupted' }
    const msgs = messagesOf(state)
    const found = [...msgs].reverse().find((m) =>
      m.role === 'step' && m.kind === 'btw' &&
      (m.question === q || (q && String(m.question || '').startsWith(q.slice(0, 80)))) &&
      !skip.has(m.id)
    )
    if (found && found.status !== 'running') return { status: 'finished', step: found }
    await sleep(200)
  }
  return { status: 'timeout' }
}

export async function waitForBusyFalse(state, timeoutMs = 5000, signal = null) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (signal?.aborted) return false
    if (!state.busy) return true
    await sleep(100)
  }
  return !state.busy
}
