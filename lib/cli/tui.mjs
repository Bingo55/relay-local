// Hand-rolled full-screen view. ANSI only; no TUI dependency.
import { StringDecoder } from 'node:string_decoder'
import { statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  createColors, detectColorDepth, COPY, displayWidth, sliceByWidth, cellToIndex,
  wrapText, truncate, truncateAnsi, padTo, centerLine, twoSides, formatDuration,
  statusLabel, stepStatusText, fallbackText, planLines, summaryLines, summarySentence,
  sessionLines, statusLines, modelLines, agentLines, instructorLines, quotaLines, agentLabel,
  changedFiles, parsePorcelainLine, normalizeText, relTime, timeOf, instructorName,
  sessionChanged, unknownCommand,
} from './format.mjs'
import {
  createState, applyBootstrap, applyEvent, lastRunGroup, summarizeGroup, lastRunSummary,
  lastPlan, waitForRun, hasRunningBtw, messagesOf,
} from './state.mjs'
import { renderMarkdown } from './markdown.mjs'
import { filterPalette, paletteWindow } from './palette.mjs'

const REPL_COMMANDS = [
  '/help', '/new', '/rm', '/sessions', '/use', '/status', '/btw', '/stop',
  '/model', '/models', '/agents', '/quota', '/instructor', '/cwd', '/rename', '/plan',
  '/chain', '/direct', '/pin', '/export', '/clear', '/palette', '/sidebar',
  '/quit', '/exit',
]

const COMMAND_HELP = {
  '/help': 'keys and commands',
  '/new': 'start a new chat',
  '/rm': 'delete a chat',
  '/sessions': 'switch chats',
  '/use': 'switch to a chat',
  '/status': 'show Relay status',
  '/btw': 'ask a side question',
  '/stop': 'stop the active run',
  '/model': 'choose a model',
  '/models': 'list model refs',
  '/agents': 'list assistants',
  '/quota': 'quota meter and next route',
  '/instructor': 'choose a planner',
  '/cwd': 'show or change folder',
  '/rename': 'rename this chat',
  '/plan': 'plan only',
  '/chain': 'manual assistant chain',
  '/direct': 'one assistant, no plan',
  '/pin': 'pin a step in the export',
  '/export': 'write this chat as JSON',
  '/clear': 'clear the screen cache',
  '/palette': 'open the command palette',
  '/sidebar': 'show or hide the sidebar',
  '/quit': 'quit when idle',
  '/exit': 'quit when idle',
}

let terminalRestored = true

export function enterTerminal({ mouse = true } = {}) {
  terminalRestored = false
  try { process.stdin.setRawMode(true) } catch {}
  process.stdin.resume()
  let s = '\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l\x1b[?2004h'
  if (mouse) s += '\x1b[?1000h\x1b[?1006h'
  process.stdout.write(s)
}

export function restoreTerminal() {
  if (terminalRestored) return
  terminalRestored = true
  try {
    process.stdout.write('\x1b[?1006l\x1b[?1000l\x1b[?2004l\x1b[?25h\x1b[?1049l')
  } catch {}
  try { if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(false) } catch {}
}

// Display width helpers used by the composer and the self-tests.
export function windowInputLine(line, caretCol, width) {
  const total = displayWidth(line)
  if (width <= 0) return { text: '', caret: 0, start: 0, prefix: false, suffix: false }
  if (total <= width) return { text: line, caret: Math.min(caretCol, total), start: 0, prefix: false, suffix: false }
  let start = 0
  if (caretCol > width - 1) start = Math.max(0, caretCol - (width - 2))
  const prefix = start > 0
  let avail = width - (prefix ? 1 : 0)
  const hasRight = total > start + avail
  if (hasRight) avail -= 1
  const text = sliceByWidth(line, start, avail)
  const caret = (prefix ? 1 : 0) + Math.max(0, Math.min(caretCol - start, avail))
  return { text: `${prefix ? '…' : ''}${text}${hasRight ? '…' : ''}`, caret, start, prefix, suffix: hasRight }
}

export function caretCell(input, caret, width = Infinity) {
  const before = String(input).slice(0, caret)
  const lineIndex = (before.match(/\n/g) || []).length
  const lineStart = before.lastIndexOf('\n') + 1
  const line = String(input).slice(lineStart).split('\n')[0]
  const column = displayWidth(line.slice(0, caret - lineStart))
  const win = windowInputLine(line, column, width)
  return { lineIndex, column, windowStart: win.start, caretColumn: win.caret }
}

export function composerWindow(input, caret, width, maxLines = 6) {
  const all = String(input).split('\n')
  const before = String(input).slice(0, caret)
  const caretLine = (before.match(/\n/g) || []).length
  let start = 0
  if (caretLine >= maxLines) start = caretLine - maxLines + 1
  const lineStart = before.lastIndexOf('\n') + 1
  const line = all[caretLine] ?? ''
  const column = displayWidth(line.slice(0, caret - lineStart))
  const win = windowInputLine(line, column, width)
  return {
    lines: all.slice(start, start + maxLines),
    caretLine: caretLine - start,
    caretColumn: win.caret,
    start,
    lineWindow: win,
    totalLines: all.length,
  }
}

const ANSI_RESET = '\x1b[0m'

export async function runTui({ client, state, flags }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    process.stderr.write(COPY.noTui + '\n')
    return 2
  }
  const tui = new Tui({ client, state, flags })
  try {
    return await tui.run()
  } finally {
    restoreTerminal()
  }
}

export class Tui {
  constructor({ client, state, flags }) {
    this.client = client
    this.state = state
    this.flags = flags
    this.c = createColors({ enabled: !flags.noColor && detectColorDepth() !== 1 })
    this.C = process.stdout.columns || 80
    this.R = process.stdout.rows || 24
    this.input = ''
    this.caret = 0
    this.history = []
    this.histIndex = -1
    this.historyDraft = ''
    this.scrollOffset = 0
    this.follow = true
    this.sidebar = true
    this.overlay = null
    this.pendingPlanId = null
    this.planning = false
    this.planStartedAt = 0
    this.planToken = 0
    this.running = false
    this.runStartedAt = 0
    this.toast = ''
    this.toastAt = 0
    this.connected = true
    this.reconnecting = false
    this.everOpened = false
    this.restarted = false
    this.cache = new Map()
    this.lastMaxOffset = 0
    this.lastTranscript = []
    this.frameTimer = null
    this.resizeTimer = null
    this.toastTimer = null
    this.closing = false
    this.done = false
    this.decoder = new StringDecoder('utf8')
    this.keyBuf = ''
    this.escTimer = null
    this.paste = null
    this.abort = new AbortController()
    this.sse = null
    this.resolve = null
    this.lastCtrlC = 0
    this.quitHintAt = 0
    this.inputScroll = 0
    this.lastInputTop = 0
    this.lastInputLines = 1
    this.lastOverlay = null
    this.lastFrameAt = 0
    this.tiny = false
    this.signalHandlers = null
  }

