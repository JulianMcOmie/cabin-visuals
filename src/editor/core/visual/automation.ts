import type { Block, InterpolationMode } from '../../types'
import { pitchToValue } from '../trackTypes'
import { flattenBlocks } from './noteFlatten'

/** One automation keyframe: a target param value at an absolute project beat. */
export interface AutomationKeyframe {
  beat: number
  value: number
}

/** Flatten an automation track's blocks into value keyframes (absolute beats, sorted).
 *  Each note is a keyframe: its beat is the time, its pitch encodes the value. */
export function extractKeyframes(
  blocks: Block[],
  beatsPerBar: number,
  paramMin: number,
  paramMax: number,
  totalBars?: number,
): AutomationKeyframe[] {
  return flattenBlocks(blocks, beatsPerBar, totalBars).map((note) => ({
    beat: note.beat,
    value: pitchToValue(note.pitch, paramMin, paramMax),
  }))
}

/** Ease a normalized 0..1 fraction per the interpolation mode. */
function ease(t: number, mode: InterpolationMode): number {
  switch (mode) {
    case 'step': return 0 // handled by the caller; never reached for interpolation
    case 'linear': return t
    case 'ease-in': return t * t
    case 'ease-out': return 1 - (1 - t) * (1 - t)
    case 'ease-in-out': return t * t * (3 - 2 * t) // smoothstep
    case 'smooth-step': return t * t * (3 - 2 * t)
    case 'exponential': return t === 0 ? 0 : Math.pow(2, 10 * (t - 1))
  }
}

/**
 * Sample a keyframe lane at `beat`, interpolating per `mode`. Endpoints are held
 * outside the keyframe range (a flat line before the first / after the last). A
 * binary search finds the surrounding pair. Pure function of the beat, so playback
 * and scrubbing produce identical values. Caller guards the empty-lane case.
 */
export function sampleLane(keyframes: AutomationKeyframe[], beat: number, mode: InterpolationMode): number {
  const n = keyframes.length
  if (n === 0) return NaN
  if (beat <= keyframes[0].beat) return keyframes[0].value
  if (beat >= keyframes[n - 1].beat) return keyframes[n - 1].value

  // Largest i with keyframes[i].beat <= beat (guaranteed 0 <= i < n-1 by the guards).
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (keyframes[mid].beat <= beat) lo = mid
    else hi = mid - 1
  }
  const a = keyframes[lo]
  const b = keyframes[lo + 1]
  if (mode === 'step') return a.value
  const span = b.beat - a.beat
  const t = span > 0 ? (beat - a.beat) / span : 0
  return a.value + (b.value - a.value) * ease(t, mode)
}
