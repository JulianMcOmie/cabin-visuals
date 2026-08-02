// Symmetric Motion mover: MIDI-driven motion that keeps a formation symmetric
// about the object's own center. Each copy's direction is derived from ITS OWN
// position in the chain frame - which side of an axis it sits on, or which way
// is outward from the center - so one note moves every copy at once and the
// arrangement's symmetry survives the motion by construction. It is the motion
// counterpart of the Symmetry splitter: that one builds a symmetric ARRANGEMENT,
// this one animates any arrangement symmetrically (a Radial ring blooms, a Grid
// splits apart, a Symmetry fold breathes).
//
// The vocabulary is deliberately tiny and gated by two mode switches rather
// than by more rows:
//  - SYMMETRY picks how a copy's direction is read off its position: Radial
//    (out/in from the center + a turn about it) or Mirror (apart/together
//    across each axis plane).
//  - MOTION picks the time shape every row shares: Burst (each note fires an
//    eased excursion - return-family easings come home, step-family easings
//    land and stay), Constant (travel accumulates while the note is held and
//    freezes on release), or Oscillate (a wave that runs while held).
//
// Composition: PRE-multiplied (delta * previous), the chain-root convention.
// Directions are measured in the chain frame the formation was built in, so a
// copy's own rotated or mirrored axes must not re-aim them - two mirrored
// copies get equal-and-opposite world motion, which is the whole point.
// (Consequence: a frame under this mover is a no-op, like Burst - it reads no
// placementTransform, so the symmetry center is always the object's own chain
// origin and travels with the track transform.)
//
// Inward motion CLAMPS at the symmetry element (per copy, against its own
// undisplaced distance): "In" and "Together" collapse the formation onto the
// center or the axis plane and hold it there rather than pushing copies out
// the far side, which would silently turn a collapse into a crossing.

