import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CAMERA_ORBIT_ROWS,
  ORBIT_AXES,
  RETURN_HOME_PITCH,
  evaluateOrbitAngles,
  orbitCameraPosition,
  orbitCameraUp,
  restingElevation,
  type CameraOrbitSettings,
  type OrbitNote,
} from './cameraOrbitCore'

const FACE_ON = ORBIT_AXES.findIndex((axis) => axis.key === 'faceOn')
const TURNTABLE = ORBIT_AXES.findIndex((axis) => axis.key === 'turntable')

/** Turntable at radius 5, on the plane: the scene's stock camera at [0, 0, 5]. */
const SETTINGS: CameraOrbitSettings = {
  centerX: 0,
  centerY: 0,
  centerZ: 0,
  orbitAxis: TURNTABLE,
  standoff: 0,
  radius: 5,
  azimuth: 0,
  swingSpeed: 90,
  tiltSpeed: 45,
  returnBeats: 1,
  returnEase: 2, // Linear, so the tests assert the schedule and not the curve.
  fov: 55,
}

/** The same rig, parked dead on the face-on axis 5 in front of an XY-plane
 *  billboard - the pose the Face-on preset exists for. */
const FACE_ON_SETTINGS: CameraOrbitSettings = {
  ...SETTINGS,
  orbitAxis: FACE_ON,
  standoff: 5,
  radius: 0,
}

function note(pitch: number, beat: number, durationBeats: number, velocity = 1): OrbitNote {
  return { pitch, beat, durationBeats, velocity }
}

const ORBIT_RIGHT = 62
const ORBIT_LEFT = 61
const ORBIT_UP = 64

