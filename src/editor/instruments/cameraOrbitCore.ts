// The pure half of the Camera Orbit instrument: where the rig stands, given its
// settings, its note stream and the beat. Split out of the .tsx because a test
// that imports the component crashes on the instruments/index.ts ⟷
// instrumentFrame cycle - see the directory guide.
//
// The rig is described the way a camera operator thinks about it - a point to
// look at, an axis to circle, how far off that axis to swing, and how far back
// to hold - rather than as a position and a rotation. That is the whole reason
// this instrument exists next to Camera: with an aim point and a ring, "still
// looking at the center" is not something the user has to maintain, it is the
// only thing the parameterisation can express. Nothing here can break the aim,
// because the aim is not stored anywhere to be broken.
//
// The ring is the other half of the design. An orbit is a circle about SOME
// axis, and which axis you pick is the shot:
//
//   Turntable (about Y) - the classic level walk-around.
//   Face-on   (about Z) - the axis pointing at the viewer. A billboard sitting
//                         in the XY plane keeps the same size and the same
//                         standoff the whole way round while the frame rolls
//                         about it; the rig's travel stays PARALLEL to the
//                         billboard rather than swinging behind it.
//   Side      (about X) - the same, for something facing along X.
//
// So the two size knobs are cylindrical, not spherical: STANDOFF is how far the
// rig holds off the plane (measured along the axis, and constant for the whole
// lap - that is the property the shot is named for) and RADIUS is how wide the
// circle it walks is. Distance from the center is whatever those two imply. A
// spherical distance-plus-height pair can describe the same poses but hides the
// one number the operator actually wants to hold still.

import { midiVelocity } from '../utils/midiVelocity'
import type { MidiRowDef } from './types'
import { clamp } from '../utils/math'

const DEG = Math.PI / 180

// BOTH axes run forever. Neither angle is clamped or wrapped: a held note keeps
// travelling for as long as it is held, so vertical laps over the top are as
// available as horizontal ones.
//
// That is only possible because the rig carries its own up vector
// (`orbitCameraUp`) instead of borrowing world +Y. With a fixed up, ±90° is
// where the camera sits ON its own up axis, `lookAt` has no roll left to choose,
// and the frame snaps over - which is why elevation used to park a degree short
// of the pole. Deriving up from the orbit frame removes the singularity
// entirely, so passing overhead ROLLS through and the tumble is continuous.

export interface CameraOrbitSettings {
  /** The point orbited AND looked at. Defaults to the origin, where an
   *  untransformed object is placed. */
  centerX: number
  centerY: number
  centerZ: number
  /** Index into ORBIT_AXES: which axis the rig circles, and therefore which
   *  plane its travel stays parallel to. */
  orbitAxis: number
  /** How far the rig holds off that plane, along the axis. Constant for the
   *  whole lap - this is the number the shot is built to keep still. */
  standoff: number
  /** How wide a circle the rig walks around the axis. Zero parks it dead on the
   *  axis, where orbiting becomes a pure roll about the subject. */
  radius: number
  /** Resting angle around the ring, in degrees. */
  azimuth: number
  /** Degrees per beat a held note travels, before velocity scaling. */
  swingSpeed: number
  tiltSpeed: number
  /** How long a held Return home note takes to bring the rig back. */
  returnBeats: number
  returnEase: number
  fov: number
}

type Vector3 = readonly [number, number, number]

/**
 * An orbit preset: the axis the rig circles, plus where on the ring angle 0 sits.
 *
 * `axis` is the pole - the direction STANDOFF is measured along, and the normal
 * of the plane the rig's travel stays parallel to. `reference` is the in-plane
 * direction the rig sits in at angle 0 with no standoff, and it also fixes the
 * roll: the frame's up at the pole comes out as its NEGATIVE, which is why the
 * two axes that are used pole-on (Face-on, Side) reference -Y and so come out
 * upright there.
 *
 * `right` completes a right-handed frame and is derived, never written by hand.
 */
export interface OrbitAxisPreset {
  key: string
  label: string
  /** The plane the rig's travel stays parallel to, named for the panel. */
  plane: string
  /** What the shot is, in one clause, for the panel's tooltip. */
  hint: string
  axis: Vector3
  reference: Vector3
  right: Vector3
}

const cross = (a: Vector3, b: Vector3): Vector3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

function preset(
  key: string,
  label: string,
  plane: string,
  hint: string,
  axis: Vector3,
  reference: Vector3,
): OrbitAxisPreset {
  return { key, label, plane, hint, axis, reference, right: cross(axis, reference) }
}

/**
 * The shipped orbit axes. ORDER IS THE SAVED VALUE - a track stores the index,
 * so these may be appended to but never resequenced.
 *
 * Turntable is the default because it is the familiar walk-around and its
 * defaults reproduce the scene's stock camera; Face-on is first in the list
 * because it is the one people come looking for.
 */
