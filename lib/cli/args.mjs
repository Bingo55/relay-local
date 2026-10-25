// Argument parsing for the Relay terminal client. No dependencies, no config.

export const COMMANDS = new Set([
  'chat', 'tui', 'task', 'plan', 'run', 'chain', 'direct', 'btw', 'stop',
  'status', 'sessions', 'use', 'new', 'rm', 'rename', 'cwd', 'instructor',
  'models', 'agents', 'quota', 'export',
])

const BOOL_FLAGS = new Map([
  ['no-start', 'noStart'],
  ['no-color', 'noColor'],
  ['no-mouse', 'noMouse'],
  ['no-wait', 'noWait'],
  ['yes', 'yes'],
  ['auto', 'auto'],
  ['plan-only', 'planOnly'],
  ['json', 'json'],
  ['debug', 'debug'],
  ['help', 'help'],
  ['version', 'version'],
])

const VALUE_FLAGS = new Map([
  ['url', 'url'],
  ['session', 'session'],
  ['model', 'model'],
  ['instructor', 'instructor'],
  ['task', 'task'],
])

const SHORT = new Map([
  ['y', 'yes'],
  ['h', 'help'],
  ['V', 'version'],
])

export function parseArgs(argv) {
  const flags = {
    noStart: false, noColor: false, noMouse: false, noWait: false, yes: false, auto: false,
    planOnly: false, json: false, debug: false, help: false, version: false,
    url: '', session: '', model: '', instructor: '', task: '',
  }
  const errors = []
  const positional = []
  let literal = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (literal) { positional.push(arg); continue }
    if (arg === '--') { literal = true; continue }

    if (arg.startsWith('--')) {
      const body = arg.slice(2)
      const eq = body.indexOf('=')
      const name = (eq >= 0 ? body.slice(0, eq) : body).toLowerCase()
      const inline = eq >= 0 ? body.slice(eq + 1) : null

      if (BOOL_FLAGS.has(name)) {
        if (inline !== null) { errors.push(`Option --${name} does not take a value.`); continue }
        flags[BOOL_FLAGS.get(name)] = true
        continue
      }
      if (VALUE_FLAGS.has(name)) {
        let value = inline
        if (value === null) {
          const next = argv[i + 1]
          if (next === undefined || (next.startsWith('-') && next !== '-')) {
            errors.push(`Option --${name} needs a value.`)
            continue
          }
          value = next
          i++
        }
        flags[VALUE_FLAGS.get(name)] = value
        continue
      }
      errors.push(`Unknown option: --${body}`)
      continue
    }

    if (arg.startsWith('-') && arg !== '-') {
      const short = arg.slice(1)
      if (short.length !== 1) { errors.push(`Unknown option: ${arg}`); continue }
      const long = SHORT.get(short)
      if (!long) { errors.push(`Unknown option: -${short}`); continue }
      flags[long] = true
      continue
    }

    positional.push(arg)
  }

  let command = ''
  let args = []
  let task = flags.task

  if (positional.length) {
    if (COMMANDS.has(positional[0])) {
      command = positional[0]
      args = positional.slice(1)
      if (command === 'task' || command === 'plan') task = args.join(' ')
    } else {
      command = 'task'
      task = positional.join(' ')
    }
  }

  if (command === 'plan') flags.planOnly = true

  return { command, args, task: String(task || '').trim(), flags, errors }
}

export function usage(colors, program = 'relay') {
  const c = colors || { bold: (s) => s, dim: (s) => s, yellow: (s) => s }
  return [
    c.bold('Relay — AI assistants on your computer'),
    '',
    c.bold('USAGE'),
    `  ${program}                          open the full-screen view`,
    `  ${program} chat                     talk in a streaming chat`,
    `  ${program} "task"                   plan, approve, run, summarize`,
    `  ${program} plan "task"              only make a plan (nothing runs)`,
    `  ${program} --auto "task"            plan and run without stopping`,
    '',
    c.bold('COMMANDS'),
    '  task "task"              same as: relay "task"',
    '  run [planId]             run a plan, or the last plan in this chat',
    '  chain <file|->           manual chain: one "agent: prompt" per line',
    '  direct <agent|role> "p"  one assistant, no planning',
    '  btw "question"           side answer while work continues',
    '  stop                     stop the active run and side answers',
    '  status                   plain status card',
    '  sessions                 list chats',
    '  use <n|id>               switch chat',
    '  new                      new chat',
    '  rm <n|id>                delete a chat',
    '  rename "title"           rename the active chat',
    '  cwd [path]               show or set the working folder',
    '  instructor [id|auto]     show or set the planner',
    '  models                   list model refs by assistant',
    '  agents                   list assistants and roles',
    '  quota                    show local quota meter and next route',
    '  quota set <agent> <n>    set an agent\'s local cap',
    '  quota reset [agent]      reset usage counters',
    '  export [path]            write the active chat as JSON',
    '',
    c.bold('OPTIONS'),
    '  --url <url>              server address (default http://127.0.0.1:7777)',
    '  --no-start               do not start the server automatically',
    '  --no-color               disable color (NO_COLOR also works)',
    '  --no-mouse               full-screen view: no mouse reporting',
    '  --session <id>           switch chat before doing anything',
    '  --model <ref>            model override for this command',
    '  --instructor <id>        planner: opencode | qoder | agy | auto',
    '  -y, --yes                approve the plan without asking',
    '  --auto                   plan and run in one request',
    '  --plan-only              plan, print, exit',
    '  --json                   one-shot JSON on stdout',
    '  --debug                  extra diagnostics on stderr',
    '  -h, --help               this help',
    '  -V, --version            version',
    '',
    c.dim('Nothing runs until you press Enter, pass --yes, or pass --auto.'),
    c.dim('Exit codes: 0 ok · 1 run problem · 2 usage · 3 connection · 130 interrupted · 143 terminated'),
  ].join('\n')
}
