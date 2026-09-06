import assert from 'node:assert/strict'
import test from 'node:test'
import { midiVelocity } from './midiVelocity'

test('velocity 1 is full normalized strength; byte velocities use the MIDI scale', () => {
  for (const value of [0, 0.25, 0.5, 1]) assert.equal(midiVelocity(value), value)
  assert.equal(midiVelocity(64), 64 / 127)
  assert.equal(midiVelocity(127), 1)
})

test('velocity conversion leaves range enforcement to each instrument', () => {
  assert.equal(midiVelocity(-0.5), -0.5)
  assert.equal(midiVelocity(254), 2)
  assert.ok(Number.isNaN(midiVelocity(NaN)))
})
