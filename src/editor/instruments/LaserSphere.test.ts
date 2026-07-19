import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateCoreAppearance } from './laserSphereCore'

test('the default white-hot setting preserves the original core and flare mix', () => {
  assert.deepEqual(evaluateCoreAppearance(1, 5.5, 0), { intensity: 5.5, whiteMix: 0.13 })
  assert.deepEqual(evaluateCoreAppearance(1, 5.5, 1), { intensity: 14.575, whiteMix: 0.23 })
})

test('zero white-hot core stays fully colored even during a MIDI flare', () => {
  assert.deepEqual(evaluateCoreAppearance(0, 5.5, 0), { intensity: 0.9, whiteMix: 0 })
  assert.deepEqual(evaluateCoreAppearance(0, 5.5, 1), { intensity: 0.9, whiteMix: 0 })
})

test('white-hot core inputs clamp to a safe color interpolation range', () => {
  assert.deepEqual(evaluateCoreAppearance(-1, 5.5, 0.5), { intensity: 0.9, whiteMix: 0 })
  assert.deepEqual(evaluateCoreAppearance(2, 2, 1), { intensity: 5.3, whiteMix: 0.23 })
})