export const ORBIT_AXES: OrbitAxisPreset[] = [
  preset(
    'faceOn',
    'Face-on',
    'parallel to the XY plane',
    'Circles the Z axis, the one pointing at you: travel stays parallel to a billboard in the XY plane at a constant standoff, and the frame rolls around it.',
    [0, 0, 1],
    [0, -1, 0],
  ),
  preset(
    'turntable',
    'Turntable',
    'parallel to the XZ floor',
    'The level walk-around: circles the Y axis, holding a constant height above the floor.',
    [0, 1, 0],
    [0, 0, 1],
  ),
  preset(
    'side',
    'Side',
    'parallel to the YZ plane',
    'Circles the X axis - for a subject facing along X, or an over-and-under tumble.',
    [1, 0, 0],
    [0, -1, 0],
  ),
]

export const DEFAULT_ORBIT_AXIS = 1

export function resolveOrbitAxis(settings: CameraOrbitSettings): OrbitAxisPreset {
  return ORBIT_AXES[Math.round(settings.orbitAxis)] ?? ORBIT_AXES[DEFAULT_ORBIT_AXIS]
}

/** Rotate a vector out of the canonical orbit frame (pole +Y, angle 0 at +Z)
 *  into world space. Turntable's frame IS the canonical one, so that preset
 *  passes everything through untouched. */
function toWorld(frame: OrbitAxisPreset, v: Vector3): [number, number, number] {
  return [
    v[0] * frame.right[0] + v[1] * frame.axis[0] + v[2] * frame.reference[0],
    v[0] * frame.right[1] + v[1] * frame.axis[1] + v[2] * frame.reference[1],
    v[0] * frame.right[2] + v[1] * frame.axis[2] + v[2] * frame.reference[2],
  ]
}

/**
 * How far the rig is from the center - derived, because standoff and radius are
 * the two the operator sets. Floored so a rig configured at the center still has
 * a direction to look along.
 */
export function orbitDistance(settings: CameraOrbitSettings): number {
  return Math.max(0.01, Math.hypot(settings.standoff, settings.radius))
}

/**
 * The resting angle off the ring, in degrees: 0 sits on the ring at zero
 * standoff, 90 parks dead on the axis. Also derived from standoff/radius, so
 * there is exactly one place the resting pose is described.
 *
 * This is the angle a held Orbit up/down note adds to - which is why holding one
 * trades standoff for radius rather than sliding the rig along the axis: the
 * distance from the center is what stays put.
 */
export function restingElevation(settings: CameraOrbitSettings): number {
  return Math.atan2(settings.standoff, Math.max(0, settings.radius)) / DEG
}

/**
 * Which way a held note drives the rig. Azimuth grows to the camera's RIGHT
 * (+90° puts it on the +X side of the stage); elevation grows upward, so the
 * camera climbs and looks down.
 *
 * Two notes held together simply add into different fields here - that is the
 * whole implementation of "combine the axes". A diagonal sweep is a chord, not
 * a mode.
 */
export const ORBIT_DIRECTIONS: Record<number, { axis: 'azimuth' | 'elevation'; sign: 1 | -1 }> = {
  64: { axis: 'elevation', sign: 1 },
  63: { axis: 'elevation', sign: -1 },
  62: { axis: 'azimuth', sign: 1 },
  61: { axis: 'azimuth', sign: -1 },
}

/** Held: ease every accumulated degree back to the resting angles. */
export const RETURN_HOME_PITCH = 60

export const CAMERA_ORBIT_ROWS: MidiRowDef[] = [
  { pitch: 64, label: 'Orbit up' },
  { pitch: 63, label: 'Orbit down' },
  { pitch: 62, label: 'Orbit right' },
  { pitch: 61, label: 'Orbit left' },
  { pitch: 60, label: 'Return home', emphasized: true },
]

export const RETURN_EASINGS: { label: string; ease: (t: number) => number }[] = [
  { label: 'Smooth', ease: (t) => t * t * (3 - 2 * t) },
  { label: 'Expo', ease: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)) },
  { label: 'Linear', ease: (t) => t },
]

/** The note stream this instrument reads: only these three fields matter here,
 *  so tests can hand-write notes without building a whole ResolvedNote. */
export interface OrbitNote {
  beat: number
  pitch: number
  velocity: number
  durationBeats: number
}

/** Degrees, folded into (-180, 180] - the short way round. */
function shortestAngle(degrees: number): number {
  return degrees - Math.round(degrees / 360) * 360
}

/**
 * Degrees a held note has driven each axis by `beat`, summed over the whole note
 * history. Closed form over the note stream rather than accumulated per frame,
 * so a scrub lands on exactly the pose playback would show and export is
 * frame-exact - the one rule.
 *
 * Unbounded on both axes: hold a row for eight beats at 90°/beat and the rig
 * turns twice, vertically as readily as horizontally. Nothing here knows about
 * 360° - the angles are only ever read through sin/cos.
 */
function accumulatedAngles(
  notes: readonly OrbitNote[],
  settings: CameraOrbitSettings,
  beat: number,
): { azimuth: number; elevation: number } {
  let azimuth = 0
  let elevation = 0
  for (const note of notes) {
    const direction = ORBIT_DIRECTIONS[note.pitch]
    if (!direction || beat <= note.beat) continue
    const heldBeats = Math.min(Math.max(0, note.durationBeats), beat - note.beat)
    const travel = direction.sign * heldBeats * midiVelocity(note.velocity)
    if (direction.axis === 'azimuth') azimuth += travel * settings.swingSpeed
    else elevation += travel * settings.tiltSpeed
  }
  return { azimuth, elevation }
}

