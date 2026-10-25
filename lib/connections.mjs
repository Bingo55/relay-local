// Connected API models.
//
// The key never leaves this file. The server exposes a sanitized view to the
// browser (name, endpoint, model ids, and a short hint), and the raw key is
// only attached to the in-memory agent config used by spawn.mjs.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { providerById } from './providers.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(here)
export const CONNECTIONS_FILE = join(ROOT, 'sessions', 'connections.json')

const PROTOCOLS = new Set(['openai', 'anthropic'])
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
const rid = () => `con_${randomUUID().slice(0, 8)}`

function normalizeModels(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[\n,]/)
  return [...new Set(raw.map((m) => String(m?.id || m || '').trim()).filter(Boolean))].slice(0, 40)
}

function normalizeUrl(input, protocol) {
  const fallback = protocol === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'
  const value = String(input || fallback).trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(value)) throw new Error('base URL must start with http:// or https://')
  return value
}

function publicConnection(c) {
  return {
    id: c.id,
    providerId: c.providerId || '',
    name: c.name,
    protocol: c.protocol,
    baseUrl: c.baseUrl,
    models: [...c.models],
    defaultModel: c.defaultModel || c.models[0] || '',
    hasKey: !!c.apiKey,
    keyHint: c.apiKey ? `••••${String(c.apiKey).length >= 8 ? String(c.apiKey).slice(-4) : ''}` : '',
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    agentId: `api-${c.id}`,
  }
}

export class ConnectionStore {
  constructor(file = CONNECTIONS_FILE) {
    this.file = file
    this.data = { version: 1, connections: [] }
    this.load()
  }

  load() {
    try {
      if (!existsSync(this.file)) return this
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      if (parsed && Array.isArray(parsed.connections)) {
        this.data = { version: 1, connections: parsed.connections.filter((c) => c && c.id && c.name && c.apiKey) }
      }
    } catch {
      this.data = { version: 1, connections: [] }
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

  list() {
    return this.data.connections.map(publicConnection)
  }

  raw(id) {
    return this.data.connections.find((c) => c.id === id) || null
  }

  upsert(input = {}) {
    const id = input.id ? String(input.id) : ''
    const existing = id ? this.raw(id) : null
    const preset = input.providerId ? providerById(input.providerId) : null
    if (input.providerId && !preset) throw new Error(`unknown provider ${input.providerId}`)
    const switching = !!preset && preset.id !== existing?.providerId
    const name = String(input.name || (switching ? preset.name : existing?.name) || preset?.name || '').trim().slice(0, 80)
    if (!name) throw new Error('connection name is required')
    const protocol = PROTOCOLS.has(input.protocol)
      ? input.protocol
      : switching ? preset.protocol : existing?.protocol || preset?.protocol || 'openai'
    const baseUrl = normalizeUrl(
      input.baseUrl || (switching ? preset.baseUrl : existing?.baseUrl || preset?.baseUrl),
      protocol,
    )
    const suppliedModels = normalizeModels(input.models)
    const models = suppliedModels.length
      ? suppliedModels
      : switching ? [...preset.models] : existing?.models?.length ? existing.models : preset ? [...preset.models] : []
    if (!models.length) throw new Error('add at least one model id')
    const suppliedKey = String(input.apiKey || '').trim()
    const apiKey = suppliedKey || existing?.apiKey || ''
    if (!apiKey) throw new Error('API key is required')
    const now = new Date().toISOString()
    const rec = {
      id: existing?.id || rid(),
      providerId: preset?.id || (input.providerId === '' ? '' : existing?.providerId || ''),
      name,
      protocol,
      baseUrl,
      apiKey,
      models,
      defaultModel: models.includes(input.defaultModel)
        ? input.defaultModel
        : existing && !switching && models.includes(existing.defaultModel) ? existing.defaultModel : models[0],
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      slug: slug(name) || 'api',
    }
    if (existing) this.data.connections = this.data.connections.map((c) => (c.id === rec.id ? rec : c))
    else this.data.connections.push(rec)
    this.save()
    return publicConnection(rec)
  }

  remove(id) {
    const before = this.data.connections.length
    this.data.connections = this.data.connections.filter((c) => c.id !== id)
    if (this.data.connections.length === before) return false
    this.save()
    return true
  }

  // Merge connected models into the in-memory config. Raw keys live only in
  // cfg.agents, never in an API response.
  apply(cfg) {
    cfg.agents = (cfg.agents || []).filter((a) => !a.connectionId)
    const conns = this.data.connections
    for (const c of conns) {
      const id = `api-${c.id}`
      cfg.agents.push({
        id,
        label: c.name,
        connectionId: c.id,
        transport: 'http',
        protocol: c.protocol,
        baseUrl: c.baseUrl,
        apiKey: c.apiKey,
        model: c.defaultModel || c.models[0],
        models: [...c.models],
        caps: `connected ${c.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible'} API · ${c.models.length} model${c.models.length === 1 ? '' : 's'}`,
        defaultFor: [],
        timeoutMin: 8,
        quota: { limit: 0, window: 'day' },
      })
    }
    // Remove stale ids from roles, then make connected models available to the
    // normal chat/build resolution. Explicit model picks still win through the
    // modelAgent hint on /api/plan and /api/orchestrate.
    const ids = new Set(cfg.agents.map((a) => a.id))
    for (const [role, list] of Object.entries(cfg.roles || {})) {
      cfg.roles[role] = [...new Set((list || []).filter((id) => ids.has(id)))]
    }
    for (const c of conns) {
      for (const role of ['chat', 'build']) {
        if (!cfg.roles[role]) cfg.roles[role] = []
        if (!cfg.roles[role].includes(`api-${c.id}`)) cfg.roles[role].push(`api-${c.id}`)
      }
    }
    return cfg
  }
}

export const connections = new ConnectionStore()
