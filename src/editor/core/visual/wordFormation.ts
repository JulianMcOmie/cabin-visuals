import type { ParamDef } from '../../instruments/types'

/**
 * Word Formation lanes: the geometry a Text Display arranges its words into.
 *
 * A `wordFormation` child track carries ONE arrangement (its params live in the
 * track's `inputValues`, exactly like a mover's) plus the notes that say when
 * that arrangement is on. Several lanes under one Text Display are several
 * formations; the lane whose note started most recently owns the frame. Text
 * Display then seats its words into the arrangement's slots one per "next word"
 * note and CYCLES when it runs out of them.
 *
 * Why this is not a splitter: a splitter would give the geometry and none of the
 * content - `VisualCopy` is deliberately content-blind, so all four cells of a
 * 2x2 would render the same word, and copy count may not depend on the beat
 * (core/visualCopies/CLAUDE.md). Nothing here enters the VisualCopy chain: the
 * lane resolves to slots and the instrument seats words in them, so a splitter
 * above the text still duplicates the finished arrangement.
 *
 * Everything is a pure function of (settings, beat, note stream) - the one rule.
 */

/** Cycle mode: what happens when the last slot is taken. */
export const CYCLE_CLEAR = 0
export const CYCLE_SCROLL = 1
export const CYCLE_HOLD = 2

/** Fill order: which slot the next word lands in. */
export const FILL_ROW = 0
export const FILL_COLUMN = 1
export const FILL_CENTER = 2
export const FILL_SPIRAL = 3

/** Per-dimension count ceiling. The product is capped separately - see
 *  MAX_FORMATION_SLOTS. */
export const MAX_DIMENSION = 8

/** Hard ceiling on slots in one arrangement. 8x8x8 is 512 words on screen, which
 *  is neither readable nor affordable (one pooled mesh + canvas each), so the
 *  slot list is TRUNCATED past this. Counts stay independent - truncating is
 *  what keeps a mistyped depth from allocating 512 canvases. */
export const MAX_FORMATION_SLOTS = 64

/** The id the library card and the preview registry use for this lane. It is NOT
 *  an instrument id and never reaches `getInstrument` - the library just needs a
 *  stable key for a card that adds a `wordFormation` track. */
export const WORD_FORMATION_LIBRARY_ID = 'wordFormation'

/** The lane's single MIDI row. A formation has one thing to say, so the editor
 *  shows one labelled row and the resolver ignores pitch entirely - the pitch is
 *  frozen only so the row the editor draws and the notes already written stay in
 *  the same place. */
export const WORD_FORMATION_PITCH = 60

/** A ring nested inside another takes this share of its radius. At equal radii
 *  the two rings intersect and the formation reads as a tangle rather than a
 *  tube, so the inner one always sits clear of the outer. */
const RING_NEST = 0.62

/**
 * The lane's schema. Numeric params (no `type`) are the automatable ones, so
 * every geometry number here can be driven by an automation child - including
 * the COUNTS, which is safe precisely because these are not VisualCopies: the
 * instrument re-seats words per frame, and no mounted-object pool has to be
 * sized ahead of the beat.
 */
export const WORD_FORMATION_PARAMS: ParamDef[] = [
  { key: 'columns', label: 'Columns', min: 1, max: MAX_DIMENSION, step: 1, default: 2 },
  { key: 'columnsRing', label: 'Columns as ring', type: 'boolean', default: 0 },
  { key: 'rows', label: 'Rows', min: 1, max: MAX_DIMENSION, step: 1, default: 2 },
  { key: 'rowsRing', label: 'Rows as ring', type: 'boolean', default: 0 },
  { key: 'depth', label: 'Depth', min: 1, max: MAX_DIMENSION, step: 1, default: 1 },
  { key: 'depthRing', label: 'Depth as ring', type: 'boolean', default: 0 },
  { key: 'spacing', label: 'Spacing', min: 0.4, max: 3.2, step: 0.05, default: 1.55 },
  { key: 'radius', label: 'Radius', min: 0.4, max: 3.6, step: 0.05, default: 1.9 },
  { key: 'tilt', label: 'Tilt', min: -60, max: 60, step: 1, default: 0 },
  { key: 'size', label: 'Size', min: 0.3, max: 2, step: 0.05, default: 1 },
  {
    key: 'cycle', label: 'Cycle', type: 'select', default: CYCLE_CLEAR, options: [
      { value: CYCLE_CLEAR, label: 'Clear' },
      { value: CYCLE_SCROLL, label: 'Scroll' },
      { value: CYCLE_HOLD, label: 'Hold' },
    ],
  },
  {
    key: 'fill', label: 'Fill order', type: 'select', default: FILL_ROW, options: [
      { value: FILL_ROW, label: 'Row' },
      { value: FILL_COLUMN, label: 'Column' },
      { value: FILL_CENTER, label: 'Center out' },
      { value: FILL_SPIRAL, label: 'Spiral' },
    ],
  },
  { key: 'carry', label: 'Carry over', type: 'boolean', default: 0 },
  { key: 'fade', label: 'Fade trail', min: 0, max: 1, step: 0.05, default: 0.5 },
]

