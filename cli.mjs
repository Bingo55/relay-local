#!/usr/bin/env node
// Relay terminal client: one-shot commands, a streaming REPL, and a full-screen TUI.
import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import readline from 'node:readline'
import { createClient, DEFAULT_URL, ROOT } from './lib/cli/client.mjs'
import { parseArgs, usage } from './lib/cli/args.mjs'
import { createColors, detectColorDepth, COPY, statusLabel, statusLines, sessionLines, modelLines, agentLines, instructorLines, quotaLines, planLines, summaryLines, summarySentence, agentLabel, changedFiles, formatDuration, normalizeText, wrapText, twoSides, padTo, truncate, unknownCommand, sessionChanged, instructorName, parsePorcelainLine } from './lib/cli/format.mjs'
import { createState, applyBootstrap, applyEvent, lastPlan, lastRunGroup, summarizeGroup, lastRunSummary, waitForRun, waitForBtw, waitForBusyFalse, messagesOf, hasRunningBtw } from './lib/cli/state.mjs'

const VERSION = '0.1.0'
const VERSION_TEXT = `relay ${VERSION} · Node ${process.versions.node}`
const INT = { count: 0, controller: new AbortController() }
let interrupted = false

const stdout = (s = '') => process.stdout.write(`${s}\n`)
const stderr = (s = '') => process.stderr.write(`${s}\n`)

function fail(code, message, flags) {
  if (flags?.json && code !== 2) {
    process.stdout.write(JSON.stringify({ ok: false, exitCode: code, error: message }) + '\n')
  } else if (message) stderr(message)
  return code
}

function networkCode(err) {
  return err?.code === 'unreachable' || err?.code === 'timeout' || err?.code === 'down' ||
    err?.code === 'port-busy' || err?.code === 'start-failed' ? 3 : 1
}

function plainApiError(r, fallback = 'Relay could not finish that.') {
  const err = String(r?.data?.error || '')
  if (r?.status === 409) {
    if (/side answer/i.test(err)) return COPY.sideBusy
    if (/switching|session/i.test(err)) return COPY.sessionBusy
    return COPY.activeRun
  }
  if (r?.status === 404) {
    if (/plan/i.test(err)) return COPY.unknownPlan
    if (/session|chat/i.test(err)) return COPY.unknownChat
    return fallback
  }
  if (r?.status === 503 && /side agent/i.test(err)) return COPY.noSideAgent
  if (r?.status === 400 && /text required/i.test(err)) return 'Type what you want done first.'
  if (r?.status === 500) return `The planner couldn't make a plan: ${err || 'unknown error'}`
  return err || fallback
}

async function connect(client, state, flags, { session = '' } = {}) {
  try {
    await client.ensureServer({ noStart: flags.noStart })
  } catch (e) {
    return { code: 3, error: e.message }
  }
  let r
  try {
    r = await client.api('GET', '/api/bootstrap', undefined, { timeout: 6000 })
  } catch (e) {
    return { code: 3, error: e.message }
  }
  if (!r.ok) return { code: 3, error: plainApiError(r, 'Relay did not return its state.') }
  applyBootstrap(state, r.data)

  const target = session || flags.session
  if (target && target !== state.session?.id) {
    try {
      const s = await client.api('POST', `/api/session/${encodeURIComponent(target)}`, {}, { timeout: 6000 })
      if (!s.ok) return { code: 1, error: plainApiError(s) }
      state.session = s.data.session
    } catch (e) {
      return { code: 3, error: e.message }
    }
    try {
      const again = await client.api('GET', '/api/bootstrap', undefined, { timeout: 6000 })
      if (again.ok) applyBootstrap(state, again.data)
    } catch {}
  }
  return { code: 0 }
}

function sanitizePlan(plan) {
  if (!plan) return null
  return {
    id: plan.id,
    task: plan.task,
    note: plan.note || '',
    via: plan.via || '',
    model: plan.model || '',
    at: plan.at,
    steps: (plan.steps || []).map((s) => ({
      ...(s.agent ? { agent: s.agent } : {}),
      ...(s.agents?.length ? { agents: s.agents } : {}),
      prompt: s.prompt,
      why: s.why || '',
      ...(s.model ? { model: s.model } : {}),
    })),
  }
}

function sanitizeStep(m) {
  return {
    n: m.n,
    agent: m.agent,
    label: m.label || agentLabel({ agents: [] }, m.agent),
    status: m.status,
    durationMs: m.durationMs ?? null,
    text: m.text || '',
    git: m.git || null,
    fallback: m.fallback || null,
    ...(m.kind ? { kind: m.kind } : {}),
    ...(m.question ? { question: m.question } : {}),
  }
}

function jsonResult({ ok, exitCode, ran, command, state, plan = null, steps = [], summary = null, error = null, extra = {} }) {
  const session = state?.session
    ? { id: state.session.id, title: state.session.title, cwd: state.session.cwd }
    : null
  return {
    ok,
    exitCode,
    ran,
    command,
    session,
    plan: sanitizePlan(plan),
    steps: (steps || []).filter((m) => m.kind !== 'btw').map(sanitizeStep),
    summary,
    error,
    ...extra,
  }
}

class OneShotView {
  constructor({ state, colors, json = false, onPlan = null, width = 80, onlyBtw = false }) {
    this.state = state
    this.c = colors
    this.json = json
    this.onPlan = onPlan
    this.width = width
    this.onlyBtw = onlyBtw
    this.views = new Map()
    this.planIds = new Set()
    this.runNotice = ''
  }

  write(text) { if (!this.json) process.stdout.write(text) }

  handle(ev) {
    if (!ev?.type) return
    if (this.onlyBtw) {
      if (ev.type === 'notice') return
      if (ev.type === 'message' && !(ev.message?.role === 'step' && ev.message.kind === 'btw')) return
      if (ev.type === 'message.update' && !this.views.has(ev.message?.id)) return
    }
    if (ev.type === 'message') {
      const m = ev.message
      if (!m) return
      if (m.role === 'user') {
        this.write(`\n${this.c.bold('YOU')} ${this.c.dim(timeText(m.at))}\n${normalizeText(m.text)}\n`)
      } else if (m.role === 'plan') {
        if (!this.planIds.has(m.id)) {
          this.planIds.add(m.id)
          this.onPlan?.(m)
        }
      } else if (m.role === 'note') {
        this.write(`\n${this.c.dim('NOTE · ' + normalizeText(m.text))}\n`)
      } else if (m.role === 'step') {
        this.startStep(m, ev)
      }
      return
    }
    if (ev.type === 'delta') {
      const v = this.views.get(ev.id)
      if (v) this.delta(v, String(ev.text ?? ''))
      return
    }
    if (ev.type === 'message.update') {
      const v = this.views.get(ev.message?.id)
      if (v) this.finishStep(v, ev.message)
      return
    }
    if (ev.type === 'notice') {
      if (/^run failed:/i.test(ev.text || '')) this.runNotice = ev.text
      return
    }
  }

  startStep(m, ev) {
    const v = {
      id: m.id, msg: m, printedRaw: 0, pending: '', anyDelta: false,
      rewrite: false, ended: false,
    }
    this.views.set(m.id, v)
    if (m.kind === 'btw') {
      this.write(`\n${this.c.bold(this.c.amber('SIDE ANSWER'))} ${this.c.dim('· ' + (m.label || agentLabel(this.state, m.agent)))}\n`)
      if (m.question) this.write(this.c.dim(`Q: ${m.question}`) + '\n')
      this.write(this.c.dim('A:') + '\n')
      return
    }
    const group = lastRunGroup(this.state)
    const total = lastPlan(this.state)?.steps?.length || group.plan?.steps?.length || Math.max(1, m.n || 1)
    this.write(`\n${this.c.bold(`STEP ${m.n || 1} of ${total}`)} ${this.c.dim('· ' + (m.label || agentLabel(this.state, m.agent)))}\n`)
  }

  delta(v, text) {
    if (!text.startsWith(v.lastRaw || '')) {
      v.rewrite = true
      v.lastRaw = text
      return
    }
    const suffix = text.slice(v.printedRaw)
    v.printedRaw = text.length
    v.lastRaw = text
    v.anyDelta = true
    this.emitLines(v, suffix)
  }

