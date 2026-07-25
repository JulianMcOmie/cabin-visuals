// Motion: one mover carrying the four fundamental motions on four separate
// MIDI blocks, plus screen-wrapping bounds that the smaller movers have no
// way to express.
//
//   48-53 (+54)  Drift   - constant translate, the new one: a held note slides
//                          the object at Drift/beat and the offset is KEPT when
//                          the note ends, so one long note walks it across the
//                          frame forever. 54 returns it to the origin.
//   60-65        Step    - translate burst (the existing Burst vocabulary, at
//                          the same pitches, so the muscle memory carries).
//   72-77 (+78)  Spin    - constant rotate. 78 returns the orientation.
//   84-89        Snap    - rotate burst.
//
// Each block starts on a C and uses the same in-block order (+X, -X, +Y, -Y,
// +Z, -Z) as every other mover, with the block's Return one step above it.
//
// WRAPPING is what makes the drift endless: the summed translation is taken
// modulo each axis's bound, so an object that passes +bound reappears at
// -bound. A bound of 0 disables wrapping on that axis. Per the design call this
// wraps the WHOLE translation (drift plus steps), so nothing this mover does
// can push the object out of the box.
//
// The maths is deliberately delegated to the existing evaluators wherever the
// shared easing tables allow, so a Motion block behaves exactly like the mover
// it replaces rather than merely similarly.
//
// COMPOSITION is the chain default, LOCAL (previous * delta), and within the
// mover: previous * translation * rotation. Translation therefore happens in
// the frame above, and the rotation spins the object in place at its drifted
// position rather than steering the drift. The two rotation blocks compose in
// order (constant, then burst) exactly as chaining the two movers would.

