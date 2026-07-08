import type { ResolvedNote } from '../visual/types'

// The Video instrument's pure time model (see docs/video-instrument-
// architecture.html §2). No DOM, no three.js: everything on screen derives
// from (beat, notes) through these two functions, which is what makes scrub,
// pause, and export land on identical frames.

export interface ActiveVideo {
  /** Index into the track's ordered videoRefs (its pad bank). */
  clipIndex: number
  /** The note-on that selected the clip - its beat is the clip's time origin. */
  noteBeat: number
}

/**
 * The clip latched at `beat`: the LATEST note-on at or before it whose block
 * still covers the beat. Latch semantics - a clip keeps playing after its
 * note ends, until a later note-on replaces it - but the latch never leaks
 * past its own block's end (block-gated visibility). null = nothing showing.
 */
export function activeVideoAt(
  notes: ResolvedNote[],
  beat: number,
  baseNote: number,
  clipCount: number,
): ActiveVideo | null {
  if (clipCount <= 0) return null
  let best: ResolvedNote | null = null
  for (const n of notes) {
    if (n.beat > beat) continue
    if (beat >= n.blockEndBeat) continue // its block is over - the latch died with it
    if (!best || n.beat >= best.beat) best = n
  }
  if (!best) return null
  const raw = (best.pitch - baseNote) % clipCount
  return { clipIndex: raw < 0 ? raw + clipCount : raw, noteBeat: best.beat }
}

/**
 * Seconds into the clip at `beat`, given the note-on that started it. Loops
 * wrap; non-looping clips hold their last frame (a hair before `duration`, so
 * a seek there never lands past the end).
 */
export function clipTimeAt(
  beat: number,
  noteBeat: number,
  secPerBeat: number,
  duration: number,
  loop: boolean,
): number {
  const t = Math.max(0, (beat - noteBeat) * secPerBeat)
  if (duration <= 0) return 0
  if (loop) return t % duration
  return Math.min(t, Math.max(0, duration - 1 / 60))
}
