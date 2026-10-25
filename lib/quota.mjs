// Relay's local quota meter.
//
// The CLIs Relay drives do not expose a reliable "requests remaining" number.
// Relay can see the calls it makes, the quota/auth walls it hits, and how long
// it has benched an agent. This store records those observations per agent so
// the web UI, terminal, and PowerShell can show a useful meter.
//
// `limit` is an editable local daily/weekly/monthly cap. It is a guardrail,
// not a claim about a provider's real dashboard. Set the real cap with:
//   relay quota set <agent> <number>
//   .\quota.ps1 -Set <agent> -Limit <number>
//
// The store lives under sessions/ (already gitignored) so deleting a chat does
// not wipe the meter.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(here)
export const QUOTA_FILE = join(ROOT, 'sessions', 'quota.json')

const WINDOWS = new Set(['day', 'week', 'month', 'total'])

// Conservative local guardrails for the free agents Relay knows about. These
// are deliberately editable: provider dashboards are authoritative, and the
// meter says "local cap" everywhere so nobody mistakes this for a live balance.
// Paid or local-compute agents start unmetered (0).
export const DEFAULT_LIMITS = {
  'opencode-build': { limit: 100, window: 'day' },
  kilo: { limit: 100, window: 'day' },
  'agy-flash': { limit: 100, window: 'day' },
  agy: { limit: 50, window: 'day' },
  qoder: { limit: 50, window: 'day' },
  kiro: { limit: 50, window: 'day' },
  gemini: { limit: 100, window: 'day' },
  claude: { limit: 0, window: 'day' },
  codex: { limit: 0, window: 'day' },
  nvidia: { limit: 0, window: 'day' },
  cline: { limit: 0, window: 'day' },
}

const clampInt = (n, fallback = 0) => {
  const v = Number(n)
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback
}

