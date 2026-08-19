// Binary-searched windows over a note stream, for the per-frame consumers that
// used to scan every note of an object on every frame (active notes, the pulse
// energy, ADSR gates, splitter mute rows).
//
// `flattenBlocks` (noteFlatten.ts) sorts every resolved note array by beat, and
// every per-frame question those consumers ask is a window on that order: "the
// notes that started at or before the beat and can still be sounding / still be
// contributing". Both ends of the window are found by bisection; the caller
// then applies its OWN exact predicate inside the window, so the answer is
// bit-identical to the full scan - the window only skips notes the predicate
// would have rejected anyway (too early to still matter, or not started yet).
//
// The one thing that makes the early edge safe is `maxSounding`: the LONGEST reach
// any note in the array has past its own onset (`durationBeats || minimum`).
// It is measured once per array identity and cached in a WeakMap, alongside a
// sortedness check - an array that is not sorted (a hand-built fixture) simply
// gets the whole range back, so nothing depends on the caller knowing where
// its notes came from. Arrays are immutable per resolve, so caching on identity
// is sound.

export interface WindowedNote {
  beat: number
  durationBeats: number
}

/** A zero-length note still counts as sounding for this long - the rule
 *  VisualEngine's activeNotes and the splitter mute rows share. */
export const MIN_SOUNDING_BEATS = 0.05

interface NoteArrayIndex {
  /** The length the index was built at - a cheap tripwire for an array that
   *  grew after it was first seen (a fixture pushing notes between calls). */
  length: number
  sorted: boolean
  /** max over notes of `durationBeats || MIN_SOUNDING_BEATS` (0 for an empty array). */
  maxSounding: number
  /** max over notes of `durationBeats` as stored (0 for an empty array). */
  maxDuration: number
}

const indexCache = new WeakMap<readonly WindowedNote[], NoteArrayIndex>()

export function noteArrayIndex(notes: readonly WindowedNote[]): NoteArrayIndex {
  let idx = indexCache.get(notes)
  if (idx && idx.length === notes.length) return idx
  let sorted = true
  let maxSounding = 0
  let maxDuration = 0
  let prev = -Infinity
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]
    if (!(n.beat >= prev)) sorted = false
    prev = n.beat
    const dur = n.durationBeats
    if (dur > maxDuration) maxDuration = dur
    const sounding = dur || MIN_SOUNDING_BEATS
    if (sounding > maxSounding) maxSounding = sounding
  }
  idx = { length: notes.length, sorted, maxSounding, maxDuration }
  indexCache.set(notes, idx)
  return idx
}

/** First index whose note starts at or after `beat` (lower bound). Requires a
 *  sorted array - callers go through `noteWindow`, which checks. */
function lowerBound(notes: readonly WindowedNote[], beat: number): number {
  let lo = 0
  let hi = notes.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (notes[mid].beat < beat) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** First index whose note starts strictly after `beat` (upper bound). */
function upperBound(notes: readonly WindowedNote[], beat: number): number {
  let lo = 0
  let hi = notes.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (notes[mid].beat <= beat) lo = mid + 1
    else hi = mid
  }
  return lo
}

const EDGE_MARGIN = 1e-6

/** The range a window query answers with. ONE shared instance, overwritten by
 *  every call - read `start`/`end` before asking for another window. Per-frame
 *  callers ask once per object, and returning a fresh tuple each time was the
 *  allocation this module exists to remove. */
export interface NoteWindowRange {
  start: number
  end: number
}
const range: NoteWindowRange = { start: 0, end: 0 }

/**
 * The index range [start, end) of notes that STARTED at or before `beat` and
 * whose onset is no older than `lookback` beats - i.e. every note that can
 * still matter to a consumer whose influence dies `lookback` after the onset.
 * Notes on the early edge are included generously (`>=`), so the caller's
 * exact predicate decides; a NaN or infinite lookback, or an unsorted array,
 * widens to the whole prefix / the whole array. Iterating [start, end) visits
 * the surviving notes in the same order the full scan would.
 */
export function noteWindow(notes: readonly WindowedNote[], beat: number, lookback: number): NoteWindowRange {
  range.start = 0
  range.end = 0
  if (notes.length === 0) return range
  const idx = noteArrayIndex(notes)
  if (!idx.sorted) {
    range.end = notes.length
    return range
  }
  const end = upperBound(notes, beat)
  // The margin keeps the early edge on the generous side of any rounding in
  // `beat - lookback` versus the consumer's own `beat - n.beat`: a note inside
  // the margin is visited and judged exactly, one outside it is provably dead.
  const start = Number.isFinite(lookback) ? lowerBound(notes, beat - lookback - EDGE_MARGIN) : 0
  range.start = Math.min(start, end)
  range.end = end
  return range
}

/**
 * The window of notes that can be SOUNDING at `beat` under the shared rule
 * `beat >= n.beat && beat < n.beat + (n.durationBeats || MIN_SOUNDING_BEATS)`.
 * The lookback is the array's longest sounding span, so a note that ended is
 * still visited only when some other note in the array is long enough that
 * it could not have been excluded by its onset alone.
 */
export function soundingNoteWindow(notes: readonly WindowedNote[], beat: number): NoteWindowRange {
  return noteWindow(notes, beat, noteArrayIndex(notes).maxSounding)
}
