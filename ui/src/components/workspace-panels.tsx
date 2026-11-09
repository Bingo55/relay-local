import { cloneElement, useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { ArrowRight, Pencil, Play, Plus, RefreshCw, RotateCcw, Trash2, X } from 'lucide-react'
import { Button } from './ui/button'
import { relay, useRelay } from '../lib/relay'
import { buttonStyles, canonicalHex, contrast, parseHex, presets, useTheme } from '../lib/theme'
import type { Agent, Bootstrap, Connection, ConnectionInput, McpServer, PlanStep, Plugin, Protocol, QuotaAgent } from '../lib/types'
import './workspace-panels.css'

export type Panel = 'agents' | 'context' | 'pipelines' | 'connections' | 'registry' | 'health' | 'help' | 'folder' | 'instructor' | 'appearance'

const titles: Record<Panel, string> = {
  agents: 'Agents and quotas', context: 'Shared context', pipelines: 'Saved pipelines',
  connections: 'Connections', registry: 'Tools and plugins', health: 'Health checks',
  help: 'Commands and shortcuts', folder: 'Working folder', instructor: 'Instructor', appearance: 'Appearance',
}

function useOperation() {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const pending = useRef(false)
  const mounted = useRef(true)
  const last = useRef<{ label: string; task: () => Promise<unknown>; safeError?: string } | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; last.current = null } }, [])
  const execute = useCallback(async (label: string, task: () => Promise<unknown>, safeError?: string) => {
    if (pending.current) return false
    pending.current = true
    last.current = { label, task, safeError }
    if (mounted.current) { setBusy(label); setError('') }
    try {
      await task()
      last.current = null
      return true
    } catch (cause: unknown) {
      if (mounted.current) setError(safeError || (cause instanceof Error ? cause.message : 'The request failed. Please retry.'))
      return false
    } finally {
      pending.current = false
      if (mounted.current) setBusy('')
    }
  }, [])
  const reset = useCallback(() => { if (!pending.current) { last.current = null; setError('') } }, [])
  return { busy, error, execute, reset, retry: () => {
    const request = last.current
    if (request) void execute(request.label, request.task, request.safeError)
  } }
}

function OperationStatus({ operation }: { operation: ReturnType<typeof useOperation> }) {
  return <>
    {operation.busy && <p className="muted" role="status">{operation.busy}…</p>}
    {operation.error && <div className="panel-error" role="alert">
      <p>{operation.error}</p>
      <Button type="button" variant="ghost" size="sm" className="button" onClick={operation.retry} disabled={!!operation.busy}>
        <RefreshCw aria-hidden="true" /> Retry
      </Button>
    </div>}
  </>
}

function useResource(load: () => Promise<unknown>, label: string, safeError?: string) {
  const operation = useOperation()
  const [loaded, setLoaded] = useState(false)
  const reload = useCallback(() => operation.execute(label, async () => {
    await load()
    setLoaded(true)
  }, safeError), [load, label, safeError, operation.execute])
  useEffect(() => { void reload() }, [reload])
  return { operation, loaded, reload }
}

function Field({ label, children, hint }: { label: string; children: ReactElement<{ id?: string; 'aria-describedby'?: string }>; hint?: string }) {
  const id = useId()
  return <div className="field"><label htmlFor={id}>{label}</label>{cloneElement(children, { id, 'aria-describedby': hint ? `${id}-hint` : undefined })}{hint && <span id={`${id}-hint`} className="muted field-hint">{hint}</span>}</div>
}

function RefreshButton({ onClick, disabled, label = 'Refresh' }: { onClick: () => void; disabled: boolean; label?: string }) {
  return <Button type="button" variant="ghost" size="sm" className="button" onClick={onClick} disabled={disabled} aria-label={label}>
    <RefreshCw aria-hidden="true" /> {label}
  </Button>
}

function words(value: string): string[] { return [...new Set(value.split(/[,\n]/).map((part) => part.trim()).filter(Boolean))] }
function date(value?: string | null): string {
  if (!value) return 'Not recorded'
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? 'Not recorded' : at.toLocaleString()
}

export function WorkspacePanel({ panel, onClose, onRunPreset, onFocusComposer }: {
  panel: Panel; onClose: () => void; onRunPreset: (name: string) => void; onFocusComposer: () => void
}) {
  const state = useRelay()
  const operation = useOperation()
  return <section className="workspace-panel-content" aria-label={titles[panel]}>
    <div className="panel-heading">
      <h2>{titles[panel]}</h2>
      <Button type="button" variant="ghost" size="icon" className="icon-button" aria-label={`Close ${titles[panel].toLowerCase()}`} onClick={onClose}>
        <X aria-hidden="true" />
      </Button>
    </div>
    <div className="panel-body">
      {!state.bootstrap ? <>
        <p className="empty-copy" role={state.phase === 'error' ? 'alert' : 'status'}>
          {state.phase === 'error' ? state.error || 'Could not load the workspace.' : 'Loading workspace…'}
        </p>
        {state.phase === 'error' && <RefreshButton onClick={() => { void operation.execute('Loading workspace', relay.refresh) }} disabled={!!operation.busy} label="Retry workspace" />}
        <OperationStatus operation={operation} />
      </> : <PanelContent key={`${panel}:${state.bootstrap.session.id}`} panel={panel} bootstrap={state.bootstrap} onRunPreset={onRunPreset} onFocusComposer={onFocusComposer} />}
    </div>
  </section>
}

function PanelContent({ panel, bootstrap, onRunPreset, onFocusComposer }: {
  panel: Panel; bootstrap: Bootstrap; onRunPreset: (name: string) => void; onFocusComposer: () => void
}) {
  switch (panel) {
    case 'agents': return <AgentsPanel bootstrap={bootstrap} />
    case 'context': return <ContextPanel bootstrap={bootstrap} />
    case 'pipelines': return <PipelinesPanel bootstrap={bootstrap} onRunPreset={onRunPreset} />
    case 'connections': return <ConnectionsPanel bootstrap={bootstrap} />
    case 'registry': return <RegistryPanel bootstrap={bootstrap} />
    case 'health': return <HealthPanel />
    case 'folder': return <FolderPanel bootstrap={bootstrap} />
    case 'instructor': return <InstructorPanel bootstrap={bootstrap} />
    case 'appearance': return <AppearancePanel />
    case 'help': return <HelpPanel onFocusComposer={onFocusComposer} />
  }
}

