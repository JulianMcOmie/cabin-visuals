import type { AdsrEnvelope, AutomationMode, Block, InterpolationMode, Track } from '../../types'
import { pitchToValueRanged, type AutomationRange } from '../trackTypes'
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
  range?: AutomationRange,
): AutomationKeyframe[] {
  return flattenBlocks(blocks, beatsPerBar, totalBars).map((note) => ({
    beat: note.beat,
    value: scaleValue(pitchToValueRanged(range, note.pitch, paramMin, paramMax), amount, paramMin, paramMax),
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
  range?: AutomationRange,
): NoiseGate[] {
  return flattenBlocks(blocks, beatsPerBar, totalBars).map((note) => ({
    beat: note.beat,
    endBeat: note.beat + note.durationBeats,
    center: scaleValue(pitchToValueRanged(range, note.pitch, paramMin, paramMax), amount, paramMin, paramMax),
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

/** The burst envelope's SHAPE. Absent = 'adsr' (every pre-existing save). */
export type BurstShape = 'adsr' | 'bezier' | 'spring'

/** A user cubic-bezier gain shape: rise 0→1 along the curve over riseBeats
 *  (control Ys past 1 overshoot the peak), hold, then play the curve BACK
 *  over fallBeats. */
export interface BurstBezier {
  x1: number
  y1: number
  x2: number
  y2: number
  riseBeats: number
  fallBeats: number
}

/** A damped-spring gain shape in the standard physical parameterization
 *  (per-BEAT time base): the gain springs from 0 toward 1 on the onset -
 *  underdamped springs overshoot and ring - and springs back to 0 on release,
 *  seeded with the exact state it held (velocity carries, no hitch). */
export interface BurstSpring {
  stiffness: number
  damping: number
  mass: number
}

/** Track-level burst settings (stored on the automation track). */
export interface BurstConfig extends AdsrEnvelope {
  /** Scales every burst's travel: 0 = the lane does nothing, 1 = full reach. */
  intensity: number
  shape?: BurstShape
  bezier?: BurstBezier
  spring?: BurstSpring
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

/** The bezier shape's starting point: the expo-out workhorse. */
export const DEFAULT_BURST_BEZIER: BurstBezier = {
  x1: 0.16, y1: 1, x2: 0.3, y2: 1, riseBeats: 0.15, fallBeats: 0.6,
}

/** The spring shape's starting point: the platform-spring band (stiffness
 *  170-230, damping 18-26, mass 1 - zeta ≈ 0.77 here, a visible ring). */
export const DEFAULT_BURST_SPRING: BurstSpring = {
  stiffness: 170, damping: 20, mass: 1,
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
  range?: AutomationRange,
): BurstGate[] {
  return flattenBlocks(blocks, beatsPerBar, totalBars).map((note) => ({
    beat: note.beat,
    durationBeats: note.durationBeats,
    velocity: note.velocity ?? 100,
    value: scaleValue(pitchToValueRanged(range, note.pitch, paramMin, paramMax), amount, paramMin, paramMax),
  }))
}

// ── Shaped gate gains ──
// The bezier and spring shapes may return gain > 1 (that IS the overshoot);
// both floor at 0, so the blend weights below stay meaningful.

const BEZIER_EPS = 0.005

/** One cubic-bezier component and derivative for control values c1, c2. */
const bezierComponent = (c1: number, c2: number, t: number): [number, number] => {
  const inv = 1 - t
  return [
    3 * inv * inv * t * c1 + 3 * inv * t * t * c2 + t * t * t,
    3 * inv * inv * c1 + 6 * inv * t * (c2 - c1) + 3 * t * t * (1 - c2),
  ]
}

/** Curve-parameter t whose bezier x equals time-progress u - Newton, bisection net. */
function solveBezierT(x1: number, x2: number, u: number): number {
  let t = u
  for (let i = 0; i < 8; i++) {
    const [x, dx] = bezierComponent(x1, x2, t)
    const err = x - u
    if (Math.abs(err) < 1e-7 || Math.abs(dx) < 1e-6) break
    t = Math.min(1, Math.max(0, t - err / dx))
  }
  if (Math.abs(bezierComponent(x1, x2, t)[0] - u) > 1e-5) {
    let lo = 0
    let hi = 1
    for (let i = 0; i < 40; i++) {
      t = (lo + hi) / 2
      if (bezierComponent(x1, x2, t)[0] < u) lo = t
      else hi = t
    }
  }
  return t
}

/** y at time-progress u of cubic-bezier(x1, y1, x2, y2) - Newton, bisection net. */
export function bezierY(x1: number, y1: number, x2: number, y2: number, u: number): number {
  if (u <= 0) return 0
  if (u >= 1) return 1
  return bezierComponent(y1, y2, solveBezierT(x1, x2, u))[0]
}

function bezierGateGain(note: BurstGate, beat: number, bez: BurstBezier): number {
  const t = beat - note.beat
  if (t < 0) return 0
  const rise = Math.max(BEZIER_EPS, bez.riseBeats)
  const fall = Math.max(BEZIER_EPS, bez.fallBeats)
  const hold = Math.max(note.durationBeats || 0, rise)
  if (t >= hold + fall) return 0
  const shape = (u: number) => bezierY(bez.x1, bez.y1, bez.x2, bez.y2, u)
  // Rise along the curve, hold at its end, then play it back down.
  const gain = t < rise ? shape(t / rise)
    : t <= hold ? 1
    : shape(1 - (t - hold) / fall)
  return Math.max(0, gain)
}

function springGateGain(note: BurstGate, beat: number, spring: BurstSpring): number {
  const t = beat - note.beat
  if (t < 0) return 0
  const mass = Math.max(0.05, spring.mass)
  const k = Math.max(1, spring.stiffness)
  const omega = Math.sqrt(k / mass)
  const zeta = Math.max(0.05, spring.damping / (2 * Math.sqrt(k * mass)))
  // Closed-form displacement + velocity from (x0, v0) toward 0.
  const solve = (x0: number, v0: number, dt: number): [number, number] => {
    if (zeta >= 1) {
      const a = x0
      const b = v0 + omega * x0
      const decay = Math.exp(-omega * dt)
      return [(a + b * dt) * decay, (b - omega * (a + b * dt)) * decay]
    }
    const omegaD = omega * Math.sqrt(1 - zeta * zeta)
    const a = x0
    const b = (v0 + zeta * omega * x0) / omegaD
    const decay = Math.exp(-zeta * omega * dt)
    const cos = Math.cos(omegaD * dt)
    const sin = Math.sin(omegaD * dt)
    return [
      decay * (a * cos + b * sin),
      decay * ((b * omegaD - zeta * omega * a) * cos - (a * omegaD + zeta * omega * b) * sin),
    ]
  }
  // The gate lives while held plus a settle window either side of release.
  const settle = 9 / Math.max(0.2, zeta * omega)
  const hold = Math.max(note.durationBeats || 0, 0.001)
  if (t >= hold + settle) return 0
  if (t <= hold) {
    const [u] = solve(-1, 0, t) // gain = 1 + u: springs from 0 toward 1
    return Math.max(0, 1 + u)
  }
  // Release: spring toward 0, seeded with the exact held state.
  const [uAtRelease, vAtRelease] = solve(-1, 0, hold)
  const [u] = solve(1 + uAtRelease, vAtRelease, t - hold)
  return Math.max(0, u)
}

/** The gain one burst note contributes at `beat`, per the config's shape.
 *  Velocity scales every shape the same way the ADSR always scaled. */
export function burstGateGain(note: BurstGate, beat: number, cfg: BurstConfig): number {
  if (cfg.shape === 'bezier') {
    const velocity = note.velocity <= 1 ? note.velocity : note.velocity / 127
    return velocity * bezierGateGain(note, beat, cfg.bezier ?? DEFAULT_BURST_BEZIER)
  }
  if (cfg.shape === 'spring') {
    const velocity = note.velocity <= 1 ? note.velocity : note.velocity / 127
    return velocity * springGateGain(note, beat, cfg.spring ?? DEFAULT_BURST_SPRING)
  }
  return adsrGateGain(note, beat, cfg)
}

/** How far past the target a shaped burst may travel (gain and travel cap).
 *  The classic ADSR keeps its historical hard cap of 1, bit-identical for
 *  every pre-existing save; the shaped envelopes are allowed to overshoot. */
function travelCap(cfg: BurstConfig): number {
  return cfg.shape === 'bezier' || cfg.shape === 'spring' ? 2 : 1
}

/** Sample a burst lane at `beat`: NaN while no burst is live (lane inert), else
 *  `base` travelled toward the live bursts' value. Overlapping bursts blend -
 *  the destination is their gain-weighted average value and the total travel
 *  clamps at the shape's cap (1 for the classic ADSR, matching
 *  evaluateAdsrGain's sum-and-clamp stacking; 2 for the overshooting shapes). */
export function sampleBurstLane(
  cfg: BurstConfig,
  gates: readonly BurstGate[],
  beat: number,
  base: number,
): number {
  let gainSum = 0
  let weightedValue = 0
  for (const g of gates) {
    const gain = burstGateGain(g, beat, cfg)
    if (gain <= 0) continue
    gainSum += gain
    weightedValue += gain * g.value
  }
  if (gainSum <= 0) return NaN
  const target = weightedValue / gainSum
  const travel = Math.min(travelCap(cfg), gainSum) * Math.max(0, Math.min(1, cfg.intensity))
  return base + (target - base) * travel
}

// ── Cycle mode ───────────────────────────────────────────────────────────────
// The fourth lane mode. Notes stop being keyframes and become the BEATS of a
// wave: the motion curve plays exactly once between each pair of consecutive
// note ONSETS, stretched to fit however far apart they are - an LFO whose
// period is the phrasing itself. The earlier onset's pitch-value scales the
// cycle (curve y = 1 lands ON that value; y = 0 is the `floor`), so a row of
// notes IS the wave's amplitude ride. Note duration is deliberately ignored -
// only onsets divide time. Outside the onsets (before the first, at/after the
// last, or with fewer than two) the lane is inert (NaN) like noise/burst.
//
// There is no seam/continuity option ON PURPOSE: the curve's endpoint heights
// are the user's to drag, so a wave that starts and ends at the same value is
// seamless by construction and a saw that snaps back is equally sayable.

/** The cycle's shape: one cubic bezier y(x) over x 0..1, endpoint heights
 *  included (P0 = (0, y0), P3 = (1, y3)). Control Ys past 1 overshoot the
 *  note's value, exactly like the burst bezier; sampling clamps back to the
 *  param range. `invert` flips which bound the note owns: normally the note's
 *  value is the cycle's HIGH over `floor`; inverted it is the LOW under the
 *  constant `ceiling`. */
export interface CycleConfig {
  y0: number
  x1: number
  y1: number
  x2: number
  y2: number
  y3: number
  invert?: boolean
  /** The cycle's resting value (curve y = 0), param units. Absent = 0. */
  floor?: number
  /** Invert mode's constant high, param units. Absent = the param's max. */
  ceiling?: number
}

/** What flipping a lane to cycle mode starts from: a seamless smooth swell -
 *  control Ys at 4/3 put the bezier's midpoint exactly on the note's value
 *  (y(0.5) = 0.75 · 4/3 = 1), so the default already keeps the spec's promise
 *  that the cycle's peak IS the note. */
export const DEFAULT_CYCLE: CycleConfig = {
  y0: 0, x1: 1 / 3, y1: 4 / 3, x2: 2 / 3, y2: 4 / 3, y3: 0,
}

/** One cycle boundary: a note onset and its pitch-mapped value. */
export interface CycleGate {
  beat: number
  value: number
}

/** Flatten a cycle-mode track's blocks into onset gates (sorted by beat).
 *  Chords collapse to ONE boundary - simultaneous onsets can't divide time -
 *  keeping the largest value so the stack's reach wins deterministically. */
export function extractCycleGates(
  blocks: Block[],
  beatsPerBar: number,
  paramMin: number,
  paramMax: number,
  totalBars?: number,
  amount = 1,
  range?: AutomationRange,
): CycleGate[] {
  const gates = flattenBlocks(blocks, beatsPerBar, totalBars)
    .map((note) => ({
      beat: note.beat,
      value: scaleValue(pitchToValueRanged(range, note.pitch, paramMin, paramMax), amount, paramMin, paramMax),
    }))
    .sort((a, b) => a.beat - b.beat || a.value - b.value)
  return gates.filter((g, i) => i === gates.length - 1 || gates[i + 1].beat !== g.beat)
}

/** The curve's height at time-progress u - the full four-height bezier
 *  (endpoints included), unlike bezierY's fixed 0→1 rise. */
export function cycleShapeY(cfg: CycleConfig, u: number): number {
  if (u <= 0) return cfg.y0
  if (u >= 1) return cfg.y3
  const t = solveBezierT(cfg.x1, cfg.x2, u)
  const inv = 1 - t
  return inv * inv * inv * cfg.y0
    + 3 * inv * inv * t * cfg.y1
    + 3 * inv * t * t * cfg.y2
    + t * t * t * cfg.y3
}

/** Sample a cycle lane at `beat`: NaN outside the onset span (lane inert; a
 *  lone onset has nothing to stretch to), else the curve stretched over the
 *  surrounding onset pair, scaled between the EARLIER note's value and the
 *  configured resting bound, clamped to the param range. */
export function sampleCycleLane(
  cfg: CycleConfig,
  gates: readonly CycleGate[],
  beat: number,
  paramMin: number,
  paramMax: number,
): number {
  const n = gates.length
  if (n < 2 || beat < gates[0].beat || beat >= gates[n - 1].beat) return NaN
  // Largest i with gates[i].beat <= beat (guaranteed 0 <= i < n-1 by the guards).
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (gates[mid].beat <= beat) lo = mid
    else hi = mid - 1
  }
  const a = gates[lo]
  const b = gates[lo + 1]
  const u = (beat - a.beat) / (b.beat - a.beat)
  const y = cycleShapeY(cfg, u)
  // The bound the note does NOT own: floor under it normally, ceiling over it
  // inverted. Either way y = 0 rests there and y = 1 lands on the note.
  const rest = Math.max(paramMin, Math.min(paramMax, cfg.invert ? cfg.ceiling ?? paramMax : cfg.floor ?? 0))
  const value = cfg.invert
    ? a.value + y * (rest - a.value)
    : rest + y * (a.value - rest)
  return Math.max(paramMin, Math.min(paramMax, value))
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

// ── One lane, four modes ─────────────────────────────────────────────────────

/** Which model a lane's notes follow. Burst wins if a document somehow carries
 *  several configs (then noise, then cycle) - the same precedence resolve.ts
 *  applies, kept in one place so the editor can never disagree with the engine
 *  about what a lane is. */
export function automationMode(track: Pick<Track, 'noise' | 'burst' | 'cycle'>): AutomationMode {
  return track.burst ? 'burst' : track.noise ? 'noise' : track.cycle ? 'cycle' : 'curve'
}

/**
 * The mode-bearing fields every resolved lane carries, whatever it drives (an
 * instrument/mover param or an effect setting - see core/visual/types.ts, whose
 * ResolvedAutomation and ResolvedEffectAutomation both extend this). Exactly one
 * mode is populated: `noise`+`gates`, `burst`+`bursts`, `cycle`+`cycles`, or
 * plain `keyframes`.
 */
export interface AutomationLane {
  mode: InterpolationMode
  keyframes: AutomationKeyframe[]
  noise?: NoiseConfig
  gates?: NoiseGate[]
  burst?: BurstConfig
  bursts?: BurstGate[]
  cycle?: CycleConfig
  cycles?: CycleGate[]
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
    if (!lane.bursts?.length) return NaN
    const value = sampleBurstLane(lane.burst, lane.bursts, beat, base)
    // Shaped bursts may overshoot their target; the param's range is still the
    // law. A no-op for the classic ADSR (travel ≤ 1 stays between base and
    // target, both already in range).
    if (Number.isNaN(value) || lane.min === undefined || lane.max === undefined) return value
    return Math.max(lane.min, Math.min(lane.max, value))
  }
  if (lane.noise) {
    return lane.gates?.length
      ? sampleNoiseLane(lane.noise, lane.gates, beat, lane.min ?? 0, lane.max ?? 1)
      : NaN
  }
  if (lane.cycle) {
    return lane.cycles?.length
      ? sampleCycleLane(lane.cycle, lane.cycles, beat, lane.min ?? 0, lane.max ?? 1)
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
    // Shaped bursts may overshoot: their reach is base + cap * (target - base),
    // clamped back to the param range exactly as sampling clamps it. Base and
    // targets stay unclamped, as they always were (base shows through inert
    // stretches whatever the range says).
    const cap = lane.burst.shape === 'bezier' || lane.burst.shape === 'spring' ? 2 : 1
    let min = base
    let max = base
    for (const g of lane.bursts ?? []) {
      let reach = base + cap * (g.value - base)
      if (lane.min !== undefined) reach = Math.max(lane.min, reach)
      if (lane.max !== undefined) reach = Math.min(lane.max, reach)
      min = Math.min(min, g.value, reach)
      max = Math.max(max, g.value, reach)
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
  if (lane.cycle) {
    const paramMin = lane.min ?? 0
    const paramMax = lane.max ?? 1
    const cfg = lane.cycle
    // A bezier stays inside its control heights' hull, so the shape's reach is
    // the min/max of the four Ys; each gate then spans rest → note by that.
    const yMin = Math.min(cfg.y0, cfg.y1, cfg.y2, cfg.y3)
    const yMax = Math.max(cfg.y0, cfg.y1, cfg.y2, cfg.y3)
    const rest = Math.max(paramMin, Math.min(paramMax, cfg.invert ? cfg.ceiling ?? paramMax : cfg.floor ?? 0))
    let min = base
    let max = base
    for (const g of lane.cycles ?? []) {
      for (const y of [yMin, yMax]) {
        const value = cfg.invert ? g.value + y * (rest - g.value) : rest + y * (g.value - rest)
        const clamped = Math.max(paramMin, Math.min(paramMax, value))
        min = Math.min(min, clamped)
        max = Math.max(max, clamped)
      }
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
