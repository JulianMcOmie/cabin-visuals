// Symmetric Rotation mover: rotation read off each copy's position relative to
// ONE axis, so a whole formation turns as a symmetric body instead of copy by
// copy. It is the rotational counterpart of Symmetric Motion (which reads a
// copy's position to give it a direction to TRAVEL); here the position picks the
// copy's rotation axis and how much of the angle it gets.
//
// Three channels, all measured against the symmetry axis A and the copy's own
// position, and they are the three rotations a point around an axis can have:
//
//   TWIST - about A itself. With a gradient along A this is the classic twist
//           deformer: a column shears into a helix, a ring becomes a spiral.
//   FOLD  - about the TANGENT of the circle the copy sits on (t = r̂ × A). This
//           is the "toward or away from the axis" one: the copy's arm swings in
//           the (r̂, A) plane, so a flat ring closes into a cone at ±90° and
//           opens back out at 0. Anchored on the copy's own center it is pure
//           re-orientation - petals facing in or out - and anchored on the axis
//           it folds the whole formation like an umbrella.
//   ROLL  - about the copy's own outward radial r̂: a pinwheel spin in place.
//           The copy sits ON that line, so ANCHOR cannot move it - roll is the
//           one channel the anchor does nothing to.
//
// FALLOFF is the second half of the design, and the reason one definition covers
// so much: the same channel angle can be applied uniformly, scaled by signed
// distance ALONG the axis (twist/shear), scaled by distance FROM the axis
// (outer copies turn hardest - a swirl), or INTO the axis (strongest at the
// core, gone past SPAN - a vortex). SPAN is the distance that earns the full
// angle; CURVE bends the ramp without touching its ends.
//
// MODE is the Mover's time matrix, one column at a time and on the same frozen
// pitches (60/61 twist, 62/63 fold, 64/65 roll, 66 Return), so switching modes
// keeps every written note meaningful:
//   Amount    - no MIDI at all: the knobs ARE the angles. This is the "just set
//               the amount of twist" case, and the knobs are ordinary numeric
//               params, so an automation lane animates the twist directly.
//   Burst     - each note fires an eased excursion of its channel's angle
//               (BURST_EASINGS: step curves land and stay, return curves come
//               home). Delegates to evaluateBurstOffset, the Mover's own.
//   Constant  - held notes turn at their channel's angle PER BEAT and keep the
//               travel on release, over an always-on baseline spin (DRIVE picks
//               whether that baseline runs) - "constant twist rotation".
//               Delegates to evaluateConstantRotationAngles.
//   Oscillate - held notes swing 0 → angle → 0 at Cycles/beat. Delegates to the
//               Mover's evaluateOscillationAmounts.
// Reusing those three evaluators is deliberate: this mover's notes feel exactly
// like the Mover's notes, and there is one place to fix a time shape.
//
// COMPOSITION: PRE-multiplied (delta · previous), declared 'chainRoot'. The
// axis, the radial and the tangent are all measured on the chain frame the
// formation was built in - a copy's own rotated or mirrored frame must not
// re-aim them, or a mirrored pair would twist the same way in world space and
// the symmetry would be lost. (Consequence, as with Symmetric Motion: this
// mover reads no placementTransform, so a mover FRAME under it is a no-op and
// the axis always travels with the track transform.)
//
// The three channels compose in a fixed order - twist outermost, then fold,
// then roll - so a chord across channels is reproducible; each one's direction
// is read from the copy's INCOMING position, not from the partially rotated
// result.