  setToast(text, ms = 5000) {
    this.toast = normalizeText(String(text || ''))
    this.toastAt = Date.now()
    if (this.toastTimer) clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => { this.toast = ''; this.requestRender(0) }, ms)
    this.requestRender(0)
  }

  async run() {
    enterTerminal({ mouse: !this.flags.noMouse })
    this.installHandlers()
    this.elapsedTimer = setInterval(() => {
      if (this.planning || this.running || this.state.busy) this.requestRender(0)
      if (this.toast && Date.now() - this.toastAt > 5000) this.toast = ''
    }, 1000)

    this.sse = this.client.openEvents({
      onEvent: (ev) => this.onEvent(ev),
      onState: (s) => this.onStreamState(s),
      onOpen: () => this.onStreamOpen(),
    })
    try {
      await this.sse.waitForOpen()
    } catch (e) {
      this.sse?.close()
      this.cleanup()
      restoreTerminal()
      process.stderr.write((e?.message || String(e)) + '\n')
      return 3
    }
    this.requestRender(0)
    return await new Promise((resolve) => { this.resolve = resolve })
  }

  installHandlers() {
    this.onData = (buf) => this.handleData(buf)
    this.onResize = () => {
      if (this.resizeTimer) clearTimeout(this.resizeTimer)
      this.resizeTimer = setTimeout(() => {
        this.C = process.stdout.columns || 80
        this.R = process.stdout.rows || 24
        this.cache.clear()
        this.requestRender(0)
      }, 50)
    }
    this.onSignal = (sig) => {
      if (this.closing) return
      this.closing = true
      this.cleanup()
      restoreTerminal()
      process.exit(sig === 'SIGINT' ? 130 : 143)
    }
    this.onExit = () => restoreTerminal()
    this.onFatal = (e) => {
      this.cleanup()
      restoreTerminal()
      process.stderr.write((e?.stack || String(e)) + '\n')
      process.exit(1)
    }
    process.stdin.on('data', this.onData)
    process.stdout.on('resize', this.onResize)
    process.on('SIGINT', this.onSignal)
    process.on('SIGTERM', this.onSignal)
    process.on('SIGHUP', this.onSignal)
    process.on('exit', this.onExit)
    process.on('uncaughtException', this.onFatal)
    process.on('unhandledRejection', this.onFatal)
    this.signalHandlers = true
  }

  cleanup() {
    if (this.frameTimer) clearTimeout(this.frameTimer)
    if (this.resizeTimer) clearTimeout(this.resizeTimer)
    if (this.toastTimer) clearTimeout(this.toastTimer)
    if (this.escTimer) clearTimeout(this.escTimer)
    if (this.elapsedTimer) clearInterval(this.elapsedTimer)
    this.abort.abort()
    try { this.sse?.close() } catch {}
    process.stdin.off('data', this.onData)
    process.stdout.off('resize', this.onResize)
    process.off('SIGINT', this.onSignal)
    process.off('SIGTERM', this.onSignal)
    process.off('SIGHUP', this.onSignal)
    process.off('exit', this.onExit)
    process.off('uncaughtException', this.onFatal)
    process.off('unhandledRejection', this.onFatal)
  }

  finish(code = 0) {
    if (this.done) return
    this.done = true
    this.closing = true
    this.cleanup()
    restoreTerminal()
    this.resolve?.(code)
  }

  requestRender(delay = 16) {
    if (this.done) return
    if (this.frameTimer) {
      if (delay === 0) { clearTimeout(this.frameTimer); this.frameTimer = null }
      else return
    }
    this.frameTimer = setTimeout(() => {
      this.frameTimer = null
      try { this.render() } catch (e) {
        this.setToast(`Display error: ${e.message}`, 8000)
      }
    }, delay)
  }

  render() {
    if (this.done) return
    const C = this.C = process.stdout.columns || this.C || 80
    const R = this.R = process.stdout.rows || this.R || 24
    this.tiny = C < 40 || R < 12
    if (this.tiny) {
      this.drawTiny(C, R)
      return
    }
    const header = this.headerLines(C)
    const composer = this.composerLines(C)
    const inputLines = this.composerInputLineCount()
    const hh = header.length
    const compH = composer.length
    const bodyH = Math.max(1, R - hh - compH)
    const body = this.bodyLines(C, bodyH)
    let lines = [...header, ...body, ...composer]
    if (lines.length > R) lines = lines.slice(0, R)
    while (lines.length < R) lines.push('')
    this.lastLayout = {
      hh, bodyH, inputTop: hh + bodyH + 2 + (this.suggestCount || 0),
      inputCount: this.composerInputLineCount(),
      data: this.pendingPlanId ? null : this.composerData(C),
    }
    this.writeFrame(lines, C, R, bodyH, hh, inputLines)
  }

  drawTiny(C, R) {
    const msg = COPY.tuiTooSmall
    const lines = []
    const top = Math.max(0, Math.floor(R / 2) - 1)
    for (let i = 0; i < R; i++) {
      if (i === top + 1) lines.push(centerLine(truncate(msg, C), C))
      else lines.push('')
    }
    process.stdout.write('\x1b[?2026h\x1b[?25l')
    for (let i = 0; i < R; i++) {
      process.stdout.write(`\x1b[${i + 1};1H${padTo(lines[i] || '', C)}\x1b[K`)
    }
    process.stdout.write('\x1b[?25l\x1b[?2026l')
  }

  writeFrame(lines, C, R, bodyH, hh, inputLines) {
    const showCaret = !this.overlay && !this.tiny && !this.pendingPlanId
    let caretRow = 0
    let caretCol = 0
    if (showCaret) {
      const data = this.composerData(C)
      caretRow = hh + bodyH + 2 + (this.suggestCount || 0) + data.caretLine
      caretCol = 7 + data.caretColumn
      caretRow = Math.max(1, Math.min(R, caretRow))
      caretCol = Math.max(1, Math.min(C, caretCol))
    }
    let out = '\x1b[?2026h\x1b[?25l'
    for (let i = 0; i < R; i++) {
      out += `\x1b[${i + 1};1H${padTo(lines[i] || '', C)}\x1b[K`
    }
    if (showCaret) out += `\x1b[${caretRow};${caretCol}H\x1b[?25h`
    else out += '\x1b[?25l'
    out += '\x1b[?2026l'
    process.stdout.write(out)
  }

  statusText() {
    const c = this.c
    if (this.reconnecting || !this.connected) return c.red('● reconnecting')
    if (this.pendingPlanId) return c.yellow('● plan ready')
    if (this.planning) return c.yellow(`● thinking ${formatDuration(Date.now() - this.planStartedAt)}`)
    if (this.running || this.state.busy) {
      const started = this.runStartedAt || this.planStartedAt || 0
      return c.yellow(`● working ${formatDuration(started ? Date.now() - started : 0)}`)
    }
    if (hasRunningBtw(this.state)) return c.yellow('● side answer')
    return c.green('● ready')
  }

  modelLabel() {
    return this.state.model || 'default model'
  }

  sidebarVisible() {
    return this.sidebar && this.C >= 88 && this.R >= 20 && !this.overlay
  }

  toggleSidebar() {
    this.sidebar = !this.sidebar
    if (this.sidebar && (this.C < 88 || this.R < 20)) {
      this.setToast('The sidebar needs a window of at least 88 × 20.')
      return
    }
    this.requestRender(0)
  }

  headerLines(C) {
    const c = this.c
    const title = truncate(normalizeText(this.state.session?.title || 'no chat'), Math.max(12, C - (C >= 100 ? 58 : 38)))
    const left = ` ${c.bold(c.brand('RELAY'))} ${c.dim('·')} ${c.white(title)}`
    const model = truncate(normalizeText(this.modelLabel()), C >= 100 ? 32 : 18)
    const right = C >= 72 ? `${c.dim(model)}  ${this.statusText()}` : this.statusText()
    const lines = [twoSides(left, right, C)]
    if (this.R >= 18) {
      const folder = ` ${c.dim('folder')} ${truncate(normalizeText(this.state.session?.cwd || 'not set'), Math.max(10, C - 44))}`
      const plan = lastPlan(this.state)
      const steps = plan?.steps?.length || 0
      const planner = this.state.session?.instructor ? instructorName(this.state, this.state.session.instructor) : 'auto'
      const extra = C >= 110 ? ` ${c.dim('·')} ${c.dim(`planner ${truncate(normalizeText(planner), 16)}`)}` : ''
      const meta = ` ${c.dim(`${(this.state.sessions || []).length} chats`)} ${c.dim('·')} ${c.dim(`${steps} steps`)}${extra}`
      lines.push(twoSides(folder, meta, C))
    }
    if (this.reconnecting || !this.connected) {
      lines.push(c.red(truncate(COPY.disconnected, C - 2)))
    }
    return lines
  }

  composerInputLineCount() {
    if (this.pendingPlanId) return 1
    return Math.min(6, Math.max(1, this.input.split('\n').length))
  }

  composerData(C) {
    const width = Math.max(1, C - 8)
    const data = composerWindow(this.input, this.caret, width, 6)
    data.width = width
    return data
  }

  composerLines(C) {
    const c = this.c
    const lines = []
    const suggestions = this.pendingPlanId || this.overlay ? [] : this.slashSuggestions()
    this.suggestCount = suggestions.length
    for (let i = 0; i < suggestions.length; i++) {
      const s = suggestions[i]
      const name = padTo(s.cmd, Math.min(12, Math.max(6, C - 16)))
      const desc = truncate(s.help, Math.max(4, C - displayWidth(name) - 5))
      lines.push('  ' + (i === 0 ? c.brand('▸ ') : '  ') + c.cyan(name) + c.dim(desc))
    }
    const topLabel = ` ${this.pendingPlanId ? 'plan ready' : 'message'} `
    const topDashes = Math.max(0, C - 5 - displayWidth(topLabel))
    lines.push('  ' + c.dim('╭─') + c.dim(topLabel) + c.dim('─'.repeat(topDashes) + '╮'))

    if (this.pendingPlanId) {
      const plan = messagesOf(this.state).find((m) => m.id === this.pendingPlanId && m.role === 'plan')
      const steps = plan?.steps?.length || 0
      const task = truncate(normalizeText(String(plan?.task || '')).replace(/\s+/g, ' '), Math.max(6, C - 28))
      const width = Math.max(4, C - 6)
      lines.push('  ' + c.dim('│ ') + padTo(c.white(`${steps} step${steps === 1 ? '' : 's'} · ${task || 'ready to run'}`), width) + c.dim(' │'))
      lines.push('  ' + c.dim('│ ') + padTo(c.yellow('Enter') + c.dim(' run   ·   ') + c.yellow('s') + c.dim(' skip   ·   ') + c.dim('Ctrl+C cancel'), width) + c.dim(' │'))
      lines.push('  ' + c.dim('╰' + '─'.repeat(Math.max(2, C - 4)) + '╯'))
      lines.push(' ' + c.dim('Review the plan above. Nothing runs until you choose.'))
      return lines
    }

    const data = this.composerData(C)
    const inputCount = this.composerInputLineCount()
    for (let i = 0; i < inputCount; i++) {
      const idx = data.start + i
      const raw = data.lines[i] ?? ''
      let text
      if (this.input === '' && i === 0) {
        text = c.dim('Ask anything…  / for commands')
      } else if (idx === data.start + data.caretLine) {
        text = data.lineWindow.text
      } else {
        const win = windowInputLine(raw, Infinity, data.width)
        text = win.text
      }
      lines.push('  ' + c.dim('│') + ' ' + (i === 0 ? c.brand('▸') : ' ') + ' ' + padTo(text, data.width) + ' ' + c.dim('│'))
    }
    lines.push('  ' + c.dim('╰' + '─'.repeat(Math.max(2, C - 4)) + '╯'))

    let left
    if (this.toast) left = c.yellow(truncate(this.toast.replace(/\n/g, ' · '), Math.max(8, C - 26)))
    else if (this.planning) left = c.dim(`Thinking ${formatDuration(Date.now() - this.planStartedAt)}…`)
    else left = c.dim('Enter send  ·  Alt+Enter newline  ·  / commands')
    const right = this.sidebarVisible() ? c.dim('Ctrl+P palette  ·  Ctrl+B sidebar') : c.dim('Ctrl+P palette  ·  ? help')
    lines.push(twoSides(' ' + left, right + ' ', C))
    return lines
  }

  bodyLines(C, H) {
    if (this.overlay) return this.overlayBody(C, H)
    const showSidebar = this.sidebarVisible()
    const sideW = showSidebar ? Math.min(30, Math.max(22, Math.floor(C * 0.24))) : 0
    const contentW = showSidebar ? Math.max(10, C - sideW - 5) : Math.min(96, Math.max(8, C - 4))
    const transcript = this.transcriptLines(contentW)
    this.lastTranscript = transcript
    const maxOffset = Math.max(0, transcript.length - H)
    this.lastMaxOffset = maxOffset
    if (this.follow) this.scrollOffset = 0
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxOffset))
    const start = Math.max(0, transcript.length - H - this.scrollOffset)
    const visible = transcript.slice(start, start + H)
    while (visible.length < H) visible.push('')

    if (!showSidebar) {
      const leftPad = Math.max(1, Math.floor((C - contentW) / 2))
      const rightPad = Math.max(1, C - leftPad - contentW)
      return visible.map((line) => ' '.repeat(leftPad) + padTo(line, contentW) + ' '.repeat(rightPad))
    }

    const side = this.sidebarLines(sideW, H)
    const out = []
    for (let i = 0; i < H; i++) {
      out.push(' ' + padTo(side[i] || '', sideW) + ' ' + this.c.dim('│') + ' ' + padTo(visible[i] || '', contentW))
    }
    return out
  }

  overlayBody(C, H) {
    const palette = this.overlay.type === 'palette'
    const width = Math.min(palette ? 78 : 78, C - 4)
    const inner = width - 2
    const title = this.overlay.type === 'picker' ? 'CHATS' : this.overlay.title || 'HELP'
    const maxContent = Math.max(3, H - 2)
    const lines = this.overlayContent(inner, maxContent)
    const box = []
    const top = `┌─ ${title} ${'─'.repeat(Math.max(0, inner - title.length - 3))}┐`
    box.push(truncate(top, width))
    for (const line of lines) box.push('│' + padTo(truncateAnsi(line, inner), inner) + '│')
    box.push('└' + '─'.repeat(inner) + '┘')
    const leftPad = Math.max(0, Math.floor((C - width) / 2))
    const topPad = Math.max(0, Math.floor((H - box.length) / 2))
    this.lastOverlay = { left: leftPad + 1, top: topPad + 1, width, box }
    const out = []
    for (let i = 0; i < H; i++) {
      const j = i - topPad
      if (j >= 0 && j < box.length) out.push(' '.repeat(leftPad) + box[j])
      else out.push('')
    }
    return out
  }

  overlayContent(inner, maxRows = 20) {
    const c = this.c
    if (this.overlay.type === 'palette') {
      const items = this.filteredPalette()
      const rows = Math.max(1, maxRows - 5)
      const win = paletteWindow(items, this.overlay.index, rows)
      const lines = []
      const query = this.overlay.query || ''
      lines.push(c.dim('> ') + (query ? c.white(query) : c.dim('type to search')))
      if (win.hasBefore) lines.push(c.dim('  ↑ earlier'))
      if (!items.length) lines.push(c.dim('  No matches.'))
      win.rows.forEach((item, i) => {
        const index = win.start + i
        const selected = index === this.overlay.index
        const mark = selected ? c.yellow('▸') : ' '
        const label = truncate(item.label || '', Math.max(8, inner - 22))
        const hint = truncate(item.hint || '', 18)
        const shown = selected ? c.white(label) : label
        lines.push(mark + ' ' + padTo(shown, Math.max(8, inner - 22)) + ' ' + c.dim(hint.padStart(18)))
      })
      if (win.hasAfter) lines.push(c.dim('  ↓ later'))
      lines.push('')
      lines.push(c.dim('↑↓ choose · Enter select · Esc cancel'))
      return lines.slice(0, maxRows)
    }

    if (this.overlay.type === 'picker') {
      const list = this.state.sessions || []
      const rows = Math.max(1, maxRows - 3)
      this.overlay.index = Math.max(0, Math.min(this.overlay.index, list.length - 1))
      const start = Math.max(0, Math.min(this.overlay.index, list.length - rows))
      const lines = []
      if (start > 0) lines.push(c.dim('  ↑ earlier'))
      for (let i = start; i < Math.min(list.length, start + rows); i++) {
        const s = list[i]
        const active = s.id === this.state.session?.id
        const sel = i === this.overlay.index
        const mark = sel ? c.yellow('▸') : ' '
        const dot = active ? c.green('●') : ' '
        const title = truncate(normalizeText(s.title || 'Untitled chat'), Math.max(8, inner - 27))
        lines.push(`${mark} ${dot} ${String(i + 1).padStart(2)}  ${padTo(title, Math.max(8, inner - 27))}  ${truncate(relTime(s.updatedAt), 8)} ${String(s.count ?? 0).padStart(4)}`)
      }
      if (!list.length) lines.push(c.dim('  No chats yet.'))
      if (start + rows < list.length) lines.push(c.dim('  ↓ later'))
      lines.push('')
      lines.push(c.dim('↑↓ choose · Enter switch · Esc cancel'))
      return lines.slice(0, maxRows)
    }

    const raw = this.overlay.lines || []
    const rows = Math.max(1, maxRows - 2)
    const maxScroll = Math.max(0, raw.length - rows)
    this.overlay.scroll = Math.max(0, Math.min(this.overlay.scroll || 0, maxScroll))
    const lines = raw.slice(this.overlay.scroll, this.overlay.scroll + rows).map((l) => truncateAnsi(l, inner))
    if (maxScroll) {
      const shown = Math.min(raw.length, this.overlay.scroll + rows)
      lines.push(c.dim(`${this.overlay.scroll > 0 ? '↑' : ' '} ${this.overlay.scroll + 1}-${shown} of ${raw.length} ${shown < raw.length ? '↓' : ' '}   Esc closes`))
    } else {
      lines.push(c.dim('Esc closes'))
    }
    return lines.slice(0, maxRows)
  }

  openPalette(mode = 'commands') {
    const title = mode === 'models' ? 'MODEL' : mode === 'planners' ? 'PLANNER' : mode === 'agents' ? 'ASSISTANTS' : 'COMMANDS'
    this.overlay = { type: 'palette', mode, title, query: '', index: 0 }
    this.requestRender(0)
  }

  paletteItems() {
    const mode = this.overlay?.mode || 'commands'
    const state = this.state
    if (mode === 'models') {
      const items = [{
        label: 'Each assistant’s default', hint: state.model ? 'auto' : 'current', value: '',
        run: () => { state.model = ''; this.setToast('Model: each assistant’s default') },
      }]
      const seen = new Set()
      for (const a of state.agents || []) {
        for (const modelRef of a.models || []) {
          if (seen.has(modelRef)) continue
          seen.add(modelRef)
          items.push({
            label: modelRef, hint: modelRef === state.model ? 'current' : (a.label || 'assistant'), value: modelRef, keywords: a.id,
            run: () => { state.model = modelRef; this.setToast(`Model: ${modelRef}`) },
          })
        }
      }
      return items
    }
    if (mode === 'planners') {
      const items = [{
        label: 'Auto', hint: (state.session?.instructor || 'auto') === 'auto' ? 'current' : 'best available', value: 'auto',
        run: () => this.setInstructor('auto'),
      }]
      for (const i of state.instructors || []) {
        items.push({
          label: i.label || i.id, hint: i.id === state.session?.instructor ? 'current' : 'planner', value: i.id,
          run: () => this.setInstructor(i.id),
        })
      }
      return items
    }
    if (mode === 'agents') {
      return (state.agents || []).map((a) => ({
        label: a.label || 'assistant',
        hint: a.disabled ? 'unavailable' : 'assistant',
        run: () => this.openInfo('ASSISTANTS', agentLines(state, this.c)),
      }))
    }

    const items = [
      { label: 'New chat', hint: 'Ctrl+N', keywords: 'session start', run: () => this.newChat() },
      { label: 'Switch chat…', hint: 'Ctrl+O', keywords: 'session resume', run: () => { this.overlay = null; this.openPicker() } },
      { label: 'Rename chat…', hint: '/rename', keywords: 'title', run: () => this.prefill('/rename ') },
      { label: 'Change folder…', hint: '/cwd', keywords: 'directory workdir', run: () => this.prefill('/cwd ') },
      { label: 'Plan only…', hint: '/plan', keywords: 'plan steps', run: () => this.prefill('/plan ') },
      { label: 'Manual chain…', hint: '/chain', keywords: 'steps script', run: () => this.prefill('/chain ') },
      { label: 'Side answer…', hint: '/btw', keywords: 'question quick', run: () => this.prefill('/btw ') },
      { label: 'Direct answer…', hint: '/direct', keywords: 'assistant', run: () => this.prefill('/direct ') },
      { label: 'Choose model…', hint: 'model', keywords: 'provider', run: () => this.openPalette('models') },
      { label: 'Choose planner…', hint: 'planner', keywords: 'instructor', run: () => this.openPalette('planners') },
      { label: 'Assistants', hint: '/agents', keywords: 'models roles', run: () => this.openInfo('ASSISTANTS', agentLines(state, this.c)) },
      { label: 'Status', hint: '/status', keywords: 'health', run: () => this.openInfo('STATUS', statusLines(state, this.c)) },
      { label: 'Quota meter', hint: '/quota', keywords: 'usage caps provider route', run: () => this.showQuota() },
      { label: 'Pin a step…', hint: '/pin', keywords: 'export step', run: () => this.prefill('/pin ') },
      { label: 'Export chat…', hint: '/export', keywords: 'json save', run: () => this.prefill('/export ') },
      { label: 'Redraw screen', hint: '/clear', keywords: 'refresh cache', run: () => { this.cache.clear(); this.setToast('Screen redrawn') } },
      { label: 'Reconnect', hint: 'Ctrl+R', keywords: 'server retry', run: () => this.forceReconnect() },
      { label: 'Toggle sidebar', hint: 'Ctrl+B', keywords: 'layout hide show', run: () => this.toggleSidebar() },
      { label: 'Help', hint: '?', keywords: 'keys shortcuts', run: () => this.openHelp() },
      { label: 'Quit', hint: 'Ctrl+Q', keywords: 'exit close', run: () => this.quit(0) },
    ]
    if (state.busy || this.running || this.planning || hasRunningBtw(state)) {
      items.unshift({ label: 'Stop current work', hint: '/stop', keywords: 'cancel interrupt', run: () => this.stopRun() })
    }
    return items
  }

  filteredPalette() {
    return filterPalette(this.paletteItems(), this.overlay?.query || '')
  }

  movePalette(delta) {
    const items = this.filteredPalette()
    if (!items.length) return
    this.overlay.index = (this.overlay.index + delta + items.length) % items.length
    this.requestRender(0)
  }

  runPaletteItem() {
    const item = this.filteredPalette()[this.overlay?.index]
    if (!item) return
    this.overlay = null
    try {
      const result = item.run?.()
      if (result?.catch) result.catch((e) => this.setToast(e.message || String(e), 8000))
    } catch (e) {
      this.setToast(e.message || String(e), 8000)
    }
    this.requestRender(0)
  }

  prefill(text) {
    this.overlay = null
    this.input = text
    this.caret = text.length
    this.scrollBottom()
    this.requestRender(0)
  }

  transcriptLines(width) {
    const c = this.c
    const msgs = messagesOf(this.state)
    if (!msgs.length) {
      const out = [
        '',
        c.bold(c.brand('RELAY')),
        c.dim('AI assistants on your computer'),
        '',
        c.white('What do you want to build?'),
        '',
        ...wrapText('Describe it in plain English. Relay plans first; nothing runs until you approve the plan.', width).map((line) => c.dim(line)),
        '',
        c.bold('Try'),
        c.dim('  · Build a landing page for a coffee shop'),
        c.dim('  · Review this folder and fix the failing tests'),
        c.dim('  · Explain what this project does'),
        '',
        c.dim('Enter send   / commands   Ctrl+P palette   ? help'),
      ]
      return out.map((line) => truncateAnsi(line, width))
    }
    const start = Math.max(0, msgs.length - 300)
    const out = []
    if (start > 0) {
      out.push(c.dim('Older messages are hidden here. /export for the full chat.'))
      out.push('')
    }
    for (let i = start; i < msgs.length; i++) {
      const block = this.messageBlock(msgs[i], width)
      if (out.length && block.length) out.push('')
      out.push(...block)
    }
    const group = lastRunGroup(this.state)
    if (!this.state.busy && !this.running && group.steps.length && !this.pendingPlanId) {
      const summary = summarizeGroup(group)
      const card = summaryLines(summary, c)
      const title = 'WHAT HAPPENED'
      const fill = Math.max(2, width - 5 - title.length)
      out.push('')
      out.push(c.dim('╭─ ') + c.bold(c.green(title)) + ' ' + c.dim('─'.repeat(fill) + '╮'))
      for (const line of card.slice(1)) out.push(c.dim('│ ') + padTo(line, Math.max(2, width - 4)) + c.dim(' │'))
      out.push(c.dim('╰' + '─'.repeat(Math.max(2, width - 2)) + '╯'))
    }
    return out
  }

  messageBlock(m, width) {
    const c = this.c
    const runningSec = m.status === 'running' ? Math.floor((Date.now() - new Date(m.startedAt).getTime()) / 1000) : ''
    const tail = String(m.text || '').slice(-32)
    const key = `m:${m.id}:${width}:${m.text?.length || 0}:${tail}:${m.status || ''}:${runningSec}:${m.id === this.pendingPlanId}:${m.git ? 'g' : ''}`
    if (this.cache.has(key)) return this.cache.get(key)
    const lines = []
    if (m.role === 'user') {
      lines.push(c.bold(c.cyan('YOU')) + c.dim('  ' + timeOf(m.at)))
      for (const line of wrapText(m.text || '', Math.max(4, width - 2))) lines.push(c.cyan('▌ ') + line)
    } else if (m.role === 'note') {
      const wrapped = wrapText(m.text || '', Math.max(4, width - 4))
      wrapped.forEach((line, i) => lines.push(c.dim((i === 0 ? '· ' : '  ') + line)))
    } else if (m.role === 'plan') {
      const plan = planLines(this.state, m, c, { width, approval: false })
      const task = String(m.task || '').replace(/\s+/g, ' ').trim()
      lines.push(c.bold(c.yellow('PLAN')) + (task ? c.dim(' · ' + truncate(task, Math.max(8, width - 8))) : ''))
      lines.push(...plan.slice(1))
    } else if (m.role === 'step') {
      if (m.kind === 'btw') {
        const left = `${c.bold(c.amber('↳ SIDE ANSWER'))} ${c.dim('· ' + (m.label || agentLabel(this.state, m.agent)))}`
        lines.push(twoSides(left, statusColor(c, m.status)(stepStatusText(m)), width))
        if (m.question) {
          const q = wrapText('Q: ' + m.question, Math.max(4, width - 2))
          q.forEach((line, i) => lines.push(c.dim((i === 0 ? '  ' : '    ') + line)))
        }
        lines.push(...this.stepTextLines(m, width, 2))
      } else {
        const group = lastRunGroup(this.state)
        const total = lastPlan(this.state)?.steps?.length || group.plan?.steps?.length || Math.max(1, m.n || 1)
        const icon = statusIcon(c, m.status)
        const label = m.label || agentLabel(this.state, m.agent)
        const left = `${icon} ${c.bold(label)} ${c.dim(`· step ${m.n || 1}/${total}`)}`
        lines.push(twoSides(left, statusColor(c, m.status)(stepStatusText(m)), width))
        if (m.why) {
          for (const line of wrapText(m.why, Math.max(4, width - 2))) lines.push(c.dim('  ' + line))
        }
        lines.push(...this.stepTextLines(m, width, 2))
        if (m.fallback?.length) {
          const f = m.fallback[m.fallback.length - 1]
          lines.push(c.yellow(truncate(f.reason === 'quota' ? `${f.from} ran out of free credits — Relay switched to ${f.to} for you.` : `${f.from} was cooling — Relay switched to ${f.to}.`, width)))
        }
        const files = (m.git?.after?.files || []).slice(0, 4).map((raw) => parsePorcelainLine(raw))
        if (files.length) {
          const names = files.map((f) => f.path).join('  ')
          lines.push(c.dim('  files  ') + c.cyan(truncate(names, Math.max(8, width - 9))))
        }
        if (m.status === 'failed') lines.push(c.dim('  Next: read the lines above, or ask Relay to try again.'))
      }
    }
    this.cache.set(key, lines)
    if (this.cache.size > 400) {
      const first = this.cache.keys().next().value
      this.cache.delete(first)
    }
    return lines
  }

  stepTextLines(m, width, indent) {
    const text = normalizeText(m.text || '')
    if (!text) {
      if (m.status === 'running') return [this.c.dim(' '.repeat(indent) + 'thinking…')]
      return []
    }
    const all = text.split('\n')
    let note = null
    const clipped = all.length > 10_000 ? all.slice(0, 9_990).join('\n') : text
    if (all.length > 10_000) note = `… output shortened here (${all.length - 9_990} more lines) — /export for all.`
    const rendered = renderMarkdown(clipped, Math.max(8, width - indent), this.c)
    const prefix = ' '.repeat(indent)
    const out = rendered.map((line) => prefix + line)
    if (note) out.push(this.c.dim(prefix + note))
    return out
  }

  sidebarLines(width, H) {
    const c = this.c
    const out = []
    const push = (s = '') => out.push(truncateAnsi(s, width))
    const sessions = this.state.sessions || []
    const active = sessions.findIndex((s) => s.id === this.state.session?.id)
    const chatRoom = Math.max(2, Math.min(7, H - 10))
    const chatStart = Math.max(0, Math.min(active < 0 ? 0 : active, sessions.length - chatRoom))

    push(c.bold(c.dim('CHATS')))
    if (!sessions.length) push(c.dim('  No chats yet'))
    for (const s of sessions.slice(chatStart, chatStart + chatRoom)) {
      const current = s.id === this.state.session?.id
      const title = truncate(normalizeText(s.title || 'Untitled chat'), Math.max(4, width - 3))
      push((current ? c.brand('▌') : ' ') + ' ' + (current ? c.white(title) : c.dim(title)))
      if (current && H >= 24) {
        push(c.dim(`  ${relTime(s.updatedAt)} · ${s.count ?? 0} messages`))
      }
    }
    if (sessions.length > chatRoom) push(c.dim(`  +${sessions.length - chatRoom} more`))

    const group = lastRunGroup(this.state)
    const planSteps = group.plan?.steps || []
    const shownSteps = planSteps.length ? planSteps : group.steps
    if (shownSteps.length && out.length + 3 < H) {
      push('')
      push(c.bold(c.dim('RUN')))
      const room = Math.max(1, Math.min(5, H - out.length - 5))
      for (let i = 0; i < Math.min(room, shownSteps.length); i++) {
        const planStep = planSteps[i]
        const step = group.steps.find((m) => (m.n || 0) === i + 1) || (!planSteps.length ? shownSteps[i] : null)
        const status = step?.status || (this.running && i === 0 ? 'running' : 'pending')
        const label = step?.label || (planStep ? agentLabel(this.state, planStep.agent || planStep.agents?.[0]) : '') || `step ${i + 1}`
        push(` ${statusIcon(c, status)} ${truncate(label, Math.max(4, width - 3))}`)
      }
      if (planSteps.length > room) push(c.dim(`  +${planSteps.length - room} more`))
    }

    const files = changedFiles(this.state, 4)
    if (out.length + 2 < H) {
      push('')
      push(c.bold(c.dim('FILES')))
      if (!files.length) push(c.dim('  no changes'))
      else for (const f of files) push(c.dim('  ') + c.cyan(truncate(normalizeText(f.path), Math.max(5, width - 4))))
    }

    const summary = lastRunSummary(this.state)
    if (summary && out.length + 3 < H) {
      push('')
      push(c.bold(c.dim('LAST RUN')))
      const filesN = summary.files.length
      push(c.dim(`  ${summary.finished}/${summary.total} steps${filesN ? ` · ${filesN} file${filesN === 1 ? '' : 's'}` : ''}`))
      push(c.dim(`  ${summary.problems ? `${summary.problems} problem${summary.problems === 1 ? '' : 's'}` : 'no problems'} · ${formatDuration(summary.durationMs)}`))
    }

    while (out.length < H) out.push('')
    return out.slice(0, H)
  }

  onEvent(ev) {
    if (this.closing) return
    const r = applyEvent(this.state, ev)
    if (r.resync) {
      this.resync(true)
      return
    }
    if (r.notice) this.setToast(r.notice)
    if (ev.type === 'message' && ev.message?.role === 'plan') {
      this.cache.clear()
    }
    if (ev.type === 'hello') {
      this.cache.clear()
      if (this.pendingPlanId && !messagesOf(this.state).some((m) => m.id === this.pendingPlanId)) this.pendingPlanId = null
    }
    if (r.changed) this.requestRender(ev.type === 'delta' ? 33 : 16)
  }

  onStreamState(s) {
    if (s === 'open') {
      this.connected = true
      this.reconnecting = false
      if (this.everOpened) {
        this.setToast(COPY.reconnected)
        this.resync(false)
      }
      this.everOpened = true
    } else if (s === 'reconnecting' || s === 'closed') {
      this.connected = false
      this.reconnecting = true
      if (!this.restarted) {
        this.restarted = true
        setTimeout(() => {
          this.client.ensureServer({ quiet: true }).catch(() => {})
        }, 1000)
      }
    }
    this.requestRender(0)
  }

  onStreamOpen() {
    this.requestRender(0)
  }

  async resync(notify = true) {
    if (this.resyncing) return
    this.resyncing = true
    try {
      const r = await this.client.api('GET', '/api/bootstrap', undefined, { timeout: 6000 })
      if (r.ok) {
        const oldTitle = this.state.session?.title
        applyBootstrap(this.state, r.data)
        this.cache.clear()
        if (notify && oldTitle !== this.state.session?.title) this.setToast(sessionChanged(this.state.session?.title || 'another chat'))
      }
    } catch {}
    finally {
      this.resyncing = false
      this.requestRender(0)
    }
  }

  addHistory(text) {
    const value = String(text || '').trim()
    if (!value) return
    if (this.history[this.history.length - 1] !== value) this.history.push(value)
    if (this.history.length > 100) this.history.shift()
    this.histIndex = -1
    this.historyDraft = ''
  }

  submit() {
    if (this.pendingPlanId) { this.runPending(); return }
    const text = this.input.trim()
    if (!text) return
    if ((this.state.busy || this.planning || this.running) && !text.startsWith('/')) {
      this.setToast(COPY.activeRun)
      return
    }
    this.addHistory(text)
    this.input = ''
    this.caret = 0
    this.inputScroll = 0
    this.scrollBottom()
    if (text.startsWith('/')) this.handleCommand(text)
    else this.planTask(text)
  }

  async planTask(text) {
    if (this.state.busy || this.planning || this.running) { this.setToast(COPY.activeRun); return }
    const token = ++this.planToken
    this.planning = true
    this.planStartedAt = Date.now()
    this.setToast('')
    this.requestRender(0)
    let r
    try {
      r = await this.client.api('POST', '/api/plan', {
        text, auto: false, model: this.state.model || this.flags.model || '', instructor: this.flags.instructor || undefined,
      })
    } catch (e) {
      if (token !== this.planToken) { this.planning = false; return }
      this.planning = false
      this.setToast(e.message, 8000)
      return
    }
    if (token !== this.planToken || this.closing) { this.planning = false; return }
    this.planning = false
    if (!r.ok) {
      this.setToast(r.status === 409 ? COPY.activeRun : r.status === 500 ? `The planner couldn't make a plan: ${r.data?.error || 'unknown error'}` : plainError(r), 8000)
      return
    }
    if (r.data?.stopped) { this.setToast(COPY.plannerStopped); return }
    const plan = r.data?.plan
    if (!plan?.steps?.length) { this.setToast(COPY.noPlanSteps, 7000); return }
    applyEvent(this.state, { type: 'message', message: plan, sessionId: this.state.session?.id })
    this.cache.clear()
    if (this.flags.auto || this.flags.yes) {
      this.pendingPlanId = null
      await this.runPlan(plan)
    } else {
      this.pendingPlanId = plan.id
      this.setToast('Plan ready. Press Enter to run it, or s to skip.', 8000)
    }
    this.requestRender(0)
  }

  async runPending() {
    const id = this.pendingPlanId
    if (!id) return
    const plan = messagesOf(this.state).find((m) => m.id === id && m.role === 'plan')
    if (!plan) { this.pendingPlanId = null; this.setToast(COPY.unknownPlan); return }
    this.pendingPlanId = null
    await this.runPlan(plan)
  }

  skipPending() {
    if (!this.pendingPlanId) return
    this.pendingPlanId = null
    this.setToast(COPY.skipped)
    this.requestRender(0)
  }

  async runPlan(plan) {
    this.running = true
    this.runStartedAt = Date.now()
    let r
    try {
      r = await this.client.api('POST', '/api/run', { planId: plan.id, model: this.state.model || this.flags.model || '' })
    } catch (e) {
      this.running = false
      this.setToast(e.message, 8000)
      return
    }
    if (!r.ok) {
      this.running = false
      this.setToast(plainError(r), 8000)
      return
    }
    this.finishRun(await waitForRun(this.state, { auto: false, planId: plan.id, runRequested: true, signal: this.abort.signal }))
  }

  finishRun(done) {
    this.running = false
    if (done.status === 'interrupted' || this.closing) return
    if (done.status === 'nostart') {
      this.setToast('The run did not start. Nothing ran.', 9000)
      this.requestRender(0)
      return
    }
    const summary = done.summary || summarizeGroup(lastRunGroup(this.state))
    this.setToast(summarySentence(summary), 9000)
    this.requestRender(0)
  }

  async startDirect(agent, prompt) {
    if (this.state.busy || this.planning || this.running) { this.setToast(COPY.activeRun); return }
    if (!agent || !prompt) { this.setToast('Use: /direct <agent> <prompt>'); return }
    this.running = true
    this.runStartedAt = Date.now()
    let r
    try { r = await this.client.api('POST', '/api/dispatch', { agent, prompt, model: this.state.model || this.flags.model || '' }) } catch (e) { this.running = false; this.setToast(e.message, 8000); return }
    if (!r.ok) { this.running = false; this.setToast(plainError(r, 'That assistant is not available.')); return }
    this.finishRun(await waitForRun(this.state, { auto: false, runRequested: true, signal: this.abort.signal }))
  }

  async startChain(text) {
    if (this.state.busy || this.planning || this.running) { this.setToast(COPY.activeRun); return }
    if (!text.trim()) { this.setToast('Use: /chain agent: prompt\\nagent: prompt'); return }
    this.running = true
    this.runStartedAt = Date.now()
    let r
    try { r = await this.client.api('POST', '/api/chain', { text, task: '', model: this.state.model || this.flags.model || '' }) } catch (e) { this.running = false; this.setToast(e.message, 8000); return }
    if (!r.ok) { this.running = false; this.setToast(plainError(r)); return }
    this.finishRun(await waitForRun(this.state, { auto: false, runRequested: true, signal: this.abort.signal }))
  }

  async startPlanOnly(text) {
    if (this.state.busy || this.planning || this.running) { this.setToast(COPY.activeRun); return }
    const token = ++this.planToken
    this.planning = true
    this.planStartedAt = Date.now()
    this.requestRender(0)
    let r
    try {
      r = await this.client.api('POST', '/api/plan', { text, auto: false, model: this.state.model || this.flags.model || '', instructor: this.flags.instructor || undefined })
    } catch (e) {
      if (token !== this.planToken) { this.planning = false; return }
      this.planning = false
      this.setToast(e.message, 8000)
      return
    }
    if (token !== this.planToken || this.closing) { this.planning = false; return }
    this.planning = false
    if (!r.ok) { this.setToast(plainError(r), 8000); return }
    if (r.data?.stopped) { this.setToast(COPY.plannerStopped); return }
    const plan = r.data?.plan
    if (!plan?.steps?.length) { this.setToast(COPY.noPlanSteps); return }
    applyEvent(this.state, { type: 'message', message: plan, sessionId: this.state.session?.id })
    this.cache.clear()
    this.setToast('Plan ready. Nothing will run.', 6000)
    this.requestRender(0)
  }

  // ---- input -------------------------------------------------------------

  handleData(buf) {
    if (this.escTimer) { clearTimeout(this.escTimer); this.escTimer = null }
    this.keyBuf += this.decoder.write(buf)
    this.processKeys()
  }

  processKeys() {
    while (this.keyBuf.length) {
      if (this.paste !== null) {
        const end = this.keyBuf.indexOf('\x1b[201~')
        if (end < 0) {
          if (this.keyBuf.length > 200_000) {
            this.insertText(this.paste)
            this.paste = ''
          }
          return
        }
        this.paste += this.keyBuf.slice(0, end)
        this.keyBuf = this.keyBuf.slice(end + 6)
        this.insertText(this.paste)
        this.paste = null
        continue
      }

      const pasteStart = this.keyBuf.indexOf('\x1b[200~')
      if (pasteStart >= 0) {
        const before = this.keyBuf.slice(0, pasteStart)
        this.keyBuf = this.keyBuf.slice(pasteStart + 6)
        if (before) this.processPlain(before)
        this.paste = ''
        continue
      }

      if (this.keyBuf === '\x1b') {
        if (this.escTimer) clearTimeout(this.escTimer)
        this.escTimer = setTimeout(() => {
          this.escTimer = null
          this.keyBuf = ''
          this.handleEsc()
        }, 30)
        return
      }

      if (this.keyBuf.startsWith('\x1b[<')) {
        const m = this.keyBuf.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/)
        if (!m) return
        this.keyBuf = this.keyBuf.slice(m[0].length)
        this.handleMouse(Number(m[1]), Number(m[2]), Number(m[3]), m[4])
        continue
      }

      if (this.keyBuf.startsWith('\x1b[')) {
        const m = this.keyBuf.match(/^\x1b\[[0-9;?]*[A-Za-z~]/)
        if (!m) {
          if (this.keyBuf.length > 12) { this.keyBuf = this.keyBuf.slice(1); continue }
          return
        }
        this.keyBuf = this.keyBuf.slice(m[0].length)
        this.handleCsi(m[0])
        continue
      }

      if (this.keyBuf.startsWith('\x1b')) {
        const next = this.keyBuf[1]
        if (next === undefined) return
        if (next === '\r' || next === '\n') this.insertText('\n')
        // Alt+<key> otherwise has no binding.
        this.keyBuf = this.keyBuf.slice(2)
        continue
      }

      const esc = this.keyBuf.indexOf('\x1b')
      const plain = esc < 0 ? this.keyBuf : this.keyBuf.slice(0, esc)
      this.keyBuf = esc < 0 ? '' : this.keyBuf.slice(esc)
      this.processPlain(plain)
    }
  }

  processPlain(text) {
    for (const ch of text) {
      const code = ch.codePointAt(0)
      if (this.pendingPlanId) {
        if (ch === '\r' || ch === '\n') this.runPending()
        else if (ch === 's' || ch === 'S') this.skipPending()
        else if (code === 0x03) this.handleCtrlC()
        continue
      }
      if (this.overlay) {
        if (this.overlay.type === 'picker') {
          if (ch === 'j') this.overlay.index = Math.min((this.state.sessions || []).length - 1, this.overlay.index + 1)
          else if (ch === 'k') this.overlay.index = Math.max(0, this.overlay.index - 1)
          else if (ch === 'q' || ch === '?') this.overlay = null
          else if (ch === '\r' || ch === '\n') this.pickSession()
          this.requestRender(0)
          continue
        }
        if (this.overlay.type === 'palette') {
          if (ch === '\r' || ch === '\n') this.runPaletteItem()
          else if (ch === '\x7f' || ch === '\x08') {
            this.overlay.query = this.overlay.query.slice(0, -1)
            this.overlay.index = 0
            this.requestRender(0)
          } else if (code === 0x15) {
            this.overlay.query = ''
            this.overlay.index = 0
            this.requestRender(0)
          } else if (code >= 32 && code !== 0x7f) {
            this.overlay.query += ch
            this.overlay.index = 0
            this.requestRender(0)
          }
          continue
        }
        if (this.overlay.type === 'info') {
          if (ch === 'j') this.overlay.scroll = (this.overlay.scroll || 0) + 1
          else if (ch === 'k') this.overlay.scroll = Math.max(0, (this.overlay.scroll || 0) - 1)
          else if (ch === 'q' || ch === '?' || ch === '\r' || ch === '\n') this.overlay = null
          this.requestRender(0)
          continue
        }
        if (ch === 'q' || ch === '?' || ch === '\r' || ch === '\n') this.overlay = null
        this.requestRender(0)
        continue
      }
      if (code === 0x03) { this.handleCtrlC(); continue }
      if (code === 0x04) { this.handleCtrlD(); continue }
      if (code === 0x01) { this.moveLineStart(); continue }
      if (code === 0x02) { this.toggleSidebar(); continue }
      if (code === 0x05) { this.moveLineEnd(); continue }
      if (code === 0x0b) { this.killToEnd(); continue }
      if (code === 0x15) { this.killToStart(); continue }
      if (code === 0x17) { this.deleteWord(); continue }
      if (code === 0x0c) { this.cache.clear(); this.requestRender(0); continue }
      if (code === 0x0e) { this.newChat(); continue }
      if (code === 0x0f) { this.openPicker(); continue }
      if (code === 0x10) { this.openPalette('commands'); continue }
      if (code === 0x11) { this.quit(); continue }
      if (code === 0x12) { this.forceReconnect(); continue }
      if (ch === '\r') { this.handleEnter(); continue }
      if (ch === '\n') { this.insertText('\n'); continue }
      if (ch === '\t') { this.completeSlash(); continue }
      if (ch === '\x7f' || ch === '\x08') { this.backspace(); continue }
      if (code < 32) continue
      if (ch === '?' && this.input === '') { this.openHelp(); continue }
      this.insertText(ch)
    }
  }

  handleCsi(seq) {
    if (this.pendingPlanId) return
    if (this.overlay?.type === 'palette') {
      if (seq === '\x1b[A') this.movePalette(-1)
      else if (seq === '\x1b[B') this.movePalette(1)
      else if (seq === '\x1b[5~') this.movePalette(-5)
      else if (seq === '\x1b[6~') this.movePalette(5)
      else if (seq === '\x1b[H' || seq === '\x1b[1~') { this.overlay.index = 0; this.requestRender(0) }
      else if (seq === '\x1b[F' || seq === '\x1b[4~') {
        this.overlay.index = Math.max(0, this.filteredPalette().length - 1)
        this.requestRender(0)
      }
      return
    }
    if (this.overlay?.type === 'picker') {
      if (seq === '\x1b[A') this.overlay.index = Math.max(0, this.overlay.index - 1)
      else if (seq === '\x1b[B') this.overlay.index = Math.min((this.state.sessions || []).length - 1, this.overlay.index + 1)
      else if (seq === '\x1b[5~') this.overlay.index = Math.max(0, this.overlay.index - 10)
      else if (seq === '\x1b[6~') this.overlay.index = Math.min((this.state.sessions || []).length - 1, this.overlay.index + 10)
      this.requestRender(0)
      return
    }
    if (this.overlay) {
      if (seq === '\x1b[A' || seq === '\x1b[5~') this.overlay.scroll = Math.max(0, (this.overlay.scroll || 0) - (seq === '\x1b[5~' ? 8 : 1))
      else if (seq === '\x1b[B' || seq === '\x1b[6~') this.overlay.scroll = (this.overlay.scroll || 0) + (seq === '\x1b[6~' ? 8 : 1)
      else if (seq === '\x1b[H' || seq === '\x1b[1~') this.overlay.scroll = 0
      else if (seq === '\x1b[F' || seq === '\x1b[4~') this.overlay.scroll = Math.max(0, (this.overlay.lines || []).length - 1)
      this.requestRender(0)
      return
    }
    switch (seq) {
      case '\x1b[A': this.moveUp(); return
      case '\x1b[B': this.moveDown(); return
      case '\x1b[C': this.moveCaret(1); return
      case '\x1b[D': this.moveCaret(-1); return
      case '\x1b[H': case '\x1b[1~': this.moveLineStart(); return
      case '\x1b[F': case '\x1b[4~': this.moveLineEnd(); return
      case '\x1b[3~': this.deleteForward(); return
      case '\x1b[5~': this.scrollBy(10); return
      case '\x1b[6~': this.scrollBy(-10); return
      case '\x1b[1;5D': this.wordLeft(); return
      case '\x1b[1;5C': this.wordRight(); return
      case '\x1b[1;5H': this.scrollTop(); return
      case '\x1b[1;5F': this.scrollBottom(); return
      default: return
    }
  }

  handleMouse(cb, x, y, release) {
    if (cb & 64) {
      const up = (cb & 1) === 0
      if (this.overlay?.type === 'palette') { this.movePalette(up ? -3 : 3); return }
      if (this.overlay?.type === 'picker') {
        const last = Math.max(0, (this.state.sessions || []).length - 1)
        this.overlay.index = Math.max(0, Math.min(last, this.overlay.index + (up ? -3 : 3)))
        this.requestRender(0)
        return
      }
      if (this.overlay?.type === 'info') {
        this.overlay.scroll = Math.max(0, (this.overlay.scroll || 0) + (up ? -3 : 3))
        this.requestRender(0)
        return
      }
      this.scrollBy(up ? 3 : -3)
      return
    }
    if (release === 'm' || cb !== 0) return
    if (this.overlay) return
    const lay = this.lastLayout
    if (!lay || !lay.data) return
    if (y < lay.inputTop || y >= lay.inputTop + lay.inputCount) return
    const lineIdx = y - lay.inputTop + lay.data.start
    const all = this.input.split('\n')
    const line = all[lineIdx] ?? ''
    const caretLine = lay.data.start + lay.data.caretLine
    const start = lineIdx === caretLine ? lay.data.lineWindow.start : 0
    const col = Math.max(0, x - 7)
    let index = cellToIndex(line, col + start)
    if (lineIdx < 0) index = 0
    let global = 0
    for (let i = 0; i < lineIdx && i < all.length; i++) global += all[i].length + 1
    this.caret = Math.max(0, Math.min(this.input.length, global + index))
    this.requestRender(0)
  }

  handleEsc() {
    if (this.overlay) { this.overlay = null; this.requestRender(0); return }
    if (this.pendingPlanId) { this.skipPending(); return }
    if (this.state.busy || this.running || this.planning || hasRunningBtw(this.state)) { this.stopRun(); return }
    if (this.scrollOffset !== 0) { this.scrollBottom(); return }
  }

  handleEnter() {
    if (this.overlay?.type === 'picker') { this.pickSession(); return }
    if (this.overlay?.type === 'palette') { this.runPaletteItem(); return }
    if (this.overlay) { this.overlay = null; this.requestRender(0); return }
    this.submit()
  }

  handleCtrlC() {
    if (this.pendingPlanId) { this.skipPending(); return }
    if (this.state.busy || this.running || this.planning || hasRunningBtw(this.state)) { this.stopRun(); return }
    if (this.input) { this.input = ''; this.caret = 0; this.requestRender(0); return }
    const now = Date.now()
    if (now - this.lastCtrlC < 1500) { this.quit(130); return }
    this.lastCtrlC = now
    this.setToast('Press Ctrl+C again to quit.', 2000)
  }

  handleCtrlD() {
    if (this.state.busy || this.running || this.planning || hasRunningBtw(this.state)) { this.setToast('Stop the run first with /stop.'); return }
    this.quit(0)
  }

  quit(code = 0) {
    if (this.state.busy || this.running || this.planning || hasRunningBtw(this.state)) {
      this.setToast('Stop the run first with /stop.')
      return
    }
    this.finish(code)
  }

  insertText(text) {
    if (this.pendingPlanId || this.overlay) return
    const value = String(text ?? '').replace(/\r\n?/g, '\n')
    if (!value) return
    this.input = this.input.slice(0, this.caret) + value + this.input.slice(this.caret)
    this.caret += value.length
    if (this.input.length > 200_000) {
      this.input = this.input.slice(0, 200_000)
      this.caret = Math.min(this.caret, 200_000)
    }
    this.requestRender(0)
  }

  backspace() {
    if (!this.input || this.caret <= 0) return
    const prev = prevCharIndex(this.input, this.caret)
    this.input = this.input.slice(0, prev) + this.input.slice(this.caret)
    this.caret = prev
    this.requestRender(0)
  }

  deleteForward() {
    if (this.caret >= this.input.length) return
    const next = nextCharIndex(this.input, this.caret)
    this.input = this.input.slice(0, this.caret) + this.input.slice(next)
    this.requestRender(0)
  }

  moveCaret(delta) {
    if (delta < 0) this.caret = prevCharIndex(this.input, this.caret)
    else this.caret = nextCharIndex(this.input, this.caret)
    this.requestRender(0)
  }

  moveLineStart() {
    const lineStart = this.input.lastIndexOf('\n', this.caret - 1) + 1
    this.caret = lineStart
    this.requestRender(0)
  }

  moveLineEnd() {
    const next = this.input.indexOf('\n', this.caret)
    this.caret = next < 0 ? this.input.length : next
    this.requestRender(0)
  }

  moveUp() {
    const before = this.input.slice(0, this.caret)
    const lineIdx = (before.match(/\n/g) || []).length
    if (lineIdx === 0) { this.historyPrev(); return }
    const lineStart = before.lastIndexOf('\n') + 1
    const col = this.caret - lineStart
    const prevStart = this.input.lastIndexOf('\n', lineStart - 2) + 1
    const prevEnd = lineStart - 1
    this.caret = prevStart + Math.min(col, prevEnd - prevStart)
    this.requestRender(0)
  }

  moveDown() {
    const before = this.input.slice(0, this.caret)
    const lineIdx = (before.match(/\n/g) || []).length
    const lineStart = before.lastIndexOf('\n') + 1
    const col = this.caret - lineStart
    const lineEnd = this.input.indexOf('\n', this.caret)
    if (lineEnd < 0) { this.historyNext(); return }
    const nextStart = lineEnd + 1
    const nextEnd = this.input.indexOf('\n', nextStart)
    const end = nextEnd < 0 ? this.input.length : nextEnd
    this.caret = nextStart + Math.min(col, end - nextStart)
    this.requestRender(0)
  }

  wordLeft() {
    let i = this.caret
    while (i > 0 && /\s/.test(this.input[i - 1])) i--
    while (i > 0 && !/\s/.test(this.input[i - 1])) i--
    this.caret = i
    this.requestRender(0)
  }

  wordRight() {
    let i = this.caret
    while (i < this.input.length && !/\s/.test(this.input[i])) i++
    while (i < this.input.length && /\s/.test(this.input[i])) i++
    this.caret = i
    this.requestRender(0)
  }

  deleteWord() {
    let i = this.caret
    while (i > 0 && /\s/.test(this.input[i - 1])) i--
    while (i > 0 && !/\s/.test(this.input[i - 1])) i--
    this.input = this.input.slice(0, i) + this.input.slice(this.caret)
    this.caret = i
    this.requestRender(0)
  }

  killToStart() {
    const start = this.input.lastIndexOf('\n', this.caret - 1) + 1
    this.input = this.input.slice(0, start) + this.input.slice(this.caret)
    this.caret = start
    this.requestRender(0)
  }

  killToEnd() {
    const end = this.input.indexOf('\n', this.caret)
    const cut = end < 0 ? this.input.length : end
    this.input = this.input.slice(0, this.caret) + this.input.slice(cut)
    this.requestRender(0)
  }

  historyPrev() {
    if (!this.history.length) return
    if (this.histIndex < 0) { this.historyDraft = this.input; this.histIndex = this.history.length }
    this.histIndex = Math.max(0, this.histIndex - 1)
    this.input = this.history[this.histIndex] || ''
    this.caret = this.input.length
    this.requestRender(0)
  }

  historyNext() {
    if (this.histIndex < 0) return
    this.histIndex++
    if (this.histIndex >= this.history.length) {
      this.histIndex = -1
      this.input = this.historyDraft || ''
    } else {
      this.input = this.history[this.histIndex] || ''
    }
    this.caret = this.input.length
    this.requestRender(0)
  }

  slashSuggestions() {
    if (!this.input.startsWith('/') || /\s/.test(this.input)) return []
    const hits = REPL_COMMANDS.filter((cmd) => cmd.startsWith(this.input.toLowerCase()))
    return hits.slice(0, 5).map((cmd) => ({ cmd, help: COMMAND_HELP[cmd] || '' }))
  }

  completeSlash() {
    if (!this.input.startsWith('/') || this.input.includes(' ')) return
    const hits = REPL_COMMANDS.filter((c) => c.startsWith(this.input))
    if (!hits.length) return
    if (hits.length === 1) {
      this.input = hits[0] + ' '
      this.caret = this.input.length
      this.requestRender(0)
      return
    }
    let prefix = hits[0]
    for (const h of hits) while (!h.startsWith(prefix)) prefix = prefix.slice(0, -1)
    if (prefix.length > this.input.length) {
      this.input = prefix
      this.caret = prefix.length
    } else {
      this.setToast(`${hits.length} commands match — keep typing, or Ctrl+P for the palette.`, 2500)
    }
    this.requestRender(0)
  }

  scrollBy(delta) {
    if (delta > 0) this.follow = false
    this.scrollOffset = Math.max(0, this.scrollOffset + delta)
    if (this.scrollOffset === 0) this.follow = true
    this.requestRender(0)
  }

  scrollTop() {
    this.follow = false
    this.scrollOffset = this.lastMaxOffset
    this.requestRender(0)
  }

  scrollBottom() {
    this.follow = true
    this.scrollOffset = 0
    this.requestRender(0)
  }

  // ---- commands ----------------------------------------------------------

  async handleCommand(text) {
    const [head, ...rest] = text.trim().split(/\s+/)
    const arg = rest.join(' ')
    const cmd = head.toLowerCase()
    try {
      switch (cmd) {
        case '/help': this.openHelp(); return
        case '/new': await this.newChat(); return
        case '/sessions': await this.refreshSessions(); this.openPicker(); return
        case '/use': await this.useSession(arg); return
        case '/rm': await this.removeSession(arg); return
        case '/status': this.openInfo('STATUS', statusLines(this.state, this.c)); return
        case '/btw': await this.sideQuestion(arg); return
        case '/stop': await this.stopRun(); return
        case '/model':
          if (!arg) { this.openPalette('models'); return }
          this.state.model = arg === 'auto' ? '' : arg
          this.setToast(`Model: ${this.state.model || 'each assistant’s default'}`)
          return
        case '/models': this.openInfo('MODELS', modelLines(this.state, this.c)); return
        case '/agents': this.openInfo('ASSISTANTS', agentLines(this.state, this.c)); return
        case '/quota': await this.showQuota(); return
        case '/instructor':
          if (!arg) { this.openPalette('planners'); return }
          await this.setInstructor(arg)
          return
        case '/cwd': await this.setFolder(arg); return
        case '/rename': await this.rename(arg); return
        case '/plan': await this.startPlanOnly(arg); return
        case '/chain': await this.startChain(arg.replace(/\\n/g, '\n')); return
        case '/direct': await this.startDirect(rest[0], rest.slice(1).join(' ')); return
        case '/pin': await this.togglePin(arg); return
        case '/export': await this.exportChat(arg); return
        case '/clear': this.cache.clear(); this.scrollBottom(); return
        case '/palette': this.openPalette('commands'); return
        case '/sidebar': this.toggleSidebar(); return
        case '/tui': this.setToast('You are already in the full-screen view.'); return
        case '/quit': case '/exit': this.quit(0); return
        default: this.setToast(unknownCommand(cmd)); return
      }
    } catch (e) {
      this.setToast(e.message || String(e), 8000)
    }
  }

  openHelp() {
    const c = this.c
    this.overlay = {
      type: 'info',
      title: 'HELP',
      lines: [
        c.bold('COMPOSE'),
        '  Enter send · Alt+Enter newline · ↑/↓ history at the edges',
        '  ←/→/Home/End caret · Ctrl+W delete word · Ctrl+U/K clear',
        '',
        c.bold('WORK'),
        '  Type a task, review the plan, then Enter to run it.',
        '  s skips a ready plan · Ctrl+C stops work or clears input.',
        '',
        c.bold('MOVE'),
        '  PgUp/PgDn or wheel scrolls · Esc jumps to newest',
        '  Ctrl+B shows/hides the sidebar · Ctrl+L redraws',
        '',
        c.bold('PALETTE'),
        '  Ctrl+P opens commands · Ctrl+O chats · Ctrl+N new chat',
        '  Type to search · ↑/↓ choose · Enter select · Esc cancel',
        '',
        c.bold('COMMANDS'),
        '  /new  /sessions  /use <n>  /rm <n>  /status',
        '  /btw <text>  /stop  /model [ref|auto]  /models  /agents  /quota',
        '  /instructor [id]  /cwd [path]  /rename <title>',
        '  /plan <text>  /chain <script>  /direct <agent> <p>',
        '  /pin <step>  /export [path]  /clear  /palette  /sidebar',
        '',
        c.dim('Shift+drag to select text (terminal selection).'),
      ],
    }
    this.requestRender(0)
  }

  async showQuota() {
    try {
      const r = await this.client.api('GET', '/api/quota', undefined, { timeout: 6000 })
      if (r.ok) this.state.quota = r.data
    } catch {}
    this.openInfo('QUOTA', quotaLines(this.state, this.c))
  }

  openInfo(title, lines) {
    this.overlay = { type: 'info', title, lines, scroll: 0 }
    this.requestRender(0)
  }

  openPicker() {
    this.overlay = { type: 'picker', index: 0, title: 'CHATS' }
    const idx = (this.state.sessions || []).findIndex((s) => s.id === this.state.session?.id)
    if (idx >= 0) this.overlay.index = idx
    this.requestRender(0)
  }

  async refreshSessions() {
    try {
      const r = await this.client.api('GET', '/api/bootstrap', undefined, { timeout: 6000 })
      if (r.ok) { applyBootstrap(this.state, r.data); this.cache.clear() }
    } catch {}
  }

  async pickSession() {
    const list = this.state.sessions || []
    const s = list[this.overlay?.index]
    if (!s) { this.overlay = null; return }
    if (s.id === this.state.session?.id) { this.overlay = null; this.requestRender(0); return }
    if (this.state.busy || this.running || this.planning) {
      this.setToast(COPY.sessionBusy)
      return
    }
    let r
    try {
      r = await this.client.api('POST', `/api/session/${encodeURIComponent(s.id)}`, {}, { timeout: 6000 })
    } catch (e) {
      this.overlay = null
      this.setToast(e.message, 8000)
      return
    }
    if (!r.ok) { this.setToast(plainError(r)); return }
    await this.resync(false)
    this.overlay = null
    this.setToast(`Now showing "${this.state.session?.title}".`)
  }

  async useSession(arg) {
    if (!arg) { this.setToast('Use: /use <number or chat id>'); return }
    await this.refreshSessions()
    const s = resolveSession(this.state, arg)
    if (!s) { this.setToast(COPY.unknownChat); return }
    if (s.id === this.state.session?.id) { this.setToast(`Already showing "${s.title}".`); return }
    if (this.state.busy || this.running || this.planning) { this.setToast(COPY.sessionBusy); return }
    const r = await this.client.api('POST', `/api/session/${encodeURIComponent(s.id)}`, {}, { timeout: 6000 })
    if (!r.ok) { this.setToast(plainError(r)); return }
    await this.resync(false)
    this.setToast(`Now showing "${this.state.session?.title}".`)
  }

  async newChat() {
    if (this.state.busy || this.running || this.planning) { this.setToast(COPY.sessionBusy); return }
    const r = await this.client.api('POST', '/api/session', {}, { timeout: 6000 })
    if (!r.ok) { this.setToast(plainError(r)); return }
    await this.resync(false)
    this.setToast(`New chat: "${this.state.session?.title}".`)
  }

  async removeSession(arg) {
    if (!arg) { this.setToast('Use: /rm <number or chat id>'); return }
    await this.refreshSessions()
    const s = resolveSession(this.state, arg)
    if (!s) { this.setToast(COPY.unknownChat); return }
    if (s.id === this.state.session?.id) { this.setToast('Switch to another chat before deleting this one.'); return }
    const r = await this.client.api('DELETE', `/api/session/${encodeURIComponent(s.id)}`, undefined, { timeout: 6000 })
    if (!r.ok) { this.setToast(plainError(r)); return }
    await this.resync(false)
    this.setToast(`Deleted "${s.title}".`)
  }

  async sideQuestion(text) {
    const q = String(text || '').trim()
    if (!q) { this.setToast('Use: /btw <question>'); return }
    if (q.length > 4000) this.setToast(COPY.sideTooLong)
    const r = await this.client.api('POST', '/api/btw', { text: q }, { timeout: 8000 })
    if (!r.ok) { this.setToast(plainError(r, COPY.noSideAgent)); return }
    this.setToast(`Side answer requested · ${agentLabel(this.state, r.data?.agent)}`)
  }

  async stopRun() {
    this.planToken = (this.planToken || 0) + 1
    try { await this.client.api('POST', '/api/stop', {}, { timeout: 2000 }) } catch {}
    this.running = false
    this.planning = false
    this.setToast(COPY.stopped)
  }

  async setInstructor(arg) {
    if (!arg) { this.openInfo('PLANNER', instructorLines(this.state, this.c)); return }
    const r = await this.client.api('POST', '/api/instructor', { instructor: arg }, { timeout: 6000 })
    if (!r.ok) { this.setToast(plainError(r, `Unknown planner: ${arg}`)); return }
    if (this.state.session) this.state.session.instructor = r.data.instructor
    this.setToast(`Planner: ${arg === 'auto' ? 'auto' : instructorName(this.state, arg)}`)
  }

  async setFolder(arg) {
    if (!arg) { this.openInfo('FOLDER', [`Folder: ${this.state.session?.cwd || 'not set'}`]); return }
    const path = resolveFolder(arg)
    try { if (!statSync(path).isDirectory()) throw new Error('not a folder') } catch { this.setToast(`That folder doesn't exist: ${path}`); return }
    const r = await this.client.api('POST', '/api/cwd', { cwd: path }, { timeout: 6000 })
    if (!r.ok) { this.setToast(plainError(r)); return }
    if (this.state.session) this.state.session.cwd = r.data.cwd
    this.setToast(`Folder: ${r.data.cwd}`)
  }

  async rename(arg) {
    if (!arg) { this.setToast('Use: /rename <title>'); return }
    const r = await this.client.api('POST', '/api/rename', { title: arg }, { timeout: 6000 })
    if (!r.ok) { this.setToast(plainError(r)); return }
    if (this.state.session) this.state.session.title = r.data.session.title
    this.setToast(`Renamed to "${r.data.session.title}".`)
  }

  async togglePin(arg) {
    const n = Number(arg)
    const plan = lastPlan(this.state)
    if (!plan || !Number.isInteger(n) || n < 1) { this.setToast('Use: /pin <step number>'); return }
    const planIndex = messagesOf(this.state).findIndex((m) => m.id === plan.id)
    const steps = messagesOf(this.state).slice(planIndex + 1).filter((m) => m.role === 'step' && m.kind !== 'btw')
    const step = steps[n - 1]
    if (!step) { this.setToast('No step with that number.'); return }
    const on = !(this.state.session.pinned || []).some((p) => p.stepId === step.id)
    const r = await this.client.api('POST', '/api/pin', { stepId: step.id, on }, { timeout: 6000 })
    if (!r.ok) { this.setToast(plainError(r)); return }
    this.state.session.pinned = r.data.pinned
    this.setToast(on ? `Pinned step ${n}.` : `Unpinned step ${n}.`)
  }

  async exportChat(arg) {
    const file = arg ? expandFolder(arg) : `relay-${this.state.session.id}.json`
    const target = (() => {
      try { return statSync(file).isDirectory() ? join(file, `relay-${this.state.session.id}.json`) : file } catch { return file }
    })()
    try {
      writeFileSync(target, JSON.stringify(this.state.session, null, 2), 'utf8')
      this.setToast(`Wrote ${resolve(target)}`, 6000)
    } catch (e) {
      this.setToast(`Couldn't write the export: ${e.message}`)
    }
  }

  async forceReconnect() {
    this.setToast('Reconnecting…')
    try {
      await this.client.ensureServer({ quiet: true })
      await this.resync(false)
      this.setToast(COPY.reconnected)
    } catch (e) {
      this.setToast(e.message, 8000)
    }
  }
}