  emitLines(v, text) {
    v.pending += normalizeText(text)
    const parts = v.pending.split('\n')
    v.pending = parts.pop() || ''
    for (const line of parts) {
      if (v.msg?.kind === 'btw') this.write(this.c.dim('   ') + line + '\n')
      else this.write('  ' + line + '\n')
    }
  }

  finishStep(v, m) {
    if (v.ended) return
    v.ended = true
    const text = normalizeText(m.text || '')
    if (!v.anyDelta && !v.rewrite) {
      this.emitLines(v, text)
    } else if (v.rewrite) {
      this.write('  ' + this.c.dim('— final output —') + '\n')
      for (const line of text.split('\n')) this.write('  ' + line + '\n')
    }
    if (v.pending) {
      this.write((v.msg?.kind === 'btw' ? '   ' : '  ') + v.pending + '\n')
      v.pending = ''
    }
    const label = m.label || agentLabel(this.state, m.agent)
    const stateText = m.status === 'done'
      ? `done in ${formatDuration(m.durationMs)}`
      : m.status === 'failed' && m.exitCode != null
        ? `didn't finish (exit ${m.exitCode})`
        : statusLabel(m.status)
    if (m.kind === 'btw') {
      this.write(`\n${this.c.dim('SIDE ANSWER · ' + label + ' · ' + stateText)}\n`)
    } else {
      this.write(`${this.c.bold(`STEP ${m.n || 1}`)} ${this.c.dim('· ' + label)}  ${statusColor(this.c, m.status)(stateText)}\n`)
    }
    if (m.fallback?.length) {
      const f = m.fallback[m.fallback.length - 1]
      this.write(this.c.yellow(`  ${f.reason === 'quota' ? `${f.from} ran out of free credits — Relay switched to ${f.to} for you.` : `${f.from} was cooling — Relay switched to ${f.to}.`}`) + '\n')
    }
    const files = (m.git?.after?.files || []).map((raw) => parsePorcelainLine(raw).path).slice(0, 3)
    if (files.length && m.kind !== 'btw') this.write(this.c.dim(`  Folder now: ${files.join(', ')}`) + '\n')
    if (m.status === 'failed') this.write(this.c.dim('  Next: read the lines above, or ask Relay to try again.') + '\n')
    this.write('\n')
  }
}

function statusColor(c, status) {
  if (status === 'done') return c.green
  if (status === 'failed' || status === 'quota') return c.red
  if (status === 'timeout') return c.yellow
  if (status === 'stopped') return c.dim
  return c.yellow
}

function timeText(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function expandHome(p) {
  const s = String(p || '')
  if (s === '~') return homedir()
  if (s.startsWith('~/') || s.startsWith('~\\')) return join(homedir(), s.slice(2))
  return s
}

function resolveSession(state, ref) {
  const list = state.sessions || []
  const s = String(ref ?? '').trim()
  if (!s) return null
  if (/^\d+$/.test(s)) {
    const i = Number(s) - 1
    return i >= 0 && i < list.length ? list[i] : null
  }
  return list.find((x) => x.id === s) || null
}

async function writeExport(state, path) {
  const file = path ? expandHome(path) : `relay-${state.session.id}.json`
  const target = (() => {
    try { return statSync(file).isDirectory() ? join(file, `relay-${state.session.id}.json`) : file } catch { return file }
  })()
  writeFileSync(target, JSON.stringify(state.session, null, 2), 'utf8')
  return resolve(target)
}

function installInterrupt(client, flags) {
  const onSigint = () => {
    INT.count++
    if (INT.count === 1) {
      interrupted = true
      INT.controller.abort()
      if (!flags.json) stderr('\nStopped.')
      client?.api('POST', '/api/stop', {}, { timeout: 2000 }).catch(() => {})
    } else {
      process.exitCode = 130
      process.exit(130)
    }
  }
  process.on('SIGINT', onSigint)
  return () => process.off('SIGINT', onSigint)
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  const { flags } = parsed
  const colorsOut = createColors({ enabled: !!process.stdout.isTTY && !flags.noColor && detectColorDepth() !== 1 })
  const colorsErr = createColors({ enabled: !!process.stderr.isTTY && !flags.noColor && detectColorDepth() !== 1 })

  if (parsed.errors.length) {
    for (const e of parsed.errors) stderr(colorsErr.red(e))
    stderr(`Try: relay --help`)
    return 2
  }
  if (flags.help) { stdout(usage(colorsOut)); return 0 }
  if (flags.version) { stdout(VERSION_TEXT); return 0 }

  const command = parsed.command
  const needTty = command === '' || command === 'chat' || command === 'tui'
  if (flags.json && needTty) {
    stderr(colorsErr.red('--json works with one-shot commands only. Try: relay --json "your task"'))
    return 2
  }
  if (needTty && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    stderr(colorsErr.red(COPY.noTty))
    stderr(usage(colorsErr))
    return 2
  }

  if (command === '' || command === 'tui') {
    const { runTui } = await import('./lib/cli/tui.mjs')
    return runTuiCommand(runTui, { flags, parsed })
  }
  if (command === 'chat') {
    return runReplCommand({ flags, parsed })
  }

  const client = createClient({ baseUrl: flags.url || process.env.RELAY_URL || DEFAULT_URL, debug: flags.debug })
  const state = createState({ model: flags.model || '' })
  const connected = await connect(client, state, flags)
  if (connected.code !== 0) {
    return fail(connected.code, connected.error, flags)
  }

  const removeInterrupt = installInterrupt(client, flags)
  try {
    switch (command) {
      case 'task': return await cmdTask({ client, state, flags, task: parsed.task, colors: colorsOut })
      case 'plan': return await cmdPlan({ client, state, flags, task: parsed.task, colors: colorsOut })
      case 'run': return await cmdRun({ client, state, flags, args: parsed.args, colors: colorsOut })
      case 'chain': return await cmdChain({ client, state, flags, args: parsed.args, colors: colorsOut })
      case 'direct': return await cmdDirect({ client, state, flags, args: parsed.args, colors: colorsOut })
      case 'btw': return await cmdBtw({ client, state, flags, args: parsed.args, colors: colorsOut })
      case 'stop': {
        const r = await client.api('POST', '/api/stop', {}, { timeout: 4000 })
        if (!r.ok) return fail(1, plainApiError(r), flags)
        if (flags.json) stdout(JSON.stringify({ ok: true, exitCode: 0, command: 'stop', stopped: true }))
        else stdout(COPY.stopped)
        return 0
      }
      case 'status': {
        if (flags.json) { stdout(JSON.stringify({ ok: true, exitCode: 0, command: 'status', session: { id: state.session.id, title: state.session.title, cwd: state.session.cwd }, status: { busy: state.busy, model: state.model, planner: state.session.instructor } }, null, 0)); return 0 }
        stdout(statusLines(state, colorsOut).join('\n'))
        return 0
      }
      case 'sessions': {
        if (flags.json) { stdout(JSON.stringify({ ok: true, exitCode: 0, command: 'sessions', sessions: state.sessions, active: state.session.id })); return 0 }
        stdout(sessionLines(state, colorsOut).join('\n'))
        return 0
      }
      case 'use': return await cmdUse({ client, state, flags, args: parsed.args, colors: colorsOut })
      case 'new': return await cmdNew({ client, state, flags, colors: colorsOut })
      case 'rm': return await cmdRm({ client, state, flags, args: parsed.args, colors: colorsOut })
      case 'rename': return await cmdRename({ client, state, flags, args: parsed.args, colors: colorsOut })
      case 'cwd': return await cmdCwd({ client, state, flags, args: parsed.args, colors: colorsOut })
      case 'instructor': return await cmdInstructor({ client, state, flags, args: parsed.args, colors: colorsOut })
      case 'models': {
        if (flags.json) { stdout(JSON.stringify({ ok: true, exitCode: 0, command: 'models', agents: (state.agents || []).map((a) => ({ id: a.id, label: a.label, models: a.models || [], disabled: !!a.disabled })) })); return 0 }
        stdout(modelLines(state, colorsOut).join('\n'))
        return 0
      }
      case 'agents': {
        if (flags.json) { stdout(JSON.stringify({ ok: true, exitCode: 0, command: 'agents', agents: (state.agents || []).map((a) => ({ id: a.id, label: a.label, roles: a.roles || [], disabled: !!a.disabled, note: a.note || '' })) })); return 0 }
        stdout(agentLines(state, colorsOut).join('\n'))
        return 0
      }
      case 'quota': return await cmdQuota({ client, state, flags, args: parsed.args, colors: colorsOut })
      case 'export': return await cmdExport({ state, flags, args: parsed.args, colors: colorsOut })
      default: return fail(2, `Unknown command: ${command}`, flags)
    }
  } catch (e) {
    if (flags.debug) stderr(e?.stack || String(e))
    return fail(networkCode(e), e?.message || String(e), flags)
  } finally {
    removeInterrupt()
  }
}

async function askApproval(colors) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  let canceled = false
  try {
    const answer = await new Promise((resolve) => {
      rl.once('SIGINT', () => {
        canceled = true
        rl.close()
        resolve('')
      })
      rl.question(colors.bold(colors.yellow('Run this?  Enter = run · n = skip  ')), resolve)
    })
    if (canceled) {
      interrupted = true
      return false
    }
    return !/^\s*n/i.test(answer)
  } finally {
    rl.close()
  }
}