import { Matrix4, Vector3 } from 'three'
import type { MidiRowDef, ParamDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import { BURST_EASINGS } from './burstEasings'
import { evaluateBurstOffset, type BurstSettings } from './burstOffset'
import {
  BASIS_PARAMS,
  RETURN_PITCH,
  SIGNED_BASIS_DIRECTIONS,
  basisRotation,
  normalizedVelocity,
  pivotedRotation,
  resolveBasis,
  type BasisSettings,
} from './motionBasis'
import { evaluateConstantRotationAngles, type ConstantRotationSettings } from './rotationMovers'
import type { VisualCopy } from './types'

const DEG_TO_RAD = Math.PI / 180

/** First pitch of each block. The six direction rows run base..base+5 in
 *  SIGNED_BASIS_DIRECTIONS order; blocks that have a Return row put it at
 *  base+6. */
export const MOTION_BLOCKS = {
  drift: 48,
  step: 60,
  spin: 72,
  snap: 84,
} as const

const DRIFT_RETURN_PITCH = MOTION_BLOCKS.drift + 6
const SPIN_RETURN_PITCH = MOTION_BLOCKS.spin + 6

const DIRECTION_SUFFIXES = ['+X', '−X', '+Y', '−Y', '+Z', '−Z']
const TRANSLATE_WORDS = ['right', 'left', 'up', 'down', 'forward', 'back']

function directionRows(base: number, verb: string, words?: string[]): MidiRowDef[] {
  return DIRECTION_SUFFIXES.map((suffix, offset) => ({
    pitch: base + offset,
    label: words ? `${verb} ${words[offset]} (${suffix})` : `${verb} ${suffix}`,
  }))
}

const MOTION_ROWS: MidiRowDef[] = [
  ...directionRows(MOTION_BLOCKS.drift, 'Drift', TRANSLATE_WORDS),
  { pitch: DRIFT_RETURN_PITCH, label: 'Return to origin' },
  ...directionRows(MOTION_BLOCKS.step, 'Step', TRANSLATE_WORDS),
  ...directionRows(MOTION_BLOCKS.spin, 'Spin'),
  { pitch: SPIN_RETURN_PITCH, label: 'Return orientation' },
  ...directionRows(MOTION_BLOCKS.snap, 'Snap'),
]

export interface MotionSettings extends BasisSettings {
  // Drift - constant translate.
  driftX: number
  driftY: number
  driftZ: number
  drift: number
  driftReturnBeats: number
  // Wrap bounds, as half-extents per basis axis. 0 disables that axis.
  boundX: number
  boundY: number
  boundZ: number
  // Step - translate burst.
  distanceX: number
  distanceY: number
  distanceZ: number
  distance: number
  // Spin - constant rotate.
  spinX: number
  spinY: number
  spinZ: number
  spin: number
  spinReturnBeats: number
  // Snap - rotate burst.
  angleX: number
  angleY: number
  angleZ: number
  angle: number
  // Shared burst feel, so a Step and a Snap on the same beat land together.
  burstBeats: number
  easing: number
  sharpness: number
  // Shared by both rotation blocks: 0 spins in place, non-zero orbits.
  pivotX: number
  pivotY: number
  pivotZ: number
}

/**
 * One block's notes, renumbered onto the shared 60-65 (+66) vocabulary the
 * existing evaluators speak, so this mover reuses their exact behaviour
 * instead of reimplementing it. Notes outside the block are dropped.
 */
export function motionBlockNotes(
  notes: readonly ResolvedNote[],
  base: number,
  hasReturn = false,
): ResolvedNote[] {
  const out: ResolvedNote[] = []
  for (const note of notes) {
    const offset = note.pitch - base
    if (offset >= 0 && offset <= 5) out.push({ ...note, pitch: 60 + offset })
    else if (hasReturn && offset === 6) out.push({ ...note, pitch: RETURN_PITCH })
  }
  return out
}

/** Per-axis distance accumulated by held drift notes, ignoring Return rows. */
function rawDrift(
  notes: readonly ResolvedNote[],
  settings: MotionSettings,
  beat: number,
): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0]
  const speeds = [settings.driftX, settings.driftY, settings.driftZ]
  for (const note of notes) {
    const direction = SIGNED_BASIS_DIRECTIONS[note.pitch]
    if (!direction || beat <= note.beat) continue
    const heldBeats = Math.min(Math.max(0, note.durationBeats), beat - note.beat)
    out[direction.axis] += direction.sign * heldBeats * speeds[direction.axis] * settings.drift
      * normalizedVelocity(note.velocity)
  }
  return out
}

/**
 * Drift offset with Return rows applied. A Return erases the drift standing at
 * its own beat, ramped over `driftReturnBeats` (and only while the note is
 * held, so a short note returns part way) - the translation twin of Constant
 * Rotate's Return orientation, minus its shortest-angle wrap. Drift accumulated
 * AFTER the return is untouched, so returning does not disarm the block.
 */
export function evaluateDriftOffset(
  notes: readonly ResolvedNote[],
  settings: MotionSettings,
  beat: number,
): [number, number, number] {
  const returnBeats = Math.max(0.0001, settings.driftReturnBeats)
  let erased: [number, number, number] = [0, 0, 0]
  const returns = notes
    .filter((note) => note.pitch === RETURN_PITCH && note.beat <= beat)
    .slice()
    .sort((a, b) => a.beat - b.beat)

  for (const note of returns) {
    const target = rawDrift(notes, settings, note.beat)
    const progress = Math.min(1, Math.min(beat - note.beat, Math.max(0, note.durationBeats)) / returnBeats)
    erased = erased.map((value, axis) => target[axis] - (target[axis] - value) * (1 - progress)) as
      [number, number, number]
  }

  const raw = rawDrift(notes, settings, beat)
  return raw.map((value, axis) => value - erased[axis]) as [number, number, number]
}

/**
 * Angles from the Snap block. Mirrors Rotate Burst, but reads the SHARED
 * easing table (which Rotate Burst's own does not), so a return-family curve
 * springs the rotation back exactly as it does a Step.
 */
