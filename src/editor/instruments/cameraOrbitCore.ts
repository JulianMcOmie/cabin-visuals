// The pure half of the Camera Orbit instrument: where the rig stands, given its
// settings, its note stream and the beat. Split out of the .tsx because a test
// that imports the component crashes on the instruments/index.ts ⟷
// instrumentFrame cycle - see the directory guide.
//
// The rig is described the way a camera operator thinks about it - a point to
// look at, how far back to stand, and two angles - rather than as a position and
// a rotation. That is the whole reason this instrument exists next to Camera:
// with an aim point and two angles, "still looking at the center" is not
// something the user has to maintain, it is the only thing the parameterisation
// can express. Height, swing and tilt cannot break the aim because the aim is
// not stored anywhere to be broken.

import type { MidiRowDef } from './types'

const DEG = Math.PI / 180

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/**
 * Elevation never reaches the poles. At exactly ±90° the camera sits on its own
 * up axis, `lookAt` has no way left to choose a roll, and the frame flips over.
 * Parking a degree short keeps "always aimed at the center" true at every
 * height, which is the promise of the whole instrument.
 */
export const ELEVATION_LIMIT = 89

export interface CameraOrbitSettings {
  /** The point orbited AND looked at. Defaults to the origin, where an
   *  untransformed object is placed. */
  centerX: number
  centerY: number
  centerZ: number
  /** How far back the rig stands from the center, in world units. */
  distance: number
  /** Resting angles - where the rig sits with no notes playing. Azimuth 0 with
   *  elevation 0 and distance 5 reproduces the scene's default camera exactly. */
  azimuth: number
  elevation: number
  /** Degrees per beat a held note travels, before velocity scaling. */
  swingSpeed: number
  tiltSpeed: number
  /** How long a held Return home note takes to bring the rig back. */
  returnBeats: number
  returnEase: number
  fov: number
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

/** MIDI velocity as 0..1, tolerating both the 0..1 and 0..127 conventions the
 *  rest of the engine accepts. */
function normalizedVelocity(velocity: number): number {
  return velocity <= 1 ? velocity : velocity / 127
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
 * Elevation is clamped HERE rather than at the end so that over-holding an
 * Orbit up note parks the rig at the top instead of banking invisible degrees
 * that a later Return would have to unwind through.
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
    const travel = direction.sign * heldBeats * normalizedVelocity(note.velocity)
    if (direction.axis === 'azimuth') azimuth += travel * settings.swingSpeed
    else elevation += travel * settings.tiltSpeed
  }
  const restingElevation = settings.elevation
  return {
    azimuth,
    elevation: clamp(restingElevation + elevation, -ELEVATION_LIMIT, ELEVATION_LIMIT) - restingElevation,
  }
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
    // Unwind a multi-turn swing the SHORT way: 350° banked comes home as -10°,
    // not as most of a lap back. The 360° that disappears is invisible - only
    // sin/cos of the angle is ever used.
    erasedAzimuth = target.azimuth - shortestAngle(target.azimuth - erasedAzimuth) * (1 - progress)
    erasedElevation = target.elevation - (target.elevation - erasedElevation) * (1 - progress)
  }

  const accumulated = accumulatedAngles(notes, settings, beat)
  return {
    azimuth: settings.azimuth + accumulated.azimuth - erasedAzimuth,
    elevation: clamp(
      settings.elevation + accumulated.elevation - erasedElevation,
      -ELEVATION_LIMIT,
      ELEVATION_LIMIT,
    ),
  }
}

/**
 * Where the rig stands for a given pose. Azimuth 0 / elevation 0 puts it on +Z
 * looking down -Z, so the defaults (center at the origin, distance 5) reproduce
 * the scene's own default camera and adding the instrument changes nothing until
 * a knob moves.
 */
export function orbitCameraPosition(
  settings: CameraOrbitSettings,
  azimuthDegrees: number,
  elevationDegrees: number,
): [number, number, number] {
  const azimuth = azimuthDegrees * DEG
  const elevation = clamp(elevationDegrees, -ELEVATION_LIMIT, ELEVATION_LIMIT) * DEG
  const radius = Math.max(0.01, settings.distance)
  const horizontal = Math.cos(elevation) * radius
  return [
    settings.centerX + Math.sin(azimuth) * horizontal,
    settings.centerY + Math.sin(elevation) * radius,
    settings.centerZ + Math.cos(azimuth) * horizontal,
  ]
}