function printPlan(colors, state, plan, approval = false) {
  const width = process.stdout.columns || 80
  const lines = planLines(state, plan, colors, { width, approval })
  stdout(lines.join('\n'))
}

function printSummary(colors, summary) {
  stdout('')
  stdout(summaryLines(summary, colors).join('\n'))
}

function attachView(client, state, view) {
  let opened = false
  const refresh = () => {
    client.api('GET', '/api/bootstrap', undefined, { timeout: 6000 }).then((b) => {
      if (b.ok) applyBootstrap(state, b.data)
    }).catch(() => {})
  }
  const sse = client.openEvents({
    onEvent: (ev) => {
      const r = applyEvent(state, ev)
      if (r.resync) refresh()
      view.handle(ev)
    },
    onOpen: () => {
      if (opened) refresh()
      opened = true
    },
  })
  return sse
}

function planFromResponse(state, data) {
  const plan = data?.plan || null
  if (plan) {
    const r = applyEvent(state, {
      type: 'message',
      message: plan,
      sessionId: state.session?.id,
    })
    if (r.resync) state.session?.messages?.push(plan)
  }
  return plan
}

async function cmdPlan({ client, state, flags, task, colors }) {
  if (!task) return fail(2, 'Type what you want planned.', flags)
  let r
  try {
    r = await client.api('POST', '/api/plan', {
      text: task, auto: false, model: flags.model || '', instructor: flags.instructor || undefined,
    }, { signal: INT.controller.signal })
  } catch (e) {
    if (interrupted) return 130
    return fail(3, e.message, flags)
  }
  if (interrupted) return 130
  if (!r.ok) {
    if (r.status === 409) return fail(1, COPY.activeRun, flags)
    const msg = r.status === 500 ? `The planner couldn't make a plan: ${r.data?.error || 'unknown error'}` : plainApiError(r)
    return fail(1, msg, flags)
  }
  if (r.data?.stopped) {
    if (flags.json) stdout(JSON.stringify({ ok: true, exitCode: 0, ran: false, command: 'plan', stopped: true, error: null }))
    else stdout(colors.yellow(COPY.plannerStopped))
    return 0
  }
  const plan = planFromResponse(state, r.data)
  if (!plan || !plan.steps?.length) return fail(1, COPY.noPlanSteps, flags)
  if (flags.json) {
    stdout(JSON.stringify(jsonResult({ ok: true, exitCode: 0, ran: false, command: 'plan', state, plan, summary: null })))
    return 0
  }
  printPlan(colors, state, plan)
  return 0
}

async function cmdTask({ client, state, flags, task, colors }) {
  if (!task) return fail(2, 'Type what you want done.', flags)
  if (flags.planOnly) return cmdPlan({ client, state, flags, task, colors })

  const view = new OneShotView({ state, colors, json: flags.json, width: process.stdout.columns || 80 })
  let planPrinted = false
  const showPlan = (plan, approval = false) => {
    if (!plan || planPrinted) return
    planPrinted = true
    if (!flags.json) printPlan(colors, state, plan, approval)
  }
  // For auto runs, the plan can arrive after the first step starts. Print it
  // as soon as it appears. Manual runs print it from the HTTP response before
  // asking for approval.
  view.onPlan = (m) => { if (flags.auto) showPlan(m, false) }

  const sse = attachView(client, state, view)
  try {
    try { await sse.waitForOpen() } catch (e) { return fail(3, e.message, flags) }

    const body = { text: task, auto: !!flags.auto, model: flags.model || '', instructor: flags.instructor || undefined }
    let r
    try { r = await client.api('POST', '/api/plan', body, { signal: INT.controller.signal }) } catch (e) {
      if (interrupted) return 130
      return fail(3, e.message, flags)
    }
    if (interrupted) return 130
    if (!r.ok) {
      if (r.status === 409) return fail(1, COPY.activeRun, flags)
      const msg = r.status === 500 ? `The planner couldn't make a plan: ${r.data?.error || 'unknown error'}` : plainApiError(r)
      return fail(1, msg, flags)
    }
    if (r.data?.stopped) {
      if (flags.json) stdout(JSON.stringify({ ok: true, exitCode: 0, ran: false, command: 'task', stopped: true, error: null }))
      else stdout(colors.yellow(COPY.plannerStopped))
      return 0
    }
    const plan = planFromResponse(state, r.data)
    if (!plan || !plan.steps?.length) return fail(1, COPY.noPlanSteps, flags)
    showPlan(plan, !flags.yes && !flags.auto)

    if (flags.auto) {
      const done = await waitForRun(state, { auto: true, planId: plan.id, runRequested: true, signal: INT.controller.signal })
      return await finishOneShot({ done, state, flags, colors, command: 'task', plan, view, planPrinted: true })
    }

    let approved = !!flags.yes
    if (!approved && flags.json) approved = false
    else if (!approved) approved = await askApproval(colors)
    if (interrupted) return 130
    if (!approved) {
      if (!flags.json) {
        stdout(colors.dim(process.stdin.isTTY ? COPY.skipped : 'Plan only (no terminal to ask). Re-run with --yes to run it.'))
      }
      if (flags.json) {
        stdout(JSON.stringify(jsonResult({ ok: true, exitCode: 0, ran: false, command: 'task', state, plan, summary: null })))
      }
      return 0
    }

    let run
    try { run = await client.api('POST', '/api/run', { planId: plan.id, model: flags.model || '' }, { signal: INT.controller.signal }) } catch (e) {
      if (interrupted) return 130
      return fail(3, e.message, flags)
    }
    if (interrupted) return 130
    if (!run.ok) return fail(run.status === 404 ? 1 : 1, plainApiError(run), flags)
    const done = await waitForRun(state, { auto: false, planId: plan.id, runRequested: true, signal: INT.controller.signal })
    return await finishOneShot({ done, state, flags, colors, command: 'task', plan, view, planPrinted: true })
  } finally {
    sse.close()
  }
}

async function finishOneShot({ done, state, flags, colors, command, plan = null, view, planPrinted }) {
  if (done.status === 'interrupted' || interrupted) {
    if (!flags.json) stdout(colors.yellow(COPY.stopped))
    return 130
  }
  if (done.status === 'nostart') {
    if (flags.json) {
      stdout(JSON.stringify({ ok: false, exitCode: 1, ran: false, command, error: 'The run did not start.' }))
    } else {
      stdout(colors.yellow('The run did not start. Nothing ran.'))
    }
    return 1
  }
  const group = done.group || lastRunGroup(state)
  const summary = done.summary || summarizeGroup(group)
  const failed = !!view?.runNotice || summary.problems > 0
  const code = failed ? 1 : 0
  if (flags.json) {
    stdout(JSON.stringify(jsonResult({
      ok: !failed, exitCode: code, ran: summary.total > 0, command,
      state, plan, steps: group?.steps || [], summary,
      error: failed ? (view?.runNotice || 'One or more steps had a problem.') : null,
    })))
    return code
  }
  printSummary(colors, summary)
  if (failed) stdout(colors.yellow('One or more steps had a problem.'))
  return code
}