function countdown(until: string | null, now: number): string {
  if (!until) return 'No reset time recorded'
  const remaining = Date.parse(until) - now
  if (!Number.isFinite(remaining)) return 'No reset time recorded'
  if (remaining <= 0) return 'Reset time reached; awaiting status'
  const seconds = Math.ceil(remaining / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `Available in ${hours ? `${hours}h ` : ''}${minutes}m ${seconds % 60}s`
}

function AgentsPanel({ bootstrap }: { bootstrap: Bootstrap }) {
  const { agentStates } = useRelay()
  const operation = useOperation()
  const [now, setNow] = useState(Date.now)
  const [editing, setEditing] = useState<string | null>(null)
  const [limit, setLimit] = useState('')
  const [windowName, setWindowName] = useState('day')
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const quotas = [...bootstrap.quota.agents]
  if (bootstrap.quota.route && !quotas.some((item) => item.id === bootstrap.quota.route?.id)) quotas.push(bootstrap.quota.route)
  const agents: (Agent | QuotaAgent)[] = [...bootstrap.agents, ...quotas.filter((quota) => !bootstrap.agents.some((agent) => agent.id === quota.id))]
  return <div className="form-stack">
    <p className="muted">Local call caps guide routing. They are not a provider billing balance.</p>
    <p className="muted">Next eligible route: {bootstrap.quota.route?.label || 'No eligible agent'}</p>
    <div className="row-actions">
      <RefreshButton onClick={() => { void operation.execute('Refreshing agents', relay.refresh) }} disabled={!!operation.busy} />
      <Button type="button" variant="ghost" size="sm" className="button" disabled={!!operation.busy} onClick={() => {
        if (window.confirm('Reset local usage counters for every agent?')) void operation.execute('Resetting quotas', () => relay.resetQuota())
      }}>Reset all usage</Button>
    </div>
    <OperationStatus operation={operation} />
    {!agents.length && <p className="empty-copy">No agents are configured. Add a provider connection to make models available.</p>}
    {agents.map((agent) => {
      const quota = quotas.find((item) => item.id === agent.id)
      let status = 'Ready'
      if (agent.disabled) status = 'Disabled'
      else if (agentStates[agent.id] === 'running') status = 'Running'
      else if (quota?.cooling || agentStates[agent.id] === 'cooling') status = 'Cooling'
      else if (quota?.out) status = 'Unavailable'
      else if (quota && quota.limit > 0 && quota.used >= quota.limit) status = 'Cap reached'
      else if (quota && quota.percent !== null && quota.percent >= 95) status = 'Near cap'
      const roles = Object.entries(bootstrap.roles).filter(([, ids]) => ids.includes(agent.id)).map(([role]) => role)
      const percent = quota && quota.limit > 0 ? Math.min(100, Math.max(0, (quota.used / quota.limit) * 100)) : null
      return <section className="panel-row panel-card" key={agent.id}>
        <div className="panel-line"><h3>{agent.label || agent.id}</h3><span className="badge">{status}</span></div>
        <p className="muted panel-code">{agent.id}</p>
        {'model' in agent && agent.model && <p className="panel-code">{agent.model}</p>}
        {'caps' in agent && agent.caps && <p className="muted">{agent.caps}</p>}
        {roles.length > 0 && <p className="muted">Roles: {roles.join(', ')}</p>}
        {quota ? <>
          <p>{quota.used} / {quota.limit > 0 ? quota.limit : 'unlimited'} calls <span className="muted">per {quota.window}</span></p>
          {percent !== null && <progress className="quota-progress" value={percent} max={100} aria-label={`${agent.label} local quota usage`} />}
          <p className="muted">{quota.calls} calls, {quota.errors} errors, {quota.quotaHits} quota hits</p>
          {(quota.out || quota.cooling || quota.outUntil) && <p className="muted">{countdown(quota.outUntil, now)}</p>}
          {editing === agent.id ? <form className="form-stack" onSubmit={(event) => {
            event.preventDefault()
            const numeric = Number(limit)
            if (!Number.isSafeInteger(numeric) || numeric < 0 || !windowName.trim()) return
            void operation.execute('Saving quota', async () => { await relay.configureQuota(agent.id, numeric, windowName.trim()); setEditing(null) })
          }}><fieldset className="panel-form-fields form-stack" disabled={!!operation.busy}>
            <Field label="Call limit" hint="Use 0 for an unlimited local cap."><input type="number" min="0" step="1" required value={limit} onChange={(event) => setLimit(event.target.value)} /></Field>
            <Field label="Quota window"><select value={windowName} onChange={(event) => setWindowName(event.target.value)}>
              {[...new Set(['day', 'week', 'month', 'total', quota.window])].map((value) => <option key={value} value={value}>{value}</option>)}
            </select></Field>
            <div className="row-actions"><Button type="submit" size="sm" className="button button-primary" disabled={!!operation.busy}>Save cap</Button><Button type="button" variant="ghost" size="sm" className="button" disabled={!!operation.busy} onClick={() => { setEditing(null); operation.reset() }}>Cancel</Button></div>
          </fieldset></form> : <div className="row-actions">
            <Button type="button" variant="ghost" size="sm" className="button" disabled={!!operation.busy} onClick={() => { setEditing(agent.id); setLimit(String(quota.limit)); setWindowName(quota.window); operation.reset() }}>Set cap</Button>
            <Button type="button" variant="ghost" size="sm" className="button" disabled={!!operation.busy} onClick={() => {
              if (window.confirm(`Reset local usage for ${agent.label}?`)) void operation.execute('Resetting usage', () => relay.resetQuota(agent.id))
            }}>Reset usage</Button>
          </div>}
        </> : <p className="muted">No local quota measurements available.</p>}
      </section>
    })}
  </div>
}

function ContextPanel({ bootstrap }: { bootstrap: Bootstrap }) {
  const operation = useOperation()
  const [note, setNote] = useState('')
  const pins = bootstrap.session.pinned || []
  const notes = bootstrap.session.notes || []
  const outputs = bootstrap.session.messages.filter((message) => message.role === 'step' && message.text && message.status !== 'running')
  return <div className="form-stack">
    <p className="muted">Pinned outputs and side notes are shared with later work in this session.</p>
    <OperationStatus operation={operation} />
    <h3>Pinned outputs <span className="muted">{pins.length}</span></h3>
    {!pins.length && <p className="empty-copy">Nothing pinned yet. Pin a completed output below or from the conversation.</p>}
    {pins.map((pin) => <div className="panel-row panel-card" key={pin.stepId}>
      <div className="panel-line"><strong>{pin.agent}</strong><Button type="button" variant="ghost" size="sm" className="button" disabled={!!operation.busy} onClick={() => { void operation.execute('Unpinning output', () => relay.pin(pin.stepId, false)) }}>Unpin</Button></div>
      <details><summary>View pinned output</summary><p className="panel-prewrap">{pin.text}</p></details>
      <p className="muted">{date(pin.at)}</p>
    </div>)}
    <h3>Available outputs</h3>
    {!outputs.length && <p className="empty-copy">Completed agent outputs will appear here.</p>}
    {outputs.map((message) => {
      if (message.role !== 'step') return null
      const id = message.stepId || message.id
      const pinned = pins.some((pin) => pin.stepId === id)
      return <div className="panel-row panel-card" key={message.id}>
        <div className="panel-line"><strong>{message.label || message.agent}</strong><Button type="button" variant="ghost" size="sm" className="button" disabled={!!operation.busy} onClick={() => { void operation.execute(pinned ? 'Unpinning output' : 'Pinning output', () => relay.pin(id, !pinned)) }}>{pinned ? 'Unpin' : 'Pin'}</Button></div>
        <p className="muted">{message.text.slice(0, 180)}{message.text.length > 180 ? '…' : ''}</p>
      </div>
    })}
    <h3>Side notes <span className="muted">{notes.length}</span></h3>
    {!notes.length && <p className="empty-copy">No side notes in this session.</p>}
    {notes.map((item) => <div className="panel-row panel-card" key={item.id}><p className="panel-prewrap">{item.text}</p><p className="muted">{date(item.at)}</p></div>)}
    <form className="form-stack" onSubmit={(event) => {
      event.preventDefault()
      if (!note.trim()) return
      void operation.execute('Sending side note', async () => { await relay.btw(note.trim()); setNote('') })
    }}><fieldset className="panel-form-fields form-stack" disabled={!!operation.busy}>
      <Field label="Question or side objective" hint="Relay saves the note and may dispatch an available agent without interrupting the main run."><textarea rows={3} required value={note} onChange={(event) => setNote(event.target.value)} /></Field>
      <Button type="submit" size="sm" className="button button-primary" disabled={!!operation.busy || !note.trim()}>Send side note <ArrowRight aria-hidden="true" /></Button>
    </fieldset></form>
    <p className="muted">Removing saved side notes requires a server endpoint that is not currently available.</p>
  </div>
}

function PipelinesPanel({ bootstrap, onRunPreset }: { bootstrap: Bootstrap; onRunPreset: (name: string) => void }) {
  const { presets } = useRelay()
  const resource = useResource(relay.loadPresets, 'Loading pipelines')
  const operation = useOperation()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [steps, setSteps] = useState<PlanStep[]>([])
  const [agentInputs, setAgentInputs] = useState<string[]>([])
  const [validation, setValidation] = useState('')
  const entries = Object.entries(presets)
  const latestPlan = [...bootstrap.session.messages].reverse().find((message) => message.role === 'plan')
  const edit = (pipelineName: string, pipelineNote: string, pipelineSteps: PlanStep[]) => {
    operation.reset()
    setName(pipelineName); setNote(pipelineNote); setSteps(pipelineSteps.map((step) => ({ ...step })))
    setAgentInputs(pipelineSteps.map((step) => step.agents?.join(', ') || step.agent || '')); setValidation(''); setEditing(true)
  }
  return <div className="form-stack">
    <div className="row-actions"><RefreshButton onClick={() => { void resource.reload() }} disabled={!!resource.operation.busy || !!operation.busy} /><Button type="button" variant="ghost" size="sm" className="button" disabled={!!operation.busy} onClick={() => edit('', '', [{ agent: bootstrap.agents.find((agent) => !agent.disabled)?.id || '', prompt: '' }])}><Plus aria-hidden="true" /> New pipeline</Button></div>
    <OperationStatus operation={resource.operation} />{!editing && <OperationStatus operation={operation} />}
    {resource.loaded && !entries.length && <p className="empty-copy">No saved pipelines. Create one or save the latest plan for reuse.</p>}
    {latestPlan?.role === 'plan' && <Button type="button" variant="ghost" size="sm" className="button" disabled={!!operation.busy} onClick={() => edit('', latestPlan.note, latestPlan.steps)}>Save latest plan</Button>}
    {entries.map(([pipelineName, preset]) => <section className="panel-row panel-card" key={pipelineName}>
      <h3>{pipelineName}</h3>{preset.note && <p className="muted">{preset.note}</p>}
      <ol className="pipeline-steps">{preset.steps.map((step, index) => <li key={index}><strong>{step.agents?.join(', ') || step.agent || 'Automatic routing'}</strong><p>{step.prompt}</p>{step.model && <p className="muted panel-code">{step.model}</p>}</li>)}</ol>
      <div className="row-actions"><Button type="button" size="sm" className="button button-primary" disabled={bootstrap.busy || !!operation.busy || !preset.steps.length} onClick={() => onRunPreset(pipelineName)}><Play aria-hidden="true" /> Run</Button><Button type="button" variant="ghost" size="sm" className="button" disabled={!!operation.busy} onClick={() => edit(pipelineName, preset.note, preset.steps)}><Pencil aria-hidden="true" /> Edit</Button></div>
    </section>)}
    {editing && <form className="form-stack panel-card" onSubmit={(event) => {
      event.preventDefault()
      setValidation('')
      const configured = steps.map((step, index) => {
        const ids = words(agentInputs[index] || '')
        return { ...step, agent: ids.length === 1 ? ids[0] : undefined, agents: ids.length > 1 ? ids : undefined }
      })
      if (!name.trim() || !configured.length || configured.some((step) => !step.prompt.trim() || (!step.agent && !step.agents?.length))) { setValidation('Enter a name, agent IDs, and a prompt for every step.'); return }
      if (presets[name.trim()] && !window.confirm(`Replace the saved pipeline “${name.trim()}”?`)) return
      void operation.execute('Saving pipeline', async () => { await relay.savePreset(name.trim(), note.trim(), configured); setEditing(false); setName(''); setNote(''); setSteps([]); setAgentInputs([]) })
    }}><fieldset className="panel-form-fields form-stack" disabled={!!operation.busy}>
      <h3>Pipeline editor</h3>
      <Field label="Pipeline name"><input required value={name} onChange={(event) => setName(event.target.value)} /></Field>
      <Field label="Description"><textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></Field>
      {steps.map((step, index) => <fieldset className="form-stack pipeline-step-editor" key={index}>
        <legend>Step {index + 1}</legend>
        <Field label="Agent IDs" hint="Comma-separated IDs run this step in parallel."><input required list="pipeline-agent-ids" value={agentInputs[index] || ''} onChange={(event) => setAgentInputs((current) => current.map((value, i) => i === index ? event.target.value : value))} /></Field>
        <Field label="Prompt"><textarea required rows={3} value={step.prompt} onChange={(event) => setSteps((current) => current.map((item, i) => i === index ? { ...item, prompt: event.target.value } : item))} /></Field>
        <Field label="Model (optional)"><input value={step.model || ''} onChange={(event) => setSteps((current) => current.map((item, i) => i === index ? { ...item, model: event.target.value } : item))} /></Field>
        <Button type="button" variant="ghost" size="sm" className="button button-danger" disabled={!!operation.busy} aria-label={`Remove pipeline step ${index + 1}`} onClick={() => { setSteps((current) => current.filter((_, i) => i !== index)); setAgentInputs((current) => current.filter((_, i) => i !== index)) }}><Trash2 aria-hidden="true" /> Remove step</Button>
      </fieldset>)}
      <datalist id="pipeline-agent-ids">{bootstrap.agents.filter((agent) => !agent.disabled).map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}</datalist>
      <Button type="button" variant="ghost" size="sm" className="button" disabled={!!operation.busy || steps.length >= 6} onClick={() => { setSteps((current) => [...current, { agent: '', prompt: '' }]); setAgentInputs((current) => [...current, '']) }}><Plus aria-hidden="true" /> Add step</Button>
      {validation && <p className="panel-error" role="alert">{validation}</p>}
      <OperationStatus operation={operation} />
      <div className="row-actions"><Button type="submit" size="sm" className="button button-primary" disabled={!!operation.busy || !steps.length}>Save pipeline</Button><Button type="button" variant="ghost" size="sm" className="button" disabled={!!operation.busy} onClick={() => { setEditing(false); operation.reset() }}>Cancel</Button></div>
    </fieldset></form>}
    <p className="muted">Pipeline deletion is not available from the server. Saving an existing name replaces its definition.</p>
  </div>
}

const emptyConnection = (): ConnectionInput => ({ name: '', providerId: '', protocol: 'openai', baseUrl: '', models: [], defaultModel: '', apiKey: '' })

function ConnectionsPanel({ bootstrap }: { bootstrap: Bootstrap }) {
  const { providers } = useRelay()
  const resource = useResource(relay.loadProviders, 'Loading providers', 'Could not load the provider catalog. Retry to reconnect.')
  const operation = useOperation()
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<ConnectionInput | null>(null)
  const [modelText, setModelText] = useState('')
  const [validation, setValidation] = useState('')
  const matching = providers.filter((provider) => `${provider.name} ${provider.id} ${provider.protocol} ${provider.note || ''} ${provider.models.join(' ')} ${provider.tags?.join(' ') || ''}`.toLowerCase().includes(query.toLowerCase().trim()))
  const open = (connection?: Connection) => {
    operation.reset()
    setDraft(connection ? { id: connection.id, providerId: connection.providerId, name: connection.name, protocol: connection.protocol, baseUrl: connection.baseUrl, models: [...connection.models], defaultModel: connection.defaultModel, apiKey: '' } : emptyConnection())
    setModelText(connection?.models.join('\n') || ''); setValidation('')
  }
  const update = (patch: Partial<ConnectionInput>) => setDraft((current) => current ? { ...current, ...patch } : current)
  const existing = draft?.id ? bootstrap.connections.find((connection) => connection.id === draft.id) : undefined
  return <div className="form-stack">
    <p className="muted">Connect a provider to make its models available to Relay agents.</p>
    <Button type="button" variant="ghost" size="sm" className="button" disabled={!!operation.busy} onClick={() => open()}><Plus aria-hidden="true" /> Add connection</Button>
    {!draft && <OperationStatus operation={operation} />}
    {!bootstrap.connections.length && <p className="empty-copy">No API connections saved. Choose a provider below to get started.</p>}
    {bootstrap.connections.map((connection) => <section className="panel-row panel-card" key={connection.id}>
      <div className="panel-line"><h3>{connection.name}</h3><span className="badge">{connection.hasKey ? 'Key saved' : 'No key'}</span></div>
      <p className="muted">{connection.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible'}</p>
      <p className="muted">{connection.models.length} models; default: <span className="panel-code">{connection.defaultModel || 'Not set'}</span></p>
      <details><summary>Model list</summary><ul className="panel-list">{connection.models.map((model) => <li className="panel-code" key={model}>{model}</li>)}</ul></details>
      <div className="row-actions"><Button type="button" variant="ghost" size="sm" className="button" disabled={!!operation.busy} onClick={() => open(connection)} aria-label={`Edit ${connection.name}`}><Pencil aria-hidden="true" /> Edit</Button><Button type="button" variant="ghost" size="sm" className="button button-danger" disabled={!!operation.busy} onClick={() => {
        if (window.confirm(`Delete “${connection.name}” and its connected agent?`)) void operation.execute('Deleting connection', async () => { await relay.deleteConnection(connection.id); if (draft?.id === connection.id) { setDraft(null); setModelText('') } }, 'Could not delete the connection. Please retry.')
      }} aria-label={`Delete ${connection.name}`}><Trash2 aria-hidden="true" /> Delete</Button></div>
    </section>)}
    <div className="panel-line"><h3>Provider catalog <span className="muted">{providers.length}</span></h3><RefreshButton onClick={() => { void resource.reload() }} disabled={!!resource.operation.busy || !!operation.busy} label="Reload providers" /></div>
    <Field label="Search providers"><input type="search" value={query} placeholder="Name or capability" onChange={(event) => setQuery(event.target.value)} /></Field>
    <OperationStatus operation={resource.operation} />
    {resource.loaded && !providers.length && <p className="empty-copy">The provider catalog is empty. You can add a custom connection.</p>}
    {providers.length > 0 && !matching.length && <p className="empty-copy">No providers match this search.</p>}
    {matching.length > 0 && <>
      <p className="muted">{matching.length} of {providers.length} providers</p>
      <Field label="Provider preset" hint="Selecting a preset fills the connection form. Nothing is saved until you submit it."><select value="" disabled={!!operation.busy} onChange={(event) => {
        const provider = providers.find((item) => item.id === event.target.value)
        if (!provider) return
        operation.reset()
        setDraft({ ...emptyConnection(), providerId: provider.id, name: provider.name, protocol: provider.protocol, baseUrl: provider.baseUrl, models: [...provider.models], defaultModel: provider.models[0] || '' })
        setModelText(provider.models.join('\n')); setValidation('')
      }}><option value="">Choose from {matching.length} providers</option>{matching.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></Field>
    </>}
    <Button type="button" variant="ghost" size="sm" className="button" disabled={!!operation.busy} onClick={() => open()}>Use a custom endpoint</Button>
    {draft && <form className="form-stack panel-card" autoComplete="off" onSubmit={(event) => {
      event.preventDefault(); setValidation('')
      const models = words(modelText)
      let endpoint: URL
      try { endpoint = new URL(draft.baseUrl) } catch { setValidation('Enter a valid HTTP or HTTPS base URL.'); return }
      if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) { setValidation('Use an HTTP or HTTPS base URL without credentials, query parameters, or a fragment.'); return }
      if (!draft.name.trim() || !models.length) { setValidation('Enter a connection name and at least one model.'); return }
      if (draft.defaultModel && !models.includes(draft.defaultModel.trim())) { setValidation('The default model must be included in the model list.'); return }
      const input: ConnectionInput = { ...draft, name: draft.name.trim(), baseUrl: draft.baseUrl.trim(), models, defaultModel: draft.defaultModel?.trim() || models[0], ...(draft.apiKey ? { apiKey: draft.apiKey } : { apiKey: undefined }) }
      void operation.execute('Saving connection', async () => { await relay.saveConnection(input); setDraft(null); setModelText(''); setValidation('') }, 'Could not save the connection. Check the endpoint and credentials, then retry. Secret values are not shown.')
    }}><fieldset className="panel-form-fields form-stack" disabled={!!operation.busy}>
      <h3>{draft.id ? 'Edit connection' : 'New connection'}</h3>
      <Field label="Name"><input required value={draft.name} onChange={(event) => update({ name: event.target.value })} /></Field>
      <Field label="Protocol"><select value={draft.protocol} onChange={(event) => update({ protocol: event.target.value as Protocol })}><option value="openai">OpenAI-compatible</option><option value="anthropic">Anthropic</option></select></Field>
      <Field label="Base URL"><input type="url" required value={draft.baseUrl} placeholder="https://api.example.com/v1" onChange={(event) => update({ baseUrl: event.target.value })} /></Field>
      <Field label="API key" hint={existing?.hasKey ? 'A key is saved. Leave this blank to keep it, or enter a replacement.' : 'Optional for endpoints that do not require a key.'}><input type="password" autoComplete="new-password" value={draft.apiKey || ''} onChange={(event) => update({ apiKey: event.target.value })} /></Field>
      <Field label="Models" hint="One model ID per line, or separate IDs with commas."><textarea required rows={4} className="panel-code" value={modelText} onChange={(event) => setModelText(event.target.value)} /></Field>
      <Field label="Default model"><select value={draft.defaultModel || ''} onChange={(event) => update({ defaultModel: event.target.value })}><option value="">First model in the list</option>{[...new Set([...(draft.defaultModel ? [draft.defaultModel] : []), ...words(modelText)])].map((model) => <option key={model} value={model}>{model}</option>)}</select></Field>
      {validation && <p className="panel-error" role="alert">{validation}</p>}
      <OperationStatus operation={operation} />
      <div className="row-actions"><Button type="submit" size="sm" className="button button-primary" disabled={!!operation.busy}>Save connection</Button><Button type="button" variant="ghost" size="sm" className="button" disabled={!!operation.busy} onClick={() => { setDraft(null); setModelText(''); setValidation(''); operation.reset() }}>Cancel</Button></div>
    </fieldset></form>}
  </div>
}

type RegistryDraft = {
  kind: 'mcp' | 'plugins'; id?: string; name: string; command: string; args: string;
  env: string; cwd: string; note: string; instructions: string; agents: string[]; enabled: boolean
}

function RegistryPanel({ bootstrap }: { bootstrap: Bootstrap }) {
  const resource = useResource(relay.loadRegistry, 'Loading registry', 'Could not load tools and plugins. Please retry.')
  const operation = useOperation()
  const [tab, setTab] = useState<'mcp' | 'plugins'>('mcp')
  const [draft, setDraft] = useState<RegistryDraft | null>(null)
  const [validation, setValidation] = useState('')
  const registry = bootstrap.registry
  const open = (kind: 'mcp' | 'plugins', item?: McpServer | Plugin) => {
    operation.reset()
    setValidation('')
    setDraft({ kind, id: item?.id, name: item?.name || '', command: item && 'command' in item ? item.command : '', args: item && 'args' in item ? JSON.stringify(item.args) : '', env: '', cwd: item && 'cwd' in item ? item.cwd || '' : '', note: item && 'note' in item ? item.note || '' : '', instructions: item && 'instructions' in item ? item.instructions : '', agents: item?.agents.includes('*') ? [] : [...(item?.agents || [])], enabled: item?.enabled ?? true })
  }
  const update = (patch: Partial<RegistryDraft>) => setDraft((current) => current ? { ...current, ...patch } : current)
  const entries = tab === 'mcp' ? registry.mcp : registry.plugins
  return <div className="form-stack">
    <div className="panel-tabs" role="group" aria-label="Registry category">
      <Button type="button" variant="ghost" size="sm" className="button" aria-pressed={tab === 'mcp'} disabled={!!operation.busy} onClick={() => { setTab('mcp'); setDraft(null); operation.reset() }}>MCP servers ({registry.mcp.length})</Button>
      <Button type="button" variant="ghost" size="sm" className="button" aria-pressed={tab === 'plugins'} disabled={!!operation.busy} onClick={() => { setTab('plugins'); setDraft(null); operation.reset() }}>Plugins ({registry.plugins.length})</Button>
    </div>
    <p className="muted">{tab === 'mcp' ? 'MCP servers launch local commands. Only configure tools you trust.' : 'Plugins add instructions to selected agents. They do not install executable packages.'}</p>
    <div className="row-actions"><Button type="button" variant="ghost" size="sm" className="button" disabled={!!operation.busy} onClick={() => open(tab)}><Plus aria-hidden="true" /> Add {tab === 'mcp' ? 'server' : 'plugin'}</Button><RefreshButton onClick={() => { void resource.reload() }} disabled={!!resource.operation.busy || !!operation.busy} /></div>
    <OperationStatus operation={resource.operation} />{!draft && <OperationStatus operation={operation} />}
    {resource.loaded && !entries.length && <p className="empty-copy">No {tab === 'mcp' ? 'MCP servers' : 'plugins'} configured.</p>}
    {entries.map((item) => <section className="panel-row panel-card" key={item.id}>
      <div className="panel-line"><h3>{item.name}</h3><span className="badge">{item.enabled ? 'Enabled' : 'Disabled'}</span></div>
      <p className="muted">Agents: {item.agents.includes('*') || !item.agents.length ? 'All eligible agents' : item.agents.join(', ')}</p>
      {'command' in item && <p className="muted">{item.args.length} command arguments; {item.envKeys?.length || 0} environment variables saved</p>}
      {'instructions' in item && <details><summary>View instructions</summary><p className="panel-prewrap">{item.instructions}</p></details>}
      <div className="row-actions">
        <Button type="button" variant="ghost" size="sm" className="button" disabled={!!operation.busy} aria-label={`${item.enabled ? 'Disable' : 'Enable'} ${item.name}`} onClick={() => { void operation.execute('Updating registry', () => relay.toggleRegistry(tab, item.id, !item.enabled), 'Could not update the registry item. Please retry.') }}>{item.enabled ? 'Disable' : 'Enable'}</Button>
        <Button type="button" variant="ghost" size="sm" className="button" disabled={!!operation.busy} aria-label={`Edit ${item.name}`} onClick={() => open(tab, item)}><Pencil aria-hidden="true" /> Edit</Button>
        <Button type="button" variant="ghost" size="sm" className="button button-danger" disabled={!!operation.busy} aria-label={`Delete ${item.name}`} onClick={() => {
          if (window.confirm(`Delete “${item.name}” from the registry?`)) void operation.execute('Deleting registry item', async () => { await relay.deleteRegistry(tab, item.id); if (draft?.id === item.id) setDraft(null) }, 'Could not delete the registry item. Please retry.')
        }}><Trash2 aria-hidden="true" /> Delete</Button>
      </div>
    </section>)}
    {draft && <form className="form-stack panel-card" autoComplete="off" onSubmit={(event) => {
      event.preventDefault(); setValidation('')
      if (!draft.name.trim()) { setValidation('Enter a name.'); return }
      let args: string[] | string = draft.args.trim()
      if (draft.kind === 'mcp' && args.startsWith('[')) {
        try {
          const parsed: unknown = JSON.parse(args)
          if (!Array.isArray(parsed) || !parsed.every((part: unknown) => typeof part === 'string')) throw new Error()
          args = parsed as string[]
        } catch { setValidation('Arguments must be a JSON array of strings, or a command argument string.'); return }
      }
      let env: string | undefined
      if (draft.kind === 'mcp' && draft.env.trim()) {
        try {
          const parsed: unknown = JSON.parse(draft.env)
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Object.values(parsed).every((value: unknown) => typeof value === 'string')) throw new Error()
          env = draft.env.trim()
        } catch { setValidation('Environment must be a JSON object with string values. Its contents are not displayed.'); return }
      }
      if (draft.kind === 'mcp' && !draft.command.trim()) { setValidation('Enter the server command.'); return }
      if (draft.kind === 'plugins' && !draft.instructions.trim()) { setValidation('Enter plugin instructions.'); return }
      void operation.execute('Saving registry item', async () => {
        if (draft.kind === 'mcp') await relay.saveMcp({ id: draft.id, name: draft.name.trim(), command: draft.command.trim(), args, ...(env ? { env } : {}), cwd: draft.cwd.trim(), note: draft.note.trim(), agents: draft.agents, enabled: draft.enabled })
        else await relay.savePlugin({ id: draft.id, name: draft.name.trim(), instructions: draft.instructions.trim(), agents: draft.agents, enabled: draft.enabled })
        setDraft(null); setValidation('')
      }, 'Could not save the registry item. Check the configuration and retry. Secret values are not shown.')
    }}><fieldset className="panel-form-fields form-stack" disabled={!!operation.busy}>
      <h3>{draft.id ? 'Edit' : 'Add'} {draft.kind === 'mcp' ? 'MCP server' : 'plugin'}</h3>
      <Field label="Name"><input required value={draft.name} onChange={(event) => update({ name: event.target.value })} /></Field>
      {draft.kind === 'mcp' ? <>
        <Field label="Command"><input required value={draft.command} placeholder="npx" onChange={(event) => update({ command: event.target.value })} /></Field>
        <Field label="Arguments" hint="A JSON string array preserves spaces within individual arguments."><input value={draft.args} placeholder='["-y", "package-name"]' onChange={(event) => update({ args: event.target.value })} /></Field>
        <Field label="Environment JSON (optional)" hint={draft.id ? 'Leave blank to keep saved environment values. A supplied object replaces them; {} clears them.' : 'JSON object with string values. Values stay masked and are cleared after saving.'}><input type="password" autoComplete="new-password" value={draft.env} onChange={(event) => update({ env: event.target.value })} /></Field>
        <Field label="Server working directory (optional)"><input value={draft.cwd} onChange={(event) => update({ cwd: event.target.value })} /></Field>
        <Field label="Note (optional)"><textarea rows={2} value={draft.note} onChange={(event) => update({ note: event.target.value })} /></Field>
      </> : <Field label="Instructions"><textarea required rows={6} value={draft.instructions} onChange={(event) => update({ instructions: event.target.value })} /></Field>}
      <fieldset className="form-stack agent-checkboxes"><legend>Agent access</legend><p className="muted">No selections applies to all eligible agents.</p>
        {[...bootstrap.agents.map((agent) => ({ id: agent.id, label: agent.label })), ...draft.agents.filter((id) => !bootstrap.agents.some((agent) => agent.id === id)).map((id) => ({ id, label: `${id} (not currently available)` }))].map((agent) => <label className="panel-check" key={agent.id}><input type="checkbox" checked={draft.agents.includes(agent.id)} onChange={(event) => update({ agents: event.target.checked ? [...draft.agents, agent.id] : draft.agents.filter((id) => id !== agent.id) })} /><span>{agent.label}</span></label>)}
      </fieldset>
      <label className="panel-check"><input type="checkbox" checked={draft.enabled} onChange={(event) => update({ enabled: event.target.checked })} /><span>Enabled</span></label>
      {validation && <p className="panel-error" role="alert">{validation}</p>}
      <OperationStatus operation={operation} />
      <div className="row-actions"><Button type="submit" size="sm" className="button button-primary" disabled={!!operation.busy}>Save {draft.kind === 'mcp' ? 'server' : 'plugin'}</Button><Button type="button" variant="ghost" size="sm" className="button" disabled={!!operation.busy} onClick={() => { setDraft(null); setValidation(''); operation.reset() }}>Cancel</Button></div>
    </fieldset></form>}
  </div>
}

function HealthPanel() {
  const { health, connected, notice } = useRelay()
  const resource = useResource(relay.loadHealth, 'Loading health report', 'Could not load the health report. Please retry.')
  return <div className="form-stack">
    <div className="panel-row panel-card"><div className="panel-line"><strong>Live updates</strong><span className="badge">{connected ? 'Connected' : 'Reconnecting'}</span></div><p className="muted">{connected ? 'Receiving server events.' : 'Relay will retry the event connection automatically.'}</p></div>
    <p className="muted">Refresh reloads the saved probe report; it does not run a new check. Run <code>npm run probe</code> on the Relay server to update it.</p>
    <RefreshButton onClick={() => { void resource.reload() }} disabled={!!resource.operation.busy} label="Refresh report" />
    <OperationStatus operation={resource.operation} />
    {health && <p className="muted">Last checked: {date(health.at)}</p>}
    {resource.loaded && (!health || !health.results.length) && <p className="empty-copy">No health check results were returned.</p>}
    {health?.results.map((result, index) => <div className="panel-row panel-card" key={`${result.id || result.agent || 'check'}:${index}`}>
      <div className="panel-line"><h3>{result.label || result.agent || result.id || `Check ${index + 1}`}</h3><span className="badge">{result.ok === true ? 'Healthy' : result.ok === false || result.error ? 'Failed' : 'Unknown'}</span></div>
      {typeof result.durationMs === 'number' && Number.isFinite(result.durationMs) && <p className="muted">Duration: {Math.max(0, result.durationMs)} ms</p>}
      {(result.ok === false || result.error) && <p className="muted">The check did not pass. Verify the agent installation or connection, then update the server’s probe report.</p>}
    </div>)}
    {!!notice && <div className="panel-row panel-card"><p className="muted">A server notice is available in the workspace.</p><Button type="button" variant="ghost" size="sm" className="button" onClick={relay.clearNotice}>Dismiss notice</Button></div>}
  </div>
}

function FolderPanel({ bootstrap }: { bootstrap: Bootstrap }) {
  const operation = useOperation()
  const [cwd, setCwd] = useState(bootstrap.session.cwd)
  useEffect(() => { setCwd(bootstrap.session.cwd) }, [bootstrap.session.cwd])
  return <form className="form-stack" onSubmit={(event) => {
    event.preventDefault()
    if (!cwd.trim()) return
    void operation.execute('Updating working folder', () => relay.setCwd(cwd.trim()))
  }}><fieldset className="panel-form-fields form-stack" disabled={!!operation.busy}>
    <p className="muted">The working folder is on the Relay server’s machine, not this browser’s device.</p>
    <div className="panel-row panel-card"><h3>Current folder</h3><p className="panel-code">{bootstrap.session.cwd || 'Not set'}</p></div>
    <Field label="Exact folder path" hint="Enter an existing directory. Relay validates the path before applying it."><input required value={cwd} spellCheck={false} autoComplete="off" placeholder="C:\\projects\\my-project" onChange={(event) => setCwd(event.target.value)} /></Field>
    <OperationStatus operation={operation} />
    <Button type="submit" size="sm" className="button button-primary" disabled={!!operation.busy || !cwd.trim() || cwd.trim() === bootstrap.session.cwd}>Use this folder</Button>
  </fieldset></form>
}

function InstructorPanel({ bootstrap }: { bootstrap: Bootstrap }) {
  const operation = useOperation()
  const [selected, setSelected] = useState(bootstrap.session.instructor || 'auto')
  useEffect(() => { setSelected(bootstrap.session.instructor || 'auto') }, [bootstrap.session.instructor])
  return <form className="form-stack" onSubmit={(event) => {
    event.preventDefault()
    void operation.execute('Changing instructor', () => relay.setInstructor(selected))
  }}><fieldset className="panel-form-fields form-stack" disabled={!!operation.busy}>
    <p className="muted">Choose the instructor that builds plans for this session. Automatic selection tries eligible instructors in order.</p>
    <Field label="Planning instructor"><select value={selected} onChange={(event) => setSelected(event.target.value)}>
      <option value="auto">Automatic selection</option>
      {bootstrap.instructors.filter((instructor) => instructor.id !== 'auto').map((instructor) => <option key={instructor.id} value={instructor.id}>{instructor.label}</option>)}
      {selected !== 'auto' && !bootstrap.instructors.some((instructor) => instructor.id === selected) && <option value={selected}>{selected} (unavailable)</option>}
    </select></Field>
    {!bootstrap.instructors.length && <p className="empty-copy">No explicit instructors are available. Relay will use automatic selection.</p>}
    <OperationStatus operation={operation} />
    <Button type="submit" size="sm" className="button button-primary" disabled={!!operation.busy || selected === (bootstrap.session.instructor || 'auto')}>Set instructor</Button>
  </fieldset></form>
}

function contrastLabel(first: string, second: string): string {
  const foreground = parseHex(first)
  const background = parseHex(second)
  return foreground && background ? `${contrast(foreground, background).toFixed(1)}:1` : 'Not available'
}

function HexColorField({ label, value, onChange, hint }: {
  label: string; value: string; onChange: (hex: string) => void; hint: string
}) {
  const id = useId()
  const [text, setText] = useState(value)
  const [invalid, setInvalid] = useState(false)
  useEffect(() => { setText(value); setInvalid(false) }, [value])
  const commit = () => {
    const hex = canonicalHex(text)
    if (!hex) { setInvalid(true); return }
    setInvalid(false)
    setText(hex)
    onChange(hex)
  }
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <div className="theme-color-row">
      <input id={id} type="color" value={value} aria-describedby={`${id}-hint`} onChange={(event) => { setInvalid(false); onChange(event.target.value) }} />
      <input type="text" value={text} aria-label={`${label} hex value`} aria-invalid={invalid || undefined} aria-describedby={`${id}-hint`} spellCheck={false} autoComplete="off"
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          setInvalid(false)
          if (/^#?[0-9a-f]{6}$/i.test(next.trim())) onChange(canonicalHex(next) as string)
        }}
        onBlur={() => { const hex = canonicalHex(text); if (hex) commit(); else { setText(value); setInvalid(false) } }}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit() } }} />
    </div>
    <span id={`${id}-hint`} className="muted field-hint">{hint}</span>
    {invalid && <span className="panel-error" role="alert">Enter a hex colour such as #0b0b0c.</span>}
  </div>
}

