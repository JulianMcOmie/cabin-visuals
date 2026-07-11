import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateAdsrGain, type AdsrGate } from './adsr'
import type { AdsrEnvelope } from '../../types'

const ADSR: AdsrEnvelope = { attackBeats: 1, decayBeats: 1, sustainLevel: 0.5, releaseBeats: 1 }

function gate(beat: number, durationBeats: number, velocity = 1): AdsrGate {
  return { beat, durationBeats, velocity }
}

function close(actual: number, expected: number, msg?: string) {
  assert.ok(Math.abs(actual - expected) < 1e-9, msg ?? `expected ${expected}, got ${actual}`)
}

test('adsr: zero before the gate and at onset', () => {
  const notes = [gate(2, 4)]
  assert.equal(evaluateAdsrGain(notes, 0, ADSR), 0)
  assert.equal(evaluateAdsrGain(notes, 1.999, ADSR), 0)
  close(evaluateAdsrGain(notes, 2, ADSR), 0)
})

test('adsr: attack ramps linearly to the peak', () => {
  const notes = [gate(0, 8)]
  close(evaluateAdsrGain(notes, 0.25, ADSR), 0.25)
  close(evaluateAdsrGain(notes, 0.5, ADSR), 0.5)
  close(evaluateAdsrGain(notes, 1, ADSR), 1)
})

test('adsr: decay falls from peak to the sustain level', () => {
  const notes = [gate(0, 8)]
  close(evaluateAdsrGain(notes, 1.5, ADSR), 0.75)
  close(evaluateAdsrGain(notes, 2, ADSR), 0.5)
})

test('adsr: sustain holds for the rest of the gate', () => {
  const notes = [gate(0, 8)]
  close(evaluateAdsrGain(notes, 4, ADSR), 0.5)
  close(evaluateAdsrGain(notes, 8, ADSR), 0.5)
})

test('adsr: release ramps from the note-end level to zero', () => {
  const notes = [gate(0, 8)]
  close(evaluateAdsrGain(notes, 8.5, ADSR), 0.25)
  assert.equal(evaluateAdsrGain(notes, 9, ADSR), 0)
  assert.equal(evaluateAdsrGain(notes, 20, ADSR), 0)
})

test('adsr: a gate shorter than the attack still peaks, then releases without a pop', () => {
  // hold = max(duration, attack): a drum-hit gate reaches the attack peak before
  // releasing (mirrors ballisticGain's decayStart = max(attack, duration)).
  const notes = [gate(0, 0)]
  close(evaluateAdsrGain(notes, 0.5, ADSR), 0.5)
  close(evaluateAdsrGain(notes, 1, ADSR), 1) // release starts here, FROM the curve's value
  close(evaluateAdsrGain(notes, 1.5, ADSR), 0.5)
  assert.equal(evaluateAdsrGain(notes, 2, ADSR), 0)
})

test('adsr: a gate ending mid-decay releases from the decay value (continuous at note end)', () => {
  const notes = [gate(0, 1.5)] // ends halfway through the decay, where held = 0.75
  close(evaluateAdsrGain(notes, 1.5, ADSR), 0.75)
  close(evaluateAdsrGain(notes, 2, ADSR), 0.375)
  assert.equal(evaluateAdsrGain(notes, 2.5, ADSR), 0)
})

test('adsr: overlapping gates sum and clamp to 1', () => {
  const partial: AdsrEnvelope = { ...ADSR, sustainLevel: 0.4 }
  const notes = [gate(0, 8), gate(0.5, 8)]
  // Both sustaining at beat 4: 0.4 + 0.4 sums below the clamp.
  close(evaluateAdsrGain(notes, 4, partial), 0.8)
  // With a higher sustain the sum exceeds 1 and clamps.
  const hot: AdsrEnvelope = { ...ADSR, sustainLevel: 0.8 }
  assert.equal(evaluateAdsrGain(notes, 4, hot), 1)
})

test('adsr: velocity scales the contribution (0..1 and 0..127 forms)', () => {
  close(evaluateAdsrGain([gate(0, 8, 0.5)], 4, ADSR), 0.25)
  close(evaluateAdsrGain([gate(0, 8, 64)], 4, ADSR), (64 / 127) * 0.5)
})

test('adsr: zero-length segments are epsilon-guarded (no NaN, square shape)', () => {
  const square: AdsrEnvelope = { attackBeats: 0, decayBeats: 0, sustainLevel: 0.7, releaseBeats: 0 }
  const notes = [gate(0, 2)]
  const mid = evaluateAdsrGain(notes, 1, square)
  assert.ok(Number.isFinite(mid))
  close(mid, 0.7)
  assert.equal(evaluateAdsrGain(notes, 2.01, square), 0)
})

test('adsr: pure function of the beat - scrubbing back reproduces the value', () => {
  const notes = [gate(0, 8), gate(3, 2, 0.6)]
  const first = evaluateAdsrGain(notes, 3.7, ADSR)
  evaluateAdsrGain(notes, 9.5, ADSR)
  evaluateAdsrGain(notes, 0, ADSR)
  assert.equal(evaluateAdsrGain(notes, 3.7, ADSR), first)
})
