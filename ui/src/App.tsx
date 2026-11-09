import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArrowUp, BookOpen, ChevronDown, Folder, Layers, Menu, MoreHorizontal, Plus, Search, Settings2, Square, Terminal, X, Pencil, Trash2, PanelRight, Command as CommandIcon, MessageSquare } from 'lucide-react'
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarProvider, useSidebar } from './components/ui/sidebar'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from './components/ui/sheet'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from './components/ui/dropdown-menu'
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from './components/ui/command'
import { ChatContainerRoot, ChatContainerContent, ChatContainerScrollAnchor } from './components/ui/chat-container'
import { ScrollButton } from './components/ui/scroll-button'
import { PromptInput, PromptInputTextarea, PromptInputActions, PromptInputAction } from './components/ui/prompt-input'
import { ConversationMessage, RunSummary, groupedMessages } from './components/conversation'
import { relay, startRelay, useRelay } from './lib/relay'
import type { Mode, Presets, SessionSummary } from './lib/types'
import type { Panel } from './components/workspace-panels'

const WorkspacePanel = lazy(() => import('./components/workspace-panels').then(m => ({ default: m.WorkspacePanel })))
const modes: { id: Mode; label: string; description: string }[] = [
  { id: 'plan', label: 'Plan', description: 'Review and edit a plan before anything runs.' },
  { id: 'code', label: 'Code', description: 'Plan and run the task, passing outputs between agents.' },
  { id: 'orchestrate', label: 'Orchestrate', description: 'Compare parallel approaches, then confirm the plan.' },
]
const commandList = [
  ['new', 'Start a new chat'], ['rename', 'Rename this chat'], ['model', 'Choose a model'], ['models', 'Browse all models'], ['mode', 'Choose Plan, Code or Orchestrate'],
  ['theme', 'Choose colours and button style'], ['connect', 'Manage API connections'], ['mcp', 'Manage MCP servers'], ['plugins', 'Manage instruction plugins'], ['status', 'Inspect workspace and health'], ['btw', 'Ask a side question'],
  ['sessions', 'Search chats'], ['agents', 'Inspect agents and quota'], ['quota', 'Set local caps'], ['instructor', 'Choose the planning instructor'], ['cwd', 'Set the working folder'],
  ['pipelines', 'Open saved pipelines'], ['preset', 'Run a saved pipeline'], ['dispatch', 'Run one agent directly'], ['chain', 'Run a manual chain'], ['export', 'Download chat JSON'], ['stop', 'Stop active agents'], ['help', 'Keyboard shortcuts and commands'],
] as const
const panelTitles: Record<Panel, string> = { agents: 'Agents and quota', context: 'Shared context', pipelines: 'Saved pipelines', connections: 'API connections', registry: 'MCP and plugins', health: 'Workspace status', help: 'Help', folder: 'Working folder', instructor: 'Planning instructor', appearance: 'Appearance' }
const label = (s: string) => s.replace(/\s*·\s*/g, ', ')
const folderName = (s: string) => s.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || s

function useMedia(query: string) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches)
  useEffect(() => { const media = matchMedia(query); const update = () => setMatches(media.matches); media.addEventListener('change', update); update(); return () => media.removeEventListener('change', update) }, [query])
  return matches
}