import { Matrix4, Vector3 } from 'three'
import type { MidiRowDef, ParamDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import { BURST_EASINGS } from './burstEasings'
import { evaluateBurstOffset } from './burstOffset'
import { evaluateOscillationAmounts } from './mover'
import { evaluateConstantRotationAngles } from './rotationMovers'
import { RETURN_PITCH, pivotedRotation } from './motionBasis'
import { SYMMETRIC_ROTATION_COLOR } from './identityColors'

const DEG_TO_RAD = Math.PI / 180

// Every select's values are persisted in saved projects: append only, never
// reorder.
export const SYMMETRIC_ROTATION_AXIS_X = 0
export const SYMMETRIC_ROTATION_AXIS_Y = 1
export const SYMMETRIC_ROTATION_AXIS_Z = 2

export const SYMMETRIC_ROTATION_MODE_AMOUNT = 0
export const SYMMETRIC_ROTATION_MODE_BURST = 1
export const SYMMETRIC_ROTATION_MODE_CONSTANT = 2
export const SYMMETRIC_ROTATION_MODE_OSCILLATE = 3

/** Uniform: every copy gets the whole angle. */
export const SYMMETRIC_ROTATION_FALLOFF_UNIFORM = 0
/** Signed distance ALONG the axis / span - the classic twist gradient. */
export const SYMMETRIC_ROTATION_FALLOFF_ALONG = 1
/** Distance FROM the axis / span - outer copies turn hardest. */
export const SYMMETRIC_ROTATION_FALLOFF_FROM = 2
/** 1 - distance/span, clamped at 0 - strongest at the core, gone past span. */
export const SYMMETRIC_ROTATION_FALLOFF_INTO = 3

/** Rotate about the axis LINE (the formation moves), or about each copy's own
 *  center (the formation only re-orients). No-op for the roll channel. */
export const SYMMETRIC_ROTATION_ANCHOR_AXIS = 0
export const SYMMETRIC_ROTATION_ANCHOR_SELF = 1

export const SYMMETRIC_ROTATION_DRIVE_AUTO = 0
export const SYMMETRIC_ROTATION_DRIVE_MIDI = 1

export interface SymmetricRotationSettings {
  /** 0 = X, 1 = Y, 2 = Z: the cardinal the symmetry axis starts from. */
  axis: number
  /** Aim the axis off its cardinal: yaw about +Y, then pitch about +X. Both 0
   *  (the default) leave it exactly on the cardinal. */
  axisYaw: number
  axisPitch: number
  /** The point the axis passes through, in the frame above this mover. */
  centerX: number
  centerY: number
  centerZ: number
  /** SYMMETRIC_ROTATION_MODE_*: what MIDI (or nothing) does with the angles. */
  mode: number
  /** SYMMETRIC_ROTATION_FALLOFF_*: how a copy's position scales its angle. */
  falloff: number
  /** The distance that earns the full angle under a non-uniform falloff. */
  span: number
  /** Exponent on the falloff ramp (1 = linear). Signs are preserved. */
  curve: number
  /** SYMMETRIC_ROTATION_ANCHOR_*: rotate about the axis line, or in place. */
  anchor: number
  /** Constant mode only: whether the always-on baseline spin runs. */
  drive: number
  /** Per-channel angles in degrees - the amount (Amount), per hit (Burst), per
   *  beat (Constant) or of swing (Oscillate). Signed, so a knob alone can turn
   *  either way. `angle` is the master multiplier. */
  twist: number
  fold: number
  roll: number
  angle: number
  /** Burst feel. */
  burstBeats: number
  easing: number
  sharpness: number
  /** Oscillate rate. */
  cyclesPerBeat: number
  /** Constant + Oscillate: how long the Return row takes to come home. */
  returnBeats: number
}

const SYMMETRIC_ROTATION_PARAMS: ParamDef[] = [
  {
    key: 'axis',
    label: 'Axis',
    type: 'select',
    options: [
      { value: SYMMETRIC_ROTATION_AXIS_X, label: 'X' },
      { value: SYMMETRIC_ROTATION_AXIS_Y, label: 'Y' },
      { value: SYMMETRIC_ROTATION_AXIS_Z, label: 'Z' },
    ],
    default: SYMMETRIC_ROTATION_AXIS_Y,
  },
  {
    key: 'mode',
    label: 'MIDI mode',
    type: 'select',
    options: [
      { value: SYMMETRIC_ROTATION_MODE_AMOUNT, label: 'Amount' },
      { value: SYMMETRIC_ROTATION_MODE_BURST, label: 'Burst' },
      { value: SYMMETRIC_ROTATION_MODE_CONSTANT, label: 'Constant' },
      { value: SYMMETRIC_ROTATION_MODE_OSCILLATE, label: 'Oscillate' },
    ],
    default: SYMMETRIC_ROTATION_MODE_AMOUNT,
  },
  {
    key: 'falloff',
    label: 'Falloff',
    type: 'select',
    options: [
      { value: SYMMETRIC_ROTATION_FALLOFF_UNIFORM, label: 'Uniform' },
      { value: SYMMETRIC_ROTATION_FALLOFF_ALONG, label: 'Along axis' },
      { value: SYMMETRIC_ROTATION_FALLOFF_FROM, label: 'From axis' },
      { value: SYMMETRIC_ROTATION_FALLOFF_INTO, label: 'Into axis' },
    ],
    // ALONG, not UNIFORM (changed 2026-08-15): uniform + the axis-line anchor
    // is a rigid whole-formation turn - indistinguishable from a plain rotate
    // mover, which is exactly the "it moves everything as a whole" report this
    // default caused. Along is the twist deformer the library card advertises,
    // and the panel's live preview now carries the lone-object case uniform
    // was protecting. Untouched saves pick up the new default, as Tunnel's
    // orientation change did.
    default: SYMMETRIC_ROTATION_FALLOFF_ALONG,
  },
  {
    key: 'anchor',
    label: 'Anchor',
    type: 'select',
    options: [
      { value: SYMMETRIC_ROTATION_ANCHOR_AXIS, label: 'Axis line' },
      { value: SYMMETRIC_ROTATION_ANCHOR_SELF, label: 'Own center' },
    ],
    default: SYMMETRIC_ROTATION_ANCHOR_AXIS,
  },
  // 45 rather than a rounder 90 or 180: under the ALONG default a copy one
  // SPAN up the axis turns 45° - a visible shear on any formation - and 90 or
  // 180 are symmetries of a cube, which would render the stock instrument's
  // grid identically with the mover and without it and read as a dead mover.
  { key: 'twist', label: 'Twist (°)', min: -720, max: 720, step: 1, default: 45 },
  { key: 'fold', label: 'Fold (°)', min: -720, max: 720, step: 1, default: 0 },
  { key: 'roll', label: 'Roll (°)', min: -720, max: 720, step: 1, default: 0 },
  { key: 'angle', label: 'Angle ×', min: 0, max: 10, step: 0.1, default: 1 },
  { key: 'span', label: 'Span', min: 0.1, max: 20, step: 0.1, default: 2 },
  { key: 'curve', label: 'Curve', min: 0.25, max: 4, step: 0.05, default: 1 },
  { key: 'centerX', label: 'Center X', min: -20, max: 20, step: 0.1, default: 0 },
  { key: 'centerY', label: 'Center Y', min: -20, max: 20, step: 0.1, default: 0 },
  { key: 'centerZ', label: 'Center Z', min: -20, max: 20, step: 0.1, default: 0 },
  { key: 'axisYaw', label: 'Axis yaw (°)', min: -180, max: 180, step: 1, default: 0 },
  { key: 'axisPitch', label: 'Axis pitch (°)', min: -180, max: 180, step: 1, default: 0 },
  { key: 'burstBeats', label: 'Burst beats', min: 0.05, max: 16, step: 0.05, default: 1, showIf: 'mode=1' },
  {
    key: 'easing',
    label: 'Easing',
    type: 'select',
    options: BURST_EASINGS.map((easing, value) => ({ value, label: easing.label })),
    default: 0,
    showIf: 'mode=1',
  },
  { key: 'sharpness', label: 'Sharpness', min: 0.25, max: 4, step: 0.05, default: 1, showIf: 'mode=1' },
  {
    key: 'drive',
    label: 'Drive',
    type: 'select',
    options: [
      { value: SYMMETRIC_ROTATION_DRIVE_AUTO, label: 'Auto spin' },
      { value: SYMMETRIC_ROTATION_DRIVE_MIDI, label: 'MIDI only' },
    ],
    default: SYMMETRIC_ROTATION_DRIVE_AUTO,
    showIf: 'mode=2',
  },
  { key: 'cyclesPerBeat', label: 'Cycles / beat', min: 0.05, max: 16, step: 0.05, default: 1, showIf: 'mode=3' },
  // Read by Constant AND Oscillate, and showIf can only pin one value, so this
  // one stays visible in every mode.
  { key: 'returnBeats', label: 'Return beats', min: 0.05, max: 16, step: 0.05, default: 1 },
]

// The frozen pitches, on the Mover's own signed-channel layout (60/61 = channel
// 0, 62/63 = channel 1, 64/65 = channel 2), which is what lets the three shared
// evaluators read these notes unchanged.
export const SYMMETRIC_ROTATION_ROWS: MidiRowDef[] = [
  { pitch: 60, label: 'Twist +' },
  { pitch: 61, label: 'Twist −' },
  { pitch: 62, label: 'Fold +' },
  { pitch: 63, label: 'Fold −' },
  { pitch: 64, label: 'Roll +' },
  { pitch: 65, label: 'Roll −' },
]

const RETURN_ROW: MidiRowDef = { pitch: RETURN_PITCH, label: 'Return' }

export function symmetricRotationMidiRows(settings: SymmetricRotationSettings): MidiRowDef[] {
  // Amount mode is knobs-only: declaring rows there would promise notes that do
  // nothing. (Automation on the angle knobs is how Amount is animated.)
  if (settings.mode === SYMMETRIC_ROTATION_MODE_AMOUNT) return []
  return settings.mode === SYMMETRIC_ROTATION_MODE_BURST
    ? SYMMETRIC_ROTATION_ROWS
    : [...SYMMETRIC_ROTATION_ROWS, RETURN_ROW]
}

const AXIS_VECTORS = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]