function AppearancePanel() {
  const { theme, palette, selectPreset, setBackground, setAccent, setButtonStyle, resetTheme } = useTheme()
  const activeStyle = buttonStyles.find((style) => style.id === theme.buttonStyle) || buttonStyles[0]
  const activePreset = presets.find((preset) => preset.id === theme.preset)
  return <div className="form-stack">
    <p className="muted">Choose a complete palette or set the page and action colours independently. Relay checks every result for readable text.</p>
    <fieldset className="panel-form-fields form-stack">
      <legend>Presets</legend>
      <div className="theme-presets">
        {presets.map((preset) => <label className="theme-preset" key={preset.id} data-selected={theme.preset === preset.id}>
          <input className="visually-hidden" type="radio" name="theme-preset" value={preset.id} checked={theme.preset === preset.id} onChange={() => selectPreset(preset.id)} />
          <span className="theme-swatches" aria-hidden="true">
            <span className="theme-swatch" style={{ '--swatch': preset.background } as CSSProperties} />
            <span className="theme-swatch" style={{ '--swatch': preset.accent } as CSSProperties} />
          </span>
          <span className="theme-preset-name">{preset.name}</span>
          <span className="theme-preset-description">{preset.description}</span>
        </label>)}
      </div>
    </fieldset>
    <HexColorField label="Background colour" value={theme.background} onChange={setBackground} hint="The main workspace, sidebar and raised surfaces are derived from this colour." />
    <HexColorField label="Button and accent colour" value={theme.accent} onChange={setAccent} hint="Primary buttons, focus rings, links and progress use this colour." />
    <fieldset className="panel-form-fields form-stack">
      <legend>Button treatment</legend>
      <div className="theme-styles">
        {buttonStyles.map((style) => <button type="button" key={style.id} className="button" aria-pressed={theme.buttonStyle === style.id} onClick={() => setButtonStyle(style.id)}>{style.label}</button>)}
      </div>
      <p className="theme-style-note">{activeStyle.description}</p>
    </fieldset>
    <p className="muted" role="status">{activePreset ? `Preset: ${activePreset.name}.` : 'Custom palette.'} {activeStyle.label} buttons.</p>
    <section className="theme-preview" aria-label="Appearance preview">
      <h3>Plan the next change</h3>
      <p className="muted">Muted notes and actions use the same contrast checks as the workspace.</p>
      <div className="theme-preview-actions" aria-hidden="true"><span className="button button-primary">Primary action</span><span className="button">Secondary</span></div>
    </section>
    <div className="theme-contrast">
      <span>Body <strong>{contrastLabel(palette.paper, palette.ink)}</strong></span>
      <span>Muted <strong>{contrastLabel(palette.paper, palette.muted)}</strong></span>
      <span>Button label <strong>{contrastLabel(palette.accent, palette.accentInk)}</strong></span>
      <span>Accent text <strong>{contrastLabel(palette.paper, palette.accentText)}</strong></span>
    </div>
    <div className="row-actions"><Button type="button" size="sm" className="button" onClick={resetTheme}><RotateCcw aria-hidden="true" /> Reset to Ink &amp; Red</Button></div>
    <p className="theme-note">Saved in this browser only. The local Relay server does not receive theme settings.</p>
    <p className="theme-note">Colours are adjusted toward black or white when needed so text and controls stay readable. Transparent buttons affect the page, not the operating-system window.</p>
  </div>
}

