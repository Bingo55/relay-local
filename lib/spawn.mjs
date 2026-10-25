// Spawns a CLI agent and normalises its output. The only place that knows
// about Windows shims, ANSI, timeouts and process-tree kills.
import crossSpawn from 'cross-spawn'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { registry } from './registry.mjs'

const ANSI = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g
export const stripAnsi = (s) => s.replace(ANSI, '')

// Windows caps a command line at ~8k chars; long prompts go through a file.
const ARG_LIMIT = 6000

function withPrompt(args, prompt) {
  if (args.includes('{prompt}')) return args.map((a) => (a === '{prompt}' ? prompt : a))
  return [...args, prompt]
}

// Resume flags are inserted where the adapter puts {resume}, so agents with a
// positional -p (agy) keep their prompt last. Without a placeholder they go first.
function resumeArgs(agent, resume) {
  const r = agent.resume
  if (!r || !resume?.id) return []
  const flag = resume.isNew ? (r.newFlag || r.flag) : (r.resumeFlag || r.flag)
  return flag ? [flag, resume.id] : []
}

export function buildInvocation(agent, prompt, { promptFile, resume, extraArgs = [] } = {}) {
  let args = [...(agent.args || []), ...extraArgs]
  const flags = resumeArgs(agent, resume)
  args = args.includes('{resume}')
    ? args.flatMap((a) => (a === '{resume}' ? flags : [a]))
    : [...args, ...flags]
  const delivery = agent.delivery || 'arg'

  if (delivery === 'stdin') return { args, stdin: prompt }

  if (delivery === 'file' || (delivery === 'arg' && prompt.length > ARG_LIMIT)) {
    if (!promptFile) throw new Error(`${agent.id}: prompt is too long for argv and no promptFile was given`)
    writeFileSync(promptFile, prompt, 'utf8')
    const note = `Read the file ${promptFile} and follow the instructions in it exactly. Do not summarise the file, execute it.`
    return { args: withPrompt(args, note), stdin: null }
  }

  return { args: withPrompt(args, prompt), stdin: null }
}

export function killTree(pid) {
  if (!pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
  } else {
    try { process.kill(-pid, 'SIGKILL') } catch { try { process.kill(pid, 'SIGKILL') } catch {} }
  }
}

// Connected API models use a small HTTP transport instead of a CLI. Both
// OpenAI-compatible and Anthropic Messages endpoints are supported; streaming
// text is fed back through the same onText callback as a spawned CLI.
const defaultBase = (protocol) => protocol === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'

function apiUrl(agent) {
  const protocol = agent.protocol === 'anthropic' ? 'anthropic' : 'openai'
  const base = String(agent.baseUrl || defaultBase(protocol)).replace(/\/+$/, '')
  if (protocol === 'anthropic') {
    if (/\/messages$/i.test(base)) return base
    if (/\/v\d+[a-z]*$/i.test(base)) return `${base}/messages`
    return `${base}/v1/messages`
  }
  if (/\/chat\/completions$/i.test(base)) return base
  // Most compatible providers give a versioned base (.../v1, /v1beta,
  // /openai/v1). A bare host or an unversioned root gets /v1/chat/completions.
  if (/\/v\d+[a-z]*(\/|$)/i.test(base) || /\/openai$/i.test(base)) return `${base}/chat/completions`
  return `${base}/v1/chat/completions`
}

function streamPiece(protocol, obj) {
  if (!obj || typeof obj !== 'object') return ''
  if (protocol === 'anthropic') {
    if (obj.type === 'content_block_delta') return obj.delta?.text || ''
    if (obj.type === 'content_block_start') return obj.content_block?.text || ''
    return ''
  }
  const choice = obj.choices?.[0]
  const content = choice?.delta?.content ?? choice?.message?.content ?? choice?.text
  if (Array.isArray(content)) return content.map((c) => c?.text || '').join('')
  return typeof content === 'string' ? content : ''
}

