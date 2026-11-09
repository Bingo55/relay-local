import { useState } from 'react'
import { INSTALL_COMMANDS, MODES, AGENTS, FAQS, FEATURES } from './data/content.js'
import './styles/index.css'

function Mark() {
  return <a className="brand" href="#top" aria-label="Relay home"><span className="brand-mark">↗</span><span>relay</span></a>
}

function Nav() {
  const [open, setOpen] = useState(false)
  return (
    <header className="site-header">
      <div className="container nav">
        <Mark />
        <button className="menu-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="site-menu">Menu</button>
        <nav id="site-menu" className={open ? 'site-menu is-open' : 'site-menu'}>
          <a href="#product" onClick={() => setOpen(false)}>Product</a>
          <a href="#how-it-works" onClick={() => setOpen(false)}>How it works</a>
          <a href="#security" onClick={() => setOpen(false)}>Security</a>
          <a href="#faq" onClick={() => setOpen(false)}>FAQ</a>
          <a className="github-link" href="https://github.com/Bingo55/relay-local" target="_blank" rel="noreferrer">GitHub</a>
          <a className="button button-dark" href="#install" onClick={() => setOpen(false)}>Install</a>
        </nav>
      </div>
    </header>
  )
}

function SectionHeading({ number, title, children }) {
  return (
    <div className="section-heading">
      <p className="section-index">{number}</p>
      <div><h2>{title}</h2>{children && <p className="section-intro">{children}</p>}</div>
    </div>
  )
}

function PlanPanel() {
  return (
    <figure className="product-figure">
      <div className="plan-panel">
        <div className="panel-top"><span>relay / session-12</span><span>127.0.0.1</span></div>
        <div className="panel-title"><span>objective</span><strong>Ship the checkout flow</strong><span className="status running">RUNNING</span></div>
        {[
          ['01', 'inspect the existing flow', 'Claude Code', 'DONE'],
          ['02', 'map the missing states', 'Codex', 'RUNNING'],
          ['03', 'write focused tests', 'Gemini CLI', 'QUEUED'],
        ].map(([n, task, agent, state]) => (
          <div className="plan-row" key={n}>
            <span className="row-number">{n}</span><strong>{task}</strong><span className="row-agent">{agent}</span><span className={`status ${state.toLowerCase()}`}>{state}</span>
          </div>
        ))}
        <div className="panel-bottom"><span>context / 4 outputs pinned</span><span>git / clean</span></div>
      </div>
      <figcaption>FIG. 01 — ONE OBJECTIVE, THREE LANES</figcaption>
    </figure>
  )
}

function Diagram({ fanout = false }) {
  return (
    <div className="diagram" aria-hidden="true">
      {fanout ? <><div className="diagram-node">PLAN</div><div className="diagram-lines"><i /><i /><i /></div><div className="diagram-stack"><span>BUILD A <b>DONE</b></span><span>BUILD B <b>RUNNING</b></span><span>REVIEW <b>QUEUED</b></span></div><div className="diagram-merge">MERGE</div></> : <><div className="terminal">TERMINAL<br /><b>build</b></div><div className="terminal">TERMINAL<br /><b>review</b></div><div className="terminal">TERMINAL<br /><b>test</b></div><div className="diagram-rail">ONE LOCAL PLAN</div></>}
    </div>
  )
}