import { Matrix4, Vector3 } from 'three'
import type { MidiRowDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import type { VisualCopy } from './types'
import { BURST_EASINGS } from './burstEasings'
import { normalizedVelocity } from './motionBasis'
import { SYMMETRIC_MOTION_COLOR } from './identityColors'

export interface SymmetricMotionSettings {
  /** 0 = Radial (out/in/turn about the center), 1 = Mirror (apart/together per axis). */
  symmetry: number
  /** 0 = Burst (eased excursion per note), 1 = Constant (accumulates while
   *  held), 2 = Oscillate (wave while held). */
  motion: number
  /** Radial mode only: 0 = XY, 1 = XZ, 2 = YZ, 3 = Sphere (fully 3D out/in). */
  plane: number
  /** Travel in scene units: per note (Burst), per `beats` held (Constant), or
   *  the wave's amplitude (Oscillate). */
  distance: number
  /** Radial mode's turn rows, in degrees - same three time shapes as distance. */
  angle: number
  /** The shared time base: a burst's flight time, Constant's "distance per
   *  this many beats", Oscillate's full cycle. */
  beats: number
  /** Burst mode only: BURST_EASINGS index. Return-family curves make notes
   *  temporary excursions; step-family curves make them permanent steps. */
  easing: number
}

export const SYMMETRIC_MOTION_RADIAL_ROWS: MidiRowDef[] = [
  { pitch: 60, label: 'Out' },
  { pitch: 61, label: 'In' },
  { pitch: 62, label: 'Turn left' },
  { pitch: 63, label: 'Turn right' },
]

export const SYMMETRIC_MOTION_MIRROR_ROWS: MidiRowDef[] = [
  { pitch: 60, label: 'Apart X' },
  { pitch: 61, label: 'Together X' },
  { pitch: 62, label: 'Apart Y' },
  { pitch: 63, label: 'Together Y' },
  { pitch: 64, label: 'Apart Z' },
  { pitch: 65, label: 'Together Z' },
]

/** Signed row channels: radial mode folds 60/61 into one signed "out" scalar
 *  and 62/63 into one signed "turn"; mirror mode folds each pitch pair into a
 *  signed per-axis scalar. */
const RADIAL_CHANNELS: Record<number, { channel: 'out' | 'turn'; sign: 1 | -1 }> = {
  60: { channel: 'out', sign: 1 },
  61: { channel: 'out', sign: -1 },
  62: { channel: 'turn', sign: 1 },
  63: { channel: 'turn', sign: -1 },
}
const MIRROR_CHANNELS: Record<number, { axis: 0 | 1 | 2; sign: 1 | -1 }> = {
  60: { axis: 0, sign: 1 },
  61: { axis: 0, sign: -1 },
  62: { axis: 1, sign: 1 },
  63: { axis: 1, sign: -1 },
  64: { axis: 2, sign: 1 },
  65: { axis: 2, sign: -1 },
}

/** Which axis the radial plane turns about (and projects out of). Matches the
 *  Radial splitter's plane axes; Sphere has no plane, so its turn rows revolve
 *  the formation about world up. */
const PLANE_NORMALS = [
  new Vector3(0, 0, 1), // XY
  new Vector3(0, 1, 0), // XZ
  new Vector3(1, 0, 0), // YZ
  new Vector3(0, 1, 0), // Sphere - turn only; out/in ignores the normal
]

/**
 * One note's unitless progress envelope under the current motion type. Pure in
 * (note, beat, settings), so the summed channels stay closed-form and scrub ==
 * playback == export.
 */
export function symmetricMotionEnvelope(
  note: ResolvedNote,
  settings: SymmetricMotionSettings,
  beat: number,
): number {
  const age = beat - note.beat
  if (age < 0) return 0
  const beats = Math.max(0.0001, settings.beats)
  if (settings.motion === 1) {
    // Constant: travel grows while the note sounds and FREEZES on release, so
    // position is choreographed by the written note lengths (like Burst's
    // permanent steps, but sized by hold time instead of note count).
    return Math.min(age, Math.max(0, note.durationBeats)) / beats
  }
  if (settings.motion === 2) {
    // Oscillate: home -> extent -> home each cycle, only while held.
    if (age >= Math.max(0, note.durationBeats)) return 0
    return (1 - Math.cos((age / beats) * Math.PI * 2)) / 2
  }
  // Burst: one eased flight per note over `beats`. Step-family easings end at
  // 1 (permanent), return-family end at 0 (temporary excursion).
  const { ease } = BURST_EASINGS[settings.easing] ?? BURST_EASINGS[0]
  return ease(Math.min(1, age / beats))
}

export interface SymmetricMotionChannels {
  /** Signed outward travel, in scene units (radial mode). */
  out: number
  /** Signed turn about the plane normal, in radians (radial mode). */
  turn: number
  /** Signed apart(+)/together(−) travel per axis, in scene units (mirror mode). */
  axes: [number, number, number]
}

/** The summed signed channels of every note at `beat`. Both modes are always
 *  evaluated - only the rows the current symmetry mode declares are hit in
 *  practice, and the editor's strict rows keep stray pitches out. */
export function evaluateSymmetricMotionChannels(
  notes: readonly ResolvedNote[],
  settings: SymmetricMotionSettings,
  beat: number,
): SymmetricMotionChannels {
  const channels: SymmetricMotionChannels = { out: 0, turn: 0, axes: [0, 0, 0] }
  const radial = settings.symmetry !== 1
  for (const note of notes) {
    const route = radial ? RADIAL_CHANNELS[note.pitch] : undefined
    const mirror = radial ? undefined : MIRROR_CHANNELS[note.pitch]
    if (!route && !mirror) continue
    const contribution = symmetricMotionEnvelope(note, settings, beat) * normalizedVelocity(note.velocity)
    if (contribution === 0) continue
    if (route) {
      if (route.channel === 'out') channels.out += route.sign * contribution * settings.distance
      else channels.turn += route.sign * contribution * (settings.angle * Math.PI) / 180
    } else if (mirror) {
      channels.axes[mirror.axis] += mirror.sign * contribution * settings.distance
    }
  }
  return channels
}

/** Copies closer to the symmetry element than this have no readable side or
 *  outward direction, and stay put. */
const CENTER_EPS = 0.000001

export const symmetricMotionMover: MoverOrSplitterDefinition<SymmetricMotionSettings> = {
  id: 'symmetricMotion',
  label: 'Symmetric Motion',
  kind: 'mover',
  identityColor: SYMMETRIC_MOTION_COLOR,
  params: [
    {
      key: 'symmetry',
      label: 'Symmetry',
      type: 'select',
      options: [
        { value: 0, label: 'Radial' },
        { value: 1, label: 'Mirror' },
      ],
      default: 0,
    },
    {
      key: 'motion',
      label: 'Motion',
      type: 'select',
      options: [
        { value: 0, label: 'Burst' },
        { value: 1, label: 'Constant' },
        { value: 2, label: 'Oscillate' },
      ],
      default: 0,
    },
    {
      key: 'plane',
      label: 'Plane',
      type: 'select',
      options: [
        { value: 0, label: 'XY' },
        { value: 1, label: 'XZ' },
        { value: 2, label: 'YZ' },
        { value: 3, label: 'Sphere' },
      ],
      default: 0,
      showIf: 'symmetry=0',
    },
    { key: 'distance', label: 'Distance', min: 0, max: 10, step: 0.1, default: 1.5 },
    { key: 'angle', label: 'Turn', min: 0, max: 360, step: 1, default: 45, showIf: 'symmetry=0' },
    { key: 'beats', label: 'Beats', min: 0.05, max: 16, step: 0.05, default: 1 },
    {
      key: 'easing',
      label: 'Easing',
      type: 'select',
      options: BURST_EASINGS.map((e, value) => ({ value, label: e.label })),
      // ADSR: notes read as temporary excursions - the formation flashes apart
      // and comes home - which is this mover's signature move. Step-family
      // easings turn the same rows into permanent choreography.
      default: 6,
      showIf: 'motion=0',
    },
  ],
  midiRows: (settings) =>
    settings.symmetry === 1 ? SYMMETRIC_MOTION_MIRROR_ROWS : SYMMETRIC_MOTION_RADIAL_ROWS,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const mirror = settings.symmetry === 1
    const plane = settings.plane >= 1 && settings.plane <= 3 ? settings.plane : 0
    const normal = PLANE_NORMALS[plane]
    const sphere = plane === 3
    return {
      apply(visualCopy, { beat }) {
        const channels = evaluateSymmetricMotionChannels(notes, settings, beat)
        const te = visualCopy.transform.elements
        const position = new Vector3(te[12], te[13], te[14])
        const offset = new Vector3()
        let delta: Matrix4 | null = null

        if (mirror) {
          for (let axis = 0 as 0 | 1 | 2; axis < 3; axis++) {
            const component = position.getComponent(axis)
            if (Math.abs(component) <= CENTER_EPS || channels.axes[axis] === 0) continue
            // Signed travel along this copy's own side, clamped so "together"
            // parks the copy ON the axis plane instead of crossing it.
            const travel = Math.max(channels.axes[axis], -Math.abs(component))
            offset.setComponent(axis, Math.sign(component) * travel)
          }
          if (offset.lengthSq() > 0) {
            delta = new Matrix4().makeTranslation(offset.x, offset.y, offset.z)
          }
        } else {
          const outward = sphere
            ? position.clone()
            : position.clone().addScaledVector(normal, -position.dot(normal))
          const reach = outward.length()
          if (reach > CENTER_EPS && channels.out !== 0) {
            const travel = Math.max(channels.out, -reach)
            offset.copy(outward).multiplyScalar(travel / reach)
            delta = new Matrix4().makeTranslation(offset.x, offset.y, offset.z)
          }
          if (channels.turn !== 0) {
            // The turn carries the radial offset with it: displace outward in
            // the undisplaced frame, then revolve the result about the center.
            const turn = new Matrix4().makeRotationAxis(normal, channels.turn)
            delta = delta ? turn.multiply(delta) : turn
          }
        }

        const next: VisualCopy = {
          // PRE-multiplied: the delta is measured on fixed chain-frame axes
          // (see the header), so the copy's own frame must not re-aim it.
          transform: delta
            ? delta.clone().multiply(visualCopy.transform)
            : visualCopy.transform.clone(),
          opacity: visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }
        return [next]
      },
    }
  },
}