async function readHttpResponse(res, agent, state, onText) {
  const protocol = agent.protocol === 'anthropic' ? 'anthropic' : 'openai'
  const type = res.headers.get('content-type') || ''
  if (!type.includes('text/event-stream') || !res.body) {
    const data = await res.json().catch(() => null)
    if (data?.error) {
      const msg = String(data.error.message || data.error || 'provider error')
      state.err = agent.apiKey ? msg.split(agent.apiKey).join('[redacted]') : msg
    }
    const text = protocol === 'anthropic'
      ? (data?.content || []).map((c) => c?.text || '').join('')
      : streamPiece(protocol, data)
    if (text) {
      state.text = text
      onText(state.text)
    }
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const handle = (payload) => {
    if (!payload || payload === '[DONE]') return
    let obj
    try { obj = JSON.parse(payload) } catch { return }
    if (obj?.error) {
      const msg = String(obj.error.message || obj.error || 'provider error')
      state.err = agent.apiKey ? msg.split(agent.apiKey).join('[redacted]') : msg
      return
    }
    const piece = streamPiece(protocol, obj)
    if (!piece) return
    state.text += piece
    onText(state.text)
  }
  const handleBlock = (block) => {
    const payload = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n')
    handle(payload)
  }
  const drain = (flush = false) => {
    const parts = buf.split('\n\n')
    buf = parts.pop() || ''
    for (const block of parts) handleBlock(block)
    if (flush && buf.trim()) {
      handleBlock(buf)
      buf = ''
    }
  }
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    buf = buf.replace(/\r\n/g, '\n')
    drain()
  }
  buf += decoder.decode()
  buf = buf.replace(/\r\n/g, '\n')
  drain(true)
}

export function startHttpAgent(agent, prompt, opts = {}) {
  const startedAt = Date.now()
  const protocol = agent.protocol === 'anthropic' ? 'anthropic' : 'openai'
  const state = { id: opts.stepId || 'step', raw: '', text: '', err: '', exitCode: null, timedOut: false, stopped: false }
  const controller = new AbortController()
  const timeoutMs = (agent.timeoutMin || 8) * 60_000
  const timer = setTimeout(() => {
    state.timedOut = true
    controller.abort()
  }, timeoutMs)
  let lastEmit = 0
  const onText = (text) => {
    const now = Date.now()
    if (now - lastEmit < 90) return
    lastEmit = now
    opts.onText?.(text)
  }

  const done = (async () => {
    try {
      const url = apiUrl(agent)
      const headers = { 'content-type': 'application/json', accept: 'text/event-stream' }
      let body
      if (protocol === 'anthropic') {
        headers['x-api-key'] = agent.apiKey
        headers['anthropic-version'] = '2023-06-01'
        body = {
          model: agent.model || agent.models?.[0],
          max_tokens: agent.maxTokens || 4096,
          stream: true,
          messages: [{ role: 'user', content: prompt }],
        }
      } else {
        headers.authorization = `Bearer ${agent.apiKey}`
        body = {
          model: agent.model || agent.models?.[0],
          stream: true,
          messages: [{ role: 'user', content: prompt }],
        }
      }
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        const safe = agent.apiKey ? detail.split(agent.apiKey).join('[redacted]') : detail
        state.err = `HTTP ${res.status} ${res.statusText}${safe ? ` · ${safe.slice(0, 500)}` : ''}`.trim()
        state.exitCode = -1
        return {
          ...state,
          text: state.text.trim() || state.err,
          durationMs: Date.now() - startedAt,
          cmdline: `POST ${url}`,
        }
      }
      await readHttpResponse(res, agent, state, onText)
      onText(state.text)
      state.exitCode = state.err ? -1 : 0
    } catch (e) {
      state.err = state.timedOut ? 'request timed out' : (e?.name === 'AbortError' ? 'stopped' : String(e?.message || e))
      state.exitCode = state.timedOut ? -2 : state.stopped ? -3 : -1
    } finally {
      clearTimeout(timer)
    }
    return {
      ...state,
      text: state.text.trim() || state.err,
      durationMs: Date.now() - startedAt,
      cmdline: `POST ${apiUrl(agent)}`,
    }
  })()

  return {
    state,
    done,
    stop() {
      state.stopped = true
      controller.abort()
    },
  }
}

