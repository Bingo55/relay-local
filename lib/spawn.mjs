// Spawns a CLI agent and normalises its output. The only place that knows
// about Windows shims, ANSI, timeouts and process-tree kills.
import crossSpawn from 'cross-spawn'
import { execFile, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve as resolvePath, sep as pathSep } from 'node:path'
import { promisify } from 'node:util'
import { registry } from './registry.mjs'

const execFileP = promisify(execFile)

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
  const responses = agent.apiStyle === 'responses'
  const protocol = agent.protocol === 'anthropic' ? 'anthropic' : 'openai'
  const base = String(agent.baseUrl || defaultBase(protocol)).replace(/\/+$/, '')
  if (protocol === 'anthropic') {
    if (/\/messages$/i.test(base)) return base
    if (/\/v\d+[a-z]*$/i.test(base)) return `${base}/messages`
    return `${base}/v1/messages`
  }
  if (responses && /\/responses$/i.test(base)) return base
  if (responses) {
    if (/\/v\d+[a-z]*(\/|$)/i.test(base) || /\/openai$/i.test(base)) return `${base}/responses`
    return `${base}/v1/responses`
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
  // OpenAI Responses API: streamed text deltas and full non-stream payloads.
  if (obj.type === 'response.output_text.delta') return obj.delta || ''
  if (obj.object === 'response' && Array.isArray(obj.output)) {
    return obj.output.map((item) => (item?.content || [])).flat()
      .map((c) => (c?.type === 'output_text' ? c.text || '' : '')).join('')
  }
  return typeof content === 'string' ? content : ''
}

// Connected HTTP agents can opt into tool use (`tools: true` on the
// connection record). That gives them the same primitive loop a spawned CLI
// runs inside its own binary: run a command, read or write a file, look at
// the result, continue. Everything is rooted at the session folder the plan
// was started in, which is the same trust level the CLI agents already have.
const TOOL_RESULT_CAP = 8000
const TOOL_FILE_CAP = 20_000

function httpToolDefs(apiStyle) {
  const shape = {
    run_shell: {
      description: 'Run a shell command inside the project directory and return combined stdout/stderr.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: { command: { type: 'string' }, timeout_s: { type: 'number' } },
        required: ['command'],
      },
    },
    read_file: {
      description: 'Read a UTF-8 text file relative to the project directory.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
    write_file: {
      description: 'Create or overwrite a UTF-8 text file relative to the project directory.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
    },
  }
  if (apiStyle === 'responses') {
    return Object.entries(shape).map(([name, t]) => ({ type: 'function', name, ...t }))
  }
  return Object.entries(shape).map(([name, t]) => ({ type: 'function', function: { name, ...t } }))
}

function containedPath(cwd, supplied) {
  const root = resolvePath(cwd)
  const abs = resolvePath(root, String(supplied || ''))
  if (abs === root || abs.startsWith(root + pathSep)) return abs
  return null
}

async function execToolCall(call, cwd) {
  let args = {}
  try { args = JSON.parse(call.arguments || '{}') || {} } catch (e) {
    return JSON.stringify({ error: `unparsable arguments: ${e.message}` })
  }
  const done = (v) => clipTool(v)
  try {
    if (call.name === 'run_shell') {
      const timeout = Math.min(Math.max(Number(args.timeout_s) || 60, 1), 600) * 1000
      const win = process.platform === 'win32'
      const bin = win ? process.env.ComSpec || 'cmd.exe' : '/bin/sh'
      const cargs = win ? ['/d', '/s', '/c', String(args.command || '')] : ['-c', String(args.command || '')]
      const out = await execFileP(bin, cargs, { cwd, timeout, windowsHide: true, maxBuffer: 1 << 20 })
      let text = String(out.stdout || '')
      if (out.stderr) text += `\n[stderr]\n${out.stderr}`
      return done(text)
    }
    if (call.name === 'read_file') {
      const abs = containedPath(cwd, args.path)
      if (!abs) return JSON.stringify({ error: 'path is outside the project directory' })
      const buf = readFileSync(abs, 'utf8')
      return done(buf.length > TOOL_FILE_CAP ? `${buf.slice(0, TOOL_FILE_CAP)}\n…[truncated ${buf.length - TOOL_FILE_CAP} chars]` : buf)
    }
    if (call.name === 'write_file') {
      const abs = containedPath(cwd, args.path)
      if (!abs) return JSON.stringify({ error: 'path is outside the project directory' })
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, String(args.content ?? ''), 'utf8')
      return JSON.stringify({ ok: true, path: abs, bytes: Buffer.byteLength(String(args.content ?? ''), 'utf8') })
    }
    return JSON.stringify({ error: `unknown tool ${call.name}` })
  } catch (e) {
    let detail = e?.stdout || ''
    if (e?.stderr) detail += (detail ? '\n[stderr]\n' : '') + e.stderr
    return done(`error${e?.code != null ? ` (exit ${e.code})` : ''}: ${e?.message || e}${detail ? `\n${detail}` : ''}`)
  }
}

function clipTool(s, n = TOOL_RESULT_CAP) {
  s = String(s ?? '')
  return s.length > n ? `${s.slice(0, n)}\n…[truncated ${s.length - n} chars]` : s
}