export function evaluateSnapAngles(
  notes: readonly ResolvedNote[],
  settings: MotionSettings,
  beat: number,
): [number, number, number] {
  const angles: [number, number, number] = [0, 0, 0]
  const burstBeats = Math.max(0.0001, settings.burstBeats)
  const sharpness = Math.max(0.0001, settings.sharpness)
  const { ease } = BURST_EASINGS[settings.easing] ?? BURST_EASINGS[0]
  const axisAngles = [settings.angleX, settings.angleY, settings.angleZ]
  for (const note of notes) {
    if (note.beat > beat) continue
    const direction = SIGNED_BASIS_DIRECTIONS[note.pitch]
    if (!direction) continue
    const progress = Math.min(1, (beat - note.beat) / burstBeats)
    const eased = ease(Math.pow(progress, 1 / sharpness))
    angles[direction.axis] += direction.sign * axisAngles[direction.axis] * settings.angle
      * normalizedVelocity(note.velocity) * eased * DEG_TO_RAD
  }
  return angles
}

/** Folds a coordinate into [-bound, bound): passing +bound reappears at
 *  -bound. A bound of 0 (or less) means no wrapping on that axis. */
export function wrapToBound(value: number, bound: number): number {
  if (!(bound > 0)) return value
  const span = bound * 2
  return ((((value + bound) % span) + span) % span) - bound
}

/** The mover's total translation at `beat`, in basis-axis coordinates: drift
 *  plus steps, each axis wrapped into its bound. */
export function evaluateMotionTranslation(
  notes: readonly ResolvedNote[],
  settings: MotionSettings,
  beat: number,
): [number, number, number] {
  const drift = evaluateDriftOffset(motionBlockNotes(notes, MOTION_BLOCKS.drift, true), settings, beat)
  const burstSettings: BurstSettings = {
    burstBeats: settings.burstBeats,
    easing: settings.easing,
    sharpness: settings.sharpness,
    distanceX: settings.distanceX,
    distanceY: settings.distanceY,
    distanceZ: settings.distanceZ,
    distance: settings.distance,
  }
  const step = evaluateBurstOffset(motionBlockNotes(notes, MOTION_BLOCKS.step), burstSettings, beat)
  const bounds = [settings.boundX, settings.boundY, settings.boundZ]
  return [0, 1, 2].map((axis) => wrapToBound(drift[axis] + step[axis], bounds[axis])) as
    [number, number, number]
}