const commands = [
  ['/help', 'List commands and keyboard shortcuts.'],
  ['/new', 'Start a new session.'],
  ['/clear', 'Alias for starting a new session.'],
  ['/rename [title]', 'Rename the current session.'],
  ['/model [name]', 'Choose a model, or use auto for routing.'],
  ['/models', 'Browse available models across agents and connections.'],
  ['/mode [plan|code|orchestrate]', 'Switch between planning, execution, and parallel orchestration.'],
  ['/theme', 'Choose colours, presets, and button treatment.'],
  ['/connect', 'Manage provider connections and models.'],
  ['/mcp', 'Manage MCP servers and plugins.'],
  ['/plugins', 'Open the plugin registry.'],
  ['/status', 'View workspace connectivity and the saved agent health report.'],
  ['/btw <question|objective>', 'Save a side note and ask an available agent while work continues.'],
  ['/sessions', 'Browse and switch sessions.'],
  ['/agents', 'Inspect agents, roles, and availability.'],
  ['/quota', 'Inspect local call caps and usage.'],
  ['/instructor [name]', 'Select the planning instructor.'],
  ['/cwd <path>', 'Set an exact server-side working folder.'],
  ['/pipelines', 'Open saved pipelines.'],
  ['/preset [name]', 'Run a saved pipeline, or open the preset picker.'],
  ['/dispatch <agent> <prompt>', 'Send a prompt directly to one agent.'],
   ['/chain <agent: prompt>', 'Run one agent: prompt per line. Use fanout[agent1,agent2]: prompt for parallel work.'],
  ['/export', 'Download the session as JSON.'],
  ['/stop', 'Stop the active run.'],
] as const