/** The symmetry axis as a unit vector in the chain frame: a cardinal, aimed by
 *  yaw (about +Y) and pitch (about +X). Identity at 0/0, so an untouched mover
 *  turns about exactly the axis its select names. */
export function resolveSymmetryAxis(settings: SymmetricRotationSettings): Vector3 {
  const base = AXIS_VECTORS[Math.round(settings.axis)] ?? AXIS_VECTORS[SYMMETRIC_ROTATION_AXIS_Y]
  const yaw = (settings.axisYaw ?? 0) * DEG_TO_RAD
  const pitch = (settings.axisPitch ?? 0) * DEG_TO_RAD
  if (yaw === 0 && pitch === 0) return base.clone()
  const aim = new Matrix4().makeRotationY(yaw).multiply(new Matrix4().makeRotationX(pitch))
  return base.clone().transformDirection(aim)
}

/**
 * How much of the channel angle this copy gets, from where it sits relative to
 * the axis: `along` is its signed distance up the axis, `radius` its distance
 * out from it. Signed on purpose in the ALONG case - that sign reversal across
 * the center is what makes a twist a twist rather than a rigid turn.
 */
export function symmetricRotationWeight(
  along: number,
  radius: number,
  settings: SymmetricRotationSettings,
): number {
  const span = Math.max(0.0001, settings.span ?? 1)
  let raw: number
  switch (settings.falloff) {
    case SYMMETRIC_ROTATION_FALLOFF_ALONG:
      raw = along / span
      break
    case SYMMETRIC_ROTATION_FALLOFF_FROM:
      raw = radius / span
      break
    case SYMMETRIC_ROTATION_FALLOFF_INTO:
      raw = Math.max(0, 1 - radius / span)
      break
    default:
      raw = 1
  }
  const curve = Math.max(0.01, settings.curve ?? 1)
  if (curve === 1 || raw === 0) return raw
  // Bend the ramp, keep its sign: a curved twist still reverses across center.
  return Math.sign(raw) * Math.pow(Math.abs(raw), curve)
}

