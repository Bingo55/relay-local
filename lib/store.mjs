// Sessions on disk. One JSON state file per session, raw stream logs beside it,
// so a run survives a closed browser and a crashed server.
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const rid = (p = 's') => `${p}_${randomUUID().slice(0, 8)}`

export class Store {
  constructor(root) {
    this.root = root
    mkdirSync(root, { recursive: true })
  }

  dir(id) {
    return join(this.root, id)
  }

  list() {
    return readdirSync(this.root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        try {
          const s = JSON.parse(readFileSync(join(this.root, d.name, 'state.json'), 'utf8'))
          const first = (s.messages.find((m) => m.role === 'user')?.text || '').replace(/\s+/g, ' ').trim().slice(0, 64)
          return { id: s.id, title: s.title && s.title !== 'Untitled run' ? s.title : (first || s.title), updatedAt: s.updatedAt, cwd: s.cwd, count: s.messages.length }
        } catch {
          return null
        }
      })
      .filter(Boolean)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  }

  create({ title, cwd, id } = {}) {
    const now = new Date().toISOString()
    const s = {
      id: id || rid('ses'),
      title: title || 'Untitled run',
      cwd: cwd || process.cwd(),
      createdAt: now,
      updatedAt: now,
      messages: [],
      pinned: [],
      notes: [],
    }
    mkdirSync(join(this.dir(s.id), 'steps'), { recursive: true })
    this.save(s)
    return s
  }

  get(id) {
    try {
      return JSON.parse(readFileSync(join(this.dir(id), 'state.json'), 'utf8'))
    } catch {
      return null
    }
  }

  save(s) {
    s.updatedAt = new Date().toISOString()
    mkdirSync(join(this.dir(s.id), 'steps'), { recursive: true })
    const target = join(this.dir(s.id), 'state.json')
    writeFileSync(`${target}.tmp`, JSON.stringify(s, null, 2), 'utf8')
    renameSync(`${target}.tmp`, target)
    return s
  }

  // Raw output while a step is running, so a crash still leaves evidence.
  appendLog(sessionId, stepId, chunk) {
    try {
      appendFileSync(join(this.dir(sessionId), 'steps', `${stepId}.log`), chunk, 'utf8')
    } catch {}
  }

  writePrompt(sessionId, stepId) {
    mkdirSync(join(this.dir(sessionId), 'steps'), { recursive: true })
    return join(this.dir(sessionId), 'steps', `${stepId}.prompt.md`)
  }

  activeId() {
    try {
      return readFileSync(join(this.root, '.active'), 'utf8').trim() || null
    } catch {
      return null
    }
  }

  setActive(id) {
    mkdirSync(this.root, { recursive: true })
    writeFileSync(join(this.root, '.active'), id, 'utf8')
  }

  remove(id) {
    rmSync(this.dir(id), { recursive: true, force: true })
  }
}

// One process, one loudspeaker. Everything the UI needs arrives over SSE.
export class Bus {
  constructor() {
    this.clients = new Set()
  }
  add(res) {
    this.clients.add(res)
    return () => this.clients.delete(res)
  }
  emit(event) {
    const frame = `data: ${JSON.stringify(event)}\n\n`
    for (const c of this.clients) {
      try {
        c.write(frame)
      } catch {
        this.clients.delete(c)
      }
    }
  }
}

export { rid }
