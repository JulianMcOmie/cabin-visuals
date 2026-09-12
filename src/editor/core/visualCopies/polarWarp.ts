// A world-space attraction field. Positions gather into a rounded polar rose;
// each object's basis compresses radially and stretches along the petal tangent.
// WORLD / chain-root composition, conjugated through placement like Contour,
// so scene, parent, mover-frame and copy-target routing need no special cases.
import { Matrix4 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { AUTOMATION_PITCH_MIN } from '../trackTypes'
import { countLaneRows, extractCountGates } from './countLane'
import type { MoverOrSplitterDefinition } from './definitions'
import { POLAR_WARP_COLOR } from './identityColors'

export interface PolarWarpSettings { attack: number; release: number }
export const POLAR_WARP_MAX_PETALS = 32
// Fits the default camera while leaving room for stretched object footprints.
const RADIUS = 2
const ROWS = countLaneRows(1, POLAR_WARP_MAX_PETALS, 'petal', 'petals')

interface Segment {
  beat: number
  duration: number
  target: number
  position: number[]
  velocity: number[]
}
export interface PolarWarpSample { weights: number[]; velocity: number[] }

const duration = (value: number, fallback: number) =>
  Math.max(0, Math.min(16, Number.isFinite(value) ? value : fallback))

/** Critically damped spring, carrying velocity on interruption. A smooth
 * window closes its negligible tail at the chosen duration with zero velocity:
 * Release really ends, and the untouched input matrix returns bit-for-bit.
 * Coefficients describe the shape field, not a cached object's placement, so
 * upstream motion and arbitrarily ordered seeks remain deterministic. */
function sampleSegment(segment: Segment, beat: number): PolarWarpSample {
  const age = Math.max(0, beat - segment.beat)
  const weights = Array<number>(POLAR_WARP_MAX_PETALS).fill(0)
  const velocity = [...weights]
  if (age >= segment.duration) {
    if (segment.target) weights[segment.target - 1] = 1
    return { weights, velocity }
  }
  const omega = 6 / segment.duration
  const u = age / segment.duration
  const window = 1 - u * u * (3 - 2 * u)
  const windowRate = -6 * u * (1 - u) / segment.duration
  const decay = Math.exp(-omega * age)
  for (let i = 0; i < weights.length; i++) {
    const target = i + 1 === segment.target ? 1 : 0
    const a = segment.position[i] - target
    const b = segment.velocity[i] + omega * a
    const offset = (a + b * age) * decay
    weights[i] = target + offset * window
    velocity[i] = (b - omega * (a + b * age)) * decay * window + offset * windowRate
  }
  return { weights, velocity }
}

/** Radial's count vocabulary and onset latch, with a separate held gate.
 * Chords choose the largest count; releasing one chord note does not retarget
 * the flower. The last held note releases the field. Invalid rows do neither. */
export function resolvePolarWarpMotion(notes: readonly ResolvedNote[], settings: PolarWarpSettings) {
  const valid = notes.filter((n) => Number.isInteger(n.pitch) && Number.isFinite(n.beat)
    && n.pitch >= AUTOMATION_PITCH_MIN && n.pitch < AUTOMATION_PITCH_MIN + POLAR_WARP_MAX_PETALS
    && Number.isFinite(n.durationBeats) && n.durationBeats > 0)
  const counts = new Map(extractCountGates(valid, 1, POLAR_WARP_MAX_PETALS).map((g) => [g.beat, g.value]))
  const events = new Map<number, number>()
  for (const note of valid) {
    events.set(note.beat, (events.get(note.beat) ?? 0) + 1)
    const end = note.beat + note.durationBeats
    events.set(end, (events.get(end) ?? 0) - 1)
  }
  const segments: Segment[] = []
  let held = 0, petals = 1, target = 0
  for (const [beat, delta] of [...events].sort((a, b) => a[0] - b[0])) {
    held += delta
    petals = counts.get(beat) ?? petals
    const next = held > 0 ? petals : 0
    if (next === target) continue
    const previous = segments.at(-1)
    const state = previous ? sampleSegment(previous, beat) : {
      weights: Array<number>(POLAR_WARP_MAX_PETALS).fill(0),
      velocity: Array<number>(POLAR_WARP_MAX_PETALS).fill(0),
    }
    segments.push({ beat, target: next, position: state.weights, velocity: state.velocity,
      duration: next ? duration(settings.attack, 0.5) : duration(settings.release, 0.75) })
    target = next
  }
  return (beat: number): PolarWarpSample => {
    let lo = 0, hi = segments.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (segments[mid].beat <= beat) lo = mid + 1
      else hi = mid
    }
    return lo ? sampleSegment(segments[lo - 1], beat) : {
      weights: Array<number>(POLAR_WARP_MAX_PETALS).fill(0),
      velocity: Array<number>(POLAR_WARP_MAX_PETALS).fill(0),
    }
  }
}

