import type { MidiRow } from '../types'
import type { VimKeyRegime } from './types'

/**
 * Logic's musical-typing row, in pitch order: `a` is C, `w` C#, ... `p` D# an
 * octave up. Sixteen keys, which is why the whole keymap is shaped around a
 * sixteen-row window.
 */
export const TYPING_KEYS = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k', 'o', 'l', 'p'] as const

export const TYPING_KEY_SET: ReadonlySet<string> = new Set(TYPING_KEYS)

/**
 * Which row each note key hits.
 *
 * `rows` is ordered top-to-bottom (index 0 is the highest pitch), and the keys
 * ascend, so a key's index counts DOWNWARD from the anchor: `a` sits at
 * `anchorRow` and `p` fifteen rows above it. Chromatic and vocabulary rows share
 * that formula — on a full piano the rows are consecutive semitones, so
 * "fifteen rows up" and "fifteen semitones up" are the same move.
 *
 * Value rows are different in kind: pitch encodes a param value, so the useful
 * mapping is not sixteen adjacent values but the whole range under the hand.
 * The keys spread across every row, `a` at the minimum (bottom) and `p` at the
 * maximum (top), so typing a melody writes a curve.
 */
export function keyMapForRows(rows: MidiRow[], regime: VimKeyRegime, anchorRow: number): Map<string, number> {
  const map = new Map<string, number>()
  const count = rows.length
  if (count === 0) return map

  if (regime === 'value') {
    const last = TYPING_KEYS.length - 1
    TYPING_KEYS.forEach((key, i) => {
      // i = 0 → bottom row (lowest value), i = 15 → top row.
      const row = Math.round(((last - i) / last) * (count - 1))
      map.set(key, row)
    })
    return map
  }

  TYPING_KEYS.forEach((key, i) => {
    const row = anchorRow - i
    if (row >= 0 && row < count) map.set(key, row)
  })
  return map
}

/** The reverse lookup the row gutter draws: row index → the key that plays it. */
export function rowKeyLabels(rows: MidiRow[], regime: VimKeyRegime, anchorRow: number): Map<number, string> {
  const labels = new Map<number, string>()
  for (const [key, row] of keyMapForRows(rows, regime, anchorRow)) {
    // In the value regime several keys can round onto one row; the first wins,
    // and TYPING_KEYS order means that's the lower-value key — the one whose
    // neighbours are also predictable.
    if (!labels.has(row)) labels.set(row, key)
  }
  return labels
}

/** How far `Shift+c` / `Shift+v` jumps: an octave on a piano, a full key window
 *  on a declared vocabulary, a quarter of the range on a value lane. */
export function bigRowStep(regime: VimKeyRegime, rowCount: number): number {
  if (regime === 'chromatic') return 12
  if (regime === 'value') return Math.max(1, Math.round(rowCount / 4))
  return TYPING_KEYS.length
}

/**
 * Keep the key window over the cursor. The anchor only moves when the cursor
 * leaves the window, and it moves by whole windows, so the mapping stays still
 * while you work in one region and re-lands predictably when you travel.
 */
export function anchorForCursor(anchorRow: number, cursorRow: number, rowCount: number): number {
  const span = TYPING_KEYS.length
  const maxAnchor = Math.max(0, rowCount - 1)
  let anchor = Math.min(anchorRow, maxAnchor)
  if (cursorRow > anchor) {
    anchor = Math.min(maxAnchor, cursorRow)
  } else if (cursorRow <= anchor - span) {
    anchor = Math.max(span - 1, cursorRow + span - 1)
    anchor = Math.min(anchor, maxAnchor)
  }
  return Math.max(0, anchor)
}