async function cmdRun({ client, state, flags, args, colors }) {
  const plan = args[0]
    ? (messagesOf(state).find((m) => m.id === args[0] && m.role === 'plan') || null)
    : lastPlan(state)
  if (args[0] && !plan) return fail(1, COPY.unknownPlan, flags)
  if (!plan) return fail(2, 'There is no plan in this chat yet. Try: relay plan "your task"', flags)
  if (!flags.json) printPlan(colors, state, plan)
  const view = new OneShotView({ state, colors, json: flags.json, width: process.stdout.columns || 80 })
  view.planIds.add(plan.id)
  const sse = attachView(client, state, view)
  try {
    try { await sse.waitForOpen() } catch (e) { return fail(3, e.message, flags) }
    let r
    try { r = await client.api('POST', '/api/run', { planId: plan.id, model: flags.model || '' }, { signal: INT.controller.signal }) } catch (e) {
      if (interrupted) return 130
      return fail(3, e.message, flags)
    }
    if (interrupted) return 130
    if (!r.ok) return fail(1, plainApiError(r), flags)
    const done = await waitForRun(state, { auto: false, planId: plan.id, runRequested: true, signal: INT.controller.signal })
    return await finishOneShot({ done, state, flags, colors, command: 'run', plan, view, planPrinted: true })
  } finally { sse.close() }
}

async function cmdChain({ client, state, flags, args, colors }) {
  let text = ''
  const source = args[0]
  if (source && source !== '-') {
    try { text = readFileSync(expandHome(source), 'utf8') } catch (e) { return fail(1, `Couldn't read ${source}: ${e.message}`, flags) }
  } else if (!process.stdin.isTTY) {
    try { text = readFileSync(0, 'utf8') } catch (e) { return fail(1, `Couldn't read the chain: ${e.message}`, flags) }
  } else {
    return fail(2, 'Give a chain file, or pipe it in. Example: relay chain steps.txt', flags)
  }
  if (!text.trim()) return fail(2, 'The chain is empty.', flags)
  const view = new OneShotView({ state, colors, json: flags.json, width: process.stdout.columns || 80 })
  let plan = null
  let printed = false
  view.onPlan = (m) => { plan = m; if (!flags.json && !printed) { printed = true; printPlan(colors, state, m) } }
  const sse = attachView(client, state, view)
  try {
    try { await sse.waitForOpen() } catch (e) { return fail(3, e.message, flags) }
    let r
    try { r = await client.api('POST', '/api/chain', { text, task: flags.task || '', model: flags.model || '' }, { signal: INT.controller.signal }) } catch (e) {
      if (interrupted) return 130
      return fail(3, e.message, flags)
    }
    if (interrupted) return 130
    if (!r.ok) return fail(1, plainApiError(r), flags)
    plan = plan || r.data?.plan || null
    if (plan && !printed && !flags.json) { printed = true; printPlan(colors, state, plan) }
    const done = await waitForRun(state, { auto: false, runRequested: true, signal: INT.controller.signal })
    return await finishOneShot({ done, state, flags, colors, command: 'chain', plan, view, planPrinted: printed })
  } finally { sse.close() }
}

async function cmdDirect({ client, state, flags, args, colors }) {
  const agent = args[0]
  const prompt = args.slice(1).join(' ').trim()
  if (!agent || !prompt) return fail(2, 'Use: relay direct <agent|role> "prompt"', flags)
  const view = new OneShotView({ state, colors, json: flags.json, width: process.stdout.columns || 80 })
  const sse = attachView(client, state, view)
  try {
    try { await sse.waitForOpen() } catch (e) { return fail(3, e.message, flags) }
    let r
    try { r = await client.api('POST', '/api/dispatch', { agent, prompt, model: flags.model || '' }, { signal: INT.controller.signal }) } catch (e) {
      if (interrupted) return 130
      return fail(3, e.message, flags)
    }
    if (interrupted) return 130
    if (!r.ok) return fail(1, plainApiError(r, 'That assistant is not available.'), flags)
    const done = await waitForRun(state, { auto: false, runRequested: true, signal: INT.controller.signal })
    return await finishOneShot({ done, state, flags, colors, command: 'direct', view, planPrinted: true })
  } finally { sse.close() }
}

async function cmdBtw({ client, state, flags, args, colors }) {
  const question = args.join(' ').trim()
  if (!question) return fail(2, 'Ask a side question after "btw".', flags)
  if (question.length > 4000) stderr(colors.yellow(COPY.sideTooLong))
  const view = new OneShotView({ state, colors, json: flags.json, width: process.stdout.columns || 80, onlyBtw: true })
  const beforeIds = messagesOf(state)
    .filter((m) => m.role === 'step' && m.kind === 'btw')
    .map((m) => m.id)
  const sse = attachView(client, state, view)
  try {
    try { await sse.waitForOpen() } catch (e) { return fail(3, e.message, flags) }
    let r
    try { r = await client.api('POST', '/api/btw', { text: question }, { timeout: 8000, signal: INT.controller.signal }) } catch (e) {
      if (interrupted) return 130
      return fail(3, e.message, flags)
    }
    if (interrupted) return 130
    if (!r.ok) return fail(1, plainApiError(r, COPY.noSideAgent), flags)
    if (!flags.json && !flags.noWait) stdout(colors.dim(`Side answer requested · ${agentLabel(state, r.data?.agent)}`))
    if (flags.noWait) return 0
    const done = await waitForBtw(state, { question, afterIds: beforeIds, timeoutMs: 120_000, signal: INT.controller.signal })
    if (done.status === 'interrupted' || interrupted) return 130
    if (done.status === 'timeout') return fail(1, 'The side answer took too long.', flags)
    const step = done.step
    if (flags.json) {
      stdout(JSON.stringify({
        ok: step.status === 'done', exitCode: step.status === 'done' ? 0 : 1, ran: true,
        command: 'btw', step: sanitizeStep(step), error: step.status === 'done' ? null : `Side answer: ${statusLabel(step.status)}`,
      }))
      return step.status === 'done' ? 0 : 1
    }
    return step.status === 'done' ? 0 : 1
  } finally { sse.close() }
}

async function cmdUse({ client, state, flags, args, colors }) {
  if (!args[0]) return fail(2, 'Which chat? Type: relay use <n|id>', flags)
  const target = resolveSession(state, args[0])
  if (!target) return fail(1, COPY.unknownChat, flags)
  const r = await client.api('POST', `/api/session/${encodeURIComponent(target.id)}`, {}, { timeout: 6000 })
  if (!r.ok) return fail(1, plainApiError(r), flags)
  if (flags.json) { stdout(JSON.stringify({ ok: true, exitCode: 0, command: 'use', session: { id: r.data.session.id, title: r.data.session.title, cwd: r.data.session.cwd } })); return 0 }
  stdout(`Now showing "${r.data.session.title}".`)
  return 0
}

async function cmdQuota({ client, state, flags, args, colors }) {
  const sub = String(args[0] || '').toLowerCase()
  let r
  if (sub === 'set') {
    const agent = String(args[1] || '').trim()
    const limit = Number(args[2])
    if (!agent || !Number.isFinite(limit) || limit < 0) {
      return fail(2, 'Usage: relay quota set <agent> <calls> [day|week|month|total]', flags)
    }
    const window = args[3] ? String(args[3]).toLowerCase() : undefined
    r = await client.api('POST', '/api/quota/config', { agent, limit, ...(window ? { window } : {}) }, { timeout: 6000 })
  } else if (sub === 'reset') {
    const agent = String(args[1] || '').trim()
    r = await client.api('POST', '/api/quota/reset', agent ? { agent } : {}, { timeout: 6000 })
  } else if (sub) {
    return fail(2, 'Usage: relay quota [set <agent> <calls>|reset [agent]]', flags)
  } else {
    r = await client.api('GET', '/api/quota', undefined, { timeout: 6000 })
  }
  if (!r.ok) return fail(1, plainApiError(r), flags)
  state.quota = r.data.quota || r.data
  if (flags.json) {
    stdout(JSON.stringify({ ok: true, exitCode: 0, command: 'quota', ...state.quota }))
    return 0
  }
  stdout(quotaLines(state, colors).join('\n'))
  return 0
}

