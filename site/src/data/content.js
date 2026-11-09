export const MODES = [
  { number: '01', title: 'Plan', body: 'The instructor writes a plan and waits. Edit the agent, model, or prompt of every step before anything touches the repository.' },
  { number: '02', title: 'Code', body: 'The instructor plans and runs automatically. Each step sees the outputs of the steps before it.' },
  { number: '03', title: 'Orchestrate', body: 'The same objective goes to several agents in parallel. Keep each result with its owner, then merge the useful work.' },
]

export const AGENTS = ['Claude Code', 'Codex', 'Gemini CLI', 'opencode', 'Kilo', 'Kiro', 'Qoder', 'Cline']

export const FEATURES = [
  { number: '01', title: 'Sessions', body: 'Separate chats with their own working folder and history.' },
  { number: '02', title: 'Pinned context', body: 'Pin an output and every later call sees it. Keep a contract, schema, or review verdict in view.' },
  { number: '03', title: 'Side notes', body: 'Ask an adjacent question through /btw without derailing the main run. The answer stays with the session.' },
  { number: '04', title: 'Usage', body: 'Observe chats, steps, failures, runtime, models, and connected keys locally.' },
  { number: '05', title: 'Quota', body: 'Set local caps and cooling periods per agent. Provider dashboards remain authoritative.' },
  { number: '06', title: 'Git snapshots', body: 'See status and diff-stat before and after a step when the folder is a git root.' },
]

export const FAQS = [
  { question: 'Is Relay a cloud service?', answer: 'No. It runs on 127.0.0.1 and has no Relay account or hosted control plane. Your sessions, keys, and project folder stay local.' },
  { question: 'Do I need API keys?', answer: 'Only if you want to call API models directly. CLI agents use their own authentication, and custom agents can be added through agents.json.' },
  { question: 'Which agents work?', answer: 'Relay ships presets for Claude Code, Codex, Gemini CLI, opencode, Kilo, Kiro, Qoder, and Cline. Any other CLI can be described in agents.json.' },
  { question: 'Are my keys encrypted?', answer: 'No. They are stored in sessions/connections.json with best-effort 0600 permissions. The browser only receives a masked hint; the OS account is the boundary.' },
  { question: 'Can I run more than one chat or model?', answer: 'Yes. One main run executes at a time so agents do not fight over a folder. You can switch sessions while it continues and use side questions alongside it.' },
  { question: 'Is Relay a sandbox?', answer: 'No. Agents run with your OS permissions, and several presets use permission-bypass flags. Review the diff and use a container or VM when the blast radius matters.' },
  { question: 'How much context moves between steps?', answer: 'Relay carries the objective and earlier outputs forward. Individual outputs are clipped to 12,000 characters, so large results should be summarized or pinned in pieces.' },
  { question: 'Does it work on macOS and Linux?', answer: 'Node 24 is the requirement. Windows is the primary development platform; CI covers CLI tests on Windows and Ubuntu.' },
]

export const INSTALL_COMMANDS = `git clone https://github.com/Bingo55/relay-local.git
cd relay-local
npm install
npm start
open http://127.0.0.1:7777`