const near = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≉ ${expected}`)

test('with no notes the rig sits at the resting pose', () => {
  const pose = evaluateOrbitAngles([], { ...SETTINGS, azimuth: 30, standoff: 5, radius: 5 }, 8)
  near(pose.azimuth, 30)
  // standoff == radius is 45° off the ring.
  near(pose.elevation, 45)
})

test('standoff and radius are the two the operator sets; distance follows', () => {
  near(restingElevation(SETTINGS), 0, 1e-12)
  near(restingElevation(FACE_ON_SETTINGS), 90, 1e-12)
  near(restingElevation({ ...SETTINGS, standoff: 3, radius: 3 }), 45, 1e-12)
})

test('the defaults reproduce the scene camera at [0, 0, 5]', () => {
  const [x, y, z] = orbitCameraPosition(SETTINGS, 0, 0)
  near(x, 0)
  near(y, 0)
  near(z, 5)
})

test('a held note orbits at Speed °/beat and stays where it was released', () => {
  const notes = [note(ORBIT_RIGHT, 0, 2)]
  near(evaluateOrbitAngles(notes, SETTINGS, 1).azimuth, 90)
  near(evaluateOrbitAngles(notes, SETTINGS, 2).azimuth, 180)
  // Released at beat 2: the swing stops there rather than drifting on.
  near(evaluateOrbitAngles(notes, SETTINGS, 6).azimuth, 180)
})

test('velocity scales how fast a held note travels', () => {
  const soft = [note(ORBIT_RIGHT, 0, 4, 0.25)]
  near(evaluateOrbitAngles(soft, SETTINGS, 1).azimuth, 22.5)
})

test('two rows held together sweep both axes at once', () => {
  const chord = [note(ORBIT_RIGHT, 0, 1), note(ORBIT_UP, 0, 1)]
  const pose = evaluateOrbitAngles(chord, SETTINGS, 1)
  near(pose.azimuth, 90)
  near(pose.elevation, 45)
})

test('opposite rows cancel, so a left note walks a right swing back', () => {
  const notes = [note(ORBIT_RIGHT, 0, 1), note(ORBIT_LEFT, 2, 1)]
  near(evaluateOrbitAngles(notes, SETTINGS, 4).azimuth, 0)
})

test('a held Return home note eases back to the resting angles over Return beats', () => {
  const notes = [note(ORBIT_RIGHT, 0, 1), note(RETURN_HOME_PITCH, 2, 4)]
  near(evaluateOrbitAngles(notes, SETTINGS, 2).azimuth, 90)
  near(evaluateOrbitAngles(notes, SETTINGS, 2.5).azimuth, 45)
  near(evaluateOrbitAngles(notes, SETTINGS, 3).azimuth, 0)
  near(evaluateOrbitAngles(notes, SETTINGS, 8).azimuth, 0)
})

test('returning goes home to the RESTING pose, not to zero', () => {
  // A raised turntable: standoff 3 over radius 4 rests at 36.87° off the ring.
  const settings = { ...SETTINGS, azimuth: 40, standoff: 3, radius: 4 }
  const notes = [note(ORBIT_RIGHT, 0, 1), note(ORBIT_UP, 0, 1), note(RETURN_HOME_PITCH, 2, 4)]
  near(evaluateOrbitAngles(notes, settings, 3).azimuth, 40)
  near(evaluateOrbitAngles(notes, settings, 3).elevation, restingElevation(settings))
  near(restingElevation(settings), (Math.atan2(3, 4) * 180) / Math.PI, 1e-12)
})

test('letting the Return row go early stops the rig partway home', () => {
  // Held for half of Return beats, so it only makes it halfway and stays there.
  const notes = [note(ORBIT_RIGHT, 0, 1), note(RETURN_HOME_PITCH, 2, 0.5)]
  near(evaluateOrbitAngles(notes, SETTINGS, 2.5).azimuth, 45)
  near(evaluateOrbitAngles(notes, SETTINGS, 9).azimuth, 45)
})

test('a note played during a return still moves the rig', () => {
  const notes = [note(RETURN_HOME_PITCH, 0, 4), note(ORBIT_RIGHT, 1, 1)]
  // The return has nothing banked to erase, so the new swing shows in full.
  near(evaluateOrbitAngles(notes, SETTINGS, 2).azimuth, 90)
})

test('a multi-turn swing comes home the short way round', () => {
  // 350° banked: unwinding should travel -10°, i.e. straight past 360.
  const notes = [note(ORBIT_RIGHT, 0, 350 / 90), note(RETURN_HOME_PITCH, 8, 4)]
  const halfway = evaluateOrbitAngles(notes, SETTINGS, 8.5).azimuth
  // Half of a -10° trip from 350° lands at 355°, which is 360 - 5 modulo a turn.
  near(((halfway % 360) + 360) % 360, 355, 1e-6)
})

test('a held note keeps turning past a full lap, on both axes', () => {
  // 8 beats at 90°/beat is two complete horizontal turns, and the vertical axis
  // is no different - it runs through the poles and keeps going.
  near(evaluateOrbitAngles([note(ORBIT_RIGHT, 0, 8)], SETTINGS, 8).azimuth, 720)
  near(evaluateOrbitAngles([note(ORBIT_UP, 0, 16)], SETTINGS, 16).elevation, 720)
})

test('the vertical orbit passes through overhead without stalling there', () => {
  const notes = [note(ORBIT_UP, 0, 8)]
  // 45°/beat: overhead at beat 2, and still climbing at 3 and 4.
  near(evaluateOrbitAngles(notes, SETTINGS, 2).elevation, 90)
  near(evaluateOrbitAngles(notes, SETTINGS, 3).elevation, 135)
  near(evaluateOrbitAngles(notes, SETTINGS, 4).elevation, 180)
})

test('a vertical lap comes home the short way too', () => {
  // 350° of climb banked, then a return: it should unwind -10°, not most of a lap.
  const notes = [note(ORBIT_UP, 0, 350 / 45), note(RETURN_HOME_PITCH, 10, 4)]
  const halfway = evaluateOrbitAngles(notes, SETTINGS, 10.5).elevation
  near(((halfway % 360) + 360) % 360, 355, 1e-6)
  near(evaluateOrbitAngles(notes, SETTINGS, 11).elevation % 360, 0, 1e-6)
})

test('the rig keeps its distance from the center at every angle', () => {
  const settings = { ...SETTINGS, centerX: 2, centerY: -1, centerZ: 3, standoff: 0, radius: 7 }
  for (const azimuth of [-180, -37, 0, 90, 179]) {
    for (const elevation of [-270, -90, -45, 0, 12, 90, 180, 450]) {
      const [x, y, z] = orbitCameraPosition(settings, azimuth, elevation)
      const radius = Math.hypot(x - settings.centerX, y - settings.centerY, z - settings.centerZ)
      near(radius, 7, 1e-9)
    }
  }
})

test('positive elevation lifts the rig and positive azimuth swings it to +X', () => {
  near(orbitCameraPosition(SETTINGS, 90, 0)[0], 5, 1e-9)
  assert.ok(orbitCameraPosition(SETTINGS, 0, 45)[1] > 3.5)
})

test('elevation 90 puts the rig exactly overhead, and 180 out the far side', () => {
  const overhead = orbitCameraPosition(SETTINGS, 0, 90)
  near(overhead[1], 5, 1e-9)
  near(Math.hypot(overhead[0], overhead[2]), 0, 1e-9)
  const over = orbitCameraPosition(SETTINGS, 0, 180)
  near(over[2], -5, 1e-9)
})

test('the up vector is unit length and perpendicular to the view, on every axis', () => {
  // The reason there is no pole to avoid: up can never collapse into the
  // direction the camera is looking, so lookAt always has a roll to choose.
  for (let orbitAxis = 0; orbitAxis < ORBIT_AXES.length; orbitAxis++) {
    const settings = { ...SETTINGS, orbitAxis, standoff: 0, radius: 1 }
    for (const azimuth of [-140, 0, 37, 90, 210]) {
      for (const elevation of [-180, -90, -20, 0, 45, 89, 90, 91, 180, 270, 400]) {
        const up = orbitCameraUp(settings, azimuth, elevation)
        const radial = orbitCameraPosition(settings, azimuth, elevation)
        near(Math.hypot(...up), 1, 1e-9)
        near(up[0] * radial[0] + up[1] * radial[1] + up[2] * radial[2], 0, 1e-9)
      }
    }
  }
})

test('crossing the axis rolls the camera through instead of flipping it', () => {
  // Just below the pole up is still nearly +Y; just above it has tipped past
  // level and keeps going, rather than snapping back the way a fixed +Y would.
  near(orbitCameraUp(SETTINGS, 0, 0)[1], 1, 1e-9)
  assert.ok(orbitCameraUp(SETTINGS, 0, 89)[1] > 0, 'still upright approaching the pole')
  near(orbitCameraUp(SETTINGS, 0, 90)[1], 0, 1e-9)
  assert.ok(orbitCameraUp(SETTINGS, 0, 91)[1] < 0, 'tipped past level just after it')
  near(orbitCameraUp(SETTINGS, 0, 180)[1], -1, 1e-9)
})

// ── The Face-on preset: the billboard shot ───────────────────────────────────

test('face-on at radius 0 is the stock camera, upright and dead in front', () => {
  const [x, y, z] = orbitCameraPosition(FACE_ON_SETTINGS, 0, restingElevation(FACE_ON_SETTINGS))
  near(x, 0, 1e-9)
  near(y, 0, 1e-9)
  near(z, 5, 1e-9)
  const up = orbitCameraUp(FACE_ON_SETTINGS, 0, restingElevation(FACE_ON_SETTINGS))
  near(up[0], 0, 1e-9)
  near(up[1], 1, 1e-9)
  near(up[2], 0, 1e-9)
})

test('face-on holds its standoff for the whole lap, travelling parallel to XY', () => {
  // THE property the preset exists for: a billboard in the XY plane stays the
  // same distance away all the way round, and the rig's path is a circle in a
  // plane parallel to it.
  const settings = { ...FACE_ON_SETTINGS, standoff: 4, radius: 3 }
  const elevation = restingElevation(settings)
  for (const azimuth of [0, 17, 90, 180, 271, 359, 720]) {
    const [x, y, z] = orbitCameraPosition(settings, azimuth, elevation)
    near(z, 4, 1e-9)
    near(Math.hypot(x, y), 3, 1e-9)
  }
})

test('face-on at radius 0 turns the lap into a pure roll about the subject', () => {
  const elevation = restingElevation(FACE_ON_SETTINGS)
  for (const azimuth of [0, 45, 90, 180]) {
    const [x, y, z] = orbitCameraPosition(FACE_ON_SETTINGS, azimuth, elevation)
    near(x, 0, 1e-9)
    near(y, 0, 1e-9)
    near(z, 5, 1e-9)
  }
  // The rig has not moved, but the frame has turned all the way over.
  near(orbitCameraUp(FACE_ON_SETTINGS, 180, elevation)[1], -1, 1e-9)
})

test('turntable holds its height for the whole lap, travelling parallel to XZ', () => {
  const settings = { ...SETTINGS, standoff: 2, radius: 6 }
  const elevation = restingElevation(settings)
  for (const azimuth of [0, 33, 90, 200, 359]) {
    const [x, y, z] = orbitCameraPosition(settings, azimuth, elevation)
    near(y, 2, 1e-9)
    near(Math.hypot(x, z), 6, 1e-9)
  }
})

test('turntable is the canonical frame, so the axis select cannot have moved it', () => {
  // The generalisation must be a strict superset: this preset has to reproduce
  // the plain spherical formula it replaced, exactly.
  for (const azimuth of [-90, 0, 40, 180]) {
    for (const elevation of [-60, 0, 25, 90]) {
      const distance = 5
      const expected = [
        Math.sin(azimuth * (Math.PI / 180)) * Math.cos(elevation * (Math.PI / 180)) * distance,
        Math.sin(elevation * (Math.PI / 180)) * distance,
        Math.cos(azimuth * (Math.PI / 180)) * Math.cos(elevation * (Math.PI / 180)) * distance,
      ]
      const actual = orbitCameraPosition(SETTINGS, azimuth, elevation)
      for (let i = 0; i < 3; i++) near(actual[i], expected[i], 1e-9)
    }
  }
})

test('every preset keeps the rig at its distance and names its plane', () => {
  for (let orbitAxis = 0; orbitAxis < ORBIT_AXES.length; orbitAxis++) {
    const settings = { ...SETTINGS, orbitAxis, standoff: 3, radius: 4, centerX: 1, centerY: -2, centerZ: 5 }
    assert.ok(ORBIT_AXES[orbitAxis].plane.length > 0)
    for (const azimuth of [0, 61, 145, 300]) {
      const [x, y, z] = orbitCameraPosition(settings, azimuth, restingElevation(settings))
      near(Math.hypot(x - 1, y + 2, z - 5), 5, 1e-9)
    }
  }
})

test('the row vocabulary is five rows in descending pitch order', () => {
  assert.equal(CAMERA_ORBIT_ROWS.length, 5)
  const pitches = CAMERA_ORBIT_ROWS.map((row) => row.pitch)
  assert.deepEqual(pitches, [...pitches].sort((a, b) => b - a))
  assert.ok(pitches.includes(RETURN_HOME_PITCH))
})
