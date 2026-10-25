export const NAV_LINKS = [
  { id: 'product', label: 'Product' },
  { id: 'how-it-works', label: 'How it works' },
  { id: 'security', label: 'Security' },
  { id: 'faq', label: 'FAQ' },
]

export const AGENTS = [
  'Claude Code',
  'Codex',
  'Gemini CLI',
  'opencode',
  'Kilo',
  'Kiro',
  'Qoder',
  'Cline',
]

export const FEATURES = [
  {
    index: '01',
    title: 'Local by default',
    body: 'Relay binds to loopback and runs on your machine. There is no Relay cloud account in the middle.',
  },
  {
    index: '02',
    title: 'Bring your own keys',
    body: 'Connect OpenAI-compatible and Anthropic Messages endpoints. Your models appear in Relay’s model picker.',
  },
  {
    index: '03',
    title: 'Plan, Code, Orchestrate',
    body: 'Make an editable plan. Run it end to end. Or fan the same objective out to several agents and compare the work.',
  },
  {
    index: '04',
    title: 'Context that survives',
    body: 'Pin an output, add a side note, switch chats, and keep the reasoning attached to the work instead of losing it in scrollback.',
  },
  {
    index: '05',
    title: 'MCP and instruction packs',
    body: 'Attach MCP servers and reusable instruction packs to the agents that should see them.',
  },
  {
    index: '06',
    title: 'Local guardrails',
    body: 'Set local call caps, stop a run, and keep output attached to the session that produced it.',
  },
]

export const STEPS = [
  {
    number: '01',
    title: 'Connect the agents you already use',
    body: 'Relay detects your CLI tools. Add API keys only for the models you want to call directly.',
  },
  {
    number: '02',
    title: 'Describe the outcome',
    body: 'Plan mode writes a plan you can edit. Code mode plans and runs. Orchestrate fans the work out in parallel.',
  },
  {
    number: '03',
    title: 'Review the work',
    body: 'Every step shows its model, status, output, and git changes. Pin what matters. Run it again or stop it cleanly.',
  },
]

export const TRUST_POINTS = [
  {
    number: '01',
    title: 'Loopback only',
    body: 'Relay listens on 127.0.0.1. It is not a public server.',
  },
  {
    number: '02',
    title: 'Keys stay in a local file',
    body: 'Connected API keys live in sessions/connections.json with best-effort 0600 permissions. The browser only gets a masked hint.',
  },
  {
    number: '03',
    title: 'You choose the blast radius',
    body: 'Agents run with your OS permissions. Point Relay at the project folder you want it to touch.',
  },
]

export const FAQS = [
  {
    question: 'Is Relay a cloud service?',
    answer: 'No. The app runs locally and binds to loopback.',
  },
  {
    question: 'Do I need API keys?',
    answer: 'Only for API models. CLI agents use the login they already have.',
  },
  {
    question: 'Which agents work?',
    answer:
      'Relay is built for Claude Code, Codex, Gemini CLI, opencode, Kilo, Kiro, Qoder, Cline, and compatible API endpoints. Availability depends on your OS and installed tools.',
  },
  {
    question: 'Are my keys encrypted?',
    answer:
      'They are stored locally with best-effort file permissions. They are not encrypted at rest. Treat the machine as the security boundary.',
  },
  {
    question: 'Can I use more than one chat or model?',
    answer: 'Yes. Sessions are separate, and the model picker can target a specific agent or model.',
  },
  {
    question: 'Does Relay work on Windows, macOS, and Linux?',
    answer: 'Relay itself runs on Node 24. Your installed agent CLIs must support your platform.',
  },
  {
    question: 'Is there a hosted version?',
    answer: 'No. Local installation is the supported path.',
  },
]

export const INSTALL_COMMANDS = [
  'git clone https://github.com/Nepoleon/relay-local.git',
  'cd relay-local',
  'npm install',
  'npm start',
  'open http://127.0.0.1:7777',
].join('\n')

export const TERMINAL_COMMAND = 'relay "build a launch page for the new release"'

export const TERMINAL_PLAN = {
  route: 'fast-chat → opencode-build',
  rows: [
    { n: '1', task: 'scaffold the page', agent: 'opencode-build' },
    { n: '2', task: 'source real imagery', agent: 'opencode-build' },
    { n: '3', task: 'review animation budget', agent: 'agy' },
  ],
  prompt: 'Run plan? [y/N]',
}

export const HERO_PLAN = {
  agents: ['Qoder', 'opencode', 'IFM'],
  count: 3,
}

export const ORCHESTRATION_LANES = [
  {
    agent: 'Claude Code',
    task: 'Refactor the auth module',
    state: 'Done',
    detail: '6 files changed',
  },
  {
    agent: 'Codex',
    task: 'Migrate the router',
    state: 'Running',
    detail: '3 files changed',
  },
  {
    agent: 'Gemini CLI',
    task: 'Write the test suite',
    state: 'Queued',
    detail: 'Waiting for a slot',
  },
]

export const ORCHESTRATION_TASK = {
  label: 'Task',
  title: 'Ship the checkout flow',
  detail: 'One objective',
}

export const ORCHESTRATION_RESULT = {
  label: 'Merged',
  title: 'One thread',
  detail: '3 outputs kept',
}