/** Fold a lane's stored `inputValues` over the schema defaults, so every consumer
 *  reads a complete settings record and a lane saved before a param existed picks
 *  up that param's default rather than a hole. Booleans/selects live in the same
 *  numeric record - only plain numeric params are automatable, which is the same
 *  split movers use. */
export function mergeFormationSettings(inputValues?: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of WORD_FORMATION_PARAMS) out[p.key] = p.default as number
  if (inputValues) {
    for (const key in inputValues) {
      const v = inputValues[key]
      if (Number.isFinite(v)) out[key] = v
    }
  }
  return out
}

/** One seat in an arrangement. Position is in the instrument's own placement
 *  units (the same units Text Display's world-space words already live in);
 *  col/row/dep are the lattice indices the fill orders sort on. */
export interface FormationSlot {
  x: number
  y: number
  z: number
  col: number
  row: number
  dep: number
}

/** A `wordFormation` child track, resolved: its settings and the notes that say
 *  when it is the live arrangement. */
export interface ResolvedWordFormation {
  trackId: string
  settings: Record<string, number>
  /** Absolute beats of this lane's note onsets, ascending. Any pitch counts -
   *  the lane has one thing to say, so it needs no row vocabulary. */
  onsets: number[]
}

const clampCount = (v: number | undefined, fallback: number) =>
  Math.max(1, Math.min(MAX_DIMENSION, Math.round(Number.isFinite(v as number) ? (v as number) : fallback)))

const num = (s: Record<string, number>, key: string, fallback: number) => {
  const v = s[key]
  return Number.isFinite(v) ? v : fallback
}

/**
 * Build an arrangement's slots.
 *
 * Each dimension is independently a LINE (evenly spaced along its own axis) or a
 * RING (wrapped into a circle). Columns ride the screen plane so a ring of
 * columns is the circle people actually want for text; rows wrap into depth so
 * columns-ring + rows-ring is a torus; depth turns the accumulated position
 * about Y, so depth-ring wraps the whole arrangement around the viewer. Order is
 * columns, then rows, then depth - a ring nests INSIDE the ring above it.
 */
export function formationSlots(settings: Record<string, number>): FormationSlot[] {
  const nc = clampCount(settings.columns, 2)
  const nr = clampCount(settings.rows, 2)
  const nd = clampCount(settings.depth, 1)
  const spacing = num(settings, 'spacing', 1.55)
  const radius = num(settings, 'radius', 1.9)
  const tilt = (num(settings, 'tilt', 0) * Math.PI) / 180
  const colRing = num(settings, 'columnsRing', 0) >= 0.5
  const rowRing = num(settings, 'rowsRing', 0) >= 0.5
  const depRing = num(settings, 'depthRing', 0) >= 0.5

  const out: FormationSlot[] = []
  for (let dep = 0; dep < nd; dep++) {
    for (let row = 0; row < nr; row++) {
      for (let col = 0; col < nc; col++) {
        if (out.length >= MAX_FORMATION_SLOTS) return out
        let x = 0
        let y = 0
        let z = 0
        if (colRing) {
          const t = (col / nc) * Math.PI * 2
          x = Math.sin(t) * radius
          y = Math.cos(t) * radius
        } else {
          x = (col - (nc - 1) / 2) * spacing
        }
        if (rowRing) {
          const t = (row / nr) * Math.PI * 2
          const r = radius * RING_NEST
          z += Math.sin(t) * r
          y += Math.cos(t) * r
        } else {
          y -= (row - (nr - 1) / 2) * spacing
        }
        if (depRing) {
          const t = (dep / nd) * Math.PI * 2
          const cos = Math.cos(t)
          const sin = Math.sin(t)
          const rx = x * cos - z * sin
          z = x * sin + z * cos
          x = rx
        } else {
          z += (dep - (nd - 1) / 2) * spacing
        }
        // Tilt rakes the whole arrangement about X, so a flat grid can lie back
        // into perspective without every dimension needing its own angle.
        const ty = y * Math.cos(tilt) - z * Math.sin(tilt)
        const tz = y * Math.sin(tilt) + z * Math.cos(tilt)
        out.push({ x, y: ty, z: tz, col, row, dep })
      }
    }
  }
  return out
}

/** Reorder slots into the order words land in them. Sorts are stable on the
 *  generation index so equal keys keep lattice order rather than jittering. */