function App() {
  return (
    <div id="top">
      <Nav />
      <main>
        <section className="hero container">
          <div className="hero-copy">
            <p className="kicker">LOCAL-FIRST AGENT ORCHESTRATION</p>
            <h1>Your agents.<br /><em>One relay.</em></h1>
            <p className="hero-tagline">One plan. One transcript. One local workspace.</p>
            <p className="hero-lede">Describe the outcome once. Relay turns it into an editable plan, routes each step to the CLI agent or API model you trust, and keeps every output, note, and git snapshot together.</p>
            <div className="actions"><a className="button button-dark" href="#install">Install locally</a><a className="button button-light" href="#how-it-works">See how it works</a></div>
            <p className="meta">Runs on 127.0.0.1 · Keys stay on your machine · MIT</p>
          </div>
          <PlanPanel />
        </section>

        <section id="product" className="section container">
          <SectionHeading number="01 / THE PROBLEM" title="Stop babysitting terminals.">
          Claude Code in one terminal, Codex in another, Gemini CLI somewhere else, and a browser tab full of API keys. Every tool has its own flags and session format. Relay brings the fragments into one local workspace.
          </SectionHeading>
          <Diagram />
        </section>

        <section className="section section-dark">
          <div className="container">
          <SectionHeading number="02 / THE ROUTE" title="Route work, not just messages.">
            A single objective can become research, build, review, and fix. Each step can use a different agent, model, or role. The route is visible before it runs.
          </SectionHeading>
          <div className="route-grid">
            {[
              ['01', 'Research', 'Map the codebase and constraints.', 'Claude Code'],
              ['02', 'Build', 'Write the implementation in your folder.', 'Codex'],
              ['03', 'Review', 'Check the diff, edge cases, and tests.', 'Gemini CLI'],
              ['04', 'Fix', 'Return to the build agent with the verdict.', 'opencode'],
            ].map(([number, title, body, agent]) => (
              <article className="route-card" key={number}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{body}</p>
                <code>{agent}</code>
              </article>
            ))}
          </div>
          <p className="route-note">The plan is the contract. Code is the commitment. Orchestrate is the comparison.</p>
          </div>
        </section>

        <section id="how-it-works" className="section section-paper">
          <div className="container">
          <SectionHeading number="03 / MODES" title="Plan. Code. Orchestrate." />
            <div className="mode-grid">{MODES.map((mode) => <article className="mode-card" key={mode.title}><span className="card-number">{mode.number}</span><h3>{mode.title}</h3><p>{mode.body}</p></article>)}</div>
            <p className="note">Plans are bounded to six steps, with fan-out to two to four agents.</p>
          </div>
        </section>

        <section className="section container">
          <SectionHeading number="04 / THE WORKSPACE" title="The parts you actually touch.">
          Sessions, pinned context, side notes, usage, quota, and git snapshots. The work stays attached to the session that produced it instead of disappearing into terminal scrollback.
          </SectionHeading>
          <div className="feature-layout"><div className="feature-list">{FEATURES.map((item) => <div className="feature-row" key={item.title}><span>{item.number}</span><div><h3>{item.title}</h3><p>{item.body}</p></div></div>)}</div><div className="context-panel"><div className="panel-top"><span>session / checkout</span><span>usage</span></div><h3>Pinned context</h3><p>Output 02 is available to every later step.</p><div className="context-line"><span>context.md</span><b>12.4kb</b></div><div className="context-line"><span>git diff --stat</span><b>6 files</b></div><div className="context-line"><span>quota / local cap</span><b>3 / 10</b></div></div></div>
        </section>

        <section className="section section-paper">
          <div className="container">
            <SectionHeading number="05 / AGENTS" title="Bring your own agents.">
              Relay does not install agent CLIs for you. It gives the ones you already trust a shared control room.
            </SectionHeading>
            <div className="agent-grid">{AGENTS.map((agent) => <span key={agent}>{agent}</span>)}</div>
            <pre className="code-block"><code>{`{
  "cmd": "claude",
  "args": ["--dangerously-skip-permissions"],
  "delivery": "stdio",
  "model": "sonnet",
  "disabled": false
}`}</code></pre>
          </div>
        </section>

        <section className="section container">
          <SectionHeading number="06 / MODELS" title="Your models. Your keys.">
          Relay speaks OpenAI chat completions and Anthropic Messages. Connect a provider once, and its chat-capable models appear in the picker. Add a custom OpenAI-compatible endpoint when the preset list is not enough.
          </SectionHeading>
          <div className="models-layout"><div className="big-count"><strong>83</strong><span>provider presets</span><p>OpenAI-compatible and Anthropic Messages formats.</p></div><div className="provider-list"><span>OpenAI</span><span>Anthropic</span><span>Groq</span><span>OpenRouter</span><span>DeepSeek</span><span>Mistral</span><span>Together AI</span><span>Fireworks AI</span><span>xAI</span><span>Cohere</span></div></div>
          <p className="security-note">Keys stay in <code>sessions/connections.json</code> with best-effort <code>0600</code> permissions. The browser only gets a masked hint. Keys are not encrypted at rest.</p>
        </section>

        <section className="section section-dark">
          <div className="container">
            <SectionHeading number="07 / ORCHESTRATION" title="One prompt. Many hands."><span>Send one objective to several agents. Compare their work. Merge the useful parts. Keep every output attached to its owner. This is a visible workflow, not a pile of terminal windows.</span></SectionHeading>
            <Diagram fanout />
          </div>
        </section>

        <section id="security" className="section container">
          <SectionHeading number="08 / LOCAL-FIRST" title="Your machine is the boundary.">
          Relay keeps the network surface small and the keys on disk. It rejects non-loopback Host headers, cross-origin browser requests, and non-JSON write bodies. It does not claim to be a sandbox, and it does not encrypt your credentials.
          </SectionHeading>
          <div className="security-grid"><div>{['Loopback only — listens on 127.0.0.1, not a public server.', 'Keys stay local — stored in sessions/connections.json.', 'No Relay account — no cloud control plane.', 'Your review is the last gate — agents use your OS permissions.'].map((item, i) => <p key={item}><b>0{i + 1}</b>{item}</p>)}</div><aside className="warning"><strong>Not a sandbox.</strong><p>Agents run with your OS permissions. Several presets use permission-bypass flags. Review the diff, point Relay at a folder you can restore, and use a container or VM when the blast radius matters.</p></aside></div>
        </section>

        <section className="section section-paper">
          <div className="container">
            <SectionHeading number="09 / TERMINAL + MCP" title="The same workspace, from the shell.">
              The browser is not the only way in. The terminal client is a thin HTTP + SSE front end for the same local server, with the same sessions, keys, and runs.
            </SectionHeading>
            <pre className="code-block large"><code>{`relay                         # full-screen TUI
relay chat                    # streaming chat
relay "build a landing page"  # plan, approve, run, summarize
relay plan "build it"         # plan only
relay --auto "build it"       # plan and run without stopping
relay status                  # plain status card
relay sessions                # list chats
relay agents                  # list assistants and roles`}</code></pre>
            <p className="mcp-line">MCP: <code>relay_dispatch</code> · <code>relay_plan</code> · <code>relay_chain</code> · <code>relay_agents</code></p>
          </div>
        </section>

        <section id="install" className="section container install">
          <SectionHeading number="10 / INSTALL" title="Run it locally.">
          Clone the repository, install dependencies, and start the app. Relay serves on loopback and opens in your browser. There is no cloud service to provision, database to migrate, or framework to learn.
          </SectionHeading>
          <div className="install-grid"><pre className="code-block large"><code>{INSTALL_COMMANDS}</code></pre><div><p className="requirements">Node 24+ · Windows tested · macOS/Linux with Node 24 · MIT</p><p className="note">Agent CLIs are installed and authenticated separately.</p></div></div>
        </section>

        <section id="faq" className="section section-paper">
          <div className="container faq"><SectionHeading number="11 / FAQ" title="Questions worth asking." />{FAQS.map((item) => <details key={item.question}><summary>{item.question}<span>+</span></summary><p>{item.answer}</p></details>)}</div>
        </section>
      </main>
      <footer className="site-footer"><div className="container footer-grid"><div><Mark /><p>Local-first agent orchestration.<br />Your keys, your models, your project folder.</p></div><div><h3>Sections</h3><a href="#product">Product</a><a href="#how-it-works">How it works</a><a href="#security">Security</a><a href="#faq">FAQ</a></div><div><h3>Source</h3><a href="https://github.com/Bingo55/relay-local">GitHub repository</a><span>MIT license</span><span>Security policy</span></div></div><div className="container footer-bottom"><span>© 2026 Relay · MIT</span><span>Built for a local machine.</span></div></footer>
    </div>
  )
}

export default App