async function cmdNew({ client, state, flags, colors }) {
  const r = await client.api('POST', '/api/session', {}, { timeout: 6000 })
  if (!r.ok) return fail(1, plainApiError(r), flags)
  if (flags.json) { stdout(JSON.stringify({ ok: true, exitCode: 0, command: 'new', session: { id: r.data.session.id, title: r.data.session.title } })); return 0 }
  stdout(`New chat: "${r.data.session.title}".`)
  return 0
}

async function cmdRm({ client, state, flags, args, colors }) {
  if (!args[0]) return fail(2, 'Which chat? Type: relay rm <n|id>', flags)
  const target = resolveSession(state, args[0])
  if (!target) return fail(1, COPY.unknownChat, flags)
  const r = await client.api('DELETE', `/api/session/${encodeURIComponent(target.id)}`, undefined, { timeout: 6000 })
  if (!r.ok) return fail(1, plainApiError(r), flags)
  if (flags.json) { stdout(JSON.stringify({ ok: true, exitCode: 0, command: 'rm', deleted: target.id })); return 0 }
  stdout(`Deleted "${target.title}".`)
  return 0
}

async function cmdRename({ client, state, flags, args, colors }) {
  const title = args.join(' ').trim()
  if (!title) return fail(2, 'Give the chat a title.', flags)
  const r = await client.api('POST', '/api/rename', { title }, { timeout: 6000 })
  if (!r.ok) return fail(1, plainApiError(r), flags)
  if (flags.json) { stdout(JSON.stringify({ ok: true, exitCode: 0, command: 'rename', session: { id: r.data.session.id, title: r.data.session.title } })); return 0 }
  stdout(`Renamed to "${r.data.session.title}".`)
  return 0
}

async function cmdCwd({ client, state, flags, args, colors }) {
  if (!args.length) {
    if (flags.json) { stdout(JSON.stringify({ ok: true, exitCode: 0, command: 'cwd', cwd: state.session.cwd })); return 0 }
    stdout(`Folder: ${state.session.cwd}`)
    return 0
  }
  const path = resolve(expandHome(args.join(' ').trim()))
  try {
    if (!statSync(path).isDirectory()) throw new Error('not a folder')
  } catch {
    return fail(1, `That folder doesn't exist: ${path}`, flags)
  }
  const r = await client.api('POST', '/api/cwd', { cwd: path }, { timeout: 6000 })
  if (!r.ok) return fail(1, plainApiError(r), flags)
  if (flags.json) { stdout(JSON.stringify({ ok: true, exitCode: 0, command: 'cwd', cwd: r.data.cwd })); return 0 }
  stdout(`Folder: ${r.data.cwd}`)
  return 0
}

async function cmdInstructor({ client, state, flags, args, colors }) {
  if (!args.length) {
    if (flags.json) { stdout(JSON.stringify({ ok: true, exitCode: 0, command: 'instructor', instructor: state.session.instructor, choices: state.instructors })); return 0 }
    stdout(instructorLines(state, colors).join('\n'))
    return 0
  }
  const id = String(args[0]).trim()
  const r = await client.api('POST', '/api/instructor', { instructor: id }, { timeout: 6000 })
  if (!r.ok) return fail(1, plainApiError(r, `Unknown planner: ${id}`), flags)
  if (flags.json) { stdout(JSON.stringify({ ok: true, exitCode: 0, command: 'instructor', instructor: r.data.instructor })); return 0 }
  stdout(`Planner: ${id === 'auto' ? 'auto' : instructorName(state, id)}`)
  return 0
}

async function cmdExport({ state, flags, args, colors }) {
  try {
    const file = await writeExport(state, args[0])
    if (flags.json) { stdout(JSON.stringify({ ok: true, exitCode: 0, command: 'export', path: file })); return 0 }
    stdout(`Wrote ${file}`)
    return 0
  } catch (e) {
    return fail(1, `Couldn't write the export: ${e.message}`, flags)
  }
}

async function runTuiCommand(runTui, { flags, parsed }) {
  const client = createClient({ baseUrl: flags.url || process.env.RELAY_URL || DEFAULT_URL, debug: flags.debug })
  try {
    await client.ensureServer({ noStart: flags.noStart })
  } catch (e) {
    stderr(e.message)
    return 3
  }
  const state = createState({ model: flags.model || '' })
  let r
  try { r = await client.api('GET', '/api/bootstrap', undefined, { timeout: 6000 }) } catch (e) { stderr(e.message); return 3 }
  if (!r.ok) { stderr(plainApiError(r)); return 3 }
  applyBootstrap(state, r.data)
  if (flags.session && flags.session !== state.session?.id) {
    const s = await client.api('POST', `/api/session/${encodeURIComponent(flags.session)}`, {}, { timeout: 6000 })
    if (!s.ok) { stderr(plainApiError(s)); return 1 }
    const again = await client.api('GET', '/api/bootstrap', undefined, { timeout: 6000 })
    if (again.ok) applyBootstrap(state, again.data)
  }
  return runTui({ client, state, flags })
}

// ---------------------------------------------------------------------------
// REPL
// ---------------------------------------------------------------------------

const REPL_COMMANDS = [
  '/help', '/new', '/rm', '/sessions', '/use', '/status', '/btw', '/stop',
  '/model', '/models', '/agents', '/instructor', '/cwd', '/rename', '/plan',
  '/chain', '/direct', '/pin', '/export', '/clear', '/quit', '/exit',
]

class ReplView {
  constructor({ state, colors, rl, flags }) {
    this.state = state
    this.c = colors
    this.rl = rl
    this.flags = flags
    this.views = new Map()
    this.queue = []
    this.timer = null
    this.planIds = new Set()
    this.notices = []
    this.hold = false
    this.held = []
  }

  printAbove(text) {
    const value = String(text ?? '')
    if (!value) return
    if (this.hold) { this.held.push(value); return }
    process.stdout.write('\r\x1b[K' + value + '\n')
    this.rl.prompt(true)
  }

  releaseHeld() {
    if (!this.held.length) return
    const lines = this.held
    this.held = []
    for (const line of lines) process.stdout.write('\r\x1b[K' + line + '\n')
    this.rl.prompt(true)
  }

  flush(force = false) {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (!this.queue.length) return
    if (!force && this.queue.length < 1) return
    const text = this.queue.join('\n')
    this.queue = []
    this.printAbove(text)
  }

  schedule() {
    if (this.timer) return
    this.timer = setTimeout(() => { this.timer = null; this.flush(true) }, 50)
  }

  pushLine(line) {
    this.queue.push(line)
    this.schedule()
  }

  onPlan(m) {
    if (this.planIds.has(m.id)) return
    this.planIds.add(m.id)
    // The command prints the plan from the HTTP response; SSE may arrive first.
    if (this.onPlanReady) this.onPlanReady(m)
  }

  handle(ev) {
    if (!ev?.type) return
    if (ev.type === 'message') {
      const m = ev.message
      if (!m) return
      if (m.role === 'user') {
        if (m.text !== this.lastSent) this.pushLine(`${this.c.bold('YOU')} ${this.c.dim(timeText(m.at))}\n${normalizeText(m.text)}`)
        this.lastSent = ''
      } else if (m.role === 'note') {
        this.pushLine(this.c.dim('NOTE · ' + normalizeText(m.text)))
      } else if (m.role === 'plan') {
        this.onPlan(m)
      } else if (m.role === 'step') {
        this.startStep(m)
      }
      return
    }
    if (ev.type === 'delta') {
      const v = this.views.get(ev.id)
      if (v) this.delta(v, String(ev.text ?? ''))
      return
    }
    if (ev.type === 'message.update') {
      const v = this.views.get(ev.message?.id)
      if (v) this.finishStep(v, ev.message)
      return
    }
    if (ev.type === 'notice') {
      if (/^run failed:/i.test(ev.text || '')) this.runNotice = ev.text
    }
  }

