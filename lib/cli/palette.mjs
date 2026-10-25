// Search helpers for the command palette. Kept pure so they can be tested
// without a terminal.

export function paletteScore(item, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return 0
  const label = String(item.label || '').toLowerCase()
  const text = `${label} ${item.hint || ''} ${item.keywords || ''}`.toLowerCase()
  const terms = q.split(/\s+/).filter(Boolean)
  if (!terms.every((term) => text.includes(term))) return -1
  let score = 0
  if (label === q) score += 100
  if (label.startsWith(q)) score += 40
  if (label.includes(q)) score += 15
  return score + terms.length
}

export function filterPalette(items, query) {
  const list = Array.isArray(items) ? items : []
  return list
    .map((item, index) => ({ item, index, score: paletteScore(item, query) }))
    .filter((row) => row.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.item)
}

export function paletteWindow(items, index, maxRows) {
  const list = Array.isArray(items) ? items : []
  const rows = Math.max(1, Math.floor(maxRows || 1))
  const size = Math.max(0, list.length - rows)
  const start = Math.max(0, Math.min(Math.max(0, index - rows + 1), size))
  return { start, rows: list.slice(start, start + rows), hasBefore: start > 0, hasAfter: start + rows < list.length }
}
