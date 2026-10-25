// The instructor: turns one instruction into an ordered, validated plan.
// opencode is the brain. agy with --json-schema is the strict fallback.
// A rules plan is the last resort so a dead instructor never blocks a run.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { startAgent, stripAnsi } from './spawn.mjs'
import { quota } from './quota.mjs'

const cooling = new Map() // agentId -> until (ms)

export const QUOTA_RE = /(rate.?limit|quota|exceeded|too many requests|429|401|403|402|unauthorized|unauthenticated|not logged in|invalid api key|api key not valid|authentication|insufficient|out of (credits|tokens)|add credits|daily limit|usage limit|billing|payment required|free tier|only be used from within|ENOENT|EFTYPE|not recognized as an internal)/i

export function markCooling(id, minutes = 30) {
  cooling.set(id, Date.now() + minutes * 60_000)
}

export function isCooling(id) {
  const until = cooling.get(id)
  if (!until) return false
  if (Date.now() > until) {
    cooling.delete(id)
    return false
  }
  return true
}

export function resolveAgent(name, cfg) {
  const role = cfg.roles?.[name]
  if (!role) {
    const a = cfg.agents.find((x) => x.id === name)
    return a && !a.disabled ? a : null
  }
  // Least-used first, but never pick an agent that is cooling, out, or at
  // 95%+ of its local cap. This is the routing half of the quota meter.
  const id = quota.leastUsed(role, cfg, { isCooling })
  return id ? cfg.agents.find((a) => a.id === id) || null : null
}

// Apply a per-step model only when that model is declared for the agent.
export function withModel(agent, model) {
  if (!agent || !model) return agent
  if (agent.transport === 'http') return agent.models?.includes(model) ? { ...agent, model } : agent
  if (!agent.modelArg || !agent.models?.includes(model)) return agent
  const args = [...(agent.args || [])]
  const i = args.lastIndexOf(agent.modelArg)
  if (i >= 0 && i + 1 < args.length) args[i + 1] = model
  else args.push(agent.modelArg, model)
  return { ...agent, args, model }
}

function agentTable(cfg) {
  return cfg.agents
    .filter((a) => !a.disabled)
    .map((a) => {
      const cool = isCooling(a.id) ? ' [COOLING - do not use]' : ''
      const usage = quota.promptLine(a.id, cfg, { isCooling })
      const models = a.models?.length ? ` models: ${a.models.slice(0, 4).join(', ')}` : ''
      const bias = a.defaultFor?.length ? ` bias: ${a.defaultFor.join('/')}` : ''
      return `- ${a.id} (${a.label}): ${a.caps}${models}${bias} | usage: ${usage}${cool}`
    })
    .join('\n')
}

function routerPrompt(task, cfg, pinned, notes, mode = 'code') {
  const roles = Object.entries(cfg.roles || {})
    .map(([k, v]) => `${k}=[${v.join(', ')}]`)
    .join('  ')
  const pin = pinned?.length
    ? `\n\nSHARED CONTEXT ALREADY PINNED BY THE USER:\n${pinned.map((p) => `- ${p.agent}: ${p.text.slice(0, 400)}`).join('\n')}`
    : ''
  const side = notes?.length
    ? `\n\nSIDE NOTES FROM THE USER (apply where relevant):\n${notes.map((n) => `- ${n.text}`).join('\n')}`
    : ''
  const modeLine = mode === 'plan'
    ? 'MODE: PLAN. Produce an implementation-ready plan. Nothing is executed automatically; the user will review and run it. Prefer research/plan/review steps, and keep build steps explicit.'
    : mode === 'orchestrate'
      ? 'MODE: ORCHESTRATE. Prefer one parallel fan-out step using 2-4 different agents, followed by one synthesis step when the work benefits from multiple perspectives.'
      : 'MODE: CODE. Produce a plan that ends in concrete implementation or verification. Prefer build steps and include review when the work changes code.'
  return `You are Relay's dispatcher. Split the user's request into the fewest steps that still use the right specialists.

${modeLine}

AVAILABLE AGENTS
${agentTable(cfg)}

ROLES (use the role name as "agent" to get automatic fallback): ${roles}

RULES
- 1 to 6 steps. They run in the order you give.
- Step 1 receives the user's request. Every later step automatically receives the original request plus all earlier outputs, so refer to earlier work as "the previous agent's output" instead of pasting it.
- Write each prompt as a direct instruction to that agent. Include concrete constraints the request implies.
- Prefer plan before build, and review after build, when the work changes code.
- For a request that explicitly wants several agents working independently, a comparison, or a second opinion, use ONE step with an "agents" array instead of "agent". Those run at the same time and all outputs feed later steps.
- Never invent agent names or roles. If one agent is enough, return one step.
- Do not restate the user's request in every prompt; the context is appended automatically.
- Never put absolute paths or the router's working directory in a prompt. The agents run in a separate workspace; say "the current folder".

OUTPUT
Return ONLY this JSON. No prose, no markdown fence:
{"note":"one line describing the strategy","steps":[{"agent":"plan|build|review|research|<agent id>","why":"short reason","prompt":"the instruction"}]}
A fan-out step uses: {"agents":["qoder","agy"],"why":"two independent reviews","prompt":"the instruction every listed agent receives"}

USER REQUEST
"""
${task}
"""${pin}${side}`
}

