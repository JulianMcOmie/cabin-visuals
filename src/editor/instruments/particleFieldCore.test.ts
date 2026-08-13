import test from 'node:test'
import assert from 'node:assert/strict'
import { fieldPositions, fieldTimeline, recruitNearest } from './particleFieldCore'

test('fieldPositions is deterministic and spans the slab', () => {
  const a = fieldPositions(2000, 10, 6, 1.5)
  const b = fieldPositions(2000, 10, 6, 1.5)
  assert.deepEqual(a, b) // pure function of its inputs - scrub equals playback

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxZ = 0
  for (let i = 0; i < 2000; i++) {
    minX = Math.min(minX, a[i * 3]); maxX = Math.max(maxX, a[i * 3])
    minY = Math.min(minY, a[i * 3 + 1]); maxY = Math.max(maxY, a[i * 3 + 1])
    maxZ = Math.max(maxZ, Math.abs(a[i * 3 + 2]))
  }
  assert.ok(minX >= -5 && maxX <= 5 && minY >= -3 && maxY <= 3 && maxZ <= 0.75)
  // Actually fills the area rather than clumping: both halves of each axis hit.
  assert.ok(minX < -3 && maxX > 3 && minY < -1.8 && maxY > 1.8)
})

test('recruitNearest returns the k nearest particles, nearest first', () => {
  // Four particles on a line at x = 0, 1, 2, 3.
  const ambient = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0])
  const picked = recruitNearest(ambient, 4, 2, 2.1, 0)
  assert.deepEqual([...picked], [2, 3]) // x=2 is nearest to 2.1, then x=3
  // k clamps to the population.
  assert.equal(recruitNearest(ambient, 4, 99, 0, 0).length, 4)
})

test('fieldTimeline forms on the onset and dissolves at note-off', () => {
  const onsets = [{ beat: 4, endBeat: 6 }]
  assert.equal(fieldTimeline(onsets, 3.9, 1, 1, false).curIndex, -1) // not yet

  const mid = fieldTimeline(onsets, 4.5, 1, 1, false)
  assert.equal(mid.curIndex, 0)
  assert.ok(Math.abs(mid.curProgress - 0.5) < 1e-9)
  assert.equal(mid.curRelease, 0) // still held

  const after = fieldTimeline(onsets, 6.5, 1, 1, false)
  assert.ok(Math.abs(after.curRelease - 0.5) < 1e-9) // half dissolved

  // Sustain ignores note-off entirely: still fully formed long after.
  const held = fieldTimeline(onsets, 20, 1, 1, true)
  assert.equal(held.curRelease, 0)
})

test('fieldTimeline hands the previous text off at the next onset', () => {
  const onsets = [
    { beat: 0, endBeat: 10 }, // still sounding when the next one lands
    { beat: 8, endBeat: 12 },
  ]
  const t = fieldTimeline(onsets, 8.4, 1, 0.8, true)
  assert.equal(t.curIndex, 1)
  assert.ok(Math.abs(t.curProgress - 0.4) < 1e-9)
  assert.equal(t.prevIndex, 0)
  assert.ok(Math.abs(t.prevRelease - 0.5) < 1e-9) // dissolving since beat 8

  // Fully home -> dropped from tracking.
  assert.equal(fieldTimeline(onsets, 9.5, 1, 0.8, true).prevIndex, -1)
})