export function orderFormationSlots(slots: FormationSlot[], fill: number): FormationSlot[] {
  if (slots.length < 2) return slots
  const mode = Math.round(fill)
  if (mode === FILL_ROW) return slots
  const idx = slots.map((_, i) => i)
  const maxCol = Math.max(...slots.map((s) => s.col))
  const maxRow = Math.max(...slots.map((s) => s.row))
  const cx = maxCol / 2
  const cy = maxRow / 2
  const rank = (s: FormationSlot) => Math.hypot(s.col - cx, s.row - cy)
  if (mode === FILL_COLUMN) {
    idx.sort((a, b) => {
      const p = slots[a]
      const q = slots[b]
      return p.col - q.col || p.row - q.row || p.dep - q.dep || a - b
    })
  } else if (mode === FILL_CENTER) {
    idx.sort((a, b) => rank(slots[a]) - rank(slots[b]) || a - b)
  } else if (mode === FILL_SPIRAL) {
    // Rings out from the middle, walking around each ring - the difference from
    // center-out is that a ring is traversed in order rather than by whatever
    // the distance tie-break happened to be.
    idx.sort((a, b) => {
      const p = slots[a]
      const q = slots[b]
      const dr = Math.round(rank(p) * 4) - Math.round(rank(q) * 4)
      if (dr !== 0) return dr
      const ap = Math.atan2(p.row - cy, p.col - cx)
      const aq = Math.atan2(q.row - cy, q.col - cx)
      return ap - aq || a - b
    })
  }
  return idx.map((i) => slots[i])
}

/** Slots in fill order - what a frame actually seats words into. */
export function formationSeats(settings: Record<string, number>): FormationSlot[] {
  return orderFormationSlots(formationSlots(settings), num(settings, 'fill', FILL_ROW))
}

/**
 * Which lane owns this beat: the one whose most recent onset at or before `beat`
 * is latest. Ties go to the LAST lane in order, so a formation added later wins
 * a shared onset - the same "last one placed owns it" rule the chain uses.
 * Returns null before any lane has played a note (Text Display then keeps its
 * ordinary layout).
 */
export function activeFormation(
  lanes: ResolvedWordFormation[],
  beat: number,
): { lane: ResolvedWordFormation; startBeat: number } | null {
  let best: { lane: ResolvedWordFormation; startBeat: number } | null = null
  for (const lane of lanes) {
    let start = -Infinity
    for (const onset of lane.onsets) {
      if (onset <= beat && onset > start) start = onset
    }
    if (start === -Infinity) continue
    if (!best || start >= best.startBeat) best = { lane, startBeat: start }
  }
  return best
}

/** One word seated in the arrangement. */
export interface FormationPlacement {
  /** Position in the word stream - which word this is. */
  wordIndex: number
  slot: FormationSlot
  /** Beats-old within the arrangement: 0 is the word that just landed. */
  age: number
}

/**
 * Seat words into slots.
 *
 * `totalWords` is how many word onsets have passed at this beat; `wordsInRun` is
 * how many of them belong to the live arrangement (all of them when the lane
 * carries over, which is what makes a formation change re-seat what is already
 * on screen instead of starting empty).
 */
export function seatWords(
  seats: FormationSlot[],
  cycle: number,
  totalWords: number,
  wordsInRun: number,
): FormationPlacement[] {
  const n = seats.length
  const k = Math.max(0, Math.min(totalWords, wordsInRun))
  if (n === 0 || k === 0) return []
  const mode = Math.round(cycle)
  // CLEAR wraps back to an empty frame on the word after the last slot; the
  // other two stop growing at a full arrangement.
  const filled = mode === CYCLE_CLEAR ? ((k - 1) % n) + 1 : Math.min(k, n)
  // The global index of this run's first word - what HOLD freezes on.
  const runStart = totalWords - k
  const out: FormationPlacement[] = []
  for (let p = 0; p < filled; p++) {
    // HOLD keeps the words it caught; the others show the newest `filled`.
    const wordIndex = mode === CYCLE_HOLD ? runStart + p : totalWords - filled + p
    // SCROLL rotates the seats so the newest word takes the seat after the
    // previous one and the oldest falls out where it stood - a marquee. Before
    // the arrangement is full there is nothing to rotate yet.
    const seat = mode === CYCLE_SCROLL && k > n ? (k - filled + p) % n : p
    out.push({ wordIndex, slot: seats[seat], age: filled - 1 - p })
  }
  return out
}

/** Count onsets at or before `beat`, and how many of those are at or after
 *  `since`. One pass over an ascending list. */
export function countOnsets(onsets: number[], beat: number, since: number): { total: number; inRun: number } {
  let total = 0
  let inRun = 0
  for (const onset of onsets) {
    if (onset > beat) break
    total++
    if (onset >= since) inRun++
  }
  return { total, inRun }
}
