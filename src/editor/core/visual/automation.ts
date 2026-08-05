import type { AdsrEnvelope, AutomationMode, Block, InterpolationMode, Track } from '../../types'
import { pitchToValue } from '../trackTypes'
import { adsrGateGain, type AdsrGate } from './adsr'
import { flattenBlocks } from './noteFlatten'

/** One automation keyframe: a target param value at an absolute project beat. */
export interface AutomationKeyframe {
  beat: number
  value: number
}

// ── Amount (lane output gain) ────────────────────────────────────────────────
// A whole-lane multiplier applied at extraction, whatever the mode: keyframe
// values, noise centers (resolve.ts scales the deviation to match) and burst
// targets all scale by it, then clamp back to the param's range. It is a GAIN
// on what the notes say, not a remap of the pitch rows - the piano roll's row
// labels keep meaning "the value at 100%".

/** The amount fader's top: 10 = the lane can boost what its notes wrote tenfold
 *  (values still clamp back to the param's range, so this is headroom for lanes
 *  written low, not a way to escape a param's bounds). */
export const AUTOMATION_AMOUNT_MAX = 10
export const DEFAULT_AUTOMATION_AMOUNT = 1

/** A track's effective amount: absent = 1, and never negative (a document edited
 *  by hand can't flip a lane upside down by surprise). */
export function automationAmount(track: Pick<Track, 'automationAmount'>): number {
  return Math.max(0, track.automationAmount ?? DEFAULT_AUTOMATION_AMOUNT)
}

/** Apply the lane's amount to one pitch-derived value. */
function scaleValue(value: number, amount: number, paramMin: number, paramMax: number): number {
  if (amount === 1) return value
  return Math.max(paramMin, Math.min(paramMax, value * amount))
}

/** Flatten an automation track's blocks into value keyframes (absolute beats, sorted).
 *  Each note is a keyframe: its beat is the time, its pitch encodes the value
 *  (scaled by the lane's `amount` and clamped back to the param's range). */