function sessionGroup(date: string) {
  const now = new Date(); const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const parsed = new Date(date); const age = Math.floor((day - new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime()) / 86400000)
  return age <= 0 ? 'Today' : age === 1 ? 'Yesterday' : age < 7 ? 'Previous 7 days' : age < 30 ? 'Previous 30 days' : parsed.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export function App() {
  useEffect(() => startRelay(), [])
  return <SidebarProvider defaultOpen={window.innerWidth >= 1200 && localStorage.getItem('relay.rail') !== 'closed'} style={{ '--sidebar-width': '280px', '--sidebar-width-icon': '64px' } as React.CSSProperties}><Workspace /></SidebarProvider>
}

function Workspace() {
  const state = useRelay()
  const b = state.bootstrap
  const { open, setOpen, isMobile, setOpenMobile, toggleSidebar } = useSidebar()
  const wideScreen = useMedia('(min-width: 1200px)')
  const previousWideScreen = useRef(wideScreen)
  const [panel, setPanel] = useState<Panel | null>(() => { const p = new URLSearchParams(location.search).get('panel'); return p && p in panelTitles ? p as Panel : null })
  const [mode, setMode] = useState<Mode>(() => { const stored = localStorage.getItem('relay.mode'); return modes.some(m => m.id === stored) ? stored as Mode : 'code' })
  const [model, setModel] = useState(localStorage.getItem('relay.model') || '')
  const [modelAgent, setModelAgent] = useState(localStorage.getItem('relay.modelAgent') || '')
  const [modelsOpen, setModelsOpen] = useState(false)
  const [modelQuery, setModelQuery] = useState('')
  const [palette, setPalette] = useState(false)
  const [query, setQuery] = useState('')
  const [filteredQuery, setFilteredQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [text, setText] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [titleEdit, setTitleEdit] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [pending, setPending] = useState(false)
  const [sidePending, setSidePending] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [lastInput, setLastInput] = useState('')
  const [onboarding, setOnboarding] = useState(localStorage.getItem('relay.onboarded') !== 'yes')
  const [onboardStep, setOnboardStep] = useState(0)
  const [projectFolder, setProjectFolder] = useState('')
  const previousSession = useRef('')
  const textRef = useRef(text); textRef.current = text
  const draftsRef = useRef(drafts); draftsRef.current = drafts
  const busy = !!b?.busy
  const running = busy || !!b?.btwRuns
  const sideDraft = /^\/btw\s+\S/i.test(text.trim())
  const agents = b?.agents.filter(a => !a.disabled) || []
  const openPanel = (p: Panel | null) => { setPanel(p); const url = new URL(location.href); if (p) url.searchParams.set('panel', p); else url.searchParams.delete('panel'); history.replaceState(null, '', url) }
  const focusComposer = () => { openPanel(null); document.getElementById('relay-composer')?.focus() }
  async function perform(fn: () => Promise<unknown>) { setRequestError(''); try { await fn() } catch (e) { setRequestError(e instanceof Error ? e.message : 'The request didn’t reach Relay. Try again.'); throw e } }
  function safely(fn: () => Promise<unknown>) { void perform(fn).catch(() => {}) }
  const changeMode = (next: Mode) => { setMode(next); localStorage.setItem('relay.mode', next) }
  const selectModel = (name: string, agent: string) => { setModel(name); setModelAgent(agent); localStorage.setItem('relay.model', name); localStorage.setItem('relay.modelAgent', agent); setModelsOpen(false) }
  const stop = () => safely(() => relay.stop())
  useEffect(() => { localStorage.setItem('relay.rail', open ? 'open' : 'closed') }, [open])
  useEffect(() => { if (previousWideScreen.current !== wideScreen) setOpen(wideScreen); previousWideScreen.current = wideScreen }, [wideScreen, setOpen])
  useEffect(() => { const t = setTimeout(() => setFilteredQuery(query), 180); return () => clearTimeout(t) }, [query])
  useEffect(() => {
    const id = b?.session.id || ''
    if (previousSession.current && previousSession.current !== id) {
      const oldId = previousSession.current
      setDrafts(old => ({ ...old, [oldId]: textRef.current }))
      setText(draftsRef.current[id] || '')
      setTitleEdit(null)
    }
    previousSession.current = id
  }, [b?.session.id])
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape' && running) { e.preventDefault(); stop() }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'k') { e.preventDefault(); setPalette(v => !v) }
      if (k === 'b') { e.preventDefault(); toggleSidebar() }
      if (k === 'n') { e.preventDefault(); safely(() => relay.newSession()) }
    }
    document.addEventListener('keydown', key, true)
    return () => document.removeEventListener('keydown', key, true)
  }, [running, toggleSidebar])
  useEffect(() => { const fn = () => { const p = new URLSearchParams(location.search).get('panel'); setPanel(p && p in panelTitles ? p as Panel : null) }; window.addEventListener('popstate', fn); return () => window.removeEventListener('popstate', fn) }, [])
  async function runPreset(name: string, presets: Presets = state.presets) { const preset = presets[name]; if (!preset) throw new Error(`No pipeline named “${name}”. Open Saved pipelines to choose one.`); if (busy) throw new Error('A main run is active. Ask a side question while it finishes.'); await relay.run(preset.steps, text.trim() || preset.note || name, model); openPanel(null) }
  async function command(name: string, args = '') {
    setPalette(false)
    switch (name) {
      case 'new': case 'clear': await relay.newSession(); break
      case 'rename': if (args) await relay.rename(args); else { setTitleEdit(b?.session.id || null); setTitle(b?.session.title || '') }; break
      case 'model': case 'models': if (!args) setModelsOpen(true); else if (args === 'auto') selectModel('', ''); else { const found = agents.find(a => (a.models || []).includes(args)); if (!found) throw new Error('That model isn’t in the registry. Open Models to choose one.'); selectModel(args, found.id) }; break
      case 'mode': if (!args) { focusComposer(); break }; if (!modes.some(m => m.id === args)) throw new Error('Use /mode plan, /mode code or /mode orchestrate.'); changeMode(args as Mode); break
      case 'theme': openPanel('appearance'); break
      case 'connect': openPanel('connections'); break
      case 'mcp': case 'plugins': openPanel('registry'); break
      case 'status': openPanel('health'); break
      case 'agents': case 'quota': openPanel('agents'); break
      case 'help': openPanel('help'); break
      case 'sessions': setSearchOpen(true); isMobile ? setOpenMobile(true) : setOpen(true); break
      case 'instructor': if (args) await relay.setInstructor(args); else openPanel('instructor'); break
      case 'cwd': if (args) await relay.setCwd(args); else openPanel('folder'); break
      case 'btw': if (!args) { setText('/btw '); focusComposer(); break }; await relay.btw(args); break
      case 'pipelines': await relay.loadPresets(); openPanel('pipelines'); break
      case 'preset': if (!args) { await relay.loadPresets(); openPanel('pipelines') } else { const loaded = await relay.loadPresets(); await runPreset(args, loaded.presets) }; break
      case 'dispatch': { const [agent, ...prompt] = args.split(/\s+/); if (!agent || !prompt.length) { setText('/dispatch '); focusComposer(); break }; await relay.dispatch(agent, prompt.join(' '), model); break }
      case 'chain': if (!args) { setText('/chain\n'); focusComposer(); break }; await relay.chain(args, model); break
      case 'stop': await relay.stop(); break
      case 'export': { if (!b) break; const url = URL.createObjectURL(new Blob([JSON.stringify(b.session, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `relay-${b.session.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); break }
      default: throw new Error(`Unknown command /${name}. Open Help for the command list.`)
    }
  }
  async function send() {
    const side = /^\/btw\s+\S/i.test(text.trim())
    if (!text.trim() || (side ? sidePending : pending) || !b) return
    const input = text.trim(); const id = b.session.id
    setLastInput(input); setRequestError(''); side ? setSidePending(true) : setPending(true)
    setText(''); setDrafts(old => ({ ...old, [id]: '' }))
    try {
      const slash = input.match(/^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/i)
      if (slash) await command(slash[1].toLowerCase(), slash[2]?.trim() || '')
      else if (busy) throw new Error('A main run is active. Use /btw followed by your side question.')
      else await relay.plan(input, mode, model, modelAgent)
    } catch (e) { setRequestError(e instanceof Error ? e.message : 'The task couldn’t be sent. Retry when Relay reconnects.'); if (previousSession.current === id) setText(current => current || input) } finally { side ? setSidePending(false) : setPending(false) }
  }
  const sessions = b?.sessions.filter(s => s.title.toLowerCase().includes(filteredQuery.toLowerCase())) || []
  const groups = new Map<string, SessionSummary[]>()
  for (const s of sessions) { const g = sessionGroup(s.updatedAt); groups.set(g, [...(groups.get(g) || []), s]) }
  async function renameRow(id: string) { if (id !== b?.session.id) await relay.switchSession(id); await relay.rename(title); setTitleEdit(null) }
  const panelContent = panel && <Suspense fallback={<p className="panel-loading" role="status">Opening inspector…</p>}><WorkspacePanel key={panel} panel={panel} onClose={() => openPanel(null)} onRunPreset={name => safely(() => runPreset(name))} onFocusComposer={focusComposer} /></Suspense>
  const slashMatches = /^\/[a-z]*$/i.test(text) ? commandList.filter(([name]) => name.startsWith(text.slice(1))).slice(0, 7) : []

  return <>
    <a className="skip-link" href="#main">Skip to conversation</a>
    <Sidebar collapsible="icon" className="conversation-sidebar">
      <SidebarHeader className="rail-header"><div className="rail-brand"><Terminal size={20} aria-hidden="true" /><span>Relay</span><button type="button" className="icon-button rail-collapse" aria-label="Collapse history" onClick={toggleSidebar}><Menu size={16} aria-hidden="true" /></button></div><button type="button" className="button new-chat" onClick={() => safely(() => relay.newSession())} aria-label="New chat"><Plus size={18} aria-hidden="true" /><span>New chat</span></button><button type="button" className="rail-link" aria-label="Search chats" onClick={() => { setSearchOpen(v => !v); if (!open) setOpen(true) }}><Search size={16} aria-hidden="true" /><span>Search chats</span></button>{searchOpen && <input className="chat-search" type="search" aria-label="Filter chat titles" autoFocus value={query} onChange={e => setQuery(e.target.value)} />}</SidebarHeader>
      <SidebarContent className="rail-content"><nav aria-label="Chat history">{Array.from(groups, ([name, list]) => <section className="chat-group" key={name}><h2>{name}</h2>{list.map(s => <div className={`chat-row ${s.id === b?.session.id ? 'is-current' : ''}`} key={s.id}>{titleEdit === s.id ? <form className="rename-form" onSubmit={e => { e.preventDefault(); safely(() => renameRow(s.id)) }}><input aria-label="Chat title" autoFocus value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setTitleEdit(null) }} /><button type="submit" className="icon-button" aria-label="Save title"><Pencil size={14} aria-hidden="true" /></button></form> : <><button type="button" className="chat-select" title={s.title} aria-current={s.id === b?.session.id ? 'page' : undefined} onClick={() => safely(async () => { await relay.switchSession(s.id); setOpenMobile(false) })}><MessageSquare size={16} aria-hidden="true" /><span>{s.title || 'Untitled chat'}</span>{b?.runningSessionIds.includes(s.id) && <span className="chat-running" role="status">Running</span>}</button><div className="chat-row-actions"><button type="button" className="icon-button" aria-label={`Rename ${s.title}`} onClick={() => { setTitleEdit(s.id); setTitle(s.title) }}><Pencil size={14} aria-hidden="true" /></button><button type="button" className="icon-button" aria-label={`Delete ${s.title}`} disabled={b?.runningSessionIds.includes(s.id)} onClick={() => { if (!confirm(`Delete “${s.title}”? Its history and logs will be permanently removed.`)) return; safely(async () => { if (s.id === b?.session.id) await relay.newSession(); await relay.deleteSession(s.id) }) }}><Trash2 size={14} aria-hidden="true" /></button></div></>}</div>)}</section>)}{b && !sessions.length && <p className="empty-copy">{query ? 'No chat titles match. Try a shorter search.' : 'Your chats will appear here.'}</p>}</nav></SidebarContent>
      <SidebarFooter className="rail-footer"><button type="button" className="rail-link" onClick={() => { safely(() => relay.loadPresets()); openPanel('pipelines') }}><Layers size={16} aria-hidden="true" /><span>Saved pipelines</span></button><button type="button" className="rail-link" onClick={() => openPanel('connections')}><Settings2 size={16} aria-hidden="true" /><span>{agents.length} agents, {b?.connections.length || 0} API connections</span></button><div className="rail-footer-meta"><span className="connection-word" role="status">{state.connected ? 'Local connection' : 'Reconnecting…'}</span><button type="button" className="icon-button" aria-label="Open help" onClick={() => openPanel('help')}><BookOpen size={16} aria-hidden="true" /></button></div></SidebarFooter>
    </Sidebar>
    <div className="workspace">
      <header className="workspace-header"><button type="button" className="icon-button" aria-label="Toggle chat history" onClick={toggleSidebar}><Menu size={18} aria-hidden="true" /></button>{titleEdit === b?.session.id ? <form className="header-title-form" onSubmit={e => { e.preventDefault(); if (b) safely(() => renameRow(b.session.id)) }}><input value={title} aria-label="Rename current chat" autoFocus onChange={e => setTitle(e.target.value)} /><button type="submit" className="text-button">Save</button></form> : <button type="button" className="header-title" title="Rename chat" onClick={() => { if (b) { setTitleEdit(b.session.id); setTitle(b.session.title) } }}>{b?.session.title || 'Your workspace'}</button>}<button type="button" className="folder-chip" title={b?.session.cwd || 'Set a working folder'} onClick={() => openPanel('folder')}><Folder size={16} aria-hidden="true" /><span>{b ? folderName(b.session.cwd) : 'Folder'}</span></button><button type="button" className="header-model" onClick={() => setModelsOpen(true)}><span>{model || 'Auto route'}</span><ChevronDown size={14} aria-hidden="true" /></button><div className="header-mode">{modes.map(m => <button type="button" key={m.id} aria-pressed={mode === m.id} className={mode === m.id ? 'is-selected' : ''} onClick={() => changeMode(m.id)}>{m.label}</button>)}</div>{running && <button type="button" className="run-chip" onClick={() => { const id = b?.runningSessionIds[0]; if (id) safely(() => relay.switchSession(id)) }}><span role="status">{busy ? 'Running' : 'Side answer'}</span></button>}<button type="button" className="icon-button" aria-label="Inspect agents and context" aria-pressed={!!panel} onClick={() => openPanel(panel ? null : 'agents')}><PanelRight size={18} aria-hidden="true" /></button><DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="icon-button" aria-label="Chat menu"><MoreHorizontal size={18} aria-hidden="true" /></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => safely(() => command('export'))}>Export chat JSON</DropdownMenuItem><DropdownMenuItem onSelect={() => openPanel('context')}>Pinned context and side notes</DropdownMenuItem><DropdownMenuItem onSelect={() => openPanel('registry')}>MCP and plugins</DropdownMenuItem><DropdownMenuItem onSelect={() => openPanel('health')}>Workspace status</DropdownMenuItem><DropdownMenuItem onSelect={() => openPanel('appearance')}>Appearance and theme</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => openPanel('help')}>Help and shortcuts</DropdownMenuItem></DropdownMenuContent></DropdownMenu></header>
      <div className={`workspace-body ${panel ? 'has-inspector' : ''}`}>
        <main id="main" tabIndex={-1} className="conversation-main">
          {!state.connected && b && <div className="connection-banner" role="status">Reconnecting to localhost. Your current chat is preserved.</div>}
          {state.phase === 'error' && !b ? <section className="startup-state"><h1>Relay isn’t connected</h1><p>{state.error || 'Start the local server with npm start, then reconnect.'}</p><button type="button" className="button" onClick={() => safely(() => relay.refresh())}>Reconnect</button></section> : !b ? <section className="startup-state" role="status"><h1>Opening your workspace</h1><p>Connecting to Relay on this computer…</p></section> : <ChatContainerRoot key={`${b.session.id}-${!b.session.messages.length}`} initial={b.session.messages.length ? 'instant' : false} className="chat-scroll" aria-label="Conversation" aria-live="polite" aria-relevant="additions text"><ChatContainerContent className="chat-content"><div className="message-column">
            {!b.session.messages.length && <section className="empty-workspace"><h1>What Relay does</h1><p>Run your coding agents in one shared, local workspace.</p><div className="capability-list"><button type="button" onClick={() => openPanel('folder')}><Folder size={20} aria-hidden="true" /><span><strong>Set a project folder</strong><small>Choose where agents can read and make changes.</small></span><ChevronDown size={16} aria-hidden="true" /></button><button type="button" onClick={() => openPanel('connections')}><Terminal size={20} aria-hidden="true" /><span><strong>Connect an agent or API</strong><small>Use your installed CLIs or add an API connection.</small></span><ChevronDown size={16} aria-hidden="true" /></button><button type="button" onClick={focusComposer}><MessageSquare size={20} aria-hidden="true" /><span><strong>Describe a task</strong><small>Review a plan, run it, or compare parallel approaches.</small></span><ChevronDown size={16} aria-hidden="true" /></button></div><button type="button" className="text-button pipeline-shortcut" onClick={() => { safely(() => relay.loadPresets()); openPanel('pipelines') }}><Layers size={16} aria-hidden="true" />Or start from a saved pipeline</button><p className="local-note">Agents can edit files in the working folder. Stop ends processes; it does not undo edits.</p></section>}
            {groupedMessages(b.session.messages).map(group => <div className="run-group" key={group.messages[0].id}>{group.messages.map(message => <ConversationMessage key={message.id} message={message} last={message.id === b.session.messages.filter(m => m.role === 'step').at(-1)?.id} />)}{group.steps.length > 0 && group.steps.every(s => s.status !== 'running') && <RunSummary plan={group.plan} steps={group.steps} />}</div>)}
            {pending && !lastInput.startsWith('/') && !b.session.messages.some(m => m.role === 'step' && m.status === 'running') && <p className="queued-placeholder" role="status">{mode === 'plan' || mode === 'code' ? 'Preparing your plan…' : 'Preparing parallel approaches…'}</p>}
          </div><ChatContainerScrollAnchor className="scroll-anchor" /></ChatContainerContent>{b.session.messages.length > 0 && <ScrollButton className="jump-latest" type="button" aria-label="Jump to latest message" />}</ChatContainerRoot>}
          <div className="composer-dock"><div className="composer-column">
            {running && <div className="busy-row"><span role="status">{busy ? 'A main run is active.' : 'A side answer is running.'} <span>You can still ask side questions.</span></span><button type="button" className="button stop-button" onClick={stop}><Square size={14} aria-hidden="true" />Stop <kbd>Esc</kbd></button></div>}
            {requestError && <div className="request-error" role="alert"><p>{requestError}</p><div><button type="button" className="text-button" onClick={() => { setText(lastInput || text); setRequestError(''); focusComposer() }}>Edit and retry</button><button type="button" className="icon-button" aria-label="Dismiss error" onClick={() => setRequestError('')}><X size={14} aria-hidden="true" /></button></div></div>}
            <div className="composer-wrapper">{slashMatches.length > 0 && <div className="slash-suggestions" aria-label="Slash commands">{slashMatches.map(([name, description]) => <button type="button" key={name} onClick={() => { setText(`/${name} `); document.getElementById('relay-composer')?.focus() }}><code>/{name}</code><span>{description}</span></button>)}</div>}<PromptInput className="relay-prompt" value={text} onValueChange={setText} maxHeight={240} onSubmit={() => void send()} disabled={!b || !state.connected}>
              <label className="visually-hidden" htmlFor="relay-composer">Task or slash command</label><PromptInputTextarea id="relay-composer" placeholder={busy ? '/btw Ask a side question while the run continues' : 'Describe a task, or type / for commands'} aria-describedby="mode-description" onKeyDown={e => { if (e.nativeEvent.isComposing) e.preventDefault() }} />
              <PromptInputActions className="composer-actions">
                <PromptInputAction tooltip="Choose task mode"><DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="composer-selector" aria-label="Choose task mode">{modes.find(m => m.id === mode)?.label}<ChevronDown size={14} aria-hidden="true" /></button></DropdownMenuTrigger><DropdownMenuContent align="start">{modes.map(m => <DropdownMenuItem key={m.id} onSelect={() => changeMode(m.id)}><span>{m.label}<small className="menu-description">{m.description}</small></span></DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></PromptInputAction>
                <PromptInputAction tooltip="Choose model"><button type="button" className="composer-selector model-selector" aria-label="Choose model" onClick={() => setModelsOpen(true)}><span>{model || 'Auto route'}</span><ChevronDown size={14} aria-hidden="true" /></button></PromptInputAction>
                <PromptInputAction tooltip="Commands (Ctrl or Cmd K)"><button type="button" className="icon-button" aria-label="Open command palette" onClick={() => setPalette(true)}><CommandIcon size={16} aria-hidden="true" /></button></PromptInputAction>
                <PromptInputAction tooltip="Planning instructor"><button type="button" className="icon-button instructor-action" aria-label="Choose instructor" onClick={() => openPanel('instructor')}><Settings2 size={16} aria-hidden="true" /></button></PromptInputAction>
                <span className="composer-spacer" />
                {running && !sideDraft ? <PromptInputAction tooltip="Stop running agents"><button type="button" className="send-button" aria-label="Stop running agents" onClick={stop}><Square size={18} aria-hidden="true" /></button></PromptInputAction> : <PromptInputAction tooltip={sideDraft ? 'Send side question (Enter)' : 'Send task (Enter)'}><button type="button" className="send-button" aria-label={sideDraft ? 'Send side question' : 'Send task'} disabled={(sideDraft ? sidePending : pending) || !text.trim() || !state.connected} aria-busy={sideDraft ? sidePending : pending} onClick={() => void send()}><ArrowUp size={20} aria-hidden="true" /></button></PromptInputAction>}
              </PromptInputActions>
            </PromptInput></div>
            <div className="composer-under"><p id="mode-description">{modes.find(m => m.id === mode)?.description}</p><button type="button" className="text-button context-reveal" title={`This run will see ${b?.session.pinned?.length || 0} pinned outputs, ${b?.session.notes?.length || 0} side notes and folder ${b?.session.cwd || 'not selected'}`} onClick={() => openPanel('context')}><span>{b?.session.pinned?.length || 0} pins, {b?.session.notes?.length || 0} notes, {b ? folderName(b.session.cwd) : 'folder'}</span><ChevronDown size={12} aria-hidden="true" /></button></div>
          </div></div>
        </main>
        {panel && wideScreen && <aside className="desktop-inspector" aria-label={panelTitles[panel]}>{panelContent}</aside>}
      </div>
    </div>
    <Sheet open={!!panel && !wideScreen} onOpenChange={v => { if (!v) openPanel(null) }}><SheetContent className="mobile-inspector" side="right"><SheetHeader className="visually-hidden"><SheetTitle>{panel ? panelTitles[panel] : 'Inspector'}</SheetTitle><SheetDescription>Local workspace settings and details.</SheetDescription></SheetHeader>{!wideScreen && panelContent}</SheetContent></Sheet>
    <Dialog open={modelsOpen} onOpenChange={setModelsOpen}><DialogContent className="model-dialog"><DialogHeader><DialogTitle>Choose a model</DialogTitle><DialogDescription>Models come from your agent registry and API connections.</DialogDescription></DialogHeader><input type="search" className="model-search" autoFocus value={modelQuery} onChange={e => setModelQuery(e.target.value)} aria-label="Search models" /><div className="model-list"><button type="button" className="model-option" onClick={() => selectModel('', '')}><strong>Auto route</strong><span>Relay selects agents by role and local quota.</span></button>{agents.filter(a => !modelQuery || `${a.label} ${(a.models || []).join(' ')}`.toLowerCase().includes(modelQuery.toLowerCase())).map(a => <section className="model-group" key={a.id}><h2>{label(a.label)}</h2>{(a.models?.length ? a.models : [a.model || '']).filter(m => !modelQuery || `${a.label} ${m}`.toLowerCase().includes(modelQuery.toLowerCase())).map(m => <button type="button" key={m || 'default'} className={`model-option ${model === m && modelAgent === a.id ? 'is-selected' : ''}`} onClick={() => selectModel(m, a.id)}><strong>{m || 'Agent default'}</strong><span>{a.connectionId ? 'Connected API' : 'Local CLI'}{m === a.model ? ', default model' : ''}</span></button>)}</section>)}</div></DialogContent></Dialog>
    <Dialog open={palette} onOpenChange={setPalette}><DialogContent className="palette-dialog"><DialogHeader className="visually-hidden"><DialogTitle>Command palette</DialogTitle><DialogDescription>Find a workspace action or slash command.</DialogDescription></DialogHeader><Command><CommandInput placeholder="Find a command…" /><CommandList><CommandEmpty>No matching commands. Try “folder” or “agents”.</CommandEmpty><CommandGroup heading="Workspace commands">{commandList.map(([name, description]) => <CommandItem key={name} value={`${name} ${description}`} onSelect={() => safely(() => command(name))}><span className="command-name">/{name}</span><span>{description}</span></CommandItem>)}</CommandGroup></CommandList></Command></DialogContent></Dialog>
    <Dialog open={onboarding && state.phase === 'ready'} onOpenChange={v => { if (!v) { setOnboarding(false); localStorage.setItem('relay.onboarded', 'yes') } }}><DialogContent className="onboarding-dialog" onCloseAutoFocus={e => { e.preventDefault(); document.getElementById('relay-composer')?.focus() }}><DialogHeader><DialogTitle>{onboardStep === 0 ? 'Make Relay your workspace' : onboardStep === 1 ? 'Use your own agents' : 'Ready for your first task'}</DialogTitle><DialogDescription>{onboardStep === 0 ? 'Choose a folder agents may edit, or keep the disposable scratch folder.' : onboardStep === 1 ? 'Installed CLIs are already in the registry. API connections are optional.' : 'Describe the outcome you want. Choose Plan to review it first.'}</DialogDescription></DialogHeader>{onboardStep === 0 && <label className="field">Working folder<input value={projectFolder} placeholder={b?.session.cwd} onChange={e => setProjectFolder(e.target.value)} /></label>}{onboardStep === 1 && <button type="button" className="button" onClick={() => { setOnboarding(false); localStorage.setItem('relay.onboarded', 'yes'); openPanel('connections') }}>Open API connections</button>}<div className="onboarding-actions"><button type="button" className="text-button" onClick={() => { setOnboarding(false); localStorage.setItem('relay.onboarded', 'yes') }}>Skip setup</button><button type="button" className="button button-primary" onClick={() => safely(async () => { if (onboardStep === 0 && projectFolder.trim()) await relay.setCwd(projectFolder.trim()); if (onboardStep < 2) setOnboardStep(v => v + 1); else { setOnboarding(false); localStorage.setItem('relay.onboarded', 'yes'); focusComposer() } })}>{onboardStep === 2 ? 'Describe a task' : 'Continue'}</button></div></DialogContent></Dialog>
    {state.notice && <div className="notice-toast" role="status"><p>{state.notice}</p><button type="button" className="icon-button" aria-label="Dismiss notice" onClick={() => relay.clearNotice()}><X size={16} aria-hidden="true" /></button></div>}
  </>
}
