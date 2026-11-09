import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { applyRelayEvent, initialRelayState, relay, startRelay, useRelay } from './relay'
import type { RelayState } from './relay'
import type { Bootstrap, Connection, PlanMessage, RelayEvent, Session, StepMessage } from './types'

function step(id = 'step_a', text = ''): StepMessage {
  return {
    id, role: 'step', n: 1, agent: 'coder', label: 'Coder', prompt: 'Build it', text,
    status: 'running', startedAt: '2026-11-04T12:00:00Z',
  }
}

function session(id = 'ses_a', messages: Session['messages'] = [step()]): Session {
  return {
    id, title: id, cwd: 'C:/scratch', instructor: 'opencode', messages,
    pinned: [], notes: [], updatedAt: '2026-11-04T12:00:00Z',
  }
}

function bootstrap(selected = session()): Bootstrap {
  return {
    session: selected,
    sessions: ['ses_a', 'ses_b', 'ses_c'].map((id) => ({ id, title: id, cwd: 'C:/scratch', updatedAt: '' })),
    agents: [{ id: 'coder', label: 'Coder' }], roles: { build: ['coder'] },
    instructors: [{ id: 'opencode', label: 'OpenCode' }], busy: false, btwRuns: 0,
    runningSessionIds: [], root: 'C:/relay', quota: { mode: 'local-observed', agents: [], route: null },
    connections: [], registry: { mcp: [], plugins: [] },
  }
}

function ready(): RelayState { return { ...initialRelayState, bootstrap: bootstrap(), phase: 'ready' } }

test('message events merge by ID without duplicates or losing optional fields', () => {
  const before = ready()
  const thinking = { ...step(), thinking: 'reasoning', why: 'needed' }
  const first = applyRelayEvent(before, { type: 'message', message: thinking, sessionId: 'ses_a' })
  const done = applyRelayEvent(first, { type: 'message.update', message: { ...step(), text: 'done', status: 'done' } })
  assert.equal(done.bootstrap?.session.messages.length, 1)
  assert.deepEqual(done.bootstrap?.session.messages[0], { ...thinking, text: 'done', status: 'done' })
  assert.equal(before.bootstrap?.session.messages[0].role, 'step')
  assert.equal((before.bootstrap?.session.messages[0] as StepMessage).text, '')
  const unseen = applyRelayEvent(done, { type: 'message.update', message: step('step_b') })
  assert.equal(unseen.bootstrap?.session.messages.length, 2)
})

test('deltas replace cumulative text, including shorter corrections, and do not mutate inputs', () => {
  const before = ready()
  const first = applyRelayEvent(before, { type: 'delta', id: 'step_a', text: 'hello' })
  const second = applyRelayEvent(first, { type: 'delta', id: 'step_a', text: 'hello world' })
  const corrected = applyRelayEvent(second, { type: 'delta', id: 'step_a', text: 'hi' })
  assert.equal((second.bootstrap?.session.messages[0] as StepMessage).text, 'hello world')
  assert.equal((corrected.bootstrap?.session.messages[0] as StepMessage).text, 'hi')
  assert.equal((before.bootstrap?.session.messages[0] as StepMessage).text, '')
  assert.equal(applyRelayEvent(before, { type: 'delta', id: 'missing', text: 'x' }), before)
})

test('background runs update indicators and global quota, not the selected chat', () => {
  const before = ready()
  const running = applyRelayEvent(before, { type: 'message', message: step('step_b'), sessionId: 'ses_b' })
  assert.equal(running.bootstrap?.session.messages, before.bootstrap?.session.messages)
  assert.deepEqual(running.bootstrap?.runningSessionIds, ['ses_b'])
  const agent = applyRelayEvent(running, { type: 'agent', agent: 'coder', state: 'running', sessionId: 'ses_b' })
  assert.equal(agent.agentStates.coder, 'running')
  const quota = { ...bootstrap().quota, mode: 'updated' }
  const metered = applyRelayEvent(agent, { type: 'quota', quota, sessionId: 'ses_b' })
  assert.equal(metered.bootstrap?.quota, quota)
  assert.equal(applyRelayEvent(metered, { type: 'notice', text: 'elsewhere', sessionId: 'ses_b' }), metered)
  const finished = applyRelayEvent(metered, { type: 'busy', busy: false, btwRuns: 0, runningSessionIds: [] })
  assert.deepEqual(finished.bootstrap?.runningSessionIds, [])
})