// Pull function-call requests out of one SSE payload or one full JSON body.
// `sink` accumulates across a whole round; chat-style calls may arrive split
// across deltas, so partial calls are merged by their stream index.
function collectToolCalls(protocol, obj, sink) {
  if (!obj || typeof obj !== 'object') return
  if (obj.response?.id) sink.responseId = obj.response.id
  const choice = obj.choices?.[0]
  const deltaCalls = choice?.delta?.tool_calls
  if (Array.isArray(deltaCalls)) {
    for (const tc of deltaCalls) {
      const i = Number(tc.index ?? 0)
      let call = sink.byIndex.get(i)
      if (!call) {
        call = { index: i, call_id: '', name: '', arguments: '' }
        sink.byIndex.set(i, call)
        sink.calls.push(call)
      }
      if (tc.id) call.call_id = tc.id
      if (tc.function?.name) call.name += tc.function.name
      if (tc.function?.arguments) call.arguments += tc.function.arguments
    }
  }
  const fullCalls = choice?.message?.tool_calls
  if (Array.isArray(fullCalls)) {
    for (const tc of fullCalls) {
      sink.calls.push({ index: sink.calls.length, call_id: tc.id || '', name: tc.function?.name || '', arguments: tc.function?.arguments ?? '' })
    }
  }
  const items = obj.type === 'response.output_item.done' && obj.item
    ? [obj.item]
    : obj.object === 'response' && Array.isArray(obj.output) ? obj.output : []
  for (const item of items) {
    if (item?.type !== 'function_call') continue
    if (sink.calls.some((c) => c.call_id && c.call_id === item.call_id)) continue
    sink.calls.push({ index: sink.calls.length, call_id: item.call_id || '', name: item.name || '', arguments: item.arguments || '' })
  }
}

async function readHttpResponse(res, agent, state, onText, sink = null) {
  const protocol = agent.protocol === 'anthropic' ? 'anthropic' : 'openai'
  const type = res.headers.get('content-type') || ''
  if (!type.includes('text/event-stream') || !res.body) {
    const data = await res.json().catch(() => null)
    if (data?.error) {
      const msg = String(data.error.message || data.error || 'provider error')
      state.err = agent.apiKey ? msg.split(agent.apiKey).join('[redacted]') : msg
    }
    if (sink) collectToolCalls(protocol, data, sink)
    const text = protocol === 'anthropic'
      ? (data?.content || []).map((c) => c?.text || '').join('')
      : streamPiece(protocol, data)
    if (text) {
      state.text = text
      onText(state.text)
    }
    return sink
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
    if (sink) collectToolCalls(protocol, obj, sink)
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
      if (agent.userAgent) headers['user-agent'] = agent.userAgent
      if (protocol === 'anthropic') {
        headers['x-api-key'] = agent.apiKey
        headers['anthropic-version'] = '2023-06-01'
      } else {
        headers.authorization = `Bearer ${agent.apiKey}`
      }

      const responses = protocol === 'openai' && agent.apiStyle === 'responses'
      const toolMode = !!opts.cwd && agent.tools === true && protocol !== 'anthropic'
      const defModel = agent.model || agent.models?.[0]
      const maxRounds = toolMode ? Math.max(1, Number(agent.maxToolRounds) || 6) : 1

      // Conversation memory for the tool loop. The responses style replays
      // the full item history every round (previous_response_id is not
      // reliably supported by proxies); chat style replays the message list.
      const chatMessages = protocol === 'openai' && !responses ? [{ role: 'user', content: prompt }] : []
      let replayItems = []
      let firstInput = prompt

      for (let round = 0; round < maxRounds; round++) {
        let body
        if (protocol === 'anthropic') {
          body = {
            model: defModel,
            max_tokens: agent.maxTokens || 4096,
            stream: true,
            messages: [{ role: 'user', content: prompt }],
          }
        } else if (responses) {
          body = {
            model: defModel,
            stream: true,
            input: round === 0 ? firstInput : replayItems,
            ...(toolMode ? { tools: httpToolDefs('responses') } : {}),
          }
        } else {
          body = {
            model: defModel,
            stream: true,
            messages: chatMessages,
          }
          if (toolMode) body.tools = httpToolDefs('openai')
        }

        const sink = { calls: [], byIndex: new Map(), responseId: null }
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
        await readHttpResponse(res, agent, state, onText, sink)
        if (!sink.calls.length) break

        // Execute the requested tools, then hand the outputs back.
        const executed = []
        for (const call of sink.calls) {
          const output = opts.stopped?.() ? 'stopped' : await execToolCall(call, opts.cwd)
          executed.push({ call_id: call.call_id, name: call.name, arguments: call.arguments, output })
          if (state.stopped) break
        }
        if (state.stopped) break

        if (responses) {
          replayItems = [
            ...replayItems,
            ...(round === 0 ? [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] }] : []),
            ...executed.map((r) => ({ type: 'function_call', call_id: r.call_id, name: r.name, arguments: r.arguments })),
            ...executed.map((r) => ({ type: 'function_call_output', call_id: r.call_id, output: r.output })),
          ]
        } else {
          chatMessages.push({
            role: 'assistant',
            content: null,
            tool_calls: executed.map((r) => ({
              id: r.call_id || `call_${r.name}_${round}`,
              type: 'function',
              function: { name: r.name, arguments: r.arguments || '{}' },
            })),
          })
          for (const r of executed) chatMessages.push({ role: 'tool', tool_call_id: r.call_id || `call_${r.name}_${round}`, content: r.output })
        }
      }
      onText(state.text)
      state.exitCode = state.err ? -1 : 0
    } catch (e) {
      const cause = e?.cause?.code || e?.cause?.message || ''
      const message = [String(e?.message || e), cause].filter(Boolean).join(' · ')
      state.err = state.timedOut ? 'request timed out' : (e?.name === 'AbortError' ? 'stopped' : message)
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
