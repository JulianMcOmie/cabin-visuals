// Pure per-slice state for the in-scene Crop mask instrument (Crop.tsx).
// Split from the component per the instruments-guide testing rule; imports only
// the React-free crop math from core/directors/crop.ts so the flash envelope
// and pitch vocabulary stay single-sourced with the Main composition surface.

import type { ResolvedNote } from '../core/visual/types'
import { CROP_BASE_PITCH, MAX_DIVISIONS, cropFlashEnvelope } from '../core/directors/crop'

/**
 * Per-slice mask state at `beat`, encoded for the shader in one number:
 *   0            - slice masked (no covering note)
 *   1 + envelope - slice visible; envelope in [0, 1] is the onset flash/blur
 *                  drive (0 once the flash window has passed)
 *
 * The array is always MAX_DIVISIONS long (the shader's fixed uniform size);
 * slices at index >= divisions stay 0 and their pitches are outside the row
 * vocabulary anyway.
 *
 * Returns null when the track has NO notes at all - deliberately different
 * from the Main crop, which treats an empty lane as "everything masked". A
 * freshly dropped in-scene Crop must not blank its scene before a single note
 * exists; once any note is written, silence honestly means masked.
 */
export function resolveCropSliceStates(
  notes: readonly ResolvedNote[],
  beat: number,
  divisions: number,
  flashBeats: number,
): Float32Array | null {
  if (notes.length === 0) return null
  const count = Math.max(1, Math.min(MAX_DIVISIONS, Math.round(divisions)))
  // Latest onset per covered slice, so a retrigger mid-hold restarts the flash
  // (same rule as the director's sliceOnsetBeats).
  const onsets = new Map<number, number>()
  for (const note of notes) {
    const index = note.pitch - CROP_BASE_PITCH
    if (index < 0 || index >= count) continue
    if (beat < note.beat || beat >= note.beat + note.durationBeats) continue
    const previous = onsets.get(index)
    if (previous === undefined || note.beat > previous) onsets.set(index, note.beat)
  }
  const states = new Float32Array(MAX_DIVISIONS)
  const duration = Math.max(0.01, flashBeats)
  for (const [index, onset] of onsets) {
    states[index] = 1 + cropFlashEnvelope((beat - onset) / duration)
  }
  return states
}