export function extractJson(text) {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  for (const blob of [fenced?.[1], text]) {
    if (!blob) continue
    const start = blob.indexOf('{')
    if (start < 0) continue
    let depth = 0
    let inStr = false
    let esc = false
    for (let i = start; i < blob.length; i++) {
      const ch = blob[i]
      if (inStr) {
        if (esc) esc = false
        else if (ch === '\\') esc = true
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') { inStr = true; continue }
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          try { return JSON.parse(blob.slice(start, i + 1)) } catch { break }
        }
      }
    }
  }
  return null
}

export function validatePlan(raw, cfg) {
  if (!raw || !Array.isArray(raw.steps) || !raw.steps.length) return { error: 'no steps' }
  if (raw.steps.length > 6) return { error: 'more than 6 steps' }
  const steps = []
  for (const [i, s] of raw.steps.entries()) {
    if (!s || typeof s.prompt !== 'string' || s.prompt.trim().length < 4) return { error: `step ${i + 1} has no usable prompt` }
    const why = String(s.why || '').slice(0, 200)
    if (Array.isArray(s.agents)) {
      const names = [...new Set(s.agents.map((x) => String(x).trim()).filter(Boolean))]
      if (names.length < 2) return { error: `step ${i + 1} fan-out needs at least 2 agents` }
      if (names.length > 4) return { error: `step ${i + 1} fans out to more than 4 agents` }
      for (const name of names) {
        if (!resolveAgent(name, cfg) && !cfg.roles?.[name]) return { error: `unknown agent "${name}"` }
      }
      steps.push({ agents: names, prompt: s.prompt.trim(), why })
      continue
    }
    const name = String(s.agent || '').trim()
    if (!resolveAgent(name, cfg) && !cfg.roles?.[name]) return { error: `unknown agent "${name}"` }
    steps.push({ agent: name, prompt: s.prompt.trim(), why })
  }
  return { plan: { note: String(raw.note || '').slice(0, 300), steps } }
}

export const INSTRUCTOR = {
  opencode: {
    id: 'opencode',
    label: 'opencode · deepseek v4.1',
    cmd: 'opencode',
    args: ['run', '--format', 'default', '--agent', 'relay-router', '--model', 'opencode/deepseek-v4.1-flash-free'],
    delivery: 'stdin',
    timeoutMin: 3,
  },
  qoder: {
    id: 'qoder-router',
    label: 'Qoder router',
    cmd: 'qoder',
    args: ['-p', '-o', 'text', '--permission-mode', 'bypass_permissions'],
    delivery: 'stdin',
    timeoutMin: 2,
  },
  agy: {
    id: 'agy-router',
    label: 'Antigravity router',
    cmd: 'agy',
    args: ['--output-format', 'json', '--print-timeout', '4m', '--model', 'gemini-3.8-flash-high'],
    delivery: 'arg',
    timeoutMin: 4,
  },
}

const SCHEMA = {
  type: 'object',
  properties: {
    note: { type: 'string' },
    steps: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: {
        type: 'object',
        properties: {
          agent: { type: 'string' },
          agents: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'string' } },
          why: { type: 'string' },
          prompt: { type: 'string' },
        },
        required: ['prompt'],
      },
    },
  },
  required: ['steps'],
}

const DEFAULT_FALLBACKS = [
  { agent: 'opencode-build', model: 'opencode/deepseek-v4.1-flash-free' },
  { agent: 'kilo', model: 'kilo/kilo-auto/free' },
]