/**
 * The rig's angles at `beat`: the resting pose, plus everything held notes have
 * driven, minus whatever a Return home note has erased.
 *
 * A Return note erases the travel banked up to its own onset, easing over
 * `returnBeats` - so anything played DURING the return still moves the rig, and
 * the return lands on the resting angles rather than on a stale snapshot.
 * Progress is gated by how long the note is HELD (`min(elapsed, duration)`), to
 * match the hold-to-orbit grammar of the other rows: let go early and the rig
 * stops partway home instead of coasting the rest of the way.
 */
export function evaluateOrbitAngles(
  notes: readonly OrbitNote[],
  settings: CameraOrbitSettings,
  beat: number,
): { azimuth: number; elevation: number } {
  const returnBeats = Math.max(0.0001, settings.returnBeats)
  const easing = RETURN_EASINGS[Math.round(settings.returnEase)] ?? RETURN_EASINGS[0]
  let erasedAzimuth = 0
  let erasedElevation = 0

  const returns = notes
    .filter((note) => note.pitch === RETURN_HOME_PITCH && note.beat <= beat)
    .slice()
    .sort((a, b) => a.beat - b.beat)

  for (const note of returns) {
    const target = accumulatedAngles(notes, settings, note.beat)
    const elapsed = beat - note.beat
    const heldBeats = Math.max(0, note.durationBeats)
    const progress = easing.ease(clamp(Math.min(elapsed, heldBeats) / returnBeats, 0, 1))
    // Unwind a multi-turn swing the SHORT way, on both axes: 350° banked comes
    // home as -10°, not as most of a lap back. The 360° that disappears is
    // invisible - only sin/cos of the angle is ever used.
    erasedAzimuth = target.azimuth - shortestAngle(target.azimuth - erasedAzimuth) * (1 - progress)
    erasedElevation = target.elevation - shortestAngle(target.elevation - erasedElevation) * (1 - progress)
  }

  const accumulated = accumulatedAngles(notes, settings, beat)
  return {
    azimuth: settings.azimuth + accumulated.azimuth - erasedAzimuth,
    elevation: restingElevation(settings) + accumulated.elevation - erasedElevation,
  }
}

/** The unit direction from the center to the rig, in the canonical frame:
 *  pole +Y, angle 0 at +Z. Everything world-facing goes through `toWorld`. */
function canonicalDirection(azimuth: number, elevation: number): Vector3 {
  const horizontal = Math.cos(elevation)
  return [Math.sin(azimuth) * horizontal, Math.sin(elevation), Math.cos(azimuth) * horizontal]
}

/**
 * Where the rig stands for a given pose.
 *
 * The whole pose - position and orientation both - is the canonical pose turned
 * into the preset's frame, which is what makes sweeping the angle a RIGID
 * rotation about the chosen axis. That rigidity is the property the Face-on shot
 * is asking for: the component along the axis is untouched by the angle, so the
 * standoff holds for the entire lap and the travel stays parallel to the plane,
 * while the frame rolls with the rig.
 *
 * Turntable's frame is the canonical one, so it comes out byte-identical to the
 * plain spherical formula this generalises.
 */
export function orbitCameraPosition(
  settings: CameraOrbitSettings,
  azimuthDegrees: number,
  elevationDegrees: number,
): [number, number, number] {
  const frame = resolveOrbitAxis(settings)
  const distance = orbitDistance(settings)
  const direction = toWorld(frame, canonicalDirection(azimuthDegrees * DEG, elevationDegrees * DEG))
  return [
    settings.centerX + direction[0] * distance,
    settings.centerY + direction[1] * distance,
    settings.centerZ + direction[2] * distance,
  ]
}

/**
 * The rig's OWN up vector: the direction it would move if elevation kept rising,
 * carried into the preset's frame alongside the position.
 *
 * This is what lets an orbit run forever. World +Y works only while the rig
 * stays off the poles - dead on the axis it IS the view direction, `lookAt` has
 * no roll left to choose, and the picture snaps around. The elevation tangent is
 * perpendicular to the view direction by construction (it is the derivative of a
 * unit-length position), so there is no pole to avoid: crossing over rolls the
 * camera smoothly through and out the far side upside down, which is exactly
 * what a continuous lap looks like. It is also why parking at radius 0 - dead on
 * the axis, face-on - is a legal pose rather than a singularity.
 *
 * Unit length, and independent of standoff and radius: only the angles matter.
 */
export function orbitCameraUp(
  settings: CameraOrbitSettings,
  azimuthDegrees: number,
  elevationDegrees: number,
): [number, number, number] {
  const azimuth = azimuthDegrees * DEG
  const elevation = elevationDegrees * DEG
  return toWorld(resolveOrbitAxis(settings), [
    -Math.sin(azimuth) * Math.sin(elevation),
    Math.cos(elevation),
    -Math.cos(azimuth) * Math.sin(elevation),
  ])
}
