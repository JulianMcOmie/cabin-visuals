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

export interface PhotoTransition {
  /** The incoming photo (the one being cut to) - the current latch. */
  toIndex: number
  /** The outgoing photo blended out of, or null when there was nothing on
   *  screen just before (transition plays from black). */
  fromIndex: number | null
  /** 0..1 blend from `fromIndex` to `toIndex`. 1 = the transition is finished
   *  (or there is none), so only `toIndex` shows. */
  progress: number
}

/**
 * The transition state at `beat`: which photo we are cutting TO, which one we
 * are coming FROM, and how far through (0..1). A pure function of (beat, notes)
 * like activePhotoAt - the same scrub/pause/export determinism, extended to
 * carry the outgoing photo so the renderer can blend the two.
 *
 * `transitionBeats <= 0` (or a finished blend) collapses to progress 1 with no
 * `fromIndex`, i.e. a hard cut. The outgoing photo is whatever was latched the
 * instant before the incoming note-on began (null if nothing / the same photo).
 */
export function photoTransitionAt(
  notes: ResolvedNote[],
  beat: number,
  baseNote: number,
  photoCount: number,
  transitionBeats: number,
): PhotoTransition | null {
  const to = activePhotoAt(notes, beat, baseNote, photoCount)
  if (!to) return null
  if (transitionBeats <= 0) return { toIndex: to.photoIndex, fromIndex: null, progress: 1 }

  const elapsed = beat - to.noteBeat
  const progress = elapsed >= transitionBeats ? 1 : Math.max(0, elapsed / transitionBeats)
  if (progress >= 1) return { toIndex: to.photoIndex, fromIndex: null, progress: 1 }

  // The photo latched the instant before this note-on: evaluate the latch over
  // only the notes that began strictly earlier, at the incoming note's beat.
  const prior = notes.filter((n) => n.beat < to.noteBeat)
  const from = activePhotoAt(prior, to.noteBeat, baseNote, photoCount)
  const fromIndex = from && from.photoIndex !== to.photoIndex ? from.photoIndex : null
  return { toIndex: to.photoIndex, fromIndex, progress }
}
