// The Burst translation vocabulary and its closed-form offset, in their own
// module for the same reason burstEasings.ts is: definitions collected BY
// library.ts (Motion) need them without importing the library itself, which
// would be a cycle. library.ts re-exports both so existing importers - the
// Burst mover's UI panel and its tests - are unaffected.

import { midiVelocity } from '../../utils/midiVelocity'
import type { ResolvedNote } from '../visual/types'
import { BURST_EASINGS } from './burstEasings'

/** Burst's MIDI vocabulary: one row per cardinal direction. */
export const BURST_DIRECTIONS: Record<number, { axis: 0 | 1 | 2; sign: 1 | -1 }> = {
  62: { axis: 1, sign: 1 }, // Up (+Y)
  63: { axis: 1, sign: -1 }, // Down (-Y)
  60: { axis: 0, sign: 1 }, // Right (+X)
  61: { axis: 0, sign: -1 }, // Left (-X)
  64: { axis: 2, sign: 1 }, // Forward (+Z)
  65: { axis: 2, sign: -1 }, // Back (-Z)
}

export interface BurstSettings {
  /** Beats a burst takes to land on its destination. */
  burstBeats: number
  /** Ease-out family (see BURST_EASINGS order). */
  easing: number
  /** Time-warp exponent: >1 makes the initial jump more violent. */
  sharpness: number
  distanceX: number
  distanceY: number
  distanceZ: number
  /** Overall distance multiplier on top of the per-axis distances. */
  distance: number
}

/**
 * The summed offset of every burst launched at or before `beat`. Each note
 * contributes `direction * axisDistance * multiplier * velocity * ease(age)`,
 * where the eased progress clamps at 1 once the burst lands. Step-family
 * curves (BURST_EASINGS entries without `returnsHome`) end at 1, so the step
 * is permanent; return-family curves end back at 0 like an ADSR envelope, so
 * the displacement is temporary and the object comes home once the burst
 * lands. Pitches outside the vocabulary are ignored.
 */
export function evaluateBurstOffset(
  notes: readonly ResolvedNote[],
  settings: BurstSettings,
  beat: number,
): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0]
  const beats = Math.max(0.0001, settings.burstBeats)
  const sharpness = Math.max(0.0001, settings.sharpness)
  const { ease } = BURST_EASINGS[settings.easing] ?? BURST_EASINGS[0]
  const axisDistance = [settings.distanceX, settings.distanceY, settings.distanceZ]
  for (const note of notes) {
    if (note.beat > beat) continue
    const dir = BURST_DIRECTIONS[note.pitch]
    if (!dir) continue
    const progress = Math.min(1, (beat - note.beat) / beats)
    const eased = ease(Math.pow(progress, 1 / sharpness))
    const velocity = midiVelocity(note.velocity)
    out[dir.axis] += dir.sign * axisDistance[dir.axis] * settings.distance * velocity * eased
  }
  return out
}