/** Exactly N rounded petals (ordinary cos(N theta) roses otherwise double
 * even counts). The small inner radius keeps the flower from collapsing into
 * an unreadable pile at each valley. */
export function polarWarpRadius(angle: number, petals: number): number {
  return RADIUS * (0.16 + 0.84 * (0.5 + 0.5 * Math.cos(petals * angle)))
}

export function polarWarpTransform(placed: Matrix4, weights: readonly number[]): Matrix4 {
  let amount = 0, radius = 0, slope = 0
  const e = placed.elements
  const x = e[12], y = e[13], z = e[14]
  const distance = Math.hypot(x, y)
  const angle = distance > 1e-8 ? Math.atan2(y, x) : 0
  for (let i = 0; i < weights.length; i++) {
    const weight = weights[i]
    if (Math.abs(weight) < 1e-12) continue
    amount += weight
    radius += weight * polarWarpRadius(angle, i + 1)
    slope -= weight * RADIUS * 0.42 * (i + 1) * Math.sin((i + 1) * angle)
  }
  if (amount === 0 && radius === 0) return placed.clone()
  // Bound elastic overshoot under rapid retriggers; never invert a mesh.
  const drive = Math.max(-0.12, Math.min(1.12, amount))
  const c = Math.cos(angle), s = Math.sin(angle)
  // The center has no polar angle. Keep it anchored and ease the attraction
  // out over a tiny core, rather than launching it arbitrarily toward +X.
  const core = Math.min(1, distance / 0.35)
  const gather = core * core * (3 - 2 * core)
  const r = distance + 0.96 * gather * (radius - amount * distance)
  const radial = 1 - 0.78 * drive
  const tangent = 1 + 0.65 * drive
  // A bounded shear follows the rose's slope, bending/squeezing the object's
  // footprint as well as relocating it. No geometry or material assumptions.
  const shear = Math.tanh(slope / RADIUS) * 0.75
  const delta = new Matrix4().set(
    radial*c*c + tangent*s*s - shear*c*s, (radial-tangent)*c*s + shear*c*c, 0, 0,
    (radial-tangent)*c*s - shear*s*s, radial*s*s + tangent*c*c + shear*s*c, 0, 0,
    0, 0, 1 - 0.65 * drive, 0,
    0, 0, 0, 1,
  )
  const result = delta.multiply(placed)
  result.setPosition(c * r, s * r, z * (1 - 0.85 * drive))
  return result
}

export const polarWarpMover: MoverOrSplitterDefinition<PolarWarpSettings> = {
  id: 'polarWarp', label: 'Polar Warp', kind: 'mover', identityColor: POLAR_WARP_COLOR,
  params: [
    { key: 'attack', label: 'Attack', min: 0, max: 16, step: 0.05, default: 0.5 },
    { key: 'release', label: 'Release', min: 0, max: 16, step: 0.05, default: 0.75 },
  ],
  midiRows: () => ROWS, strictMidiRows: true,
  resolve({ settings, notes }) {
    const sample = resolvePolarWarpMotion(notes, settings)
    let cachedBeat = NaN
    let weights: number[] = []
    return {
      composition: 'chainRoot',
      apply(copy, { beat, placementTransform }) {
        if (beat !== cachedBeat) { weights = sample(beat).weights; cachedBeat = beat }
        const output = { ...copy, transform: copy.transform.clone(), colorShift: { ...copy.colorShift } }
        if (weights.every((weight) => weight === 0)) return [output]
        // Zero-size parents are legitimate. Inversion would erase the entire
        // transform; a collapsed placement instead passes through unchanged.
        if (placementTransform && Math.abs(placementTransform.determinant()) < 1e-10) return [output]
        const placed = placementTransform ? placementTransform.clone().multiply(copy.transform) : copy.transform
        output.transform = polarWarpTransform(placed, weights)
        if (placementTransform) output.transform.premultiply(placementTransform.clone().invert())
        return [output]
      },
    }
  },
}
