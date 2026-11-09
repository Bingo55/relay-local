import { useSyncExternalStore } from 'react'

export type ButtonStyle = 'solid' | 'outline' | 'transparent'
export type ThemePresetId = 'ink-red' | 'black-green' | 'red-white' | 'grey-black' | 'coral' | 'clear'
export type ThemeChoice = { background: string; accent: string; buttonStyle: ButtonStyle }
export type ThemeState = ThemeChoice & { preset: ThemePresetId | 'custom' }

export type ThemePreset = ThemeChoice & {
  id: ThemePresetId
  name: string
  description: string
}

export type ThemePalette = {
  mode: 'light' | 'dark'
  paper: string
  paper2: string
  paper3: string
  cotton: string
  ink: string
  ink2: string
  muted: string
  rule: string
  rule2: string
  accent: string
  accentInk: string
  accent2: string
  accentText: string
  accentSoft: string
  focus: string
  error: string
  success: string
  overlay: string
  desk: string
  print: string
  board: string
  boardType: string
  paid: string
  shadeRgb: string
  litRgb: string
  deepRgb: string
}

export type RGB = { r: number; g: number; b: number }

export const STORAGE_KEY = 'relay.theme'
export const DEFAULT_PRESET_ID: ThemePresetId = 'ink-red'

export const buttonStyles: { id: ButtonStyle; label: string; description: string }[] = [
  { id: 'solid', label: 'Solid', description: 'Filled buttons using the accent colour.' },
  { id: 'outline', label: 'Outline', description: 'Clear buttons with an accent border and text.' },
  { id: 'transparent', label: 'Transparent', description: 'Text-only controls that tint on hover.' },
]

export const presets: ThemePreset[] = [
  { id: 'ink-red', name: 'Ink & Red', description: 'Near-black paper with a vivid red action colour.', background: '#0b0b0c', accent: '#d92d20', buttonStyle: 'solid' },
  { id: 'black-green', name: 'Black & Green', description: 'Near-black paper with a clear green action colour.', background: '#090d0b', accent: '#3ddc84', buttonStyle: 'solid' },
  { id: 'red-white', name: 'Red & White', description: 'White paper with a deep red action colour.', background: '#ffffff', accent: '#b91c1c', buttonStyle: 'solid' },
  { id: 'grey-black', name: 'Grey & Black', description: 'Soft grey paper with black actions.', background: '#e9e9e6', accent: '#171717', buttonStyle: 'solid' },
  { id: 'coral', name: 'Coral', description: 'Warm paper with the original coral accent.', background: '#f7f3ef', accent: '#b8512f', buttonStyle: 'solid' },
  { id: 'clear', name: 'Clear & Outline', description: 'Bright paper with outlined controls.', background: '#fafaf8', accent: '#1f1f1f', buttonStyle: 'outline' },
]

const presetById = new Map(presets.map(preset => [preset.id, preset]))
const DEFAULT_PRESET = presetById.get(DEFAULT_PRESET_ID) as ThemePreset
const DEFAULT_CHOICE: ThemeChoice = { background: DEFAULT_PRESET.background, accent: DEFAULT_PRESET.accent, buttonStyle: DEFAULT_PRESET.buttonStyle }
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i
const MIN_TEXT = 4.6
const MIN_BODY = 7.1
const WHITE: RGB = { r: 255, g: 255, b: 255 }
const BLACK: RGB = { r: 0, g: 0, b: 0 }

export function parseHex(value: string): RGB | null {
  const match = HEX.exec(value.trim())
  if (!match) return null
  let hex = match[1].toLowerCase()
  if (hex.length === 3) hex = [...hex].map(part => part + part).join('')
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  }
}

export function toHex(value: RGB): string {
  const channel = (part: number) => Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, '0')
  return `#${channel(value.r)}${channel(value.g)}${channel(value.b)}`
}

export function canonicalHex(value: string): string | null {
  const parsed = parseHex(value)
  return parsed ? toHex(parsed) : null
}

export function mix(from: RGB, to: RGB, amount: number): RGB {
  const t = Math.max(0, Math.min(1, amount))
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  }
}