test('hello snapshots cannot undo selected chats or streamed output', () => {
  const before = ready()
  for (const selected of [session('ses_b'), session('ses_a', [])]) {
    assert.equal(applyRelayEvent(before, {
      type: 'hello', session: selected, busy: false, btwRuns: 0, runningSessionIds: [],
    }), before)
  }
  assert.equal(applyRelayEvent(initialRelayState, { type: 'notice', text: 'not booted' }), initialRelayState)
})

class FakeEventSource {
  static instances: FakeEventSource[] = []
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  constructor(readonly url: string) { FakeEventSource.instances.push(this) }
  open() { this.onopen?.(new Event('open')) }
  emit(event: RelayEvent) { this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event) })) }
  fail() { this.onerror?.() }
  close() { this.closed = true }
}

interface PendingRequest {
  path: string
  init: RequestInit
  resolve: (response: Response) => void
}

async function flush() { for (let i = 0; i < 24; i++) await Promise.resolve() }

function snapshot(): RelayState {
  let observed = initialRelayState
  renderToString(createElement(() => { observed = useRelay(); return null }))
  return observed
}

test('store and API integration uses only fake fetch/EventSource, including race and reconnect checks', async (t) => {
  const originalSource = globalThis.EventSource
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
  const pending: PendingRequest[] = []
  const history: { path: string; init: RequestInit }[] = []
  t.mock.method(globalThis, 'fetch', (input: string | URL | Request, init: RequestInit = {}) => {
    const path = String(input)
    assert.match(path, /^\/api\//)
    history.push({ path, init })
    return new Promise<Response>((resolve) => pending.push({ path, init, resolve }))
  })
  t.mock.timers.enable({ apis: ['setTimeout'] })

  function take(path: string, method = 'GET') {
    const index = pending.findIndex((request) => request.path === path && request.init.method === method)
    assert.notEqual(index, -1, `expected ${method} ${path}; pending: ${pending.map((request) => request.path).join(', ')}`)
    return pending.splice(index, 1)[0]
  }
  async function reply(request: PendingRequest, data: unknown, status = 200) {
    request.resolve(new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } }))
    await flush()
  }
  async function switchTo(id: string, messages: Session['messages'] = [step()]) {
    const operation = relay.switchSession(id)
    await flush()
    await reply(take(`/api/session/${id}`, 'POST'), { session: session(id, messages) })
    await operation
    await reply(take('/api/bootstrap'), bootstrap(session(id, messages)))
  }
  const firstCleanup = startRelay()
  const cleanup = startRelay()
  const stream = FakeEventSource.instances[0]
  try {
    await t.test('one initial stream, bootstrap retry, and events buffered during loading', async () => {
      assert.equal(FakeEventSource.instances.length, 1)
      assert.equal(history.length, 1)
      await reply(take('/api/bootstrap'), { error: 'Relay offline' }, 503)
      assert.equal(snapshot().phase, 'error')
      assert.equal(snapshot().error, 'Relay offline')
      stream.open()
      assert.equal(snapshot().phase, 'loading')
      stream.emit({ type: 'message', message: step(), sessionId: 'ses_a' })
      stream.emit({ type: 'delta', id: 'step_a', text: 'initial streamed answer', sessionId: 'ses_a' })
      await reply(take('/api/bootstrap'), bootstrap())
      assert.equal(snapshot().phase, 'ready')
      assert.equal(snapshot().error, '')
      assert.equal(snapshot().connected, true)
      assert.equal((snapshot().bootstrap?.session.messages[0] as StepMessage).text, 'initial streamed answer')
      firstCleanup()
      firstCleanup()
      assert.equal(stream.closed, false)
    })

    await t.test('stale bootstrap replies never rewind messages, quota, or run status', async () => {
      const old = relay.refresh()
      const oldRequest = take('/api/bootstrap')
      const latest = relay.refresh()
      const latestRequest = take('/api/bootstrap')
      stream.emit({ type: 'delta', id: 'step_a', text: 'newest streamed answer', sessionId: 'ses_a' })
      stream.emit({ type: 'busy', busy: true, btwRuns: 1, runningSessionIds: ['ses_a'] })
      stream.emit({ type: 'quota', quota: { ...bootstrap().quota, mode: 'newest' }, sessionId: 'ses_a' })
      await reply(latestRequest, bootstrap())
      await latest
      await reply(oldRequest, bootstrap(session('ses_c')))
      await old
      assert.equal(snapshot().bootstrap?.session.id, 'ses_a')
      assert.equal((snapshot().bootstrap?.session.messages[0] as StepMessage).text, 'newest streamed answer')
      assert.equal(snapshot().bootstrap?.busy, true)
      assert.equal(snapshot().bootstrap?.quota.mode, 'newest')
      assert.deepEqual(snapshot().bootstrap?.runningSessionIds, ['ses_a'])
    })

    await t.test('switch snapshots replay destination events and ignore old hello', async () => {
      const oldRefresh = relay.refresh()
      const oldRequest = take('/api/bootstrap')
      const operation = relay.switchSession('ses_b')
      await flush()
      const switchRequest = take('/api/session/ses_b', 'POST')
      stream.emit({ type: 'message', message: step('step_b'), sessionId: 'ses_b' })
      stream.emit({ type: 'delta', id: 'step_b', text: 'B partial', sessionId: 'ses_b' })
      await reply(switchRequest, { session: session('ses_b', [step('step_b')]) })
      await operation
      assert.equal((snapshot().bootstrap?.session.messages[0] as StepMessage).text, 'B partial')
      const afterSwitch = take('/api/bootstrap')
      stream.emit({ type: 'delta', id: 'step_b', text: 'B complete', sessionId: 'ses_b' })
      stream.emit({ type: 'hello', session: session(), busy: false, btwRuns: 0, runningSessionIds: [] })
      await reply(afterSwitch, bootstrap(session('ses_b', [step('step_b', 'B partial')])))
      await reply(oldRequest, bootstrap())
      await oldRefresh
      assert.equal(snapshot().bootstrap?.session.id, 'ses_b')
      assert.equal((snapshot().bootstrap?.session.messages[0] as StepMessage).text, 'B complete')
      assert.equal(FakeEventSource.instances.length, 1)
      assert.equal(history.some((request) => request.path === '/api/stop'), false)
    })

    await t.test('concurrent switches are ordered on the server and latest selection wins', async () => {
      const first = relay.switchSession('ses_c')
      const last = relay.switchSession('ses_b')
      await flush()
      assert.equal(pending.some((request) => request.path === '/api/session/ses_b'), false)
      await reply(take('/api/session/ses_c', 'POST'), { session: session('ses_c') })
      await first
      assert.equal(snapshot().bootstrap?.session.id, 'ses_b')
      await reply(take('/api/session/ses_b', 'POST'), { session: session('ses_b') })
      await last
      await reply(take('/api/bootstrap'), bootstrap(session('ses_b')))
      assert.equal(snapshot().bootstrap?.session.id, 'ses_b')
    })

    await t.test('a long plan cannot switch chats or cause a bootstrap refresh when it finishes', async () => {
      await switchTo('ses_a')
      const planning = relay.plan('Build it', 'code', 'model-one', 'coder')
      const planRequest = take('/api/plan', 'POST')
      assert.deepEqual(JSON.parse(String(planRequest.init.body)), {
        text: 'Build it', mode: 'code', auto: true, model: 'model-one', modelAgent: 'coder', instructor: 'opencode',
      })
      await switchTo('ses_b')
      const plan: PlanMessage = { id: 'plan_a', role: 'plan', task: 'Build it', note: '', steps: [{ agent: 'coder', prompt: 'Build' }] }
      const selectedMessages = snapshot().bootstrap?.session.messages
      stream.emit({ type: 'message', message: plan, sessionId: 'ses_a' })
      await reply(planRequest, { plan })
      await planning
      assert.equal(snapshot().bootstrap?.session.id, 'ses_b')
      assert.equal(snapshot().bootstrap?.session.messages, selectedMessages)
      assert.equal(pending.length, 0)
    })

    await t.test('metadata responses never replace live messages and stale metadata replies are ignored', async () => {
      const refreshing = relay.refresh()
      const refreshRequest = take('/api/bootstrap')
      const renaming = relay.rename('Renamed B')
      const renameRequest = take('/api/rename', 'POST')
      stream.emit({ type: 'delta', id: 'step_a', text: 'live output', sessionId: 'ses_b' })
      await reply(renameRequest, { session: { ...session('ses_b'), title: 'Renamed B' } })
      await renaming
      await reply(refreshRequest, bootstrap(session('ses_b')))
      await refreshing
      assert.equal(snapshot().bootstrap?.session.title, 'Renamed B')
      assert.equal(snapshot().bootstrap?.sessions.find((item) => item.id === 'ses_b')?.title, 'Renamed B')
      assert.equal((snapshot().bootstrap?.session.messages[0] as StepMessage).text, 'live output')
      const cwd = relay.setCwd('C:/other')
      const cwdRequest = take('/api/cwd', 'POST')
      await switchTo('ses_c')
      await reply(cwdRequest, { cwd: 'C:/other' })
      await cwd
      assert.equal(snapshot().bootstrap?.session.cwd, 'C:/scratch')
    })

    await t.test('active-session deletion exposes the server error without deleting locally', async () => {
      const before = snapshot().bootstrap?.sessions
      const deletion = relay.deleteSession('ses_c')
      const rejected = assert.rejects(deletion, /cannot delete the active session/)
      await reply(take('/api/session/ses_c', 'DELETE'), {
        error: 'cannot delete the active session; switch to another first',
      }, 409)
      await rejected
      assert.equal(snapshot().bootstrap?.sessions, before)
      assert.match(snapshot().error, /cannot delete the active session/)
      assert.equal(snapshot().notice, snapshot().error)
      relay.clearNotice()
      assert.equal(snapshot().notice, '')
      const removed = relay.deleteSession('ses_a')
      await reply(take('/api/session/ses_a', 'DELETE'), { deleted: 'ses_a' })
      await removed
      assert.equal(snapshot().bootstrap?.sessions.some((item) => item.id === 'ses_a'), false)
    })

    await t.test('registry and connection changes beat older reads and bootstrap snapshots', async () => {
      const loading = relay.loadRegistry()
      const readRequest = take('/api/mcp')
      const saving = relay.saveMcp({ name: 'Tools', command: 'node', args: ['tools.mjs'], env: { TOKEN: 'test-only' } })
      const server = { id: 'tools', name: 'Tools', command: 'node', args: ['tools.mjs'], agents: ['*'], enabled: true }
      const registry = { mcp: [server], plugins: [] }
      await reply(take('/api/mcp', 'POST'), { server, registry })
      await saving
      await reply(readRequest, { mcp: [], plugins: [] })
      await loading
      assert.deepEqual(snapshot().bootstrap?.registry, registry)

      const refreshing = relay.refresh()
      const oldRequest = take('/api/bootstrap')
      const connecting = relay.saveConnection({ name: 'Test', protocol: 'openai', baseUrl: 'https://example.test', models: ['test'], apiKey: 'fake-key' })
      const connection: Connection = {
        id: 'test', providerId: 'custom', name: 'Test', protocol: 'openai', baseUrl: 'https://example.test',
        models: ['test'], defaultModel: 'test', hasKey: true, keyHint: 'fake…', agentId: 'api-test',
      }
      const agents = [{ id: 'api-test', label: 'Test' }]
      await reply(take('/api/connections', 'POST'), { connection, connections: [connection], agents })
      await connecting
      await reply(oldRequest, bootstrap(session('ses_c')))
      await refreshing
      assert.deepEqual(snapshot().bootstrap?.connections, [connection])
      assert.deepEqual(snapshot().bootstrap?.agents, agents)
      assert.equal('connection' in (snapshot().bootstrap || {}), false)
    })

    await t.test('quota configuration/reset use exact endpoints and cannot rewind newer SSE quota', async () => {
      const configured = { ...bootstrap().quota, mode: 'configured' }
      const configuring = relay.configureQuota('coder', 40, 'day')
      const configureRequest = take('/api/quota/config', 'POST')
      assert.deepEqual(JSON.parse(String(configureRequest.init.body)), { agent: 'coder', limit: 40, window: 'day' })
      await reply(configureRequest, { ok: true, agent: { id: 'coder' }, quota: configured })
      await configuring
      assert.deepEqual(snapshot().bootstrap?.quota, configured)

      const resetting = relay.resetQuota('coder')
      const resetRequest = take('/api/quota/reset', 'POST')
      assert.deepEqual(JSON.parse(String(resetRequest.init.body)), { agent: 'coder' })
      const newer = { ...configured, mode: 'new SSE quota' }
      stream.emit({ type: 'quota', quota: newer, sessionId: 'ses_a' })
      await reply(resetRequest, { ok: true, quota: configured })
      await resetting
      assert.deepEqual(snapshot().bootstrap?.quota, newer)

      const refreshing = relay.refresh()
      const oldRequest = take('/api/bootstrap')
      const resetAll = relay.resetQuota()
      const allRequest = take('/api/quota/reset', 'POST')
      assert.deepEqual(JSON.parse(String(allRequest.init.body)), {})
      const cleared = { ...configured, mode: 'reset all' }
      await reply(allRequest, { ok: true, quota: cleared })
      await resetAll
      await reply(oldRequest, bootstrap(session('ses_c')))
      await refreshing
      assert.deepEqual(snapshot().bootstrap?.quota, cleared)
    })

    await t.test('concurrent deletions remove both sessions even when responses arrive out of order', async () => {
      const a = relay.deleteSession('ses_a')
      const aRequest = take('/api/session/ses_a', 'DELETE')
      const b = relay.deleteSession('ses_b')
      await reply(take('/api/session/ses_b', 'DELETE'), { deleted: 'ses_b' })
      await b
      await reply(aRequest, { deleted: 'ses_a' })
      await a
      assert.equal(snapshot().bootstrap?.sessions.some((item) => item.id === 'ses_a' || item.id === 'ses_b'), false)
    })

    await t.test('remaining typed API methods use the common fetch wrapper and correct endpoints', async () => {
      async function call(operation: Promise<unknown>, path: string, method: string, data: unknown) {
        const request = take(path, method)
        assert.equal(new Headers(request.init.headers).get('content-type'), 'application/json')
        assert.equal(request.init.cache, 'no-store')
        await reply(request, data)
        await operation
      }
      await call(relay.setInstructor('auto'), '/api/instructor', 'POST', { instructor: 'auto' })
      assert.equal(snapshot().bootstrap?.session.instructor, 'auto')
      const plan: PlanMessage = { id: 'plan_c', role: 'plan', task: 'Task', note: '', steps: [{ agent: 'coder', prompt: 'Task' }] }
      await call(relay.plan('Task', 'plan'), '/api/plan', 'POST', { plan })
      const orchestrating = relay.plan('Task', 'orchestrate')
      const orchestrateRequest = take('/api/plan', 'POST')
      assert.equal(JSON.parse(String(orchestrateRequest.init.body)).auto, false)
      assert.equal(JSON.parse(String(orchestrateRequest.init.body)).mode, 'orchestrate')
      await reply(orchestrateRequest, { plan })
      await orchestrating
      await call(relay.run(plan.steps, plan.task), '/api/run', 'POST', { ok: true })
      await call(relay.dispatch('coder', 'Task'), '/api/dispatch', 'POST', { ok: true })
      await call(relay.chain('coder: Task'), '/api/chain', 'POST', { plan })
      const note = { id: 'note_c', text: 'Side task', at: '' }
      await call(relay.btw('Side task'), '/api/btw', 'POST', { note, notes: [note], agent: 'Coder', queued: true })
      assert.deepEqual(snapshot().bootstrap?.session.notes, [note])
      const pin = { stepId: 'step_a', agent: 'coder', text: 'Pinned', at: '' }
      await call(relay.pin('step_a', true), '/api/pin', 'POST', { pinned: [pin] })
      assert.deepEqual(snapshot().bootstrap?.session.pinned, [pin])
      await call(relay.stop(), '/api/stop', 'POST', { ok: true })
      await call(relay.loadPresets(), '/api/presets', 'GET', { presets: {} })
      const presets = { Test: { note: 'Note', steps: plan.steps } }
      await call(relay.savePreset('Test', 'Note', plan.steps), '/api/presets', 'POST', { presets })
      assert.deepEqual(snapshot().presets, presets)
      const providers = [{ id: 'test', name: 'Test', protocol: 'openai', baseUrl: 'https://example.test', models: ['test'] }]
      await call(relay.loadProviders(), '/api/providers', 'GET', { providers })
      assert.deepEqual(snapshot().providers, providers)
      await call(relay.deleteConnection('test/a'), '/api/connections/test%2Fa', 'DELETE', { ok: true, connections: [], agents: [] })
      assert.deepEqual(snapshot().bootstrap?.connections, [])
      const plugin = { id: 'plugin', name: 'Plugin', instructions: 'Be brief', agents: ['*'], enabled: true }
      await call(relay.savePlugin({ name: 'Plugin', instructions: 'Be brief' }), '/api/plugins', 'POST', {
        plugin, registry: { mcp: [], plugins: [plugin] },
      })
      assert.equal(snapshot().bootstrap?.registry.plugins.length, 1)
      for (const kind of ['mcp', 'plugins'] as const) {
        await call(relay.toggleRegistry(kind, 'id/a', false), `/api/${kind}/id%2Fa`, 'POST', { registry: { mcp: [], plugins: [] } })
        await call(relay.deleteRegistry(kind, 'id/a'), `/api/${kind}/id%2Fa`, 'DELETE', { ok: true, registry: { mcp: [], plugins: [] } })
      }
      await call(relay.loadHealth(), '/api/health', 'GET', { at: null, results: [] })
      assert.deepEqual(snapshot().health, { at: null, results: [] })
      const creating = relay.newSession()
      await flush()
      await reply(take('/api/session', 'POST'), { session: session('ses_new') })
      await creating
      await reply(take('/api/bootstrap'), bootstrap(session('ses_new')))
      assert.equal(snapshot().bootstrap?.session.id, 'ses_new')
    })

    await t.test('reconnect waits exactly two seconds, opens one stream, and resyncs bootstrap', async () => {
      stream.fail()
      stream.fail()
      assert.equal(stream.closed, true)
      assert.equal(snapshot().connected, false)
      t.mock.timers.tick(1999)
      assert.equal(FakeEventSource.instances.length, 1)
      t.mock.timers.tick(1)
      assert.equal(FakeEventSource.instances.length, 2)
      const replacement = FakeEventSource.instances[1]
      replacement.open()
      const request = take('/api/bootstrap')
      replacement.emit({ type: 'delta', id: 'step_a', text: 'after reconnect', sessionId: 'ses_new' })
      await reply(request, bootstrap(session('ses_new')))
      assert.equal(snapshot().connected, true)
      assert.equal((snapshot().bootstrap?.session.messages[0] as StepMessage).text, 'after reconnect')
      stream.emit({ type: 'delta', id: 'step_a', text: 'obsolete connection', sessionId: 'ses_new' })
      assert.equal((snapshot().bootstrap?.session.messages[0] as StepMessage).text, 'after reconnect')
      replacement.fail()
      const health = relay.loadHealth()
      const healthRequest = take('/api/health')
      cleanup()
      cleanup()
      assert.equal(healthRequest.init.signal?.aborted, true)
      await reply(healthRequest, { at: 'ignored after cleanup', results: [] })
      await health
      assert.deepEqual(snapshot().health, { at: null, results: [] })
      t.mock.timers.tick(2000)
      assert.equal(FakeEventSource.instances.length, 2)
      assert.equal(snapshot().connected, false)
    })
  } finally {
    firstCleanup()
    cleanup()
    globalThis.EventSource = originalSource
    t.mock.restoreAll()
    t.mock.timers.reset()
  }
})
