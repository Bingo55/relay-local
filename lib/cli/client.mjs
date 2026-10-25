// Thin HTTP + SSE client for Relay. The terminal client never reads sessions/
// or agents.json: everything comes from /api/bootstrap and /api/events.
import { spawn } from 'node:child_process'
import net from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
export const DEFAULT_URL = 'http://127.0.0.1:7777'
export const DEFAULT_PORT = 7777

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function normalizeBase(url) {
  let s = String(url || DEFAULT_URL).trim()
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`
  return s.replace(/\/+$/, '')
}

export function createClient({ baseUrl = DEFAULT_URL, debug = false } = {}) {
  const base = normalizeBase(baseUrl)
  let lastEventsError = null

  async function api(method, path, body, { timeout = 0, signal } = {}) {
    const init = {
      method,
      headers: { accept: 'application/json', 'cache-control': 'no-store' },
    }
    if (body !== undefined) {
      init.headers['content-type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    const signals = []
    if (timeout) signals.push(AbortSignal.timeout(timeout))
    if (signal) signals.push(signal)
    if (signals.length === 1) init.signal = signals[0]
    else if (signals.length > 1) init.signal = AbortSignal.any(signals)

    let res
    try {
      res = await fetch(base + path, init)
    } catch (e) {
      const timeoutHit = e?.name === 'TimeoutError' || e?.name === 'AbortError'
      const err = new Error(timeoutHit
        ? `Relay did not answer in time (${base}).`
        : `Relay is not reachable at ${base}.`)
      err.code = timeoutHit ? 'timeout' : 'unreachable'
      err.cause = e
      throw err
    }
    let text = ''
    try { text = await res.text() } catch (e) {
      const err = new Error(`The connection to Relay ended while reading ${path}.`)
      err.code = 'unreachable'
      err.cause = e
      throw err
    }
    let data = {}
    try { data = text ? JSON.parse(text) : {} } catch { data = { error: text.trim() || `HTTP ${res.status}` } }
    if (debug) process.stderr.write(`[relay] ${method} ${path} -> ${res.status}\n`)
    return { ok: res.ok, status: res.status, data }
  }

  async function health(timeout = 800) {
    try {
      const r = await api('GET', '/api/health', undefined, { timeout })
      return r.ok
    } catch {
      return false
    }
  }

  async function ensureServer({ noStart = false, quiet = false } = {}) {
    if (await health(800)) return false

    const u = new URL(base)
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80))
    const local = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname)
    const canStart = local && port === DEFAULT_PORT && !noStart

    if (await portOpen(u.hostname, port, 500)) {
      const err = new Error(`Port ${port} is being used by something that isn't answering. Close it, or start Relay yourself.`)
      err.code = 'port-busy'
      throw err
    }

    if (!canStart) {
      const err = new Error(noStart
        ? `Relay isn't running. Start it with: npm start`
        : `Relay isn't running at ${base}. Start it with: npm start`)
      err.code = 'down'
      throw err
    }

    if (!quiet) process.stderr.write("Relay isn't running. Starting it…\n")
    const bin = process.env.RELAY_NODE || 'node'
    let spawnError = null
    try {
      const child = spawn(bin, ['server.mjs'], {
        cwd: ROOT,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.once('error', (e) => { spawnError = e })
      child.unref()
    } catch (e) {
      spawnError = e
    }

    for (let i = 0; i < 48; i++) {
      await sleep(250)
      if (spawnError) break
      if (await health(500)) return true
    }

    const why = spawnError ? ` (${spawnError.message})` : ''
    const err = new Error(`Couldn't start Relay${why}. In a terminal, run:  cd ${ROOT}  then  npm start`)
    err.code = 'start-failed'
    throw err
  }

  function openEvents({ onEvent, onState, onOpen, onError } = {}) {
    const controller = new AbortController()
    let closed = false
    let openedOnce = false
    let attempt = null
    let resolveOpen
    let rejectOpen
    const openPromise = new Promise((resolve, reject) => {
      resolveOpen = resolve
      rejectOpen = reject
    })
    const openTimer = setTimeout(() => {
      if (!openedOnce) rejectOpen(new Error('Relay did not open the live stream in time.'))
    }, 2500)
    openPromise.catch(() => {})

    ;(async () => {
      let delay = 500
      while (!closed) {
        attempt = new AbortController()
        const abortAttempt = () => attempt.abort()
        controller.signal.addEventListener('abort', abortAttempt, { once: true })
        try {
          const res = await fetch(base + '/api/events', {
            signal: attempt.signal,
            headers: { accept: 'text/event-stream', 'cache-control': 'no-store' },
          })
          if (!res.ok || !res.body) throw new Error(`Live updates answered ${res.status}.`)
          if (!openedOnce) {
            openedOnce = true
            clearTimeout(openTimer)
            resolveOpen()
          }
          onState?.('open')
          onOpen?.()
          delay = 500

          const reader = res.body.getReader()
          const decoder = new TextDecoder('utf-8')
          const parser = createSseParser(onEvent)
          let lastByte = Date.now()
          const watchdog = setInterval(() => {
            if (Date.now() - lastByte > 60_000) attempt.abort()
          }, 5000)
          try {
            while (!closed) {
              const { value, done } = await reader.read()
              if (done) break
              lastByte = Date.now()
              parser.push(decoder.decode(value, { stream: true }))
            }
          } finally {
            clearInterval(watchdog)
          }
        } catch (e) {
          if (!closed) {
            lastEventsError = e
            onError?.(e)
          }
        } finally {
          controller.signal.removeEventListener('abort', abortAttempt)
        }
        if (closed) break
        onState?.('reconnecting')
        await sleep(delay)
        delay = Math.min(5000, delay * 2)
      }
      if (!openedOnce) {
        clearTimeout(openTimer)
        rejectOpen(lastEventsError || new Error('The live connection to Relay could not be opened.'))
      }
      if (!closed) onState?.('closed')
    })().catch((e) => {
      if (!openedOnce) rejectOpen(e)
    })

    return {
      close() {
        closed = true
        clearTimeout(openTimer)
        controller.abort()
        try { attempt?.abort() } catch {}
      },
      waitForOpen() { return openPromise },
    }
  }

  return { baseUrl: base, api, health, ensureServer, openEvents }
}