export function extractKeyframes(
  blocks: Block[],
  beatsPerBar: number,
  paramMin: number,
  paramMax: number,
  totalBars?: number,
  amount = 1,
): AutomationKeyframe[] {
  return flattenBlocks(blocks, beatsPerBar, totalBars).map((note) => ({
    beat: note.beat,
    value: scaleValue(pitchToValue(note.pitch, paramMin, paramMax), amount, paramMin, paramMax),
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

/** What flipping a lane to noise mode starts from; the caller supplies the seed
 *  (it is re-rolled per take, and the engine must stay free of randomness). */
export const DEFAULT_NOISE: Omit<NoiseConfig, 'seed'> = {
  rate: 4,
  smoothness: 0.5,
  range: 0.5,
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
  amount = 1,
): NoiseGate[] {
  return flattenBlocks(blocks, beatsPerBar, totalBars).map((note) => ({
    beat: note.beat,
    endBeat: note.beat + note.durationBeats,
    center: scaleValue(pitchToValue(note.pitch, paramMin, paramMax), amount, paramMin, paramMax),
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

// ── Burst mode ───────────────────────────────────────────────────────────────
// The third lane mode. Notes stop being keyframes and become ADSR BURSTS: every
// note fires the same adjustable envelope (attack/decay/sustain/release, all in
// BEATS), and the note's PITCH says how far that burst travels - the param
// leaves whatever value is underneath and heads for the note's pitch-value,
// arriving exactly at full gain. Velocity is the note's intensity, and the
// track-level `intensity` scales every burst at once. Between bursts the lane is
// inert (NaN) like noise mode, so the base value shows through instead of the
// last keyframe. Closed-form over the note list (adsr.ts), so pause/scrub/export
// replay identically.

/** Track-level burst settings (stored on the automation track). */
export interface BurstConfig extends AdsrEnvelope {
  /** Scales every burst's travel: 0 = the lane does nothing, 1 = full reach. */
  intensity: number
}

/** What flipping a lane to burst mode starts from: a fast hit that falls to a low
 *  sustain, so a single tap reads as a burst while a held note still holds. */
export const DEFAULT_BURST: BurstConfig = {
  attackBeats: 0.05,
  decayBeats: 0.5,
  sustainLevel: 0.35,
  releaseBeats: 0.5,
  intensity: 1,
}

/** One burst: a note's gate window plus the value it reaches at full gain. */
export interface BurstGate extends AdsrGate {
  /** Where this burst is headed, from the note's pitch. */
  value: number
}

/** Flatten a burst-mode track's blocks into bursts (pitch → peak value). */
export function extractBurstGates(
  blocks: Block[],
  beatsPerBar: number,
  paramMin: number,
  paramMax: number,
  totalBars?: number,
  amount = 1,
): BurstGate[] {
  return flattenBlocks(blocks, beatsPerBar, totalBars).map((note) => ({
    beat: note.beat,
    durationBeats: note.durationBeats,
    velocity: note.velocity ?? 100,
    value: scaleValue(pitchToValue(note.pitch, paramMin, paramMax), amount, paramMin, paramMax),
  }))
}

/** Sample a burst lane at `beat`: NaN while no burst is live (lane inert), else
 *  `base` travelled toward the live bursts' value. Overlapping bursts blend -
 *  the destination is their gain-weighted average value and the total travel
 *  clamps at 1, matching evaluateAdsrGain's sum-and-clamp stacking. */
export function sampleBurstLane(
  cfg: BurstConfig,
  gates: readonly BurstGate[],
  beat: number,
  base: number,
): number {
  let gainSum = 0
  let weightedValue = 0
  for (const g of gates) {
    const gain = adsrGateGain(g, beat, cfg)
    if (gain <= 0) continue
    gainSum += gain
    weightedValue += gain * g.value
  }
  if (gainSum <= 0) return NaN
  const target = weightedValue / gainSum
  const travel = Math.min(1, gainSum) * Math.max(0, Math.min(1, cfg.intensity))
  return base + (target - base) * travel
}

/** Ease a normalized 0..1 fraction per the interpolation mode. Exported so the
 *  automation panel can PLOT the curve the lane will actually ride, instead of
 *  drawing its own idea of one. */
export function easeFraction(t: number, mode: InterpolationMode): number {
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
  return a.value + (b.value - a.value) * easeFraction(t, mode)
}

// ── One lane, three modes ────────────────────────────────────────────────────

/** Which model a lane's notes follow. Burst wins if a document somehow carries
 *  both configs - the same precedence resolve.ts applies, kept in one place so
 *  the editor can never disagree with the engine about what a lane is. */
export function automationMode(track: Pick<Track, 'noise' | 'burst'>): AutomationMode {
  return track.burst ? 'burst' : track.noise ? 'noise' : 'curve'
}

/**
 * The mode-bearing fields every resolved lane carries, whatever it drives (an
 * instrument/mover param or an effect setting - see core/visual/types.ts, whose
 * ResolvedAutomation and ResolvedEffectAutomation both extend this). Exactly one
 * mode is populated: `noise`+`gates`, `burst`+`bursts`, or plain `keyframes`.
 */
export interface AutomationLane {
  mode: InterpolationMode
  keyframes: AutomationKeyframe[]
  noise?: NoiseConfig
  gates?: NoiseGate[]
  burst?: BurstConfig
  bursts?: BurstGate[]
  /** Param range, for noise's deviation scaling. */
  min?: number
  max?: number
  /** What a burst departs from when nothing underneath has set a value (the
   *  param's default / the effect's stored setting). */
  base?: number
}

/**
 * Sample a lane at `beat` whatever its mode - THE single place that decides what
 * mode a lane is in, so the engine, the hover preview and paramAtBeat can never
 * disagree and a new mode lands in all of them at once.
 *
 * NaN means the lane is INERT this frame (a noise/burst lane between its gates,
 * or a lane with no notes at all): callers keep whatever value was already
 * there. `base` is what a burst travels away from; the other modes ignore it.
 */
export function sampleAutomationLane(lane: AutomationLane, beat: number, base: number): number {
  if (lane.burst) {
    return lane.bursts?.length ? sampleBurstLane(lane.burst, lane.bursts, beat, base) : NaN
  }
  if (lane.noise) {
    return lane.gates?.length
      ? sampleNoiseLane(lane.noise, lane.gates, beat, lane.min ?? 0, lane.max ?? 1)
      : NaN
  }
  return lane.keyframes.length ? sampleLane(lane.keyframes, beat, lane.mode) : NaN
}

/**
 * The range a lane can ever reach, over ALL beats - what sizes a structural
 * budget (a mover's mounted copy pool) to the automation's reach rather than to
 * whatever the lane happens to say at one probe beat. `base` is the value that
 * shows through wherever the lane is inert, so it bounds every mode that can go
 * inert; a keyframe lane with notes never is, and deliberately excludes it (the
 * knob's value never shows through such a lane, and including it would
 * over-mount).
 *
 * Sound because every mode interpolates BETWEEN its extremes: easings map onto
 * [0,1], a burst travels from `base` toward its targets by a 0..1 fraction, and
 * noise clamps to the param range around its centers.
 */
export function automationLaneValueBounds(
  lane: AutomationLane,
  base: number,
): { min: number; max: number } {
  if (lane.burst) {
    let min = base
    let max = base
    for (const g of lane.bursts ?? []) {
      min = Math.min(min, g.value)
      max = Math.max(max, g.value)
    }
    return { min, max }
  }
  if (lane.noise) {
    const paramMin = lane.min ?? 0
    const paramMax = lane.max ?? 1
    let min = base
    let max = base
    for (const g of lane.gates ?? []) {
      const deviation = (paramMax - paramMin) * (lane.noise.range ?? 0) * g.amp * 0.5
      min = Math.min(min, Math.max(paramMin, g.center - deviation))
      max = Math.max(max, Math.min(paramMax, g.center + deviation))
    }
    return { min, max }
  }
  if (lane.keyframes.length === 0) return { min: base, max: base }
  let min = Infinity
  let max = -Infinity
  for (const k of lane.keyframes) {
    min = Math.min(min, k.value)
    max = Math.max(max, k.value)
  }
  return { min, max }
}