// The next agent to try when the current one hits a quota or auth wall.
// Pick the least-used eligible fallback instead of blindly taking list order.
export function fallbackAgent(agent, cfg) {
  const list = cfg.fallbacks?.length ? cfg.fallbacks : DEFAULT_FALLBACKS
  const byId = new Map()
  for (const f of list) {
    if (f.agent === agent.id) continue
    const next = cfg.agents.find((a) => a.id === f.agent && !a.disabled)
    if (!next) continue
    if (!byId.has(next.id)) byId.set(next.id, { agent: next, model: f.model || next.model })
  }
  // The configured fallback order is a preference list, not a ceiling. If both
  // configured fallbacks are out, use any other metered/free agent rather than
  // failing the step. Paid/local agents (limit 0) stay out of automatic routing.
  for (const next of cfg.agents || []) {
    if (next.id === agent.id || next.disabled || byId.has(next.id)) continue
    if (quota.status(next.id, cfg, { isCooling }).limit <= 0) continue
    byId.set(next.id, { agent: next, model: next.model })
  }
  const id = quota.leastUsed([...byId.keys()], cfg, { isCooling })
  if (!id) return null
  const hit = byId.get(id)
  return withModel(hit.agent, hit.model)
}

export function rulesPlan(task, cfg) {
  const preferred = cfg.agents.find((a) => {
    if (a.id !== (cfg.defaultPlanner || 'opencode-build') || a.disabled || isCooling(a.id)) return false
    const s = quota.status(a.id, cfg, { isCooling })
    return !s.out && s.level !== 'out'
  })
  const planId = quota.leastUsed((cfg.roles?.plan || []), cfg, { isCooling })
  const anyId = quota.leastUsed((cfg.agents || []).map((a) => a.id), cfg, { isCooling })
  const agent = preferred || (planId ? cfg.agents.find((a) => a.id === planId) : null) || (anyId ? cfg.agents.find((a) => a.id === anyId) : null) || cfg.agents.find((a) => !a.disabled && !isCooling(a.id)) || cfg.agents.find((a) => !a.disabled)
  if (!agent) return { error: 'no eligible agents — all are disabled, cooling, or out of quota' }
  return {
    note: `rules fallback: ${agent.label}`,
    steps: [{ agent: agent.id, prompt: task, why: 'instructor unavailable, sent to the default planner' }],
  }
}

// Deterministic orchestration: fan the same objective out to a few eligible
// agents in parallel, then merge their work with a fast synthesis agent. The
// least-used routing rules still apply, so this respects quota/cooling.
export function orchestratePlan(task, cfg, { model = '', modelAgent = '' } = {}) {
  const picks = []
  const add = (ids = []) => {
    const id = quota.leastUsed(ids, cfg, { isCooling })
    if (id && !picks.includes(id)) picks.push(id)
    return id
  }
  if (modelAgent) add([modelAgent])
  for (const role of ['research', 'build', 'review', 'plan', 'chat']) add(cfg.roles?.[role] || [])
  if (picks.length < 2) add((cfg.agents || []).filter((a) => !a.disabled).map((a) => a.id))
  if (!picks.length) return { error: 'no eligible agents — all are disabled, cooling, or out of quota' }

  const agents = picks.slice(0, 3)
  const supportsModel = (id) => {
    const a = cfg.agents.find((x) => x.id === id)
    return !!model && !!a?.models?.includes(model)
  }
  const details = agents.map((id) => {
    const a = cfg.agents.find((x) => x.id === id)
    return `${id} (${a?.label || id}): ${String(a?.caps || 'generalist').slice(0, 120)}`
  }).join('\n')

  const first = agents.length > 1
    ? {
        agents,
        prompt: `Work independently on the original task below. Do not wait for the other agents. Use your strongest capability and return concrete output, decisions, code, or findings. If you cannot finish the whole task, complete the part you can do best and state assumptions.\n\nAGENT STRENGTHS:\n${details}`,
        why: `orchestrate · ${agents.length} agents in parallel`,
      }
    : {
        agent: agents[0],
        prompt: 'Work on the original task below. Use your strongest capability and return concrete output, decisions, code, or findings.',
        why: 'orchestrate · least-used eligible agent',
      }
  if (model && agents.some((id) => supportsModel(id))) first.model = model

  const steps = [first]
  if (agents.length > 1) {
    const candidates = [
      ...(cfg.roles?.chat || []),
      ...(cfg.roles?.build || []),
      ...(cfg.roles?.review || []),
      ...(cfg.agents || []).map((a) => a.id),
    ]
    const outside = [...new Set(candidates)].filter((id) => !agents.includes(id))
    const synth = quota.leastUsed(outside, cfg, { isCooling }) || quota.leastUsed(candidates, cfg, { isCooling }) || agents[0]
    const step = {
      agent: synth,
      prompt: 'Synthesize the parallel agent outputs above into one final answer. Remove duplicates, resolve disagreements, and end with concrete next actions. Do not repeat the original request; produce the result.',
      why: 'orchestrate · merge parallel work',
    }
    if (model && supportsModel(synth)) step.model = model
    steps.push(step)
  }
  return {
    plan: {
      note: agents.length > 1
        ? `orchestrated ${agents.length} agents in parallel · synced through ${steps[1]?.agent || 'the lead agent'}`
        : `orchestrated with ${agents[0]} (only eligible agent)`,
      steps,
    },
    via: 'orchestrator',
    agents,
  }
}