/**
 * The three channel angles in RADIANS at `beat` - [twist, fold, roll], before
 * any copy's falloff weight. Each mode delegates to the evaluator the Mover
 * uses for the same time shape, so the notes feel identical across the two.
 */
export function evaluateSymmetricRotationChannels(
  notes: readonly ResolvedNote[],
  settings: SymmetricRotationSettings,
  beat: number,
): [number, number, number] {
  const perChannel: [number, number, number] = [settings.twist, settings.fold, settings.roll]
  const multiplier = settings.angle ?? 1
  if (settings.mode === SYMMETRIC_ROTATION_MODE_BURST) {
    const degrees = evaluateBurstOffset(notes, {
      burstBeats: settings.burstBeats,
      easing: settings.easing,
      sharpness: settings.sharpness,
      distanceX: perChannel[0],
      distanceY: perChannel[1],
      distanceZ: perChannel[2],
      distance: multiplier,
    }, beat)
    return [degrees[0] * DEG_TO_RAD, degrees[1] * DEG_TO_RAD, degrees[2] * DEG_TO_RAD]
  }
  if (settings.mode === SYMMETRIC_ROTATION_MODE_CONSTANT) {
    // Already radians: the constant evaluator converts internally.
    return evaluateConstantRotationAngles(notes, {
      speedX: perChannel[0],
      speedY: perChannel[1],
      speedZ: perChannel[2],
      speed: multiplier,
      returnBeats: settings.returnBeats,
      baselineSpin: settings.drive !== SYMMETRIC_ROTATION_DRIVE_MIDI,
    }, beat)
  }
  if (settings.mode === SYMMETRIC_ROTATION_MODE_OSCILLATE) {
    const degrees = evaluateOscillationAmounts(
      notes,
      perChannel,
      multiplier,
      settings.cyclesPerBeat,
      settings.returnBeats,
      beat,
    )
    return [degrees[0] * DEG_TO_RAD, degrees[1] * DEG_TO_RAD, degrees[2] * DEG_TO_RAD]
  }
  // Amount: the knobs are the angles, held for the whole timeline.
  return [
    perChannel[0] * multiplier * DEG_TO_RAD,
    perChannel[1] * multiplier * DEG_TO_RAD,
    perChannel[2] * multiplier * DEG_TO_RAD,
  ]
}

