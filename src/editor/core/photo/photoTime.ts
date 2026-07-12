import type { ResolvedNote } from '../visual/types'

// The Photo instrument's pure time model - the still-image sibling of
// core/video/videoTime.ts. No DOM, no three.js: everything on screen derives
// from (beat, notes) through this one function, which is what makes scrub,
// pause, and export land on identical frames. There is no clip-time here: a
// photo has no timeline of its own, so the latch is the whole model.

/** The fixed pitch photo 1 answers. Internal plumbing, never user-facing: the
 *  MIDI editor shows one labelled row per photo, so the actual pitch numbers
 *  are an implementation detail. Shares Video's base so the two lanes read the
 *  same way. */
export const PHOTO_BASE_PITCH = 48

export interface ActivePhoto {
  /** Index into the track's ordered photoPads (its photo bank). */
  photoIndex: number
  /** The note-on that selected the photo - its beat, kept for parity with
   *  video (a photo has no per-note clock, but the origin still identifies the
   *  latch). */
  noteBeat: number
}

/**
 * The photo latched at `beat`: the LATEST note-on at or before it whose block
 * still covers the beat. Latch semantics - a photo keeps showing after its
 * note ends, until a later note-on replaces it - but the latch never leaks
 * past its own block's end (block-gated visibility). null = nothing showing.
 */
export function activePhotoAt(
  notes: ResolvedNote[],
  beat: number,
  baseNote: number,
  photoCount: number,
): ActivePhoto | null {
  if (photoCount <= 0) return null
  let best: ResolvedNote | null = null
  for (const n of notes) {
    if (n.beat > beat) continue
    if (beat >= n.blockEndBeat) continue // its block is over - the latch died with it
    if (!best || n.beat >= best.beat) best = n
  }
  if (!best) return null
  const raw = (best.pitch - baseNote) % photoCount
  return { photoIndex: raw < 0 ? raw + photoCount : raw, noteBeat: best.beat }
}
