import test from 'node:test'
import assert from 'node:assert/strict'
import { tapTempoBpm } from './tapTempo'

test('needs two taps', () => {
  assert.equal(tapTempoBpm([]), null)
  assert.equal(tapTempoBpm([100]), null)
})

test('500ms intervals = 120 BPM', () => {
  assert.equal(tapTempoBpm([0, 500, 1000, 1500]), 120)
  assert.equal(tapTempoBpm([0, 500]), 120)
})

test('identical timestamps are ignored', () => {
  assert.equal(tapTempoBpm([5, 5]), null)
})

test('a sloppy first tap moves the fit less than the endpoint estimate', () => {
  // Steady 120 except the first tap landed 80ms early.
  const taps = [-80, 500, 1000, 1500, 2000, 2500, 3000, 3500]
  const endpoint = (60000 * (taps.length - 1)) / (taps[taps.length - 1] - taps[0])
  const fit = tapTempoBpm(taps)!
  assert.ok(Math.abs(fit - 120) < Math.abs(endpoint - 120))
  assert.ok(Math.abs(fit - 120) < 2)
})