function linear(part: number): number {
  const channel = part / 255
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

export function luminance(value: RGB): number {
  return 0.2126 * linear(value.r) + 0.7152 * linear(value.g) + 0.0722 * linear(value.b)
}

export function contrast(first: RGB, second: RGB): number {
  const a = luminance(first)
  const b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

export function bestText(background: RGB): RGB {
  return contrast(background, WHITE) >= contrast(background, BLACK) ? WHITE : BLACK
}

function opposite(value: RGB): RGB {
  return value === WHITE ? BLACK : WHITE
}

function ensureContrast(value: RGB, background: RGB, minimum: number): RGB {
  if (contrast(value, background) >= minimum) return value
  const target = bestText(background)
  const targetContrast = contrast(target, background)
  if (targetContrast <= minimum) return target
  for (let step = 1; step <= 100; step++) {
    const candidate = mix(value, target, step / 100)
    if (contrast(candidate, background) >= minimum) return candidate
  }
  return target
}

function ensureContrastAgainst(value: RGB, backgrounds: RGB[], minimum: number): RGB {
  const score = (candidate: RGB) => Math.min(...backgrounds.map(background => contrast(candidate, background)))
  const passes = (candidate: RGB) => score(candidate) >= minimum
  if (passes(value)) return value
  let best = value
  let bestScore = score(value)
  let chosen: RGB | null = null
  let chosenStep = Number.POSITIVE_INFINITY
  const firstPole = bestText(backgrounds[0])
  for (const pole of [firstPole, opposite(firstPole)]) {
    for (let step = 1; step <= 100; step++) {
      const candidate = mix(value, pole, step / 100)
      if (passes(candidate)) {
        if (step < chosenStep) { chosen = candidate; chosenStep = step }
        break
      }
      const candidateScore = score(candidate)
      if (candidateScore > bestScore) { best = candidate; bestScore = candidateScore }
    }
  }
  return chosen || best
}

function ensureSurfaceContrast(value: RGB, reference: RGB, minimum: number): RGB {
  const pole = bestText(reference)
  if (contrast(value, pole) >= minimum) return value
  for (let step = 1; step <= 100; step++) {
    const candidate = mix(value, reference, step / 100)
    if (contrast(candidate, pole) >= minimum) return candidate
  }
  return reference
}

function paletteFrom(background: RGB, accent: RGB): ThemePalette {
  const inkPole = bestText(background)
  const mode: ThemePalette['mode'] = inkPole === WHITE ? 'dark' : 'light'
  const headroom = contrast(background, inkPole)
  const surfacePole = headroom >= 8 ? inkPole : opposite(inkPole)

  const paper2 = mix(background, surfacePole, 0.06)
  const paper3 = mix(background, surfacePole, 0.12)
  const cotton = mode === 'dark' ? mix(background, surfacePole, 0.06) : mix(background, WHITE, 0.62)

  const ink = ensureContrastAgainst(ensureContrast(mix(background, inkPole, 0.9), background, MIN_BODY), [background, paper2, paper3], MIN_TEXT)
  const ink2 = ensureContrastAgainst(mix(ink, background, 0.18), [background, paper2, paper3], MIN_TEXT)
  const muted = ensureContrastAgainst(mix(ink, background, 0.42), [background, paper2, paper3], MIN_TEXT)

  const accentInk = bestText(accent)
  const accentFill = accent
  const accent2 = mix(accent, accentInk === WHITE ? BLACK : WHITE, 0.16)
  const accentSoft = ensureSurfaceContrast(mix(background, accent, mode === 'dark' ? 0.2 : 0.12), background, 4.55)
  const accentText = ensureContrastAgainst(accent, [background, paper2, paper3, accentSoft], MIN_TEXT)

  const rule = mix(background, ink, 0.2)
  const rule2 = mix(background, ink, 0.34)
  const error = ensureContrastAgainst(parseHex(mode === 'dark' ? '#ff7b72' : '#b42318') as RGB, [background, paper2, paper3], MIN_TEXT)
  const success = ensureContrastAgainst(parseHex(mode === 'dark' ? '#56d364' : '#1a7f37') as RGB, [background, paper2, paper3], MIN_TEXT)

  return {
    mode,
    paper: toHex(background),
    paper2: toHex(paper2),
    paper3: toHex(paper3),
    cotton: toHex(cotton),
    ink: toHex(ink),
    ink2: toHex(ink2),
    muted: toHex(muted),
    rule: toHex(rule),
    rule2: toHex(rule2),
    accent: toHex(accentFill),
    accentInk: toHex(accentInk),
    accent2: toHex(accent2),
    accentText: toHex(accentText),
    accentSoft: toHex(accentSoft),
    focus: toHex(accentText),
    error: toHex(error),
    success: toHex(success),
    overlay: mode === 'dark' ? 'rgb(0 0 0 / 0.72)' : 'rgb(30 24 20 / 0.46)',
    desk: toHex(paper2),
    print: toHex(ink),
    board: toHex(ink),
    boardType: toHex(background),
    paid: toHex(accentText),
    shadeRgb: mode === 'dark' ? '0 0 0' : '36 29 22',
    litRgb: '255 255 255',
    deepRgb: '0 0 0',
  }
}

export function paletteFor(theme: ThemeChoice): ThemePalette {
  const background = parseHex(theme.background) || parseHex(DEFAULT_CHOICE.background) as RGB
  const accent = parseHex(theme.accent) || parseHex(DEFAULT_CHOICE.accent) as RGB
  return paletteFrom(background, accent)
}

export function presetChoice(id: ThemePresetId): ThemeChoice {
  const preset = presetById.get(id) || DEFAULT_PRESET
  return { background: preset.background, accent: preset.accent, buttonStyle: preset.buttonStyle }
}

export function matchPreset(choice: ThemeChoice): ThemePresetId | 'custom' {
  const background = canonicalHex(choice.background)
  const accent = canonicalHex(choice.accent)
  const found = presets.find(preset => preset.background === background && preset.accent === accent && preset.buttonStyle === choice.buttonStyle)
  return found ? found.id : 'custom'
}

export function themeWithPreset(choice: ThemeChoice): ThemeState {
  return { ...choice, preset: matchPreset(choice) }
}

function isButtonStyle(value: unknown): value is ButtonStyle {
  return value === 'solid' || value === 'outline' || value === 'transparent'
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function loadTheme(): ThemeState {
  const raw = storage()?.getItem(STORAGE_KEY)
  if (!raw) return themeWithPreset(DEFAULT_CHOICE)
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return themeWithPreset(DEFAULT_CHOICE)
    const record = parsed as Record<string, unknown>
    const background = typeof record.background === 'string' ? canonicalHex(record.background) : null
    const accent = typeof record.accent === 'string' ? canonicalHex(record.accent) : null
    if (!background || !accent || !isButtonStyle(record.buttonStyle)) return themeWithPreset(DEFAULT_CHOICE)
    return themeWithPreset({ background, accent, buttonStyle: record.buttonStyle })
  } catch {
    return themeWithPreset(DEFAULT_CHOICE)
  }
}

let current: ThemeState | null = null
const listeners = new Set<() => void>()

function applyTheme(theme: ThemeState): void {
  if (typeof document === 'undefined') return
  const palette = paletteFor(theme)
  const root = document.documentElement
  root.dataset.theme = theme.preset
  root.dataset.buttons = theme.buttonStyle
  root.dataset.scheme = palette.mode
  root.style.colorScheme = palette.mode
  const tokens: Record<string, string> = {
    '--color-paper': palette.paper,
    '--color-paper-2': palette.paper2,
    '--color-paper-3': palette.paper3,
    '--color-cotton': palette.cotton,
    '--color-ink': palette.ink,
    '--color-ink-2': palette.ink2,
    '--color-muted': palette.muted,
    '--color-rule': palette.rule,
    '--color-rule-2': palette.rule2,
    '--color-accent': palette.accent,
    '--color-accent-ink': palette.accentInk,
    '--color-accent-2': palette.accent2,
    '--color-accent-text': palette.accentText,
    '--color-accent-soft': palette.accentSoft,
    '--color-focus': palette.focus,
    '--color-error': palette.error,
    '--color-success': palette.success,
    '--color-overlay': palette.overlay,
    '--color-desk': palette.desk,
    '--color-print': palette.print,
    '--color-board': palette.board,
    '--color-board-type': palette.boardType,
    '--color-paid': palette.paid,
    '--shade-rgb': palette.shadeRgb,
    '--lit-rgb': palette.litRgb,
    '--deep-rgb': palette.deepRgb,
  }
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', palette.paper)
}

function persist(theme: ThemeState): void {
  try { storage()?.setItem(STORAGE_KEY, JSON.stringify({ background: theme.background, accent: theme.accent, buttonStyle: theme.buttonStyle })) } catch { /* Storage can be unavailable in private modes; the current tab still updates. */ }
}

function publish(choice: ThemeChoice): ThemeState {
  const theme = themeWithPreset(choice)
  current = theme
  persist(theme)
  applyTheme(theme)
  for (const listener of listeners) listener()
  return theme
}

export function getTheme(): ThemeState {
  if (!current) current = loadTheme()
  return current
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function applyStoredTheme(): ThemeState {
  current = loadTheme()
  applyTheme(current)
  return current
}

export function selectPreset(id: ThemePresetId): ThemeState {
  return publish(presetChoice(id))
}

export function setBackground(value: string): ThemeState {
  const background = canonicalHex(value)
  return publish({ ...getTheme(), background: background || getTheme().background })
}

export function setAccent(value: string): ThemeState {
  const accent = canonicalHex(value)
  return publish({ ...getTheme(), accent: accent || getTheme().accent })
}

export function setButtonStyle(buttonStyle: ButtonStyle): ThemeState {
  return publish({ ...getTheme(), buttonStyle })
}

export function resetTheme(): ThemeState {
  return publish(DEFAULT_CHOICE)
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getTheme)
  return {
    theme,
    palette: paletteFor(theme),
    selectPreset,
    setBackground,
    setAccent,
    setButtonStyle,
    resetTheme,
  }
}
