// Local MCP server + plugin registry.
//
// MCP servers are passed to agent CLIs through a generated config file and
// RELAY_MCP_* environment variables. Claude Code additionally receives
// --mcp-config on the command line. Plugin entries are reusable instruction
// packs appended to a step prompt for the agents they target.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(here)
export const REGISTRY_FILE = join(ROOT, 'sessions', 'registry.json')
const MCP_DIR = join(ROOT, 'sessions', 'mcp')

const rid = (p) => `${p}_${randomUUID().slice(0, 8)}`
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)

function splitArgs(input) {
  if (Array.isArray(input)) return input.map((x) => String(x)).filter((x) => x.length)
  const text = String(input || '').trim()
  if (!text) return []
  const out = []
  const re = /"([^"]*)"|'([^']*)'|([^\s]+)/g
  let m
  while ((m = re.exec(text))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

function parseEnv(input) {
  if (!input) return {}
  let obj = input
  if (typeof input === 'string') {
    try { obj = JSON.parse(input) } catch { throw new Error('environment must be a JSON object') }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('environment must be a JSON object')
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [String(k), String(v)]).slice(0, 40))
}

function normalizeAgents(input) {
  if (!input) return ['*']
  const list = Array.isArray(input) ? input : String(input).split(',')
  const ids = [...new Set(list.map((x) => String(x).trim()).filter(Boolean))]
  return ids.length ? ids.slice(0, 40) : ['*']
}

function normalizeMcp(input, existing) {
  const name = String(input.name || existing?.name || '').trim().slice(0, 80)
  if (!name) throw new Error('MCP name is required')
  const command = String(input.command ?? existing?.command ?? '').trim()
  if (!command) throw new Error('MCP command is required')
  const id = existing?.id || slug(input.id || name) || rid('mcp')
  const now = new Date().toISOString()
  return {
    id,
    name,
    command,
    args: splitArgs(input.args ?? existing?.args).slice(0, 40),
    env: parseEnv(input.env ?? existing?.env),
    cwd: String(input.cwd ?? existing?.cwd ?? '').trim(),
    agents: normalizeAgents(input.agents ?? existing?.agents),
    enabled: input.enabled == null ? (existing?.enabled ?? true) : !!input.enabled,
    note: String(input.note ?? existing?.note ?? '').slice(0, 240),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }
}

function normalizePlugin(input, existing) {
  const name = String(input.name || existing?.name || '').trim().slice(0, 80)
  if (!name) throw new Error('plugin name is required')
  const instructions = String(input.instructions ?? existing?.instructions ?? '').trim().slice(0, 8000)
  if (!instructions) throw new Error('plugin instructions are required')
  const now = new Date().toISOString()
  return {
    id: existing?.id || slug(input.id || name) || rid('plug'),
    name,
    instructions,
    agents: normalizeAgents(input.agents ?? existing?.agents),
    enabled: input.enabled == null ? (existing?.enabled ?? true) : !!input.enabled,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }
}

const safeMcp = (s) => ({
  id: s.id,
  name: s.name,
  command: s.command,
  args: [...s.args],
  envKeys: Object.keys(s.env || {}),
  cwd: s.cwd,
  agents: [...s.agents],
  enabled: !!s.enabled,
  note: s.note,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
})

const safePlugin = (p) => ({
  id: p.id,
  name: p.name,
  instructions: p.instructions,
  agents: [...p.agents],
  enabled: !!p.enabled,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
})

export class RegistryStore {
  constructor(file = REGISTRY_FILE) {
    this.file = file
    this.data = { version: 1, mcp: [], plugins: [] }
    this.load()
  }

  load() {
    try {
      if (!existsSync(this.file)) return this
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      this.data = {
        version: 1,
        mcp: Array.isArray(parsed?.mcp) ? parsed.mcp.filter((s) => s?.id && s?.command) : [],
        plugins: Array.isArray(parsed?.plugins) ? parsed.plugins.filter((p) => p?.id && p?.name) : [],
      }
    } catch {
      this.data = { version: 1, mcp: [], plugins: [] }
    }
    return this
  }