  startStep(m) {
    this.flush(true)
    const v = { id: m.id, msg: m, lastRaw: '', printedRaw: 0, pending: '', anyDelta: false, rewrite: false, ended: false }
    this.views.set(m.id, v)
    if (m.kind === 'btw') {
      this.pushLine(`${this.c.amber('SIDE ANSWER')} ${this.c.dim('· ' + (m.label || agentLabel(this.state, m.agent)) + (m.question ? ' · ' + m.question : ''))}`)
      this.pushLine(this.c.dim('A:'))
    } else {
      const group = lastRunGroup(this.state)
      const total = lastPlan(this.state)?.steps?.length || group.plan?.steps?.length || Math.max(1, m.n || 1)
      this.pushLine(`${this.c.bold(`STEP ${m.n || 1} of ${total}`)} ${this.c.dim('· ' + (m.label || agentLabel(this.state, m.agent)))}`)
    }
  }

  delta(v, text) {
    if (!text.startsWith(v.lastRaw || '')) { v.rewrite = true; v.lastRaw = text; return }
    const suffix = text.slice(v.printedRaw)
    v.printedRaw = text.length
    v.lastRaw = text
    v.anyDelta = true
    this.emit(v, suffix)
  }

  emit(v, text) {
    v.pending += normalizeText(text)
    const lines = v.pending.split('\n')
    v.pending = lines.pop() || ''
    for (const line of lines) this.pushLine((v.msg?.kind === 'btw' ? '  ' : '  ') + line)
  }

  finishStep(v, m) {
    if (v.ended) return
    v.ended = true
    const text = normalizeText(m.text || '')
    if (!v.anyDelta && !v.rewrite) this.emit(v, text)
    else if (v.rewrite) {
      this.pushLine(this.c.dim('— final output —'))
      for (const line of text.split('\n')) this.pushLine('  ' + line)
    }
    if (v.pending) { this.pushLine('  ' + v.pending); v.pending = '' }
    const label = m.label || agentLabel(this.state, m.agent)
    const status = m.status === 'done'
      ? `done in ${formatDuration(m.durationMs)}`
      : m.status === 'failed' && m.exitCode != null
        ? `didn't finish (exit ${m.exitCode})`
        : statusLabel(m.status)
    if (m.kind === 'btw') {
      this.pushLine(this.c.dim(`SIDE ANSWER · ${label} · ${status}`))
    } else {
      this.pushLine(`${this.c.bold(`STEP ${m.n || 1}`)} ${this.c.dim('· ' + label)}  ${statusColor(this.c, m.status)(status)}`)
    }
    if (m.fallback?.length) {
      const f = m.fallback[m.fallback.length - 1]
      this.pushLine(this.c.yellow(f.reason === 'quota' ? `${f.from} ran out of free credits — Relay switched to ${f.to} for you.` : `${f.from} was cooling — Relay switched to ${f.to}.`))
    }
    this.pushLine('')
    this.flush(true)
  }
}

function replBanner(state, colors, { primer = false } = {}) {
  const lines = []
  if (primer) {
    lines.push(colors.bold(colors.brand('RELAY')))
    lines.push('Relay runs AI assistants on your computer.')
    lines.push('')
    lines.push('1. Type what you want done, in plain English.')
    lines.push('2. Relay shows you a plan. Nothing runs until you press Enter.')
    lines.push('3. Watch the steps, then read WHAT HAPPENED.')
    lines.push('')
    lines.push(colors.dim('/help for commands.'))
    return lines
  }
  lines.push(colors.bold('Relay') + colors.dim(' — AI assistants on your computer'))
  lines.push(`${colors.dim('Chat:')}   ${state.session?.title || 'no chat'}`)
  lines.push(`${colors.dim('Folder:')} ${state.session?.cwd || 'not set'}`)
  lines.push('')
  lines.push(colors.dim('Type what you want done, or /help. Nothing runs until you say yes.'))
  return lines
}