const MOTION_PARAMS: ParamDef[] = [
  // Drift (constant translate) + its wrap bounds.
  { key: 'driftX', label: 'Drift X (/beat)', min: 0, max: 20, step: 0.1, default: 2 },
  { key: 'driftY', label: 'Drift Y (/beat)', min: 0, max: 20, step: 0.1, default: 2 },
  { key: 'driftZ', label: 'Drift Z (/beat)', min: 0, max: 20, step: 0.1, default: 2 },
  { key: 'drift', label: 'Drift ×', min: 0, max: 10, step: 0.1, default: 1 },
  { key: 'driftReturnBeats', label: 'Drift return beats', min: 0.05, max: 16, step: 0.05, default: 1 },
  // Roughly the default camera's framing at the origin (z = 5, fov 55, 16:9):
  // an object drifting sideways leaves the frame and comes back on the far
  // side. 0 turns wrapping off for that axis.
  { key: 'boundX', label: 'Wrap bound X (0 = off)', min: 0, max: 50, step: 0.5, default: 5 },
  { key: 'boundY', label: 'Wrap bound Y (0 = off)', min: 0, max: 50, step: 0.5, default: 3 },
  { key: 'boundZ', label: 'Wrap bound Z (0 = off)', min: 0, max: 50, step: 0.5, default: 8 },
  // Step (translate burst).
  { key: 'distanceX', label: 'Step X', min: 0, max: 10, step: 0.1, default: 1 },
  { key: 'distanceY', label: 'Step Y', min: 0, max: 10, step: 0.1, default: 1 },
  { key: 'distanceZ', label: 'Step Z', min: 0, max: 10, step: 0.1, default: 1 },
  { key: 'distance', label: 'Step ×', min: 0, max: 10, step: 0.1, default: 1 },
  // Spin (constant rotate).
  { key: 'spinX', label: 'Spin X (°/beat)', min: 0, max: 720, step: 1, default: 90 },
  { key: 'spinY', label: 'Spin Y (°/beat)', min: 0, max: 720, step: 1, default: 90 },
  { key: 'spinZ', label: 'Spin Z (°/beat)', min: 0, max: 720, step: 1, default: 90 },
  { key: 'spin', label: 'Spin ×', min: 0, max: 10, step: 0.1, default: 1 },
  { key: 'spinReturnBeats', label: 'Spin return beats', min: 0.05, max: 16, step: 0.05, default: 1 },
  // Snap (rotate burst).
  { key: 'angleX', label: 'Snap X (°)', min: 0, max: 720, step: 1, default: 90 },
  { key: 'angleY', label: 'Snap Y (°)', min: 0, max: 720, step: 1, default: 90 },
  { key: 'angleZ', label: 'Snap Z (°)', min: 0, max: 720, step: 1, default: 90 },
  { key: 'angle', label: 'Snap ×', min: 0, max: 10, step: 0.1, default: 1 },
  // Shared burst feel for Step and Snap.
  { key: 'burstBeats', label: 'Burst beats', min: 0.05, max: 16, step: 0.05, default: 1 },
  {
    key: 'easing',
    label: 'Burst easing',
    type: 'select',
    options: BURST_EASINGS.map((easing, value) => ({ value, label: easing.label })),
    default: 0,
  },
  { key: 'sharpness', label: 'Burst sharpness', min: 0.25, max: 4, step: 0.05, default: 1 },
  // Shared by Spin and Snap.
  { key: 'pivotX', label: 'Pivot X', min: -20, max: 20, step: 0.1, default: 0 },
  { key: 'pivotY', label: 'Pivot Y', min: -20, max: 20, step: 0.1, default: 0 },
  { key: 'pivotZ', label: 'Pivot Z', min: -20, max: 20, step: 0.1, default: 0 },
  ...BASIS_PARAMS,
]

export const motionMover: MoverOrSplitterDefinition<MotionSettings> = {
  id: 'motion',
  label: 'Motion',
  kind: 'mover',
  params: MOTION_PARAMS,
  midiRows: () => MOTION_ROWS,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const basis = resolveBasis(settings)
    const pivot: [number, number, number] = [settings.pivotX ?? 0, settings.pivotY ?? 0, settings.pivotZ ?? 0]
    // Constant Rotate's evaluator wants its own key names; the basis and pivot
    // fields it also declares come straight through the spread.
    const spinSettings: ConstantRotationSettings = {
      ...settings,
      speedX: settings.spinX,
      speedY: settings.spinY,
      speedZ: settings.spinZ,
      speed: settings.spin,
      returnBeats: settings.spinReturnBeats,
    }
    const spinNotes = motionBlockNotes(notes, MOTION_BLOCKS.spin, true)
    const snapNotes = motionBlockNotes(notes, MOTION_BLOCKS.snap)

    return {
      apply(visualCopy, { beat }) {
        const amounts = evaluateMotionTranslation(notes, settings, beat)
        const offset = new Vector3()
          .addScaledVector(basis[0], amounts[0])
          .addScaledVector(basis[1], amounts[1])
          .addScaledVector(basis[2], amounts[2])
        const rotation = basisRotation(basis, evaluateConstantRotationAngles(spinNotes, spinSettings, beat))
          .multiply(basisRotation(basis, evaluateSnapAngles(snapNotes, settings, beat)))

        const next: VisualCopy = {
          transform: visualCopy.transform.clone()
            .multiply(new Matrix4().makeTranslation(offset.x, offset.y, offset.z))
            .multiply(pivotedRotation(rotation, pivot)),
          opacity: visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }
        return [next]
      },
    }
  },
}