/** Below this the copy is effectively ON the axis: it has no readable radial or
 *  tangent, so fold and roll leave it alone (twist still turns it). */
const AXIS_EPS = 0.000001
const ANGLE_EPS = 0.0000000001

export const symmetricRotationMover: MoverOrSplitterDefinition<SymmetricRotationSettings> = {
  id: 'symmetricRotation',
  label: 'Symmetric Rotation',
  kind: 'mover',
  identityColor: SYMMETRIC_ROTATION_COLOR,
  params: SYMMETRIC_ROTATION_PARAMS,
  midiRows: symmetricRotationMidiRows,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const axis = resolveSymmetryAxis(settings)
    const center = new Vector3(settings.centerX ?? 0, settings.centerY ?? 0, settings.centerZ ?? 0)
    const onAxis = settings.anchor !== SYMMETRIC_ROTATION_ANCHOR_SELF
    return {
      // Declared so a splitter's child chain takes this delta as-is: it is
      // already anchored on the chain frame's fixed axes (see the header).
      composition: 'chainRoot',
      apply(visualCopy, { beat }) {
        const channels = evaluateSymmetricRotationChannels(notes, settings, beat)
        const te = visualCopy.transform.elements
        const position = new Vector3(te[12], te[13], te[14])
        const offset = position.clone().sub(center)
        const along = offset.dot(axis)
        const radial = offset.clone().addScaledVector(axis, -along)
        const radius = radial.length()
        const weight = symmetricRotationWeight(along, radius, settings)

        const self: [number, number, number] = [position.x, position.y, position.z]
        // The nearest point on the axis line - the pivot everything but a
        // self-anchored rotation turns about.
        const foot = center.clone().addScaledVector(axis, along)
        const pivot: [number, number, number] = onAxis ? [foot.x, foot.y, foot.z] : self

        // Collected in the fixed channel order and multiplied in it, so the
        // composition is twist · fold · roll (twist outermost) and a chord
        // across channels always lands the same way.
        const steps: Matrix4[] = []
        const twist = channels[0] * weight
        if (Math.abs(twist) > ANGLE_EPS) {
          steps.push(pivotedRotation(new Matrix4().makeRotationAxis(axis, twist), pivot))
        }
        if (radius > AXIS_EPS) {
          const outward = radial.clone().divideScalar(radius)
          const fold = channels[1] * weight
          if (Math.abs(fold) > ANGLE_EPS) {
            // t = r̂ × A, so a POSITIVE fold lifts the copy's arm toward +A:
            // R(t, θ)·r̂ = r̂·cos θ + A·sin θ. At ±90° the arm lies on the axis.
            const tangent = outward.clone().cross(axis).normalize()
            steps.push(pivotedRotation(new Matrix4().makeRotationAxis(tangent, fold), pivot))
          }
          const roll = channels[2] * weight
          if (Math.abs(roll) > ANGLE_EPS) {
            // The copy lies on this rotation's own axis, so ANCHOR cannot move
            // it - roll always turns the copy where it stands.
            steps.push(pivotedRotation(new Matrix4().makeRotationAxis(outward, roll), self))
          }
        }
        const delta = steps.length > 0
          ? steps.reduce((accumulated, step) => accumulated.multiply(step))
          : null

        return [{
          // PRE-multiplied: the delta is measured on the chain frame's fixed
          // axes, so the copy's own frame must not re-aim it (see the header).
          transform: delta
            ? delta.clone().multiply(visualCopy.transform)
            : visualCopy.transform.clone(),
          opacity: visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }]
      },
    }
  },
}
