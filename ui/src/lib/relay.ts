import { useSyncExternalStore } from 'react'
import type {
  Bootstrap, Connection, ConnectionInput, Health, McpServer, Message, Mode, Pin,
  PlanMessage, PlanStep, Plugin, Presets, Provider, Quota, QuotaAgent, Registry, RelayEvent, Session,
  SessionSummary, SideNote,
} from './types'

export interface RelayState {
  bootstrap: Bootstrap | null
  phase: 'loading' | 'ready' | 'error'
  error: string
  connected: boolean
  notice: string
  presets: Presets
  providers: Provider[]
  health: Health | null
  agentStates: Record<string, 'running' | 'cooling' | 'idle'>
}

export interface McpInput {
  id?: string
  name: string
  command: string
  args?: string[] | string
  env?: Record<string, string> | string
  cwd?: string
  agents?: string[] | string
  enabled?: boolean
  note?: string
}

export interface PluginInput {
  id?: string
  name: string
  instructions: string
  agents?: string[] | string
  enabled?: boolean
}

export type RegistryKind = 'mcp' | 'plugins'

export const initialRelayState: RelayState = {
  bootstrap: null, phase: 'loading', error: '', connected: false, notice: '',
  presets: {}, providers: [], health: null, agentStates: {},
}

function upsertMessage(messages: Message[], message: Message): Message[] {
  const index = messages.findIndex((item) => item.id === message.id)
  if (index < 0) return [...messages, message]
  const previous = messages[index]
  const merged: Message = previous.role === message.role ? { ...previous, ...message } : message
  return messages.map((item, i) => i === index ? merged : item)
}

function summary(session: Session): SessionSummary {
  const first = session.messages.find((message) => message.role === 'user')
  const title = session.title === 'Untitled run' && first?.role === 'user'
    ? first.text.replace(/\s+/g, ' ').trim().slice(0, 64) : session.title
  return {
    id: session.id, title, cwd: session.cwd, updatedAt: session.updatedAt || '',
    createdAt: session.createdAt,
  }
}

function updateSummary(sessions: SessionSummary[], session: Session): SessionSummary[] {
  const item = summary(session)
  return sessions.some((entry) => entry.id === session.id)
    ? sessions.map((entry) => entry.id === session.id ? item : entry) : [item, ...sessions]
}

export function applyRelayEvent(state: RelayState, event: RelayEvent): RelayState {
  // Hello can describe an old selection. Bootstrap is the authoritative snapshot.
  if (event.type === 'hello') return state
  if (event.type === 'agent') {
    state = { ...state, agentStates: { ...state.agentStates, [event.agent]: event.state } }
  }
  const bootstrap = state.bootstrap
  if (!bootstrap) return state
  if (event.type === 'busy') {
    return { ...state, bootstrap: {
      ...bootstrap, busy: event.busy, btwRuns: event.btwRuns,
      runningSessionIds: event.runningSessionIds,
    } }
  }
  if (event.type === 'quota') return { ...state, bootstrap: { ...bootstrap, quota: event.quota } }

  const sessionId = event.sessionId || bootstrap.session.id
  const running = (event.type === 'agent' && event.state === 'running') ||
    ((event.type === 'message' || event.type === 'message.update') &&
      event.message.role === 'step' && event.message.status === 'running')
  const next = running && !bootstrap.runningSessionIds.includes(sessionId)
    ? { ...bootstrap, runningSessionIds: [...bootstrap.runningSessionIds, sessionId] } : bootstrap
  state = next === bootstrap ? state : { ...state, bootstrap: next }
  if (sessionId !== next.session.id) return state

  if (event.type === 'notice') return { ...state, notice: event.text }
  if (event.type === 'message' || event.type === 'message.update') {
    const session = { ...next.session, messages: upsertMessage(next.session.messages, event.message), updatedAt: event.message.at || (event.message.role === 'step' ? event.message.endedAt || event.message.startedAt : next.session.updatedAt) }
    return { ...state, bootstrap: { ...next, session, sessions: updateSummary(next.sessions, session) } }
  }
  if (event.type === 'delta') {
    const index = next.session.messages.findIndex((message) => message.id === event.id && 'text' in message)
    if (index < 0) return state
    const messages = next.session.messages.map((message, i) => i === index
      ? { ...message, text: event.text } : message)
    return { ...state, bootstrap: { ...next, session: { ...next.session, messages } } }
  }
  return state
}