async function runRepl({ client, state, flags }) {
  const colors = createColors({ enabled: !flags.noColor && detectColorDepth() !== 1 })
  if (!process.stdin.isTTY || !process.stdout.isTTY) { stderr(COPY.noTty); return 2 }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    historySize: 200,
    completer: (line) => {
      if (!line.startsWith('/')) return [[], line]
      const hits = REPL_COMMANDS.filter((c) => c.startsWith(line))
      return [hits.length ? hits : REPL_COMMANDS, line]
    },
  })
  const view = new ReplView({ state, colors, rl, flags })
  let closing = false
  let running = false
  let queued = null
  let lastCtrlC = 0
  let exitCode = 0
  let pendingPlanId = null
  let awaitingApproval = false
  let approvalCanceled = false
  let lineChain = Promise.resolve()
  const abort = new AbortController()

  rl.setPrompt(colors.brand('relay') + ' ▸ ')

  // readline closes on Ctrl+D at an empty line. Keep the chat open while the
  // server is working; the TUI has the same rule. This is the only readline
  // private hook used, and it falls back cleanly if the hook is unavailable.
  if (typeof rl._ttyWrite === 'function') {
    const ttyWrite = rl._ttyWrite.bind(rl)
    rl._ttyWrite = (s, key) => {
      if (key?.ctrl && key.name === 'd' && !rl.line && (state.busy || running || hasRunningBtw(state))) {
        view.printAbove(colors.yellow('Stop the run first with /stop.'))
        return
      }
      return ttyWrite(s, key)
    }
  }

  const boot = () => {
    const lines = replBanner(state, colors, { primer: !(state.session?.messages || []).length })
    process.stdout.write(lines.join('\n') + '\n\n')
  }
  boot()
  rl.prompt()

  const sse = client.openEvents({
    onEvent: (ev) => {
      const r = applyEvent(state, ev)
      if (r.resync) {
        resync().then((title) => { if (title) view.printAbove(colors.yellow(sessionChanged(title))) })
        return
      }
      if (ev.type === 'busy' && !ev.busy) {
        if (queued) {
          const text = queued
          queued = null
          setTimeout(() => { if (!closing) sendPrompt(text, { fromQueue: true }) }, 150)
        }
      }
      view.handle(ev)
      if (r.changed) rl.prompt(true)
    },
  })
  try { await sse.waitForOpen() } catch (e) {
    sse.close(); rl.close(); stderr(colors.red(e.message)); return 3
  }

  async function resync() {
    try {
      const b = await client.api('GET', '/api/bootstrap', undefined, { timeout: 6000 })
      if (!b.ok) return ''
      applyBootstrap(state, b.data)
      view.views.clear()
      return state.session?.title || ''
    } catch { return '' }
  }

  async function stopRun() {
    try { await client.api('POST', '/api/stop', {}, { timeout: 2000 }) } catch {}
    running = false
    view.printAbove(colors.yellow(COPY.stopped))
  }

  async function planAndAsk(text) {
    if (state.busy || running) { view.printAbove(colors.yellow(COPY.activeRun)); return }
    pendingPlanId = null
    running = true
    const started = Date.now()
    view.printAbove(colors.dim('Working out a plan…'))
    let r
    try {
      view.lastSent = text
      r = await client.api('POST', '/api/plan', { text, auto: false, model: state.model || flags.model || '', instructor: flags.instructor || undefined })
    } catch (e) {
      running = false
      view.printAbove(colors.red(e.message))
      return
    }
    if (!running || closing) return
    if (!r.ok) {
      running = false
      view.printAbove(colors.red(r.status === 409 ? COPY.activeRun : r.status === 500 ? `The planner couldn't make a plan: ${r.data?.error || 'unknown error'}` : plainApiError(r)))
      return
    }
    if (r.data?.stopped) {
      running = false
      view.printAbove(colors.yellow(COPY.plannerStopped))
      return
    }
    const plan = planFromResponse(state, r.data)
    if (!plan?.steps?.length) {
      running = false
      view.printAbove(colors.red(COPY.noPlanSteps))
      return
    }
    view.planIds.add(plan.id)
    view.flush(true)
    view.printAbove(colors.dim(`Plan ready in ${formatDuration(Date.now() - started)}.`))
    printPlan(colors, state, plan, !flags.yes && !flags.auto)

    let approved = !!flags.yes || !!flags.auto
    if (!approved) {
      view.hold = true
      awaitingApproval = true
      approvalCanceled = false
      let answer = ''
      try {
        answer = await new Promise((resolve) => {
          rl.question(colors.bold(colors.yellow('Run this?  Enter = run · n = skip  ')), resolve)
        })
      } finally {
        awaitingApproval = false
        view.hold = false
        view.releaseHeld()
      }
      if (approvalCanceled) {
        approvalCanceled = false
        running = false
        pendingPlanId = null
        view.printAbove(colors.dim(COPY.skipped))
        return
      }
      approved = !/^\s*n/i.test(answer)
    }
    if (!approved) {
      running = false
      pendingPlanId = null
      view.printAbove(colors.dim(COPY.skipped))
      return
    }
    pendingPlanId = plan.id
    await startPlanRun(plan)
  }

  async function startPlanRun(plan) {
    running = true
    let r
    try {
      r = await client.api('POST', '/api/run', { planId: plan.id, model: state.model || flags.model || '' })
    } catch (e) {
      running = false
      view.printAbove(colors.red(e.message))
      return
    }
    if (!r.ok) {
      running = false
      view.printAbove(colors.red(plainApiError(r)))
      return
    }
    pendingPlanId = null
    const done = await waitForRun(state, { auto: false, planId: plan.id, runRequested: true, signal: abort.signal })
    running = false
    if (done.status === 'interrupted' || closing) return
    if (done.status === 'nostart') { view.printAbove(colors.yellow('The run did not start. Nothing ran.')); return }
    view.flush(true)
    const summary = done.summary || summarizeGroup(lastRunGroup(state))
    printSummary(colors, summary)
    if (view.runNotice) view.printAbove(colors.yellow(view.runNotice))
  }

  async function sendPrompt(text, { fromQueue = false } = {}) {
    const value = String(text || '').trim()
    if (!value) return
    if (state.busy || running) {
      if (!fromQueue && !value.startsWith('/')) {
        if (!queued) {
          queued = value
          view.printAbove(colors.yellow('Queued. It will run when the current run finishes. /stop cancels.'))
        } else {
          view.printAbove(colors.yellow('One prompt is already queued. /stop cancels.'))
        }
      }
      return
    }
    if (value.startsWith('/')) { await handleCommand(value); return }
    await planAndAsk(value)
  }

  async function startDirect(agent, prompt) {
    if (state.busy || running) { view.printAbove(colors.yellow(COPY.activeRun)); return }
    if (!agent || !prompt) { view.printAbove(colors.yellow('Use: /direct <agent> <prompt>')); return }
    running = true
    let r
    try { r = await client.api('POST', '/api/dispatch', { agent, prompt, model: state.model || flags.model || '' }) } catch (e) { running = false; view.printAbove(colors.red(e.message)); return }
    if (!r.ok) { running = false; view.printAbove(colors.red(plainApiError(r, 'That assistant is not available.'))); return }
    const done = await waitForRun(state, { auto: false, runRequested: true, signal: abort.signal })
    running = false
    if (done.status === 'interrupted' || closing) return
    if (done.status === 'nostart') { view.printAbove(colors.yellow('The run did not start. Nothing ran.')); return }
    view.flush(true)
    printSummary(colors, done.summary || summarizeGroup(lastRunGroup(state)))
  }

  async function startChain(text) {
    if (state.busy || running) { view.printAbove(colors.yellow(COPY.activeRun)); return }
    running = true
    let r
    try { r = await client.api('POST', '/api/chain', { text, task: '', model: state.model || flags.model || '' }) } catch (e) { running = false; view.printAbove(colors.red(e.message)); return }
    if (!r.ok) { running = false; view.printAbove(colors.red(plainApiError(r))); return }
    const done = await waitForRun(state, { auto: false, runRequested: true, signal: abort.signal })
    running = false
    if (done.status === 'interrupted' || closing) return
    if (done.status === 'nostart') { view.printAbove(colors.yellow('The run did not start. Nothing ran.')); return }
    view.flush(true)
    printSummary(colors, done.summary || summarizeGroup(lastRunGroup(state)))
  }

  async function startBtw(question) {
    const q = String(question || '').trim()
    if (!q) { view.printAbove(colors.yellow('Ask a side question after /btw.')); return }
    if (q.length > 4000) view.printAbove(colors.yellow(COPY.sideTooLong))
    try {
      const r = await client.api('POST', '/api/btw', { text: q }, { timeout: 8000 })
      if (!r.ok) view.printAbove(colors.red(plainApiError(r, COPY.noSideAgent)))
      else view.printAbove(colors.dim(`Side answer requested · ${agentLabel(state, r.data?.agent)}`))
    } catch (e) { view.printAbove(colors.red(e.message)) }
  }

  async function handleCommand(line) {
    const [head, ...rest] = line.trim().split(/\s+/)
    const arg = rest.join(' ')
    const cmd = head.toLowerCase()
    switch (cmd) {
      case '/help':
        view.printAbove([
          colors.bold('COMMANDS'),
          '  /new                 new chat',
          '  /sessions            list chats',
          '  /use <n|id>          switch chat',
          '  /rm <n|id>           delete a chat',
          '  /status              status card',
          '  /btw <text>          side question while work continues',
          '  /stop                stop the active run and side answers',
          '  /model [ref|auto]    show or set a model override',
          '  /models              list model refs',
          '  /agents              list assistants',
          '  /instructor [id]     show or set the planner',
          '  /cwd [path]          show or set the working folder',
          '  /rename <title>      rename the chat',
          '  /plan <text>         only make a plan',
          '  /chain <script>      manual chain; use \\n between steps',
          '  /direct <agent> <p>  one assistant, no planning',
          '  /pin <step>          pin or unpin a step',
          '  /export [path]       write the chat as JSON',
          '  /clear               clear the screen',
          '  /quit, /exit         leave (stop a run first)',
          colors.dim('  Nothing runs until you press Enter.'),
        ].join('\n'))
        return
      case '/new': {
        if (state.busy) { view.printAbove(colors.yellow(COPY.sessionBusy)); return }
        const r = await client.api('POST', '/api/session', {}, { timeout: 6000 })
        if (!r.ok) view.printAbove(colors.red(plainApiError(r)))
        else { await resync(); view.printAbove(colors.green(`New chat: "${state.session.title}".`)) }
        return
      }
      case '/sessions': {
        await resync()
        view.printAbove(sessionLines(state, colors).join('\n'))
        return
      }
      case '/use': {
        if (state.busy) { view.printAbove(colors.yellow(COPY.sessionBusy)); return }
        await resync()
        const target = resolveSession(state, arg)
        if (!target) { view.printAbove(colors.red(COPY.unknownChat)); return }
        const r = await client.api('POST', `/api/session/${encodeURIComponent(target.id)}`, {}, { timeout: 6000 })
        if (!r.ok) { view.printAbove(colors.red(plainApiError(r))); return }
        await resync()
        view.printAbove(colors.green(`Now showing "${state.session.title}".`))
        return
      }
      case '/rm': {
        await resync()
        const target = resolveSession(state, arg)
        if (!target) { view.printAbove(colors.red(COPY.unknownChat)); return }
        const r = await client.api('DELETE', `/api/session/${encodeURIComponent(target.id)}`, undefined, { timeout: 6000 })
        if (!r.ok) view.printAbove(colors.red(plainApiError(r)))
        else { await resync(); view.printAbove(colors.green(`Deleted "${target.title}".`)) }
        return
      }
      case '/status':
        view.printAbove(statusLines(state, colors).join('\n'))
        return
      case '/btw':
        await startBtw(arg)
        return
      case '/stop':
        await stopRun()
        return
      case '/model':
        if (!arg) { view.printAbove(`Model: ${state.model || 'each assistant’s default'}`); return }
        state.model = arg === 'auto' ? '' : arg
        view.printAbove(colors.green(`Model: ${state.model || 'each assistant’s default'}`))
        return
      case '/models':
        view.printAbove(modelLines(state, colors).join('\n'))
        return
      case '/agents':
        view.printAbove(agentLines(state, colors).join('\n'))
        return
      case '/instructor': {
        if (!arg) { view.printAbove(instructorLines(state, colors).join('\n')); return }
        const r = await client.api('POST', '/api/instructor', { instructor: arg }, { timeout: 6000 })
        if (!r.ok) view.printAbove(colors.red(plainApiError(r, `Unknown planner: ${arg}`)))
        else { state.session.instructor = r.data.instructor; view.printAbove(colors.green(`Planner: ${arg === 'auto' ? 'auto' : instructorName(state, arg)}`)) }
        return
      }
      case '/cwd': {
        if (!arg) { view.printAbove(`Folder: ${state.session.cwd}`); return }
        const path = resolve(expandHome(arg))
        try { if (!statSync(path).isDirectory()) throw new Error('not a folder') } catch { view.printAbove(colors.red(`That folder doesn't exist: ${path}`)); return }
        const r = await client.api('POST', '/api/cwd', { cwd: path }, { timeout: 6000 })
        if (!r.ok) view.printAbove(colors.red(plainApiError(r)))
        else { state.session.cwd = r.data.cwd; view.printAbove(colors.green(`Folder: ${r.data.cwd}`)) }
        return
      }
      case '/rename': {
        if (!arg) { view.printAbove(colors.yellow('Give the chat a title.')); return }
        const r = await client.api('POST', '/api/rename', { title: arg }, { timeout: 6000 })
        if (!r.ok) view.printAbove(colors.red(plainApiError(r)))
        else { state.session.title = r.data.session.title; view.printAbove(colors.green(`Renamed to "${r.data.session.title}".`)) }
        return
      }
      case '/plan': {
        if (!arg) { view.printAbove(colors.yellow('Use: /plan <text>')); return }
        if (state.busy || running) { view.printAbove(colors.yellow(COPY.activeRun)); return }
        running = true
        view.lastSent = arg
        view.printAbove(colors.dim('Working out a plan…'))
        let r
        try { r = await client.api('POST', '/api/plan', { text: arg, auto: false, model: state.model || flags.model || '', instructor: flags.instructor || undefined }) } catch (e) { running = false; view.printAbove(colors.red(e.message)); return }
        running = false
        if (!r.ok) { view.printAbove(colors.red(plainApiError(r))); return }
        if (r.data?.stopped) { view.printAbove(colors.yellow(COPY.plannerStopped)); return }
        const plan = planFromResponse(state, r.data)
        if (!plan?.steps?.length) { view.printAbove(colors.red(COPY.noPlanSteps)); return }
        view.planIds.add(plan.id)
        view.flush(true)
        printPlan(colors, state, plan)
        view.printAbove(colors.dim('Plan only. Nothing ran.'))
        return
      }
      case '/chain': {
        if (!arg) { view.printAbove(colors.yellow('Use: /chain agent: prompt\\nagent: prompt')); return }
        await startChain(arg.replace(/\\n/g, '\n'))
        return
      }
      case '/direct': {
        const [agent, ...p] = rest
        await startDirect(agent, p.join(' '))
        return
      }
      case '/pin': {
        const n = Number(arg)
        const plan = lastPlan(state)
        const planIndex = plan ? messagesOf(state).findIndex((m) => m.id === plan.id) : -1
        const steps = messagesOf(state).slice(planIndex + 1).filter((m) => m.role === 'step' && m.kind !== 'btw')
        const step = steps[n - 1]
        if (!step) { view.printAbove(colors.yellow('No step with that number.')); return }
        const on = !(state.session.pinned || []).some((p) => p.stepId === step.id)
        const r = await client.api('POST', '/api/pin', { stepId: step.id, on }, { timeout: 6000 })
        if (!r.ok) view.printAbove(colors.red(plainApiError(r)))
        else { state.session.pinned = r.data.pinned; view.printAbove(colors.green(on ? `Pinned step ${n}.` : `Unpinned step ${n}.`)) }
        return
      }
      case '/export': {
        try { const file = await writeExport(state, arg); view.printAbove(colors.green(`Wrote ${file}`)) } catch (e) { view.printAbove(colors.red(`Couldn't write the export: ${e.message}`)) }
        return
      }
      case '/clear':
        process.stdout.write('\x1b[2J\x1b[H')
        boot()
        rl.prompt()
        return
      case '/tui':
        view.printAbove(colors.dim('Leave this chat with /quit, then run: relay tui'))
        return
      case '/quit':
      case '/exit':
        if (state.busy || running) { view.printAbove(colors.yellow('Stop the run first with /stop.')); return }
        closing = true
        rl.close()
        return
      default:
        view.printAbove(colors.yellow(unknownCommand(cmd)))
    }
  }

  rl.on('line', (line) => {
    if (awaitingApproval) { awaitingApproval = false; return }
    lineChain = lineChain.then(async () => {
      const text = line.trim()
      if (!text) { rl.prompt(); return }
      if (text.startsWith('/')) {
        const allowed = ['/stop', '/btw', '/status', '/help', '/export']
        const head = text.split(/\s+/)[0].toLowerCase()
        if ((state.busy || running) && !allowed.includes(head)) { view.printAbove(colors.yellow(COPY.activeRun)); rl.prompt(); return }
        await handleCommand(text)
      } else {
        if (state.busy || running) {
          if (!queued) { queued = text; view.printAbove(colors.yellow('Queued. It will run when the current run finishes. /stop cancels.')) }
          else view.printAbove(colors.yellow('One prompt is already queued. /stop cancels.'))
        } else {
          await planAndAsk(text)
        }
      }
      if (!closing) rl.prompt()
    }).catch((e) => {
      view.printAbove(colors.red(e.message || String(e)))
      if (!closing) rl.prompt()
    })
  })

  rl.on('SIGINT', async () => {
    if (awaitingApproval) {
      approvalCanceled = true
      awaitingApproval = false
      rl.write('\n')
      rl.prompt()
      return
    }
    if (state.busy || running || hasRunningBtw(state)) { await stopRun(); rl.prompt(); return }
    if (rl.line) { rl.write(null, { ctrl: true, name: 'u' }); rl.prompt(); return }
    const now = Date.now()
    if (now - lastCtrlC < 1500) { exitCode = 130; closing = true; rl.close(); return }
    lastCtrlC = now
    view.printAbove(colors.dim('Press Ctrl+C again to quit.'))
    rl.prompt()
  })

  const onSigterm = () => { exitCode = 143; closing = true; rl.close() }
  process.on('SIGTERM', onSigterm)
  rl.on('close', () => { closing = true })

  await new Promise((resolve) => rl.once('close', resolve))
  closing = true
  process.off('SIGTERM', onSigterm)
  abort.abort()
  sse.close()
  return exitCode
}

