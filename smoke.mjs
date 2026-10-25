// End-to-end smoke test: instructor -> plan -> agents -> outputs -> pinned context.
import { fileURLToPath } from 'node:url'

const B = 'http://127.0.0.1:7777'
const scratch = fileURLToPath(new URL('./scratch', import.meta.url))
const j = async (p, o = {}) => {
  const r = await fetch(B + p, { headers: { 'content-type': 'application/json' }, ...o })
  const d = await r.json()
  if (!r.ok) throw new Error(`${p}: ${JSON.stringify(d)}`)
  return d
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await j('/api/session', { method: 'POST' })
await j('/api/cwd', { method: 'POST', body: JSON.stringify({ cwd: scratch }) })

const task = 'Create a tiny Python CLI that parses "key=value" args into a dict and prints JSON. Include one unittest. Then have it reviewed.'
console.log('task:', task)
const t0 = Date.now()
const planned = await j('/api/plan', { method: 'POST', body: JSON.stringify({ text: task, auto: true }) })
console.log(`plan via ${planned.plan.via}:`, planned.plan.steps.map((s) => `${s.agent}(${s.why})`).join(' -> '))

let seen = ''
for (let i = 0; i < 120; i++) {
  await sleep(5000)
  const s = (await j('/api/bootstrap')).session
  const steps = s.messages.filter((m) => m.role === 'step')
  const line = steps.map((m) => `${m.agent}:${m.status}${m.durationMs ? `(${Math.round(m.durationMs / 1000)}s)` : ''}`).join(' | ')
  if (line && line !== seen) { console.log(`${Math.round((Date.now() - t0) / 1000)}s`, line); seen = line }
  const b = (await j('/api/bootstrap')).busy
  if (!b && steps.length && steps.every((m) => m.status !== 'running')) break
}

const s = (await j('/api/bootstrap')).session
console.log('\n--- transcript ---')
for (const m of s.messages) {
  if (m.role === 'step') console.log(`\n[${m.n}] ${m.agent} — ${m.status} exit=${m.exitCode} ${Math.round((m.durationMs || 0) / 1000)}s\n${(m.text || '').slice(0, 700)}`)
  if (m.role === 'note') console.log('\nNOTE:', m.text)
}
const last = s.messages.filter((m) => m.role === 'step').at(-1)
if (last) {
  const pin = await j('/api/pin', { method: 'POST', body: JSON.stringify({ stepId: last.id, on: true }) })
  console.log('\npinned:', pin.pinned.length)
}
console.log('\ntotal', Math.round((Date.now() - t0) / 1000) + 's')
