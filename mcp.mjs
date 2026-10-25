// MCP bridge: exposes the relay agents to opencode (or any MCP client) over stdio.
// Protocol is newline-delimited JSON-RPC 2.0; stdout carries the protocol only.
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startAgent } from './lib/spawn.mjs'
import { makePlan, readConfig, resolveAgent, validatePlan, QUOTA_RE } from './lib/plan.mjs'
import { runSteps, parseOutput } from './lib/execute.mjs'
import { rid } from './lib/store.mjs'
import { connections } from './lib/connections.mjs'
import { registry } from './lib/registry.mjs'
import { quota } from './lib/quota.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const cfg = readConfig(join(here, 'agents.json'))
const reloadLocalConfig = () => {
  connections.load().apply(cfg)
  registry.load()
  quota.load()
}
reloadLocalConfig()
const tmp = join(tmpdir(), 'relay-mcp')

const memStore = {
  save() {},
  appendLog() {},
  writePrompt(_sessionId, stepId) {
    mkdirSync(tmp, { recursive: true })
    return join(tmp, `${stepId}.prompt.md`)
  },
}

const text = (s, isError = false) => ({ content: [{ type: 'text', text: s }], ...(isError ? { isError: true } : {}) })

const TOOLS = [
  {
    name: 'relay_dispatch',
    description:
      'Run one configured agent, connected API model, or role (chat, plan, build, review, research) on a prompt and return its output. CLI agents can read and write files in cwd. Runs synchronously and can take minutes.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Agent id or role name' },
        prompt: { type: 'string', description: 'The instruction for the agent' },
        cwd: { type: 'string', description: 'Working directory (defaults to the MCP server cwd)' },
      },
      required: ['agent', 'prompt'],
    },
  },
  {
    name: 'relay_plan',
    description: 'Ask the relay instructor to split an instruction into an ordered, quota-aware agent plan. Returns JSON; does not run it.',
    inputSchema: {
      type: 'object',
      properties: { instruction: { type: 'string' } },
      required: ['instruction'],
    },
  },
  {
    name: 'relay_chain',
    description: 'Run an ordered chain of agents. Every step receives the original task plus all earlier outputs. Use relay_plan to build the steps, or pass your own.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The original request, included in every step' },
        steps: {
          type: 'array',
          description: 'Ordered steps. Use agent for one agent, or agents[] to fan out in parallel.',
          items: {
            type: 'object',
            properties: {
              agent: { type: 'string' },
              agents: { type: 'array', items: { type: 'string' } },
              prompt: { type: 'string' },
              why: { type: 'string' },
            },
            required: ['prompt'],
          },
        },
        cwd: { type: 'string' },
      },
      required: ['task', 'steps'],
    },
  },
  {
    name: 'relay_agents',
    description: 'List the configured relay agents, their models, capabilities and availability.',
    inputSchema: { type: 'object', properties: {} },
  },
]

async function callTool(name, args = {}) {
  reloadLocalConfig()
  if (name === 'relay_agents') {
    return text(
      cfg.agents
        .map((a) => `${a.disabled ? '[off] ' : ''}${a.id} (${a.label})${a.model ? ` model=${a.model}` : ''}\n  ${a.caps || ''}${a.note ? `\n  note: ${a.note}` : ''}`)
        .join('\n'),
    )
  }

  if (name === 'relay_dispatch') {
    if (!args.agent || !args.prompt) return text('agent and prompt are required', true)
    const agent = resolveAgent(String(args.agent), cfg)
    if (!agent) return text(`agent "${args.agent}" is unavailable or disabled`, true)
    mkdirSync(tmp, { recursive: true })
    quota.recordCall(agent.id, cfg)
    const res = await startAgent(agent, String(args.prompt), {
      cwd: args.cwd || process.cwd(),
      promptFile: join(tmp, `${rid('mcp')}.prompt.md`),
    }).done
    const ok = res.exitCode === 0
    const status = ok ? 'done' : `exit ${res.exitCode}${res.timedOut ? ' (timeout)' : ''}`
    quota.recordOutcome(agent.id, { ok, status: res.timedOut ? 'timeout' : ok ? 'done' : 'failed' }, cfg)
    if (!ok && QUOTA_RE.test(`${res.text}\n${res.err}`)) quota.recordQuota(agent.id, cfg, { minutes: 30 })
    return text(`${agent.label} — ${status} in ${Math.round(res.durationMs / 1000)}s\n\n${parseOutput(agent, res.text)}`, !ok)
  }

  if (name === 'relay_plan') {
    if (!args.instruction) return text('instruction is required', true)
    const built = await makePlan({
      task: String(args.instruction),
      cfg,
      pinned: [],
      emit: () => {},
      routerDir: join(here, 'router'),
    })
    if (!built.plan) return text(built.error || 'no eligible instructor or fallback agent', true)
    return text(JSON.stringify({ via: built.via, plan: built.plan, attempts: built.attempts }, null, 2))
  }

  if (name === 'relay_chain') {
    if (!args.task || !Array.isArray(args.steps) || !args.steps.length) return text('task and steps are required', true)
    const checked = validatePlan({ note: 'mcp', steps: args.steps }, cfg)
    if (!checked.plan) return text(`invalid steps: ${checked.error}`, true)
    const session = { id: rid('mcp'), cwd: args.cwd || process.cwd(), pinned: [], messages: [], agentSessions: {} }
    const { outputs } = await runSteps({
      cfg,
      store: memStore,
      session,
      steps: checked.plan.steps,
      task: String(args.task),
      emit: () => {},
      active: new Map(),
      control: { stopped: false },
    })
    return text(
      outputs.map((o) => `## Step ${o.n}: ${o.agent} — ${o.status}\n${o.text}`).join('\n\n') || 'no step produced output',
      outputs.some((o) => o.status !== 'done'),
    )
  }

  return text(`unknown tool "${name}"`, true)
}

async function handle(msg) {
  const { id, method, params } = msg
  const reply = (result) => ({ jsonrpc: '2.0', id, result })
  const error = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } })

  if (method === 'initialize') {
    return reply({
      protocolVersion: params?.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'relay', version: '0.2.0' },
    })
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return null
  if (method === 'ping') return reply({})
  if (method === 'tools/list') return reply({ tools: TOOLS })
  if (method === 'tools/call') {
    try {
      return reply(await callTool(params?.name, params?.arguments || {}))
    } catch (e) {
      return reply(text(`relay tool failed: ${e.message}`, true))
    }
  }
  return id == null ? null : error(-32601, `method not found: ${method}`)
}

let buf = ''
let pending = 0
let ended = false
const maybeExit = () => { if (ended && pending === 0) process.exit(0) }

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    pending++
    handle(msg)
      .then((res) => { if (res) process.stdout.write(`${JSON.stringify(res)}\n`) })
      .catch((e) => process.stderr.write(`relay mcp: ${e.message}\n`))
      .finally(() => { pending--; maybeExit() })
  }
})
process.stdin.on('end', () => { ended = true; maybeExit() })