export function startAgent(agent, prompt, opts = {}) {
  if (agent.transport === 'http') return startHttpAgent(agent, prompt, opts)
  const startedAt = Date.now()
  const cwd = opts.cwd || process.cwd()
  const timeoutMs = (agent.timeoutMin || 30) * 60_000
  const state = { id: opts.stepId || 'step', raw: '', text: '', err: '', exitCode: null, timedOut: false, stopped: false }

  let inv
  try {
    const mcpFile = registry.writeMcpConfig(agent.id)
    const extraArgs = mcpFile && (agent.mcp === 'claude' || agent.id === 'claude')
      ? ['--mcp-config', mcpFile]
      : []
    const mcpServers = registry.forAgent(agent.id)
    inv = buildInvocation(agent, prompt, { promptFile: opts.promptFile, extraArgs })
    inv.env = {
      ...(mcpFile ? { RELAY_MCP_CONFIG: mcpFile } : {}),
      ...(mcpServers.length ? { RELAY_MCP_SERVERS: JSON.stringify(registry.mcpConfig(agent.id)?.mcpServers || {}) } : {}),
    }
  } catch (e) {
    return { done: Promise.resolve({ ...state, exitCode: -1, err: String(e.message) }), stop() {}, state }
  }

  let child
  try {
    child = crossSpawn(agent.cmd, inv.args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, ...(inv.env || {}), NO_COLOR: '1', FORCE_COLOR: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (e) {
    return { done: Promise.resolve({ ...state, exitCode: -1, err: String(e.message) }), stop() {}, state }
  }

  let lastEmit = 0
  const flush = (force = false) => {
    const now = Date.now()
    if (!force && now - lastEmit < 120) return
    lastEmit = now
    state.text = stripAnsi(state.raw)
    opts.onText?.(state.text)
  }

  const kick = setTimeout(() => {
    state.timedOut = true
    killTree(child.pid)
  }, timeoutMs)

  child.stdout?.on('data', (b) => { state.raw += b.toString(); flush() })
  child.stderr?.on('data', (b) => { state.err += b.toString(); flush() })
  child.on('error', (e) => { state.err += `\nspawn error: ${e.message}`; flush(true) })

  if (inv.stdin != null) {
    child.stdin?.on('error', () => {})
    child.stdin?.end(inv.stdin, 'utf8')
  } else {
    child.stdin?.end()
  }

  const done = new Promise((resolve) => {
    let settled = false
    const finish = (code) => {
      if (settled) return
      settled = true
      clearTimeout(kick)
      flush(true)
      state.exitCode = state.timedOut ? -2 : state.stopped ? -3 : (code ?? child.exitCode ?? -1)
      const out = state.text.trim()
      // Do not wait for stdout to close: an agent may leave a dev server (or
      // another long-lived child) holding the pipe after the agent itself exits.
      child.stdout?.removeAllListeners('data')
      child.stderr?.removeAllListeners('data')
      resolve({
        ...state,
        text: out || stripAnsi(state.err).trim(),
        durationMs: Date.now() - startedAt,
        cmdline: [agent.cmd, ...inv.args].join(' '),
      })
    }
    child.on('close', (code) => finish(code))
    child.on('exit', (code) => setTimeout(() => finish(code), 250))
    child.on('error', () => setTimeout(() => finish(-1), 50))
  })

  return {
    state,
    done,
    stop() {
      state.stopped = true
      killTree(child.pid)
    },
  }
}
