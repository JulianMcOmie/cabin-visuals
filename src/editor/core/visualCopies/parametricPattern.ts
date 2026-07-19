import { Matrix4, Quaternion, Vector3 } from 'three'
import type { MidiRowDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import { normalizedVelocity } from './motionBasis'
import type { VisualCopy } from './types'

export const PARAMETRIC_PATTERNS = [
  'Polar Rose',
  'Spirograph',
  'Torus Knot',
  'Superformula',
  'Spherical Harmonic',
  'Phyllotaxis',
] as const

export interface ParametricPatternSettings {
  pattern: number
  copies: number
  radius: number
  amount: number
  frequencyA: number
  frequencyB: number
  shape: number
  phaseDegrees: number
  /** 0 = XY, 1 = XZ, 2 = YZ. */
  plane: number
  /** 0 = fixed, 1 = face away from origin, 2 = follow curve. */
  orientation: number
  midiAmountRate: number
  midiPhaseRate: number
}

export interface PatternMidiOffsets {
  amount: number
  phaseDegrees: number
  frequencyA: number
  frequencyB: number
}

export const PATTERN_MIDI = {
  amountUp: 60,
  amountDown: 61,
  phaseForward: 62,
  phaseBackward: 63,
  frequencyAUp: 64,
  frequencyADown: 65,
  frequencyBUp: 66,
  frequencyBDown: 67,
  reset: 68,
} as const

const PATTERN_ROWS: MidiRowDef[] = [
  { pitch: PATTERN_MIDI.amountUp, label: 'Amount +' },
  { pitch: PATTERN_MIDI.amountDown, label: 'Amount −' },
  { pitch: PATTERN_MIDI.phaseForward, label: 'Phase +' },
  { pitch: PATTERN_MIDI.phaseBackward, label: 'Phase −' },
  { pitch: PATTERN_MIDI.frequencyAUp, label: 'Frequency A +' },
  { pitch: PATTERN_MIDI.frequencyADown, label: 'Frequency A −' },
  { pitch: PATTERN_MIDI.frequencyBUp, label: 'Frequency B +' },
  { pitch: PATTERN_MIDI.frequencyBDown, label: 'Frequency B −' },
  { pitch: PATTERN_MIDI.reset, label: 'Reset MIDI offsets' },
]

const TWO_PI = Math.PI * 2
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const X_AXIS = new Vector3(1, 0, 0)
const MAX_COPIES = 256

/** Continuous rows integrate note length and velocity; frequency rows step once
 * per note-on. The latest Reset discards all earlier MIDI modulation without
 * mutating the configured base parameters. */
export function evaluatePatternMidi(
  notes: readonly ResolvedNote[],
  settings: Pick<ParametricPatternSettings, 'midiAmountRate' | 'midiPhaseRate'>,
  beat: number,
): PatternMidiOffsets {
  let resetBeat = -Infinity
  for (const note of notes) {
    if (note.pitch === PATTERN_MIDI.reset && note.beat <= beat) resetBeat = Math.max(resetBeat, note.beat)
  }

  const offsets: PatternMidiOffsets = { amount: 0, phaseDegrees: 0, frequencyA: 0, frequencyB: 0 }
  for (const note of notes) {
    if (note.beat <= resetBeat || note.beat > beat) continue
    const velocity = normalizedVelocity(note.velocity)
    const heldBeats = Math.min(Math.max(0, note.durationBeats), Math.max(0, beat - note.beat))
    if (note.pitch === PATTERN_MIDI.amountUp) offsets.amount += heldBeats * velocity * settings.midiAmountRate
    else if (note.pitch === PATTERN_MIDI.amountDown) offsets.amount -= heldBeats * velocity * settings.midiAmountRate
    else if (note.pitch === PATTERN_MIDI.phaseForward) offsets.phaseDegrees += heldBeats * velocity * settings.midiPhaseRate
    else if (note.pitch === PATTERN_MIDI.phaseBackward) offsets.phaseDegrees -= heldBeats * velocity * settings.midiPhaseRate
    else if (note.pitch === PATTERN_MIDI.frequencyAUp) offsets.frequencyA += 1
    else if (note.pitch === PATTERN_MIDI.frequencyADown) offsets.frequencyA -= 1
    else if (note.pitch === PATTERN_MIDI.frequencyBUp) offsets.frequencyB += 1
    else if (note.pitch === PATTERN_MIDI.frequencyBDown) offsets.frequencyB -= 1
  }
  return offsets
}

function signedPow(value: number, exponent: number): number {
  return Math.sign(value) * Math.pow(Math.abs(value), exponent)
}

function orientToPlane(point: Vector3, plane: number): Vector3 {
  if (plane === 1) return new Vector3(point.x, point.z, point.y)
  if (plane === 2) return new Vector3(point.z, point.x, point.y)
  return point
}

/** Position of one stable slot for the currently selected function. */
export function parametricPatternPosition(
  slot: number,
  count: number,
  settings: ParametricPatternSettings,
  midi: PatternMidiOffsets = { amount: 0, phaseDegrees: 0, frequencyA: 0, frequencyB: 0 },
): Vector3 {
  const u = slot / Math.max(1, count)
  const phase = (settings.phaseDegrees + midi.phaseDegrees) * Math.PI / 180
  const t = u * TWO_PI + phase
  const radius = Math.max(0, settings.radius)
  const amount = Math.max(0, settings.amount + midi.amount)
  const frequencyA = Math.max(1, Math.min(32, Math.round(settings.frequencyA + midi.frequencyA)))
  const frequencyB = Math.max(1, Math.min(32, Math.round(settings.frequencyB + midi.frequencyB)))
  const shape = Math.max(0.05, settings.shape)
  let point: Vector3

  switch (Math.round(settings.pattern)) {
    case 1: { // Hypotrochoid / spirograph, closed by the integer A:B ratio.
      const outerRadius = radius
      const numerator = Math.max(frequencyB + 1, frequencyA)
      const rollingRadius = outerRadius * frequencyB / numerator
      const gearRatio = (outerRadius - rollingRadius) / Math.max(0.0001, rollingRadius)
      const gearAngle = u * TWO_PI * frequencyB + phase
      point = new Vector3(
        (outerRadius - rollingRadius) * Math.cos(gearAngle) + amount * Math.cos(gearRatio * gearAngle),
        (outerRadius - rollingRadius) * Math.sin(gearAngle) - amount * Math.sin(gearRatio * gearAngle),
        0,
      )
      break
    }
    case 2: { // Standard (p, q) torus knot.
      const tubeAngle = frequencyB * t
      const ringAngle = frequencyA * t
      const ringRadius = radius + amount * Math.cos(tubeAngle)
      point = new Vector3(
        ringRadius * Math.cos(ringAngle),
        ringRadius * Math.sin(ringAngle),
        amount * Math.sin(tubeAngle) * shape,
      )
      break
    }
    case 3: { // Gielis superformula; the two exponents deliberately differ.
      const m = frequencyA
      const termA = Math.pow(Math.abs(Math.cos(m * t / 4)), shape)
      const termB = Math.pow(Math.abs(Math.sin(m * t / 4)), shape + frequencyB * 0.25)
      const rawRadius = Math.pow(Math.max(0.000001, termA + termB), -1 / Math.max(0.05, amount))
      const r = radius * Math.max(0.05, Math.min(10, rawRadius))
      point = new Vector3(r * Math.cos(t), r * Math.sin(t), 0)
      break
    }
    case 4: { // Fibonacci sphere with a signed spherical-harmonic radius field.
      const y = 1 - 2 * ((slot + 0.5) / Math.max(1, count))
      const ring = Math.sqrt(Math.max(0, 1 - y * y))
      const azimuth = slot * GOLDEN_ANGLE + phase
      const polar = Math.acos(Math.max(-1, Math.min(1, y)))
      const harmonic = signedPow(Math.cos(frequencyA * azimuth) * Math.sin(frequencyB * polar), shape)
      const r = Math.max(0, radius + amount * harmonic)
      point = new Vector3(ring * Math.cos(azimuth) * r, y * r, ring * Math.sin(azimuth) * r)
      break
    }
    case 5: { // Phyllotaxis; Amount nudges divergence around the golden angle.
      const fraction = (slot + 0.5) / Math.max(1, count)
      const divergence = GOLDEN_ANGLE + (amount - 1) * 0.04
      const angle = slot * divergence + phase
      const ripple = 1 + 0.08 * Math.cos(frequencyA * angle) + 0.05 * Math.sin(frequencyB * angle)
      const r = radius * Math.pow(fraction, shape) * ripple
      point = new Vector3(r * Math.cos(angle), r * Math.sin(angle), 0)
      break
    }
    default: { // Polar rose with Shape blending in a secondary harmonic.
      const secondaryMix = Math.max(0, Math.min(1, shape))
      const wave = Math.cos(frequencyA * t) * (1 - secondaryMix)
        + Math.cos(frequencyB * t) * secondaryMix
      const r = radius + amount * wave
      point = new Vector3(r * Math.cos(t), r * Math.sin(t), 0)
      break
    }
  }

  return orientToPlane(point, settings.plane)
}

function transformsForPattern(
  settings: ParametricPatternSettings,
  midi: PatternMidiOffsets,
  count: number,
): Matrix4[] {
  const positions = Array.from({ length: count }, (_, slot) =>
    parametricPatternPosition(slot, count, settings, midi),
  )
  return positions.map((position, slot) => {
    if (settings.orientation === 0) return new Matrix4().makeTranslation(position.x, position.y, position.z)

    const direction = settings.orientation === 1
      ? position.clone()
      : positions[(slot + 1) % count].clone().sub(positions[(slot + count - 1) % count])
    if (direction.lengthSq() < 1e-12) direction.copy(X_AXIS)
    else direction.normalize()
    const rotation = new Quaternion().setFromUnitVectors(X_AXIS, direction)
    return new Matrix4().makeRotationFromQuaternion(rotation).setPosition(position)
  })
}

function nextCopy(visualCopy: VisualCopy, transform: Matrix4): VisualCopy {
  return {
    transform: visualCopy.transform.clone().multiply(transform),
    opacity: visualCopy.opacity,
    colorShift: { ...visualCopy.colorShift },
  }
}

export const parametricPatternSplitter: MoverOrSplitterDefinition<ParametricPatternSettings> = {
  id: 'parametricPattern',
  label: 'Parametric Pattern',
  kind: 'splitter',
  params: [
    {
      key: 'pattern',
      label: 'Pattern',
      type: 'select',
      options: PARAMETRIC_PATTERNS.map((label, value) => ({ label, value })),
      default: 0,
    },
    { key: 'copies', label: 'Copies', min: 1, max: MAX_COPIES, step: 1, default: 48 },
    { key: 'radius', label: 'Radius', min: 0, max: 20, step: 0.1, default: 3 },
    { key: 'amount', label: 'Amount', min: 0, max: 10, step: 0.05, default: 1 },
    { key: 'frequencyA', label: 'Frequency A', min: 1, max: 32, step: 1, default: 5 },
    { key: 'frequencyB', label: 'Frequency B', min: 1, max: 32, step: 1, default: 2 },
    { key: 'shape', label: 'Shape', min: 0.05, max: 8, step: 0.05, default: 0.35 },
    { key: 'phaseDegrees', label: 'Phase (°)', min: -360, max: 360, step: 1, default: 0 },
    {
      key: 'plane',
      label: 'Plane',
      type: 'select',
      options: [
        { value: 0, label: 'XY' },
        { value: 1, label: 'XZ' },
        { value: 2, label: 'YZ' },
      ],
      default: 0,
    },
    {
      key: 'orientation',
      label: 'Orientation',
      type: 'select',
      options: [
        { value: 0, label: 'Fixed' },
        { value: 1, label: 'Face outward' },
        { value: 2, label: 'Follow curve' },
      ],
      default: 2,
    },
    { key: 'midiAmountRate', label: 'MIDI amount / beat', min: 0, max: 5, step: 0.05, default: 0.5 },
    { key: 'midiPhaseRate', label: 'MIDI phase ° / beat', min: 0, max: 360, step: 1, default: 90 },
  ],
  midiRows: () => PATTERN_ROWS,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const count = Math.max(1, Math.min(MAX_COPIES, Math.round(settings.copies)))
    return {
      apply(visualCopy, { beat }) {
        const midi = evaluatePatternMidi(notes, settings, beat)
        return transformsForPattern(settings, midi, count).map((transform) => nextCopy(visualCopy, transform))
      },
    }
  },
}