function resolveSession(state, ref) {
  const s = String(ref || '').trim()
  if (!s) return null
  if (/^\d+$/.test(s)) return (state.sessions || [])[Number(s) - 1] || null
  return (state.sessions || []).find((x) => x.id === s) || null
}

function resolveFolder(value) {
  return resolve(expandFolder(value))
}

function expandFolder(value) {
  const s = String(value || '')
  if (s === '~') return homedir()
  if (s.startsWith('~/') || s.startsWith('\\~')) return join(homedir(), s.slice(2))
  if (s.startsWith('~\\')) return join(homedir(), s.slice(2))
  return s
}

function prevCharIndex(text, index) {
  if (index <= 0) return 0
  const code = text.charCodeAt(index - 1)
  if (code >= 0xdc00 && code <= 0xdfff && index >= 2) return index - 2
  return index - 1
}

function nextCharIndex(text, index) {
  if (index >= text.length) return text.length
  const code = text.charCodeAt(index)
  if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) return index + 2
  return index + 1
}

function plainError(r, fallback = 'Relay could not finish that.') {
  const err = String(r?.data?.error || '')
  if (r?.status === 409) {
    if (/side answer/i.test(err)) return COPY.sideBusy
    if (/switching|session/i.test(err)) return COPY.sessionBusy
    return COPY.activeRun
  }
  if (r?.status === 404) {
    if (/plan/i.test(err)) return COPY.unknownPlan
    if (/session|chat/i.test(err)) return COPY.unknownChat
  }
  if (r?.status === 503 && /side agent/i.test(err)) return COPY.noSideAgent
  return err || fallback
}

function statusIcon(c, status) {
  if (status === 'done') return c.green('✓')
  if (status === 'failed' || status === 'quota') return c.red('✗')
  if (status === 'timeout') return c.yellow('!')
  if (status === 'running') return c.yellow('●')
  if (status === 'stopped' || status === 'skipped') return c.dim('–')
  return c.dim('○')
}

function statusColor(c, status) {
  if (status === 'done') return c.green
  if (status === 'failed' || status === 'quota') return c.red
  if (status === 'timeout') return c.yellow
  if (status === 'stopped') return c.dim
  return c.yellow
}