  save() {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    try { chmodSync(tmp, 0o600) } catch {}
    renameSync(tmp, this.file)
    try { chmodSync(this.file, 0o600) } catch {}
  }

  snapshot() {
    return {
      mcp: this.data.mcp.map(safeMcp),
      plugins: this.data.plugins.map(safePlugin),
      file: this.file,
    }
  }

  mcpRaw(id) {
    return this.data.mcp.find((s) => s.id === id) || null
  }

  pluginRaw(id) {
    return this.data.plugins.find((p) => p.id === id) || null
  }

  upsertMcp(input = {}) {
    const existing = input.id ? this.mcpRaw(String(input.id)) : null
    const rec = normalizeMcp(input, existing)
    if (existing) this.data.mcp = this.data.mcp.map((s) => (s.id === rec.id ? rec : s))
    else {
      if (this.data.mcp.some((s) => s.id === rec.id)) rec.id = `${rec.id}-${randomUUID().slice(0, 4)}`
      this.data.mcp.push(rec)
    }
    this.save()
    return safeMcp(rec)
  }

  removeMcp(id) {
    const before = this.data.mcp.length
    this.data.mcp = this.data.mcp.filter((s) => s.id !== id)
    if (this.data.mcp.length === before) return false
    this.save()
    return true
  }

  toggleMcp(id, enabled) {
    const rec = this.mcpRaw(id)
    if (!rec) return null
    rec.enabled = enabled == null ? !rec.enabled : !!enabled
    rec.updatedAt = new Date().toISOString()
    this.save()
    return safeMcp(rec)
  }

  upsertPlugin(input = {}) {
    const existing = input.id ? this.pluginRaw(String(input.id)) : null
    const rec = normalizePlugin(input, existing)
    if (existing) this.data.plugins = this.data.plugins.map((p) => (p.id === rec.id ? rec : p))
    else {
      if (this.data.plugins.some((p) => p.id === rec.id)) rec.id = `${rec.id}-${randomUUID().slice(0, 4)}`
      this.data.plugins.push(rec)
    }
    this.save()
    return safePlugin(rec)
  }

  removePlugin(id) {
    const before = this.data.plugins.length
    this.data.plugins = this.data.plugins.filter((p) => p.id !== id)
    if (this.data.plugins.length === before) return false
    this.save()
    return true
  }

  togglePlugin(id, enabled) {
    const rec = this.pluginRaw(id)
    if (!rec) return null
    rec.enabled = enabled == null ? !rec.enabled : !!enabled
    rec.updatedAt = new Date().toISOString()
    this.save()
    return safePlugin(rec)
  }

  forAgent(agentId) {
    return this.data.mcp.filter((s) => s.enabled && (s.agents.includes('*') || s.agents.includes(agentId)))
  }

  pluginsForAgent(agentId) {
    return this.data.plugins.filter((p) => p.enabled && (p.agents.includes('*') || p.agents.includes(agentId)))
  }

  mcpConfig(agentId) {
    const servers = this.forAgent(agentId)
    if (!servers.length) return null
    const mcpServers = {}
    for (const s of servers) {
      const entry = { command: s.command, args: [...s.args] }
      if (Object.keys(s.env || {}).length) entry.env = { ...s.env }
      if (s.cwd) entry.cwd = s.cwd
      mcpServers[s.id] = entry
    }
    return { mcpServers }
  }

  writeMcpConfig(agentId) {
    const conf = this.mcpConfig(agentId)
    if (!conf) return null
    mkdirSync(MCP_DIR, { recursive: true })
    const file = join(MCP_DIR, `${slug(agentId) || 'agent'}.json`)
    writeFileSync(file, JSON.stringify(conf, null, 2), 'utf8')
    try { chmodSync(file, 0o600) } catch {}
    return file
  }

  pluginPrompt(agentId) {
    const plugins = this.pluginsForAgent(agentId)
    if (!plugins.length) return ''
    return `\n\n# RELAY PLUGINS (enabled by the user for this agent)\nApply these instructions in addition to the task above. They do not override safety or the user's request.\n${plugins.map((p) => `\n## ${p.name}\n${p.instructions}`).join('\n')}`
  }
}

export const registry = new RegistryStore()