export async function makePlan({ task, cfg, pinned, notes, instructor, emit, routerDir, control, active, mode = 'code' }) {
  const prompt = routerPrompt(task, cfg, pinned, notes, mode)
  const attempts = []
  const selected = instructor || cfg.defaultInstructor || 'opencode'
  const instructorAgent = { opencode: 'opencode-build', agy: 'agy', qoder: 'qoder' }
  const rank = (kind) => {
    const s = quota.status(instructorAgent[kind] || kind, cfg, { isCooling })
    if (s.disabled || s.out || s.level === 'out') return Number.POSITIVE_INFINITY
    return s.limit > 0 ? s.percent : s.used
  }
  const order = selected === 'auto'
    ? ['opencode', 'agy', 'qoder'].sort((a, b) => rank(a) - rank(b))
    : selected === 'opencode'
      ? ['opencode']
      : INSTRUCTOR[selected] ? [selected, 'opencode'] : ['opencode']

  const queue = order.filter((kind) => Number.isFinite(rank(kind)))
  for (const [i, kind] of queue.entries()) {
    if (control?.stopped) return { stopped: true, attempts }
    let route = INSTRUCTOR[kind]
    if (!route) continue
    if (kind === 'agy') {
      const schemaPath = join(routerDir, 'plan.schema.json')
      writeFileSync(schemaPath, JSON.stringify(SCHEMA, null, 2), 'utf8')
      route = { ...route, args: [...route.args, '--json-schema', schemaPath, '-p'] }
    }
    const qid = instructorAgent[kind] || kind
    const run = startAgent(route, prompt, { cwd: routerDir })
    const key = `router:${kind}`
    quota.recordCall(qid, cfg)
    active?.set(key, run)
    const res = await run.done
    active?.delete(key)
    const failed = res.exitCode !== 0
    quota.recordOutcome(qid, { ok: !failed, status: res.timedOut ? 'timeout' : failed ? 'failed' : 'done' }, cfg)
    if (QUOTA_RE.test(`${res.text}\n${res.err}`)) quota.recordQuota(qid, cfg, { minutes: route.timeoutMin || 30 })
    if (control?.stopped) return { stopped: true, attempts }
    let raw = extractJson(res.text)
    // agy wraps its answer in {response: "...plan..."}; unwrap before validating.
    if (raw && typeof raw.response === 'string') raw = extractJson(raw.response) || raw
    const checked = validatePlan(raw, cfg)
    if (checked.plan) return { plan: checked.plan, via: kind, attempts }
    const why = res.timedOut ? `timed out after ${route.timeoutMin}m` : checked.error || `exit ${res.exitCode}`
    attempts.push(`${kind}: ${why}${res.err ? ` / ${stripAnsi(res.err).replace(/\s+/g, ' ').slice(0, 140)}` : ''}`)
    const next = queue[i + 1]
    emit?.({ type: 'notice', text: `${kind} could not plan (${why})${next ? `, trying ${next}` : ', falling back to rules'}` })
  }

  emit?.({ type: 'notice', text: `instructor failed: ${attempts.join(' | ')}` })
  const fallback = rulesPlan(task, cfg)
  if (fallback.error) return { error: fallback.error, attempts }
  return { plan: fallback, via: 'rules', attempts }
}

export function readConfig(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
}