export function portOpen(host, port, timeout = 500) {
  return new Promise((resolve) => {
    let done = false
    const finish = (v) => {
      if (done) return
      done = true
      try { socket.destroy() } catch {}
      resolve(v)
    }
    const socket = net.connect({ host, port })
    socket.setTimeout(timeout, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

// Parse one SSE frame. Comments and unknown fields are ignored.
export function parseSseFrame(frame) {
  const data = []
  for (const rawLine of String(frame).split('\n')) {
    if (!rawLine || rawLine.startsWith(':')) continue
    const colon = rawLine.indexOf(':')
    const field = colon < 0 ? rawLine : rawLine.slice(0, colon)
    let value = colon < 0 ? '' : rawLine.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') data.push(value)
  }
  if (!data.length) return null
  try { return JSON.parse(data.join('\n')) } catch { return null }
}

// Incremental SSE parser: frames may split across network chunks.
export function createSseParser(onEvent) {
  let buf = ''
  return {
    push(chunk) {
      buf += String(chunk)
      // Normalize CRLF, but hold a trailing CR in case the LF is in the next chunk.
      buf = buf.replace(/\r\n/g, '\n').replace(/\r(?!$)/g, '\n')
      const events = []
      let cut
      while ((cut = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, cut)
        buf = buf.slice(cut + 2)
        const ev = parseSseFrame(frame)
        if (ev) { events.push(ev); onEvent?.(ev) }
      }
      return events
    },
    flush() {
      if (!buf.trim()) { buf = ''; return [] }
      const frame = buf
      buf = ''
      const ev = parseSseFrame(frame)
      if (!ev) return []
      onEvent?.(ev)
      return [ev]
    },
    get buffered() { return buf },
  }
}
