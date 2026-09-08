import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isBlackKey, whiteIndex, whiteKeyRange, keyLayout, keyCenterX, keyNoteWidth,
  fitRange, wispPose, plumeEnvelope, rand01,
} from './glassRollCore'

test('an 88-key range has 52 white keys and even white spacing', () => {
  const layout = keyLayout(21, 108, 1040)
  assert.equal(layout.lowKey, 21)
  assert.equal(layout.highKey, 108)
  assert.equal(layout.whiteCount, 52)
  assert.equal(layout.whiteW, 20)
  // A0 is the first white key: centered in its slot.
  assert.equal(keyCenterX(layout, 21), 10)
  // C8 is the last.
  assert.equal(keyCenterX(layout, 108), 1040 - 10)
})

test('black keys straddle white boundaries and are narrower', () => {
  const layout = keyLayout(60, 72, 80) // C4..C5, 8 white keys of 10px
  assert.equal(layout.whiteCount, 8)
  assert.ok(isBlackKey(61) && !isBlackKey(60))
  // C#4 sits on the C/D boundary (10px), leaning left.
  const cs = keyCenterX(layout, 61)
  assert.ok(cs > 8 && cs < 10, `C# at ${cs}`)
  // G#4 is centered on the G/A boundary (50px).
  assert.equal(keyCenterX(layout, 68), 50)
  assert.equal(keyNoteWidth(layout, 61), layout.whiteW * 0.64)
  assert.equal(keyNoteWidth(layout, 62), layout.whiteW)
  assert.ok(layout.blackW < layout.whiteW)
})

test('ranges snap outward to white keys', () => {
  assert.deepEqual(whiteKeyRange(61, 70), [60, 71])
  assert.deepEqual(whiteKeyRange(64, 64), [64, 64])
  assert.equal(whiteIndex(12) - whiteIndex(0), 7)
})

test('fitRange pads to at least two octaves on white keys', () => {
  const [lo, hi] = fitRange(64, 67)
  assert.ok(!isBlackKey(lo) && !isBlackKey(hi))
  assert.ok(hi - lo >= 24)
  assert.ok(lo < 64 && hi > 67)
  assert.deepEqual(fitRange(Infinity, -Infinity), [48, 72])
})

test('wisp poses are pure in age and rise monotonically early on', () => {
  const p = { rise: 120, spread: 30, curl: 20, life: 2 }
  const out = { x: 0, y: 0, t: 0 }
  const a = { ...wispPose(3.3, 0.5, { x: 100, y: 500 }, p, out) }
  const b = { ...wispPose(3.3, 0.5, { x: 100, y: 500 }, p, out) }
  assert.deepEqual(a, b)
  const y0 = wispPose(3.3, 0, { x: 100, y: 500 }, p, out).y
  const y1 = wispPose(3.3, 0.4, { x: 100, y: 500 }, p, out).y
  const y2 = wispPose(3.3, 0.8, { x: 100, y: 500 }, p, out).y
  assert.equal(y0, 500)
  assert.ok(y1 < y0 && y2 < y1)
})

test('the plume envelope is zero outside life and peaks early', () => {
  assert.equal(plumeEnvelope(0), 0)
  assert.equal(plumeEnvelope(1), 0)
  assert.ok(plumeEnvelope(0.1) > plumeEnvelope(0.6))
  assert.ok(rand01(1) >= 0 && rand01(1) < 1)
})
