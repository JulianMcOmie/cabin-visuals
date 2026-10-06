import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResolvedNote } from '../core/visual/types'
import {
  DUST_PITCH_X, DUST_PITCH_Y, DUST_PITCH_Z, DUST_CHORD_WINDOW_BEATS,
  buildDustDirections, collectDustSpheres, dustPitchAxis,
} from './dustSphereCore'

function note(beat: number, pitch: number, velocity = 1, durationBeats = 1): ResolvedNote {
  return { beat, pitch, durationBeats, velocity, blockStartBeat: 0, blockEndBeat: 64 }
}

const positions = (beat: number, notes: ResolvedNote[], life = 8, max = 8) =>
  collectDustSpheres({ beat, notes }, life, max).map((s) => [s.x, s.y, s.z])

test('the shipped pitch bands are frozen', () => {
  // Projects store the pitch: moving a band re-places every saved sphere.
  assert.deepEqual([DUST_PITCH_Z, DUST_PITCH_Y, DUST_PITCH_X], [60, 65, 70])
  assert.deepEqual(dustPitchAxis(70), { axis: 0, step: -2 })
  assert.deepEqual(dustPitchAxis(72), { axis: 0, step: 0 })
  assert.deepEqual(dustPitchAxis(74), { axis: 0, step: 2 })
  assert.deepEqual(dustPitchAxis(65), { axis: 1, step: -2 })
  assert.deepEqual(dustPitchAxis(64), { axis: 2, step: 2 })
  assert.equal(dustPitchAxis(59), null)
  assert.equal(dustPitchAxis(75), null)
})

test('a lone note names one coordinate and leaves the others at the centre', () => {
  assert.deepEqual(positions(0, [note(0, DUST_PITCH_X + 4)]), [[2, 0, 0]])
  assert.deepEqual(positions(0, [note(0, DUST_PITCH_Y)]), [[0, -2, 0]])
  assert.deepEqual(positions(0, [note(0, DUST_PITCH_Z + 3)]), [[0, 0, 1]])
})

test('axes that start together are one sphere at the combined position', () => {
  const chord = [note(0, DUST_PITCH_Z + 4), note(0, DUST_PITCH_Y + 3), note(0, DUST_PITCH_X)]
  assert.deepEqual(positions(0.5, chord), [[-2, 1, 2]])
})

test('held is not together: a later note under a long one is its own sphere', () => {
  const notes = [note(0, DUST_PITCH_Y + 4, 1, 8), note(1, DUST_PITCH_X + 4)]
  assert.deepEqual(positions(1.5, notes), [[0, 2, 0], [2, 0, 0]])
})

test('a flammed chord has the same position at every playhead inside the window', () => {
  const late = DUST_CHORD_WINDOW_BEATS * 0.8
  const notes = [note(4, DUST_PITCH_X + 4), note(4 + late, DUST_PITCH_Y + 4)]
  // Playhead between the two onsets: the second note is still in the future.
  assert.deepEqual(positions(4 + late / 2, notes), [[2, 2, 0]])
  assert.deepEqual(positions(5, notes), [[2, 2, 0]])
  // And the sphere's clock is the chord's first note either way.
  assert.equal(collectDustSpheres({ beat: 5, notes }, 8, 8)[0].beat, 4)
})

test('two notes of one axis in a chord spawn the cross product', () => {
  const notes = [note(0, DUST_PITCH_Y + 4), note(0, DUST_PITCH_X), note(0, DUST_PITCH_X + 4)]
  assert.deepEqual(positions(0, notes), [[-2, 2, 0], [2, 2, 0]])
})

test('spheres exist only between their onset and the end of their life', () => {
  const notes = [note(2, DUST_PITCH_X + 2)]
  assert.equal(positions(1.99, notes, 4).length, 0)
  assert.equal(positions(2, notes, 4).length, 1)
  assert.equal(positions(5.99, notes, 4).length, 1)
  assert.equal(positions(6, notes, 4).length, 0)
})

test('past the cap the oldest spheres go, and the loudest note sets the velocity', () => {
  const notes = [0, 1, 2, 3].map((b) => note(b, DUST_PITCH_X + b))
  assert.deepEqual(positions(3.5, notes, 100, 2), [[0, 0, 0], [1, 0, 0]])
  const chord = [note(0, DUST_PITCH_X, 0.3), note(0, DUST_PITCH_Y, 0.9)]
  assert.equal(collectDustSpheres({ beat: 0, notes: chord }, 8, 8)[0].velocity, 0.9)
})

test('any prefix of the grain directions is unit-length and covers the whole ball', () => {
  const dirs = buildDustDirections(4000)
  const sum = [0, 0, 0]
  // The first quarter alone - what a reduced preview budget draws.
  for (let i = 0; i < 1000; i++) {
    const [x, y, z] = [dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]]
    assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-5)
    sum[0] += x; sum[1] += y; sum[2] += z
  }
  // A polar cap would have a mean far from the centre.
  for (const s of sum) assert.ok(Math.abs(s / 1000) < 0.08)
  assert.deepEqual(Array.from(buildDustDirections(8).slice(0, 6)), Array.from(dirs.slice(0, 6)))
})