async function runReplCommand({ flags, parsed }) {
  const client = createClient({ baseUrl: flags.url || process.env.RELAY_URL || DEFAULT_URL, debug: flags.debug })
  try {
    await client.ensureServer({ noStart: flags.noStart })
  } catch (e) {
    stderr(e.message)
    return 3
  }
  const state = createState({ model: flags.model || '' })
  let r
  try { r = await client.api('GET', '/api/bootstrap', undefined, { timeout: 6000 }) } catch (e) { stderr(e.message); return 3 }
  if (!r.ok) { stderr(plainApiError(r)); return 3 }
  applyBootstrap(state, r.data)
  if (flags.session && flags.session !== state.session?.id) {
    const s = await client.api('POST', `/api/session/${encodeURIComponent(flags.session)}`, {}, { timeout: 6000 })
    if (!s.ok) { stderr(plainApiError(s)); return 1 }
    const again = await client.api('GET', '/api/bootstrap', undefined, { timeout: 6000 })
    if (again.ok) applyBootstrap(state, again.data)
  }
  return runRepl({ client, state, flags })
}

main()
  .then((code) => { process.exitCode = Number.isInteger(code) ? code : 0 })
  .catch((e) => {
    if (process.argv.includes('--debug')) stderr(e?.stack || String(e))
    else stderr(e?.message || String(e))
    process.exitCode = 1
  })