function HelpPanel({ onFocusComposer }: { onFocusComposer: () => void }) {
  return <div className="form-stack">
    <p className="muted">Use slash commands in the composer or open the command palette for workspace actions.</p>
    <Button type="button" size="sm" className="button button-primary" onClick={onFocusComposer}>Go to composer <ArrowRight aria-hidden="true" /></Button>
    <h3>Keyboard</h3>
    <dl className="panel-shortcuts">
      <div><dt>Ctrl / ⌘ + K</dt><dd>Open the command palette.</dd></div>
      <div><dt>Ctrl / ⌘ + B</dt><dd>Toggle the conversation sidebar.</dd></div>
      <div><dt>Ctrl / ⌘ + N</dt><dd>Start a new session.</dd></div>
      <div><dt>Enter</dt><dd>Send a task or execute a slash command.</dd></div>
      <div><dt>Shift + Enter</dt><dd>Insert a new line.</dd></div>
      <div><dt>Escape</dt><dd>Stop active work from anywhere, or dismiss an open menu or dialog.</dd></div>
    </dl>
    <h3>Slash commands</h3>
    {commands.map(([command, description]) => <div className="panel-row" key={command}><code>{command}</code><p className="muted">{description}</p></div>)}
    <h3>Command palette actions</h3>
    <div className="panel-row"><strong>Manual dispatch</strong><p className="muted">Choose an agent, supply a prompt, and optionally select a model for a direct run.</p></div>
    <div className="panel-row"><strong>Chain</strong><p className="muted">Enter one agent: prompt per line. Steps receive earlier outputs.</p></div>
    <div className="panel-row"><strong>Saved pipelines</strong><p className="muted">Run a reusable preset or save the latest plan.</p></div>
    <div className="panel-row"><strong>Context and health</strong><p className="muted">Manage pinned outputs and side notes, or inspect the saved health report.</p></div>
  </div>
}