let state = initialRelayState
const listeners = new Set<() => void>()
const snapshots = new Set<RelayEvent[]>()
const requests = new Set<AbortController>()
const versions = new Map<string, number>()
let lifetime = 0
let selection = 0
let selecting = 0
let selectionQueue: Promise<unknown> = Promise.resolve()
let owners = 0
let source: EventSource | null = null
let reconnect: ReturnType<typeof setTimeout> | null = null
let quotaRevision = 0

function publish(next: RelayState) {
  if (state === next) return
  state = next
  listeners.forEach((listener) => listener())
}

function receiveEvent(event: RelayEvent) {
  if (event.type === 'quota') quotaRevision++
  snapshots.forEach((events) => events.push(event))
  publish(applyRelayEvent(state, event))
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useRelay(): RelayState {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

function version(key: string) { return versions.get(key) || 0 }
function nextVersion(key: string) {
  const value = version(key) + 1
  versions.set(key, value)
  return value
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function request<T>(path: string, method = 'GET', input?: unknown, current = () => true): Promise<T> {
  const controller = new AbortController()
  const epoch = lifetime
  requests.add(controller)
  if (current()) publish({ ...state, error: '' })
  try {
    const response = await fetch(path, {
      method, headers: { 'content-type': 'application/json' }, cache: 'no-store',
      signal: controller.signal, ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    })
    const data: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(/^\/api\/(connections|mcp|plugins)(\/|$)/.test(path)
        ? 'Relay could not save or load this configuration. Check its fields and retry; secret values are not shown.'
        : record(data) && typeof data.error === 'string' ? data.error : response.statusText || `HTTP ${response.status}`)
    }
    if (!record(data)) throw new Error('Invalid JSON response from Relay')
    if (typeof data.error === 'string' && data.error) throw new Error(/^\/api\/(connections|mcp|plugins)(\/|$)/.test(path) ? 'Relay could not apply this configuration. Check its fields and retry; secret values are not shown.' : data.error)
    return data as T
  } catch (error: unknown) {
    if (epoch === lifetime && current() && !controller.signal.aborted) {
      const text = error instanceof Error ? error.message : String(error)
      publish({ ...state, error: text, notice: text, phase: state.bootstrap ? state.phase : 'error' })
    }
    throw error
  } finally {
    requests.delete(controller)
  }
}

async function resource<T>(key: string, path: string, method: string, input: unknown,
  apply: (data: T) => void, relevant = () => true): Promise<T> {
  const token = nextVersion(key)
  const epoch = lifetime
  const current = () => epoch === lifetime && token === version(key) && relevant()
  const data = await request<T>(path, method, input, current)
  if (current()) apply(data)
  return data
}

function replay(next: RelayState, events: RelayEvent[]): RelayState {
  // Notices already live in state and may have been dismissed during the request.
  return events.reduce((value, event) => event.type === 'notice' ? value : applyRelayEvent(value, event), next)
}

async function refresh(): Promise<Bootstrap> {
  const token = nextVersion('bootstrap')
  const generation = selection
  const epoch = lifetime
  const before = state.bootstrap
  const connectionVersion = version('connections')
  const registryVersion = version('registry')
  const sessionVersions = ['title', 'cwd', 'instructor', 'pinned', 'notes'].map(version)
  const events: RelayEvent[] = []
  snapshots.add(events)
  const current = () => epoch === lifetime && token === version('bootstrap') && generation === selection && selecting === 0
  if (current() && !before) publish({ ...state, phase: 'loading' })
  try {
    const data = await request<Bootstrap>('/api/bootstrap', 'GET', undefined, current)
    if (!current()) return data
    const live = state.bootstrap
    let bootstrap = data
    if (live) {
      // A snapshot of another selected chat cannot replace the user's selection.
      if (data.session.id !== live.session.id) bootstrap = { ...bootstrap, session: live.session }
      if (connectionVersion !== version('connections')) {
        bootstrap = { ...bootstrap, connections: live.connections, agents: live.agents }
      }
      if (registryVersion !== version('registry')) bootstrap = { ...bootstrap, registry: live.registry }
      if (before?.session.id === live.session.id && bootstrap.session.id === live.session.id) {
        const session = { ...bootstrap.session }
        if (sessionVersions[0] !== version('title')) session.title = live.session.title
        if (sessionVersions[1] !== version('cwd')) session.cwd = live.session.cwd
        if (sessionVersions[2] !== version('instructor')) session.instructor = live.session.instructor
        if (sessionVersions[3] !== version('pinned')) session.pinned = live.session.pinned
        if (sessionVersions[4] !== version('notes')) session.notes = live.session.notes
        bootstrap = { ...bootstrap, session }
      }
    }
    const next = replay({ ...state, bootstrap, phase: 'ready' }, events)
    publish(next.bootstrap ? { ...next, bootstrap: {
      ...next.bootstrap, sessions: updateSummary(next.bootstrap.sessions, next.bootstrap.session),
    } } : next)
    return data
  } finally {
    snapshots.delete(events)
  }
}

function selectSession(path: string): Promise<{ session: Session }> {
  const generation = ++selection
  const epoch = lifetime
  nextVersion('bootstrap')
  selecting++
  let succeeded = false
  const current = () => generation === selection && epoch === lifetime
  const operation = selectionQueue.catch(() => {}).then(async () => {
    const events: RelayEvent[] = []
    snapshots.add(events)
    try {
      if (epoch !== lifetime) throw new Error('Relay connection closed')
      const data = await request<{ session: Session }>(path, 'POST', {}, current)
      succeeded = true
      if (current() && state.bootstrap) {
        const bootstrap = {
          ...state.bootstrap, session: data.session,
          sessions: updateSummary(state.bootstrap.sessions, data.session),
        }
        publish(replay({ ...state, bootstrap }, events))
      }
      return data
    } finally {
      snapshots.delete(events)
    }
  }).finally(() => {
    selecting--
    if (current() && succeeded) void refresh().catch(() => {})
  })
  // Session switches are ordered on the server; an older response never wins locally.
  selectionQueue = operation
  return operation
}

function patchSession(patch: Partial<Session>) {
  if (!state.bootstrap) return
  const session = { ...state.bootstrap.session, ...patch }
  publish({ ...state, bootstrap: {
    ...state.bootstrap, session, sessions: updateSummary(state.bootstrap.sessions, session),
  } })
}

async function sessionRequest<T>(key: string, path: string, input: unknown,
  patch: (data: T) => Partial<Session>): Promise<T> {
  const generation = selection
  const id = state.bootstrap?.session.id
  return resource<T>(key, path, 'POST', input, (data) => {
    patchSession(patch(data))
  }, () => generation === selection && id === state.bootstrap?.session.id)
}

function applyConnections(data: { connections: Connection[]; agents: Bootstrap['agents'] }) {
  if (state.bootstrap) publish({ ...state, bootstrap: {
    ...state.bootstrap, connections: data.connections, agents: data.agents,
  } })
}

function applyRegistry(data: { registry: Registry }) {
  if (state.bootstrap) publish({ ...state, bootstrap: { ...state.bootstrap, registry: data.registry } })
}

function quotaRequest<T extends { quota: Quota }>(path: string, input: unknown): Promise<T> {
  const revision = quotaRevision
  return resource<T>('quota', path, 'POST', input, (data) => {
    if (revision === quotaRevision) receiveEvent({ type: 'quota', quota: data.quota })
  })
}

export const relay = {
  refresh,
  newSession: () => selectSession('/api/session'),
  switchSession: (id: string) => selectSession(`/api/session/${encodeURIComponent(id)}`),
  deleteSession: (id: string) => resource<{ deleted: string }>(`session.delete:${id}`, `/api/session/${encodeURIComponent(id)}`,
    'DELETE', undefined, (data) => {
      nextVersion('bootstrap')
      if (state.bootstrap) publish({ ...state, bootstrap: {
        ...state.bootstrap, sessions: state.bootstrap.sessions.filter((session) => session.id !== data.deleted),
      } })
    }),
  rename: (title: string) => sessionRequest<{ session: Session }>('title', '/api/rename', { title },
    (data) => ({ title: data.session.title, updatedAt: data.session.updatedAt })),
  setCwd: (cwd: string) => sessionRequest<{ cwd: string }>('cwd', '/api/cwd', { cwd }, (data) => ({ cwd: data.cwd })),
  setInstructor: (instructor: string) => sessionRequest<{ instructor: string }>('instructor', '/api/instructor',
    { instructor }, (data) => ({ instructor: data.instructor })),
  plan: (text: string, mode: Mode, model = '', modelAgent = '') => request<{ plan?: PlanMessage; stopped?: boolean }>(
    '/api/plan', 'POST', {
      text, mode, auto: mode === 'code', model, modelAgent, instructor: state.bootstrap?.session.instructor,
    }),
  run: async (steps: PlanStep[], task: string, model = '') => {
    if (!steps.length || steps.length > 6 || steps.some(step => !step.prompt.trim() || (!step.agent && !step.agents?.length) || (step.agents && (step.agents.length < 2 || step.agents.length > 4)))) throw new Error('Use one to six steps with prompts and agents. Parallel steps need two to four agents.')
    return request<{ ok: boolean }>('/api/run', 'POST', { steps, task, model })
  },
  dispatch: (agent: string, prompt: string, model = '') => request<{ ok: boolean }>('/api/dispatch', 'POST', { agent, prompt, model }),
  chain: (text: string, model = '') => request<{ plan: PlanMessage }>('/api/chain', 'POST', { text, model }),
  btw: (text: string) => sessionRequest<{ note: SideNote; notes: SideNote[]; agent: string; queued: boolean }>(
    'notes', '/api/btw', { text }, (data) => ({ notes: data.notes })),
  stop: () => request<{ ok: boolean }>('/api/stop', 'POST', {}),
  pin: (stepId: string, on: boolean) => sessionRequest<{ pinned: Pin[] }>('pinned', '/api/pin', { stepId, on },
    (data) => ({ pinned: data.pinned })),
  loadPresets: () => resource<{ presets: Presets }>('presets', '/api/presets', 'GET', undefined,
    (data) => publish({ ...state, presets: data.presets })),
  savePreset: (name: string, note: string, steps: PlanStep[]) => resource<{ presets: Presets }>(
    'presets', '/api/presets', 'POST', { name, note, steps }, (data) => publish({ ...state, presets: data.presets })),
  loadProviders: () => resource<{ providers: Provider[] }>('providers', '/api/providers', 'GET', undefined,
    (data) => publish({ ...state, providers: data.providers })),
  saveConnection: (input: ConnectionInput) => resource<{ connection: Connection; connections: Connection[]; agents: Bootstrap['agents'] }>(
    'connections', '/api/connections', 'POST', input, applyConnections),
  deleteConnection: (id: string) => resource<{ ok: boolean; connections: Connection[]; agents: Bootstrap['agents'] }>(
    'connections', `/api/connections/${encodeURIComponent(id)}`, 'DELETE', undefined, applyConnections),
  loadRegistry: () => resource<Registry>('registry', '/api/mcp', 'GET', undefined, (registry) => applyRegistry({ registry })),
  saveMcp: (input: McpInput) => resource<{ server: McpServer; registry: Registry }>('registry', '/api/mcp', 'POST', input, applyRegistry),
  savePlugin: (input: PluginInput) => resource<{ plugin: Plugin; registry: Registry }>('registry', '/api/plugins', 'POST', input, applyRegistry),
  toggleRegistry: (kind: RegistryKind, id: string, enabled: boolean) => resource<{ registry: Registry }>(
    'registry', `/api/${kind}/${encodeURIComponent(id)}`, 'POST', { enabled }, applyRegistry),
  deleteRegistry: (kind: RegistryKind, id: string) => resource<{ ok: boolean; registry: Registry }>(
    'registry', `/api/${kind}/${encodeURIComponent(id)}`, 'DELETE', undefined, applyRegistry),
  loadHealth: () => resource<Health>('health', '/api/health', 'GET', undefined, (health) => publish({ ...state, health })),
  configureQuota: (agent: string, limit: number, window: string) => quotaRequest<{ ok: boolean; agent: QuotaAgent; quota: Quota }>(
    '/api/quota/config', { agent, limit, window }),
  resetQuota: (agent?: string) => quotaRequest<{ ok: boolean; quota: Quota }>('/api/quota/reset', agent ? { agent } : {}),
  clearNotice: () => publish({ ...state, notice: '' }),
}

function readEvent(text: string): RelayEvent | null {
  const value: unknown = JSON.parse(text)
  if (!record(value)) return null
  if (value.sessionId !== undefined && typeof value.sessionId !== 'string') return null
  const strings = (input: unknown) => Array.isArray(input) && input.every((item: unknown) => typeof item === 'string')
  switch (value.type) {
    case 'hello': return null
    case 'message': case 'message.update':
      if (!record(value.message) || typeof value.message.id !== 'string' ||
        !['user', 'note', 'plan', 'step'].includes(String(value.message.role))) return null
      break
    case 'delta': if (typeof value.id !== 'string' || typeof value.text !== 'string') return null; break
    case 'agent':
      if (typeof value.agent !== 'string' || !['running', 'cooling', 'idle'].includes(String(value.state))) return null
      break
    case 'quota': if (!record(value.quota) || !Array.isArray(value.quota.agents)) return null; break
    case 'busy':
      if (typeof value.busy !== 'boolean' || typeof value.btwRuns !== 'number' || !strings(value.runningSessionIds)) return null
      break
    case 'notice': if (typeof value.text !== 'string') return null; break
    default: return null
  }
  return value as unknown as RelayEvent
}

function connect() {
  if (!owners || source) return
  const stream = new EventSource('/api/events')
  source = stream
  stream.onopen = () => {
    if (source !== stream) return
    publish({ ...state, connected: true })
    // Also cover the initial gap between the first HTTP snapshot and SSE subscription.
    void refresh().catch(() => {})
  }
  stream.onmessage = (message: MessageEvent<string>) => {
    if (source !== stream) return
    try {
      const event = readEvent(message.data)
      if (!event) return
      receiveEvent(event)
    } catch {
      publish({ ...state, notice: 'Could not read a Relay event; reconnect to resync.' })
    }
  }
  stream.onerror = () => {
    if (source !== stream) return
    stream.close()
    source = null
    publish({ ...state, connected: false })
    reconnect = setTimeout(() => { reconnect = null; connect() }, 2000)
  }
}

export function startRelay(): () => void {
  owners++
  if (owners === 1) {
    void refresh().catch(() => {})
    connect()
  }
  let cleaned = false
  return () => {
    if (cleaned) return
    cleaned = true
    if (--owners) return
    lifetime++
    source?.close()
    source = null
    if (reconnect !== null) clearTimeout(reconnect)
    reconnect = null
    requests.forEach((controller) => controller.abort())
    publish({ ...state, connected: false })
  }
}
