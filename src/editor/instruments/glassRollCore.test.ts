import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isBlackKey, whiteIndex, whiteKeyRange, keyLayout, keyCenterX, keyNoteWidth,
  fitRange, motePose, moteEnvelope, streakPose, rand01,
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

test('mote poses are pure in age, kick up fast, then drift', () => {
  const p = { rise: 120, spread: 30, curl: 20, life: 2 }
  const out = { x: 0, y: 0, t: 0 }
  const a = { ...motePose(3.3, 0.5, { x: 100, y: 500 }, p, out) }
  const b = { ...motePose(3.3, 0.5, { x: 100, y: 500 }, p, out) }
  assert.deepEqual(a, b)
  const y0 = motePose(3.3, 0, { x: 100, y: 500 }, p, out).y
  const y1 = motePose(3.3, 0.3, { x: 100, y: 500 }, p, out).y
  const y2 = motePose(3.3, 0.6, { x: 100, y: 500 }, p, out).y
  const y3 = motePose(3.3, 1.6, { x: 100, y: 500 }, p, out).y
  assert.equal(y0, 500)
  assert.ok(y1 < y0 && y2 < y1 && y3 < y2)
  // The kick decays: the first 0.3 s climbs more than the next 0.3 s.
  assert.ok(y0 - y1 > y1 - y2)
  const s = streakPose(1.1, 0.3, { x: 0, y: 0 }, 200, out)
  assert.ok(s.y < 0 && s.t > 0)
})

test('the mote envelope is zero outside life, holds, then fades', () => {
  assert.equal(moteEnvelope(0), 0)
  assert.equal(moteEnvelope(1), 0)
  assert.equal(moteEnvelope(0.2), 1)
  assert.ok(moteEnvelope(0.5) > moteEnvelope(0.9))
  assert.ok(rand01(1) >= 0 && rand01(1) < 1)
})
