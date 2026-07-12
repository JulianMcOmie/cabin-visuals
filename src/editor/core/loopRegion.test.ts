import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldLoopWrap, MIN_LOOP_LENGTH_BEATS } from './loopRegion'

test('no region means no wrap', () => {
  assert.equal(shouldLoopWrap(4, null), false)
})

test('wraps at and past the region end', () => {
  const r = { startBeat: 4, endBeat: 8, enabled: true }
  assert.equal(shouldLoopWrap(8, r), true)
  assert.equal(shouldLoopWrap(8.01, r), true)
  assert.equal(shouldLoopWrap(100, r), true)
})

test('before or inside the region means no wrap', () => {
  const r = { startBeat: 4, endBeat: 8, enabled: true }
  assert.equal(shouldLoopWrap(0, r), false)
  assert.equal(shouldLoopWrap(4, r), false)
  assert.equal(shouldLoopWrap(7.99, r), false)
})

test('degenerate regions are inert', () => {
  assert.equal(shouldLoopWrap(10, { startBeat: 4, endBeat: 4, enabled: true }), false)
  assert.equal(shouldLoopWrap(10, { startBeat: 4, endBeat: 4 + MIN_LOOP_LENGTH_BEATS / 2, enabled: true }), false)
  assert.equal(shouldLoopWrap(10, { startBeat: 8, endBeat: 4, enabled: true }), false)
})

test('minimum-length region wraps', () => {
  const r = { startBeat: 4, endBeat: 4 + MIN_LOOP_LENGTH_BEATS, enabled: true }
  assert.equal(shouldLoopWrap(4 + MIN_LOOP_LENGTH_BEATS, r), true)
})

test('disabled region preserves its range without wrapping', () => {
  assert.equal(shouldLoopWrap(8, { startBeat: 4, endBeat: 8, enabled: false }), false)
})
