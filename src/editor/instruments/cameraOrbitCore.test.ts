import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CAMERA_ORBIT_ROWS,
  ELEVATION_LIMIT,
  RETURN_HOME_PITCH,
  evaluateOrbitAngles,
  orbitCameraPosition,
  type CameraOrbitSettings,
  type OrbitNote,
} from './cameraOrbitCore'

const SETTINGS: CameraOrbitSettings = {
  centerX: 0,
  centerY: 0,
  centerZ: 0,
  distance: 5,
  azimuth: 0,
  elevation: 0,
  swingSpeed: 90,
  tiltSpeed: 45,
  returnBeats: 1,
  returnEase: 2, // Linear, so the tests assert the schedule and not the curve.
  fov: 55,
}

function note(pitch: number, beat: number, durationBeats: number, velocity = 1): OrbitNote {
  return { pitch, beat, durationBeats, velocity }
}

const ORBIT_RIGHT = 62
const ORBIT_LEFT = 61
const ORBIT_UP = 64

const near = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≉ ${expected}`)

test('with no notes the rig sits at the resting angles', () => {
  const pose = evaluateOrbitAngles([], { ...SETTINGS, azimuth: 30, elevation: -12 }, 8)
  near(pose.azimuth, 30)
  near(pose.elevation, -12)
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

test('returning goes home to the RESTING angle, not to zero', () => {
  const settings = { ...SETTINGS, azimuth: 40, elevation: 20 }
  const notes = [note(ORBIT_RIGHT, 0, 1), note(RETURN_HOME_PITCH, 2, 4)]
  near(evaluateOrbitAngles(notes, settings, 3).azimuth, 40)
  near(evaluateOrbitAngles(notes, settings, 3).elevation, 20)
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

test('elevation parks at the limit instead of banking degrees to unwind', () => {
  const notes = [note(ORBIT_UP, 0, 16)]
  near(evaluateOrbitAngles(notes, SETTINGS, 16).elevation, ELEVATION_LIMIT)
  // Coming home from the pole takes one full Return, not the whole overshoot.
  const withReturn = [...notes, note(RETURN_HOME_PITCH, 16, 4)]
  near(evaluateOrbitAngles(withReturn, SETTINGS, 17).elevation, 0)
})

test('the rig keeps its distance from the center at every angle', () => {
  const settings = { ...SETTINGS, centerX: 2, centerY: -1, centerZ: 3, distance: 7 }
  for (const azimuth of [-180, -37, 0, 90, 179]) {
    for (const elevation of [-89, -45, 0, 12, 89]) {
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

test('an overhead shot is clamped a degree short of the pole, never straight down', () => {
  // Straight down would put the rig on its own up axis, where lookAt has no roll
  // left to choose and the frame flips.
  const [x, y, z] = orbitCameraPosition(SETTINGS, 0, 90)
  near(y, 5 * Math.sin(ELEVATION_LIMIT * (Math.PI / 180)), 1e-9)
  assert.ok(Math.hypot(x, z) > 0.05, 'never exactly overhead')
})

test('the row vocabulary is five rows in descending pitch order', () => {
  assert.equal(CAMERA_ORBIT_ROWS.length, 5)
  const pitches = CAMERA_ORBIT_ROWS.map((row) => row.pitch)
  assert.deepEqual(pitches, [...pitches].sort((a, b) => b - a))
  assert.ok(pitches.includes(RETURN_HOME_PITCH))
})