function periodKey(window, ms = Date.now()) {
  if (window === 'total') return 'all'
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  if (window === 'month') return `${y}-${m}`
  if (window === 'week') {
    // ISO-ish week key, local time. Good enough for a local guardrail.
    const t = new Date(y, d.getMonth(), d.getDate())
    t.setHours(0, 0, 0, 0)
    t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7))
    const week1 = new Date(t.getFullYear(), 0, 4)
    const n = 1 + Math.round(((t - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
    return `${t.getFullYear()}-W${String(n).padStart(2, '0')}`
  }
  return `${y}-${m}-${day}`
}

function emptyAgent() {
  return {
    used: 0,
    calls: 0,
    errors: 0,
    quotaHits: 0,
    lastAt: null,
    lastResult: '',
    period: '',
    outUntil: null,
    outReason: '',
  }
}

export class QuotaStore {
  constructor(file = QUOTA_FILE) {
    this.file = file
    this.data = { version: 1, updatedAt: null, agents: {}, limits: {} }
    this.load()
  }

  load() {
    try {
      if (!existsSync(this.file)) return this
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      if (parsed && typeof parsed === 'object') {
        this.data = {
          version: 1,
          updatedAt: parsed.updatedAt || null,
          agents: parsed.agents && typeof parsed.agents === 'object' ? parsed.agents : {},
          limits: parsed.limits && typeof parsed.limits === 'object' ? parsed.limits : {},
        }
      }
    } catch {
      // A corrupt meter must not stop Relay. Start fresh; the file will be
      // replaced on the next write.
      this.data = { version: 1, updatedAt: null, agents: {}, limits: {} }
    }
    return this
  }

  save() {
    this.data.updatedAt = new Date().toISOString()
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      renameSync(tmp, this.file)
    } catch {
      // Meter writes are best-effort. Never break a run because the counter
      // could not be persisted.
    }
  }

  agentConfig(cfg, id) {
    return cfg?.agents?.find((a) => a.id === id) || null
  }

  entry(id) {
    if (!this.data.agents[id]) this.data.agents[id] = emptyAgent()
    return this.data.agents[id]
  }

  quotaConfig(cfg, id) {
    const agent = this.agentConfig(cfg, id)
    const override = this.data.limits?.[id] || {}
    const q = agent?.quota || {}
    const fallback = DEFAULT_LIMITS[id] || { limit: 0, window: 'day' }
    const limit = clampInt(override.limit ?? q.limit ?? fallback.limit, 0)
    const window = WINDOWS.has(override.window)
      ? override.window
      : WINDOWS.has(q.window)
        ? q.window
        : (WINDOWS.has(fallback.window) ? fallback.window : 'day')
    return { limit, window }
  }

  ensurePeriod(id, cfg, now = Date.now()) {
    const e = this.entry(id)
    const { window } = this.quotaConfig(cfg, id)
    const key = periodKey(window, now)
    if (e.period !== key || e.window !== window) {
      e.used = 0
      e.calls = 0
      e.errors = 0
      e.quotaHits = 0
      e.period = key
      e.window = window
      // A quota wall from the previous period should not keep the agent out
      // after the window has rolled over.
      e.outUntil = null
      e.outReason = ''
    }
    return e
  }

  status(id, cfg, { isCooling, now = Date.now() } = {}) {
    const agent = this.agentConfig(cfg, id)
    const e = this.ensurePeriod(id, cfg, now)
    const { limit, window } = this.quotaConfig(cfg, id)
    const cooling = typeof isCooling === 'function' ? !!isCooling(id) : false
    const outUntil = e.outUntil && Date.parse(e.outUntil) > now ? e.outUntil : null
    const out = cooling || !!outUntil
    const rawPercent = limit > 0 ? Math.min(100, (e.used / limit) * 100) : null
    const percent = rawPercent === null ? null : Math.round(rawPercent)
    let level = 'unknown'
    if (agent?.disabled) level = 'off'
    else if (out) level = 'out'
    else if (percent !== null) {
      if (percent >= 95) level = 'out'
      else if (percent >= 80) level = 'red'
      else if (percent >= 50) level = 'orange'
      else level = 'green'
    }
    return {
      id,
      label: agent?.label || id,
      disabled: !!agent?.disabled,
      limit,
      window,
      used: e.used,
      calls: e.calls,
      errors: e.errors,
      quotaHits: e.quotaHits,
      percent,
      level,
      out,
      cooling,
      outUntil,
      outReason: cooling ? 'cooling down' : e.outReason || '',
      lastAt: e.lastAt,
      lastResult: e.lastResult,
    }
  }

  // Increment a call attempt. Called once per spawned agent invocation.
  recordCall(id, cfg, now = Date.now()) {
    const e = this.ensurePeriod(id, cfg, now)
    e.used++
    e.calls++
    e.lastAt = new Date(now).toISOString()
    this.save()
    return e
  }

  recordOutcome(id, { ok = true, status = '' } = {}, cfg, now = Date.now()) {
    const e = this.ensurePeriod(id, cfg, now)
    if (!ok) e.errors++
    e.lastResult = status || (ok ? 'done' : 'failed')
    this.save()
    return e
  }

  recordQuota(id, cfg, { minutes = 30, now = Date.now() } = {}) {
    const e = this.ensurePeriod(id, cfg, now)
    e.quotaHits++
    e.errors++
    e.lastResult = 'quota'
    e.outUntil = new Date(now + Math.max(1, minutes) * 60_000).toISOString()
    e.outReason = `quota/auth wall · benched ${minutes}m`
    this.save()
    return e
  }

  markOut(id, cfg, { minutes = 30, reason = 'quota/auth wall', now = Date.now() } = {}) {
    const e = this.ensurePeriod(id, cfg, now)
    e.outUntil = new Date(now + Math.max(1, minutes) * 60_000).toISOString()
    e.outReason = `${reason} · benched ${minutes}m`
    this.save()
    return e
  }

  configure(id, { limit, window } = {}, cfg) {
    const agent = this.agentConfig(cfg, id)
    if (!agent) return null
    const next = clampInt(limit, 0)
    const win = WINDOWS.has(window) ? window : this.quotaConfig(cfg, id).window
    this.data.limits[id] = { limit: next, window: win }
    const e = this.entry(id)
    if (e.window !== win) {
      e.period = ''
      e.outUntil = null
      e.outReason = ''
    }
    this.save()
    return this.status(id, cfg)
  }

  reset(id, cfg) {
    if (cfg?.agents && !this.agentConfig(cfg, id)) return null
    this.data.agents[id] = emptyAgent()
    this.save()
    return this.status(id, cfg)
  }

  resetAll() {
    this.data.agents = {}
    this.save()
  }

  // Return the least-used usable id from a list. Excludes disabled, cooling,
  // out, and 95%+ agents. Configured (limit > 0) agents are compared by
  // percentage; if none are configured, calls are compared directly.
  leastUsed(ids, cfg, { isCooling, now = Date.now() } = {}) {
    const seen = new Set()
    const candidates = []
    for (const id of ids || []) {
      if (!id || seen.has(id)) continue
      seen.add(id)
      const agent = this.agentConfig(cfg, id)
      if (!agent || agent.disabled) continue
      const s = this.status(id, cfg, { isCooling, now })
      if (s.out) continue
      if (s.limit > 0 && s.percent >= 95) continue
      candidates.push(s)
    }
    if (!candidates.length) return null
    const tracked = candidates.filter((s) => s.limit > 0)
    const pool = tracked.length ? tracked : candidates
    pool.sort((a, b) => {
      const av = a.limit > 0 ? a.percent : a.used
      const bv = b.limit > 0 ? b.percent : b.used
      if (av !== bv) return av - bv
      if (a.used !== b.used) return a.used - b.used
      return ids.indexOf(a.id) - ids.indexOf(b.id)
    })
    return pool[0].id
  }

  snapshot(cfg, { isCooling, now = Date.now() } = {}) {
    const agents = (cfg?.agents || []).map((a) => this.status(a.id, cfg, { isCooling, now }))
    const enabled = agents.filter((a) => !a.disabled)
    const routeId = this.leastUsed(enabled.map((a) => a.id), cfg, { isCooling, now })
    const route = routeId ? agents.find((a) => a.id === routeId) || null : null
    const roles = {}
    for (const [role, ids] of Object.entries(cfg?.roles || {})) {
      const id = this.leastUsed(ids, cfg, { isCooling, now })
      if (id) {
        const s = agents.find((a) => a.id === id)
        roles[role] = s ? { id: s.id, label: s.label, percent: s.percent, level: s.level } : { id }
      } else {
        roles[role] = null
      }
    }
    return {
      at: new Date(now).toISOString(),
      file: this.file,
      mode: 'local-observed',
      note: 'Relay-observed calls. Caps are editable local guardrails; provider dashboards are authoritative.',
      route: route ? { id: route.id, label: route.label, percent: route.percent, level: route.level } : null,
      roles,
      agents,
    }
  }

  // Compact line for the instructor prompt, so the planner can avoid an agent
  // that is already out or nearly at its local cap.
  promptLine(id, cfg, opts) {
    const s = this.status(id, cfg, opts)
    if (s.disabled) return 'unavailable'
    if (s.out) return `OUT (${s.outReason || 'cooling'})`
    if (s.limit > 0) return `${s.percent}% of local cap (${s.used}/${s.limit} ${s.window})`
    return `${s.used} calls this ${s.window}`
  }
}

export const quota = new QuotaStore()
