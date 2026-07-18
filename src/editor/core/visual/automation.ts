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

// ── Noise mode ───────────────────────────────────────────────────────────────
// An automation track flipped to noise mode stops being a keyframe lane: its
// notes become GATES - while a note is held, the param wanders randomly
// around the note's pitch-value; between notes the lane is inert. Seeded and
// sampled as a pure function of the beat, so pause/scrub/export all replay
// the exact same wobble (the pause invariant applies to noise too).

/** Track-level noise settings (stored on the automation track). */
export interface NoiseConfig {
  /** Wiggles per beat. */
  rate: number
  /** 0 = stepped chaos (hold each value), 1 = smooth wandering. */
  smoothness: number
  /** Deviation around the note's value, as a fraction of the param's range. */
  range: number
  /** Fixed at authoring time; re-roll for a new take. */
  seed: number
}

/** One noise burst: a held note's window and its pitch-mapped center value. */
export interface NoiseGate {
  beat: number
  endBeat: number
  center: number
  /** Velocity scaling (0..1) of the burst's deviation. */
  amp: number
}

/** Flatten a noise-mode track's blocks into burst gates. */
export function extractNoiseGates(
  blocks: Block[],
  beatsPerBar: number,
  paramMin: number,
  paramMax: number,
  totalBars?: number,
): NoiseGate[] {
  return flattenBlocks(blocks, beatsPerBar, totalBars).map((note) => ({
    beat: note.beat,
    endBeat: note.beat + note.durationBeats,
    center: pitchToValue(note.pitch, paramMin, paramMax),
    amp: Math.max(0, Math.min(1, (note.velocity ?? 100) / 127)),
  }))
}

/** Deterministic integer hash → [-1, 1]. */
function noiseHash(i: number, seed: number): number {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(seed | 0, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1
}

/** Sample a noise lane at `beat`: NaN outside every gate (lane inert), else
 *  the gate's center value plus seeded value-noise scaled by range and the
 *  note's velocity, clamped to the param range. */
export function sampleNoiseLane(
  cfg: NoiseConfig,
  gates: NoiseGate[],
  beat: number,
  paramMin: number,
  paramMax: number,
): number {
  let gate: NoiseGate | undefined
  for (const g of gates) {
    if (beat >= g.beat && beat < g.endBeat) { gate = g; break }
  }
  if (!gate) return NaN
  const t = beat * Math.max(0.01, cfg.rate)
  const i = Math.floor(t)
  const a = noiseHash(i, cfg.seed)
  const b = noiseHash(i + 1, cfg.seed)
  const u = t - i
  const s = Math.max(0, Math.min(1, cfg.smoothness))
  // smoothness blends hold-the-sample (stepped chaos) toward smoothstepped
  // travel between samples (smooth wandering).
  const n = a + (b - a) * (s * (u * u * (3 - 2 * u)))
  const value = gate.center + n * (paramMax - paramMin) * cfg.range * gate.amp * 0.5
  return Math.max(paramMin, Math.min(paramMax, value))
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
