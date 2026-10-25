// Small, dependency-free markdown renderer for the full-screen view.
// It intentionally covers the parts agents actually emit: headings, lists,
// quotes, code fences, inline code, emphasis, links, and rules.
import {
  normalizeText, wrapText, truncate, truncateAnsi, displayWidth,
} from './format.mjs'

const FENCE = /^\s*(```+|~~~+)\s*([A-Za-z0-9_+.#-]*)\s*$/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/
const BULLET = /^(\s*)([-*+])\s+(.*)$/
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/

const KEYWORDS = new Set([
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'default', 'def', 'delete', 'do', 'else', 'enum', 'export', 'extends',
  'false', 'finally', 'for', 'from', 'fn', 'func', 'function', 'if', 'implements',
  'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package',
  'private', 'protected', 'pub', 'public', 'raise', 'return', 'self', 'static',
  'struct', 'switch', 'this', 'throw', 'trait', 'true', 'try', 'type', 'typeof',
  'undefined', 'use', 'var', 'void', 'while', 'with', 'yield',
])

const LANG = /^(js|javascript|jsx|ts|typescript|tsx|json|jsonc|css|scss|html|xml|py|python|sh|bash|zsh|ps1|powershell|go|rs|rust|sql|yaml|yml|toml|md|markdown|diff|patch)$/i

function isComment(line) {
  return /^\s*(\/\/|#|--|;|\/\*|\*)/.test(line)
}

function highlight(line, lang, c) {
  const language = String(lang || '').toLowerCase()
  if (language === 'diff' || language === 'patch') {
    if (/^\+/.test(line)) return c.green(line)
    if (/^-/.test(line)) return c.red(line)
    if (/^@@/.test(line)) return c.cyan(line)
    return c.dim(line)
  }
  if (isComment(line)) return c.dim(line)
  if (!LANG.test(language)) return line
  const token = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g
  return line.replace(token, (word) => {
    if (/^["'`]/.test(word)) return c.green(word)
    if (/^\d/.test(word)) return c.yellow(word)
    if (KEYWORDS.has(word)) return c.magenta(word)
    return word
  })
}

function inline(line, c) {
  let s = String(line ?? '')
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, (_, label) => c.underline(label))
  s = s.replace(/`([^`]+)`/g, (_, code) => c.cyan(code))
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, text) => c.bold(text))
  s = s.replace(/__([^_]+)__/g, (_, text) => c.bold(text))
  s = s.replace(/~~([^~]+)~~/g, (_, text) => c.dim(text))
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, (_, text) => c.italic(text))
  return s
}

function codeBlock(lines, lang, width, c) {
  const out = []
  const inner = Math.max(4, width - 6)
  const label = truncate(String(lang || 'code'), 14)
  const heading = ` ${label} `
  const dashes = Math.max(0, width - 5 - displayWidth(heading))
  out.push('  ' + c.dim('╭─') + c.dim(heading) + c.dim('─'.repeat(dashes) + '╮'))
  for (const raw of lines) {
    const styled = highlight(raw, lang, c)
    const clipped = truncateAnsi(styled, inner)
    out.push('  ' + c.dim('│ ') + clipped + ' '.repeat(Math.max(0, inner - displayWidth(clipped))) + c.dim(' │'))
  }
  out.push('  ' + c.dim('╰' + '─'.repeat(Math.max(2, width - 4)) + '╯'))
  return out
}

export function renderMarkdown(text, width, colors, { compact = false } = {}) {
  const c = colors
  const max = Math.max(8, Math.floor(width || 80))
  const source = normalizeText(text).split('\n')
  const out = []
  let lastBlank = false

  const push = (line = '') => {
    if (line === '') {
      if (lastBlank && compact) return
      if (out.length === 0) { lastBlank = true; return }
      out.push('')
      lastBlank = true
      return
    }
    out.push(line)
    lastBlank = false
  }

  for (let i = 0; i < source.length; i++) {
    const line = source[i]
    const fence = line.match(FENCE)
    if (fence) {
      const marker = fence[1]
      const lang = fence[2]
      const code = []
      i++
      while (i < source.length && !new RegExp(`^\\s*${marker[0] === '`' ? '```+' : '~~~+'}\\s*$`).test(source[i])) {
        code.push(source[i])
        i++
      }
      for (const rendered of codeBlock(code, lang, max, c)) push(rendered)
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      const level = heading[1].length
      const prefix = level > 2 ? '  '.repeat(level - 2) : ''
      for (const part of wrapText(heading[2], Math.max(4, max - displayWidth(prefix)))) {
        push(prefix + c.bold(inline(part, c)))
      }
      continue
    }

    if (RULE.test(line)) {
      push('  ' + c.dim('─'.repeat(Math.max(6, Math.min(52, max - 2)))))
      continue
    }

    const bullet = line.match(BULLET)
    if (bullet) {
      const indent = '  '.repeat(Math.min(3, Math.floor(bullet[1].length / 2)))
      const body = wrapText(bullet[3], Math.max(4, max - displayWidth(indent) - 4))
      body.forEach((part, n) => {
        push(indent + (n === 0 ? c.brand('• ') : '  ') + inline(part, c))
      })
      continue
    }

    const ordered = line.match(ORDERED)
    if (ordered) {
      const indent = '  '.repeat(Math.min(3, Math.floor(ordered[1].length / 2)))
      const label = `${ordered[2]}. `
      const body = wrapText(ordered[3], Math.max(4, max - displayWidth(indent) - displayWidth(label)))
      body.forEach((part, n) => {
        push(indent + (n === 0 ? c.dim(label) : ' '.repeat(displayWidth(label))) + inline(part, c))
      })
      continue
    }

    const quote = line.match(QUOTE)
    if (quote) {
      const body = wrapText(quote[1], Math.max(4, max - 4))
      body.forEach((part) => push(c.dim('  │ ') + c.italic(inline(part, c))))
      continue
    }

    if (line.trim() === '') { push(''); continue }
    for (const part of wrapText(line, max)) push(inline(part, c))
  }

  while (out.length && out[out.length - 1] === '') out.pop()
  return out
}
