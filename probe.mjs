// Health check for every agent plus the instructor. Prints one actionable line
// per failure and writes probe-report.json (also served at /api/health).
// Usage: npm run doctor [agentId ...]
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { startAgent } from './lib/spawn.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const cfg = JSON.parse(readFileSync(join(here, 'agents.json'), 'utf8').replace(/^\uFEFF/, ''))
const scratch = join(here, 'scratch')
const PROMPT = 'Reply with exactly RELAY_OK and nothing else. Do not read or write any files, do not use tools.'
const AUTH_RE = /(not logged in|unauthorized|unauthenticated|invalid api key|api key not valid|authentication|401|403|quota|credits)/i

const FIX = {
  qoder: 'run `qoder` once to sign in, then retry',
  agy: 'run `agy` once to sign in, then retry',
  'agy-flash': 'run `agy` once to sign in, then retry',
  kilo: 'run `kilo auth login`, or check that `kilo/kilo-auto/free` is still offered',
  'opencode-build': 'run `opencode` once to sign in, then retry',
  kiro: 'run `kiro-cli login` and check `kiro-cli chat --list-models`',
  nvidia: 'replace the NVIDIA key in ~/.config/kilo/kilo.jsonc with an NVAPI key that has chat access, then remove disabled',
  cline: 'run `npm i -g cline --force`, then `cline auth`',
  gemini: 'run `gemini` and sign in with Google, or set GEMINI_API_KEY from aistudio.google.com/apikey',
  claude: 'run `claude` and /login (or set ANTHROPIC_API_KEY)',
  codex: 'codex is configured for local Ollama: start `ollama serve` and `ollama pull qwen2.5-coder:3b`',
}

const probeOnce = async (agent, delivery) => {
  const a = { ...agent, delivery, timeoutMin: 3 }
  const run = startAgent(a, PROMPT, { cwd: scratch })
  return { delivery, ...(await run.done) }
}

const only = process.argv.slice(2)
const wanted = cfg.agents.filter((a) => !only.length || only.includes(a.id))
const results = []

for (const agent of wanted) {
  if (agent.disabled) {
    console.log(`SKIP  ${agent.id.padEnd(10)} disabled — ${agent.note || 'see agents.json'}`)
    results.push({ id: agent.id, ok: false, skipped: true, note: agent.note, fix: FIX[agent.id] })
    continue
  }
  process.stdout.write(`probe ${agent.id} (${agent.delivery}) ... `)
  const first = await probeOnce(agent, agent.delivery)
  let r = first
  let ok = r.exitCode === 0 && /\bRELAY_OK\b/.test(r.text)
  // A delivery retry on an auth failure just hides the real error behind a
  // missing-prompt message (gemini -p consumes the next token).
  if (!ok && !AUTH_RE.test(`${first.text}\n${first.err}`)) {
    const alt = agent.delivery === 'stdin' ? 'arg' : 'stdin'
    process.stdout.write(`retry ${alt} ... `)
    r = await probeOnce(agent, alt)
    ok = r.exitCode === 0 && /\bRELAY_OK\b/.test(r.text)
  }
  console.log(ok ? 'OK' : `FAIL (exit ${r.exitCode})`)
  const err = `${r.text || ''}\n${r.err || ''}`.replace(/\s+/g, ' ').trim()
  results.push({
    id: agent.id,
    ok,
    workingDelivery: ok ? r.delivery : null,
    configuredDelivery: agent.delivery,
    exitCode: r.exitCode,
    durationMs: r.durationMs,
    text: (r.text || '').slice(0, 400),
    stderr: (r.err || '').slice(-400),
    cmdline: r.cmdline,
    fix: ok ? null : agent.fix || agent.note || FIX[agent.id] || 'run the CLI once interactively, then re-probe',
  })
  if (!ok && err) console.log(`      ${err.slice(0, 220)}`)
}

// The instructor must work headlessly too.
if (!only.length || only.includes('opencode')) {
  const router = { id: 'opencode', cmd: 'opencode', args: ['run', '--format', 'default'], delivery: 'arg', timeoutMin: 3 }
  process.stdout.write('probe opencode (instructor) ... ')
  const rr = await startAgent(router, 'Reply with exactly RELAY_OK and nothing else. Do not use any tools.', { cwd: join(here, 'router') }).done
  const ok = rr.exitCode === 0 && /\bRELAY_OK\b/.test(rr.text)
  console.log(ok ? 'OK' : `FAIL (exit ${rr.exitCode})`)
  results.push({
    id: 'opencode',
    ok,
    workingDelivery: 'arg',
    exitCode: rr.exitCode,
    durationMs: rr.durationMs,
    text: (rr.text || '').slice(0, 400),
    stderr: (rr.err || '').slice(-400),
    cmdline: rr.cmdline,
    fix: ok ? null : 'run `opencode` once to sign in or set a model, then retry',
  })
}

const reportPath = join(here, 'probe-report.json')
let previous = []
if (only.length) {
  try { previous = JSON.parse(readFileSync(reportPath, 'utf8')).results || [] } catch {}
}
const merged = [...previous.filter((p) => !results.some((r) => r.id === p.id)), ...results]
writeFileSync(reportPath, JSON.stringify({ at: new Date().toISOString(), results: merged }, null, 2))
console.log('\n' + results.map((r) => `${r.ok ? 'PASS' : r.skipped ? 'SKIP' : 'MISS'}  ${r.id.padEnd(10)} ${String(r.durationMs || '').padStart(7)}  ${r.ok ? `${r.workingDelivery} works` : r.skipped ? r.note || 'disabled' : r.fix}`).join('\n'))
if (results.some((r) => !r.ok && !r.skipped)) console.log('\nFix the MISS lines above, then re-run: npm run doctor')
