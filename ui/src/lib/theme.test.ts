import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_PRESET_ID, buttonStyles, canonicalHex, contrast, matchPreset, paletteFor,
  parseHex, presetChoice, presets, themeWithPreset, toHex,
} from './theme'

const pairs = (value: string) => parseHex(value) as { r: number; g: number; b: number }
const ratio = (first: string, second: string) => contrast(pairs(first), pairs(second))

test('hex parsing accepts the formats the appearance controls can produce', () => {
  assert.deepEqual(parseHex('#d92d20'), { r: 217, g: 45, b: 32 })
  assert.deepEqual(parseHex('d92d20'), { r: 217, g: 45, b: 32 })
  assert.deepEqual(parseHex('#fff'), { r: 255, g: 255, b: 255 })
  assert.equal(canonicalHex(' #ABC '), '#aabbcc')
  assert.equal(toHex({ r: 300, g: -4, b: 15.6 }), '#ff0010')
  for (const invalid of ['', '#12', '#12345', '#1234567', 'red', '#gggggg']) assert.equal(parseHex(invalid), null)
  assert.equal(canonicalHex('not-a-colour'), null)
})

test('every preset derives readable body, muted, accent and status colours', () => {
  for (const preset of presets) {
    const palette = paletteFor(preset)
    assert.ok(ratio(palette.paper, palette.ink) >= 7, `${preset.name}: body text contrast`)
    assert.ok(ratio(palette.paper2, palette.ink) >= 4.5, `${preset.name}: body text on raised surface`)
    assert.ok(ratio(palette.paper3, palette.ink) >= 4.5, `${preset.name}: body text on selected surface`)
    assert.ok(ratio(palette.paper, palette.muted) >= 4.5, `${preset.name}: muted text contrast`)
    assert.ok(ratio(palette.paper2, palette.muted) >= 4.5, `${preset.name}: muted text on raised surface`)
    assert.ok(ratio(palette.paper3, palette.muted) >= 4.5, `${preset.name}: muted text on selected surface`)
    assert.ok(ratio(palette.accent, palette.accentInk) >= 4.5, `${preset.name}: button label contrast`)
    assert.ok(ratio(palette.accent2, palette.accentInk) >= 4.5, `${preset.name}: hover label contrast`)
    assert.ok(ratio(palette.paper, palette.accentText) >= 4.5, `${preset.name}: accent text contrast`)
    assert.ok(ratio(palette.paper2, palette.accentText) >= 4.5, `${preset.name}: accent text on raised surface`)
    assert.ok(ratio(palette.accentSoft, palette.accentText) >= 4.5, `${preset.name}: accent text on soft surface`)
    assert.ok(ratio(palette.paper2, palette.error) >= 4.5, `${preset.name}: error text contrast`)
    assert.ok(ratio(palette.paper2, palette.success) >= 4.5, `${preset.name}: success text contrast`)
    assert.equal(palette.focus, palette.accentText)
    assert.ok(['light', 'dark'].includes(palette.mode))
  }
})

test('arbitrary background and accent pairs clamp to accessible output', () => {
  const choices = [
    ['#ffffff', '#ffff00'],
    ['#000000', '#0000ff'],
    ['#808080', '#808080'],
    ['#7a7a7a', '#ff00ff'],
    ['#fef3c7', '#f59e0b'],
    ['#0f172a', '#22d3ee'],
    ['#ff0000', '#00ff00'],
    ['#111111', '#111111'],
  ]
  for (const [background, accent] of choices) {
    const palette = paletteFor({ background, accent, buttonStyle: 'solid' })
    const label = `custom ${background}/${accent}`
    assert.ok(ratio(palette.paper, palette.ink) >= 4.5, `${label}: body text`)
    assert.ok(ratio(palette.paper2, palette.ink) >= 4.5, `${label}: body text on raised surface`)
    assert.ok(ratio(palette.paper3, palette.ink) >= 4.5, `${label}: body text on selected surface`)
    assert.ok(ratio(palette.paper, palette.muted) >= 4.5, `${label}: muted text`)
    assert.ok(ratio(palette.paper3, palette.muted) >= 4.5, `${label}: muted text on selected surface`)
    assert.ok(ratio(palette.accent, palette.accentInk) >= 4.5, `${label}: button label`)
    assert.ok(ratio(palette.accent2, palette.accentInk) >= 4.5, `${label}: hover label`)
    assert.ok(ratio(palette.paper, palette.accentText) >= 4.5, `${label}: accent text`)
    assert.ok(ratio(palette.accentSoft, palette.accentText) >= 4.5, `${label}: accent text on soft surface`)
    assert.ok(ratio(palette.paper2, palette.error) >= 4.5, `${label}: error text`)
    assert.ok(ratio(palette.paper2, palette.success) >= 4.5, `${label}: success text`)
  }
})

test('preset membership follows the exact background, accent and button treatment', () => {
  assert.equal(DEFAULT_PRESET_ID, 'ink-red')
  for (const preset of presets) {
    assert.equal(themeWithPreset(presetChoice(preset.id)).preset, preset.id)
    const palette = paletteFor(preset)
    assert.equal(palette.accent, canonicalHex(preset.accent))
  }
  assert.equal(buttonStyles.map((style) => style.id).join(','), 'solid,outline,transparent')
  assert.equal(matchPreset({ background: '#0b0b0c', accent: '#d92d20', buttonStyle: 'outline' }), 'custom')
  assert.equal(matchPreset({ background: '#0B0B0C', accent: '#D92D20', buttonStyle: 'solid' }), 'ink-red')
  assert.equal(matchPreset({ background: '#123456', accent: '#d92d20', buttonStyle: 'solid' }), 'custom')
})

test('malformed stored colours fall back to the Ink & Red defaults', () => {
  const fallback = presetChoice(DEFAULT_PRESET_ID)
  for (const background of ['', 'nope', '#12']) {
    const palette = paletteFor({ background, accent: 'nope', buttonStyle: 'solid' })
    assert.equal(palette.paper, fallback.background)
    assert.equal(palette.accent, fallback.accent)
  }
})
