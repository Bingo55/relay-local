import { memo, useEffect, useState } from 'react'
import { Check, Copy, Pin, RotateCcw, AlertCircle, Play, Terminal, Square } from 'lucide-react'
import { Message, MessageContent, MessageActions, MessageAction } from './ui/message'
import { Tool } from './ui/tool'
import { Reasoning, ReasoningTrigger, ReasoningContent } from './ui/reasoning'
import { Loader } from './ui/loader'
import { relay, useRelay } from '@/lib/relay'
import type { Message as RelayMessage, PlanMessage, PlanStep, StepMessage } from '@/lib/types'

export const duration = (ms: number) => ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))}s` : `${Math.floor(ms / 60_000)}m ${Math.round(ms / 1000) % 60}s`
export const statusCopy: Record<StepMessage['status'], string> = { running: 'Working…', done: 'Done', stopped: 'Stopped', failed: 'Didn’t finish', timeout: 'Took too long', quota: 'Out of free credits' }
const displayLabel = (s: string) => s.replace(/\s*·\s*/g, ', ')

export function useClock(active = true) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (!active) return; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [active])
  return now
}

function splitReasoning(text: string) {
  let thinking = ''
  const output = text.replace(/<(thinking|reasoning|scratchpad)>([\s\S]*?)<\/\1>/gi, (_, _tag: string, inner: string) => { thinking += `${thinking ? '\n\n' : ''}${inner}`; return '' }).replace(/<(thinking|reasoning|scratchpad)>([\s\S]*)$/i, (_, _tag: string, inner: string) => { thinking += `${thinking ? '\n\n' : ''}${inner}`; return '' })
  return { output, thinking }
}

function PlanEditor({ message }: { message: PlanMessage }) {
  const { bootstrap } = useRelay()
  const [steps, setSteps] = useState<PlanStep[]>(() => message.steps.map(s => ({ ...s, agents: s.agents && [...s.agents] })))
  const [model, setModel] = useState(message.model || '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)
  const agents = bootstrap?.agents.filter(a => !a.disabled) || []
  const busy = !!bootstrap?.busy
  const update = (index: number, change: Partial<PlanStep>) => setSteps(old => old.map((step, i) => i === index ? { ...step, ...change } : step))
  async function run() {
    setError('')
    if (steps.length > 6 || !steps.length || steps.some(s => !s.prompt.trim() || (!s.agent && !s.agents?.length) || (s.agents && (s.agents.length < 2 || s.agents.length > 4)))) { setError('Use one to six steps, each with a prompt. Parallel steps need two to four agents.'); return }
    setSubmitting(true)
    try { await relay.run(steps, message.task, model) } catch (e) { setError(e instanceof Error ? e.message : 'The plan couldn’t run. Try again.') } finally { setSubmitting(false) }
  }
  return <section className="plan-message" aria-label="Editable plan">
    <div className="plan-heading"><h2>{message.mode === 'orchestrate' ? 'Parallel plan' : 'Your plan'}</h2><span className="badge">{steps.length} {steps.length === 1 ? 'step' : 'steps'}</span></div>
    {message.note && <p className="plan-note">{message.note}</p>}
    <ol className="plan-list">{steps.map((step, index) => <li key={index}>
      <div className="plan-step-top"><span className="plan-number">{index + 1}</span><strong>{step.why || 'Agent step'}</strong><span className="muted">{step.agents?.length ? 'Parallel' : 'Sequential'}</span></div>
      <div className="plan-routing">
        <label className="field">{step.agents?.length ? 'Agents (choose 2–4)' : 'Agent'}<select aria-label={`Step ${index + 1} agent`} multiple={!!step.agents?.length} value={step.agents?.length ? step.agents : step.agent || ''} onChange={e => update(index, step.agents?.length ? { agents: Array.from(e.target.selectedOptions, o => o.value) } : { agent: e.target.value, model: '' })}>
          {!step.agents?.length && <option value="">Select an agent</option>}
          {Object.keys(bootstrap?.roles || {}).map(role => <option key={`role-${role}`} value={role}>{role} (automatic routing)</option>)}
          {agents.map(agent => <option key={agent.id} value={agent.id}>{displayLabel(agent.label)}</option>)}
        </select></label>
        <label className="field">Model<select aria-label={`Step ${index + 1} model`} value={step.model || ''} onChange={e => update(index, { model: e.target.value })}><option value="">Agent default</option>{Array.from(new Set(agents.filter(a => (step.agents || [step.agent]).includes(a.id)).flatMap(a => a.models || []))).map(m => <option key={m} value={m}>{m}</option>)}</select></label>
      </div>
      <label className="field prompt-field">Prompt<textarea aria-label={`Step ${index + 1} prompt`} value={step.prompt} rows={3} onChange={e => update(index, { prompt: e.target.value })} /></label>
    </li>)}</ol>
    <div className="plan-footer"><label className="field compact-field">Run model<select value={model} aria-label="Plan model override" onChange={e => setModel(e.target.value)}><option value="">Agent defaults</option>{Array.from(new Set([...(model ? [model] : []), ...agents.flatMap(a => a.models || [])])).map(m => <option key={m} value={m}>{m}</option>)}</select></label><button type="button" className="button button-primary" disabled={busy || submitting} aria-busy={submitting} onClick={() => void run()}><Play aria-hidden="true" size={16} />{submitting ? 'Starting…' : message.mode === 'orchestrate' ? 'Confirm and run' : 'Run plan'}</button></div>
    {busy && <p className="helper">A main run is active in {bootstrap?.sessions.find(s => bootstrap.runningSessionIds.includes(s.id))?.title || 'another chat'}. You can still ask side questions.</p>}
    <details className="save-disclosure"><summary>Save as pipeline</summary><form className="inline-form" onSubmit={async e => { e.preventDefault(); setSaving(true); try { await relay.savePreset(saveName, message.note, steps); setSaveName('') } catch (err) { setError(err instanceof Error ? err.message : 'Couldn’t save the pipeline.') } finally { setSaving(false) } }}><label className="field">Pipeline name<input value={saveName} required onChange={e => setSaveName(e.target.value)} /></label><button type="submit" className="button" disabled={saving}>{saving ? 'Saving…' : 'Save pipeline'}</button></form></details>
    {error && <p className="error-copy" role="alert">{error} <button type="button" className="text-button" onClick={() => void run()}>Retry run</button></p>}
  </section>
}

function StepOutput({ message, last }: { message: StepMessage; last: boolean }) {
  const { bootstrap } = useRelay()
  const now = useClock(message.status === 'running' || !!bootstrap?.quota.agents.find(a => a.id === message.agent)?.outUntil)
  const [error, setError] = useState('')
  const [copyState, setCopyState] = useState(false)
  const [pending, setPending] = useState(false)
  const parsed = splitReasoning(message.text)
  const thinking = message.thinking || parsed.thinking
  const running = message.status === 'running'
  const failed = ['failed', 'timeout', 'quota'].includes(message.status)
  const pinned = bootstrap?.session.pinned?.some(p => p.stepId === message.id)
  const quota = bootstrap?.quota.agents.find(a => a.id === message.agent)
  const cooling = quota?.outUntil ? Math.max(0, Math.ceil((Date.parse(quota.outUntil) - now) / 60_000)) : 0
  const elapsed = message.durationMs ?? (message.endedAt ? Date.parse(message.endedAt) : now) - Date.parse(message.startedAt)
  async function action(fn: () => Promise<unknown>) { setPending(true); setError(''); try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t complete that action. Try again.') } finally { setPending(false) } }
  return <article className={`agent-message ${message.kind === 'btw' ? 'side-message' : ''}`} aria-label={message.kind === 'btw' ? 'Side answer' : `${displayLabel(message.label)} output`}>
    {message.kind === 'btw' && <h2 className="side-title">Side answer</h2>}
    {message.question && <p className="side-question">{message.question}</p>}
    <header className="agent-message-header"><Terminal size={16} aria-hidden="true" /><strong>{displayLabel(message.label || message.agent)}</strong><span className="model-label">{message.model}</span><span className={`step-status ${failed ? 'is-error' : ''}`} role="status">{statusCopy[message.status]}{cooling > 0 && ` (cooling ${cooling}m)`}</span><time className="duration">{duration(elapsed)}</time></header>
    {thinking && <Reasoning isStreaming={running} className="reasoning"><ReasoningTrigger type="button" className="text-button">Agent reasoning</ReasoningTrigger><ReasoningContent markdown contentClassName="markdown-body">{thinking}</ReasoningContent></Reasoning>}
    {!parsed.output.trim() && running ? <div className="queued-state" role="status"><Loader variant="typing" /><span>Waiting for the first output…</span></div> : <MessageContent markdown className={`markdown-body agent-output ${running ? 'is-streaming' : ''}`}>{parsed.output || (failed ? 'No answer was returned.' : 'No text output.')}</MessageContent>}
    {failed && <div className="step-error" role="alert"><AlertCircle size={16} aria-hidden="true" /><p>{message.status === 'quota' ? 'This agent reached a quota or authentication wall. Check its local cap or credentials, then retry.' : message.status === 'timeout' ? 'The agent exceeded its time limit. Try a smaller task or another agent.' : 'The agent didn’t finish this step. Inspect its output below, then retry.'}</p></div>}
    {failed && <button type="button" className="text-button" disabled={(!!bootstrap?.busy && message.kind !== 'btw') || pending} onClick={() => void action(() => message.kind === 'btw' ? relay.btw(message.question || message.prompt) : relay.dispatch(message.agent, message.prompt, message.model))}>Retry this {message.kind === 'btw' ? 'side question' : 'step'}</button>}
    {message.fallback?.map((f, i) => <p className="fallback-note" key={i}>{displayLabel(f.from)} reached a {f.reason} wall; {displayLabel(f.to)} took over.</p>)}
    <Tool className="step-details" toolPart={{ type: 'Inspect step', state: running ? 'input-streaming' : failed ? 'output-error' : 'output-available', input: { agent: message.agent, model: message.model || 'default', prompt: message.prompt }, output: { text: message.text }, errorText: failed ? `Exit code ${message.exitCode ?? 'not reported'}` : undefined }} />
    {!running && <MessageActions className="message-actions">
      <MessageAction tooltip="Copy answer"><button type="button" className="icon-button" aria-label={copyState ? 'Answer copied' : 'Copy answer'} onClick={() => void action(async () => { await navigator.clipboard.writeText(parsed.output); setCopyState(true); setTimeout(() => setCopyState(false), 2000) })}>{copyState ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}</button></MessageAction>
      <MessageAction tooltip={pinned ? 'Remove from context' : 'Pin to future steps'}><button type="button" className={`icon-button ${pinned ? 'is-selected' : ''}`} aria-label={pinned ? 'Unpin answer' : 'Pin answer'} aria-pressed={pinned} disabled={pending} onClick={() => void action(() => relay.pin(message.id, !pinned))}><Pin size={16} aria-hidden="true" /></button></MessageAction>
      {(last || failed) && <MessageAction tooltip="Retry this step"><button type="button" className="icon-button" aria-label="Retry step" disabled={(!!bootstrap?.busy && message.kind !== 'btw') || pending} onClick={() => void action(() => message.kind === 'btw' ? relay.btw(message.question || message.prompt) : relay.dispatch(message.agent, message.prompt, message.model))}><RotateCcw size={16} aria-hidden="true" /></button></MessageAction>}
    </MessageActions>}
    {error && <p className="error-copy" role="alert">{error}</p>}
  </article>
}

export const ConversationMessage = memo(function ConversationMessage({ message, last }: { message: RelayMessage; last: boolean }) {
  if (message.role === 'plan') return <PlanEditor message={message} />
  if (message.role === 'step') return <StepOutput message={message} last={last} />
  if (message.role === 'note') return <p className="thread-note"><AlertCircle size={16} aria-hidden="true" />{message.text}</p>
  return <Message className="user-message"><MessageContent className="user-content">{message.text}</MessageContent></Message>
})

export function RunSummary({ plan, steps }: { plan?: PlanMessage; steps: StepMessage[] }) {
  const finished = steps.filter(s => s.status === 'done').length
  const problems = steps.filter(s => ['failed', 'timeout', 'quota'].includes(s.status)).length
  const files = [...new Set(steps.flatMap(s => s.git?.after?.files || []).map(file => file.replace(/^.{2}\s/, '').trim()))]
  const stopped = steps.some(s => s.status === 'stopped')
  const total = plan?.steps.reduce((n, s) => n + (s.agents?.length || 1), 0) || steps.length
  const starts = steps.map(s => Date.parse(s.startedAt)).filter(Number.isFinite)
  const ends = steps.map(s => Date.parse(s.endedAt || s.startedAt)).filter(Number.isFinite)
  const time = starts.length && ends.length ? Math.max(0, Math.max(...ends) - Math.min(...starts)) : steps.reduce((n, s) => n + (s.durationMs || 0), 0)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  return <section className="run-summary" aria-label="Run summary"><div className="summary-heading">{stopped ? <Square size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}<h2>{stopped ? 'Run stopped' : problems ? 'Run finished with problems' : 'Run finished'}</h2></div><dl className="summary-stats"><div><dt>Steps finished</dt><dd>{finished}/{total}</dd></div><div><dt>Problems</dt><dd>{problems}</dd></div><div><dt>Elapsed</dt><dd>{duration(time)}</dd></div></dl>{files.length > 0 ? <details><summary>{files.length} changed {files.length === 1 ? 'file' : 'files'} in the working folder</summary><ul className="file-list">{files.map(f => <li key={f}><code>{f}</code></li>)}</ul><p className="helper">Git working-tree snapshots include any pre-existing changes.</p></details> : <p className="helper">No file changes were reported.</p>}{plan && <details><summary>Save this plan as a pipeline</summary><form className="inline-form" onSubmit={async e => { e.preventDefault(); setSaving(true); try { await relay.savePreset(name, plan.note, plan.steps); setName('') } catch (err) { setError(err instanceof Error ? err.message : 'Couldn’t save this pipeline.') } finally { setSaving(false) } }}><label className="field">Pipeline name<input required value={name} onChange={e => setName(e.target.value)} /></label><button type="submit" className="button" disabled={saving}>Save pipeline</button></form></details>}{error && <p className="error-copy" role="alert">{error}</p>}</section>
}

export function groupedMessages(messages: RelayMessage[]) {
  const groups: { messages: RelayMessage[]; plan?: PlanMessage; steps: StepMessage[] }[] = []
  for (const message of messages) {
    if (message.role === 'user' || !groups.length) groups.push({ messages: [], steps: [] })
    const group = groups.at(-1)!
    group.messages.push(message)
    if (message.role === 'plan') group.plan = message
    if (message.role === 'step' && message.kind !== 'btw') group.steps.push(message)
  }
  return groups
}
