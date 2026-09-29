import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResolvedNote } from '../core/visual/types'
import {
  IMPACT_WARP_PITCH, IMPACT_WARP_SECONDS, IMPACT_WARP_DEFAULT,
  impactEnvelope, impactWarpInstrument, resolveActiveImpactWarp,
} from './ImpactWarp'

function note(beat: number, pitch = IMPACT_WARP_PITCH, velocity = 1, durationBeats = 1): ResolvedNote {
  return { beat, pitch, durationBeats, velocity, blockStartBeat: 0, blockEndBeat: 64 }
}
function stateAt(seconds: number, notes = [note(0)], params: Record<string, number> = {}) {
  return { beat: seconds * 2, secPerBeat: 0.5, notes, params: { impact: 1, ...params }, opacity: 1, blackedOut: false }
}
const amountAt = (seconds: number, notes?: ResolvedNote[]) => resolveActiveImpactWarp(stateAt(seconds, notes))?.amount ?? 0
const peak = IMPACT_WARP_SECONDS * 0.13

test('single Impact control retains its saved automation key and default', () => {
  assert.deepEqual(impactWarpInstrument.params.map(p => p.key), ['impact'])
  assert.equal(IMPACT_WARP_DEFAULT, 0.7)
  const base = stateAt(peak)
  assert.deepEqual(resolveActiveImpactWarp(base), resolveActiveImpactWarp({ ...base, params: { ...base.params, style: 3, release: 0.01, size: 1 } }))
})

test('the attack starts at rest, rises smoothly and carries a broad recovery', () => {
  assert.equal(amountAt(-0.01), 0)
  assert.equal(amountAt(0), 0)
  assert.ok(amountAt(1 / 60) > 0 && amountAt(1 / 60) < 0.05)
  assert.ok(amountAt(peak) > 0.7)
  assert.ok(amountAt(0.25) > amountAt(peak) / 2)
  assert.ok(amountAt(0.4) < amountAt(0.25))
})

test('envelope joins have continuous position, velocity and acceleration', () => {
  const h = 1e-5
  for (const t of [0, 0.13, 0.66, 1]) {
    const leftSlope = (impactEnvelope(t) - impactEnvelope(t - h)) / h
    const rightSlope = (impactEnvelope(t + h) - impactEnvelope(t)) / h
    assert.ok(Math.abs(leftSlope - rightSlope) < 1e-4, `velocity at ${t}`)
    const leftAcceleration = (impactEnvelope(t) - 2 * impactEnvelope(t - h) + impactEnvelope(t - 2 * h)) / h ** 2
    const rightAcceleration = (impactEnvelope(t + 2 * h) - 2 * impactEnvelope(t + h) + impactEnvelope(t)) / h ** 2
    assert.ok(Math.abs(leftAcceleration - rightAcceleration) < 0.6, `acceleration at ${t}`)
  }
})

test('one restrained rebound settles exactly to rest', () => {
  const values = Array.from({ length: 1001 }, (_, i) => impactEnvelope(i / 1000))
  assert.ok(Math.min(...values) >= -0.0600001)
  assert.ok(impactEnvelope(0.66) < -0.059)
  const signs = values.filter(v => Math.abs(v) > 1e-8).map(v => Math.sign(v))
  assert.equal(signs.filter((v, i) => i > 0 && v !== signs[i - 1]).length, 1)
  assert.equal(amountAt(IMPACT_WARP_SECONDS), 0)
  assert.equal(amountAt(5), 0)
})

test('duration is ignored, including after note-off', () => {
  assert.deepEqual(amountAt(0.25, [note(0, 60, 1, 8)]), amountAt(0.25, [note(0, 60, 1, 0.01)]))
})

test('physical timing stays consistent across tempos', () => {
  for (const seconds of [0.025, peak, 0.3, 0.6, 0.8]) {
    for (const bpm of [40, 60, 120, 240, 300]) {
      const state = { ...stateAt(seconds), secPerBeat: 60 / bpm, beat: seconds * bpm / 60 }
      assert.ok(Math.abs((resolveActiveImpactWarp(state)?.amount ?? 0) - amountAt(seconds)) < 1e-12)
    }
  }
})

test('dense rolls compound smoothly and remain bounded', () => {
  const roll = Array.from({ length: 100 }, (_, i) => note(i * 0.001))
  assert.ok(amountAt(peak, roll) > amountAt(peak))
  assert.ok(amountAt(peak, roll) < 1)
  assert.ok(amountAt(0.56, roll) < 0 && amountAt(0.56, roll) > -0.1, 'even dense rolls have a restrained rebound')
  // Adding an onset cannot reset the position or jump to the peak.
  const notes = [note(0), note(0.4)]
  assert.equal(amountAt(0.2, notes), amountAt(0.2, [note(0)]))
  assert.ok(Math.abs(amountAt(0.200001, notes) - amountAt(0.2, notes)) < 1e-4)
})

test('velocity remains expressive and accepts normalized or MIDI values', () => {
  assert.ok(amountAt(peak, [note(0, 60, 0.25)]) < amountAt(peak) / 2)
  assert.equal(amountAt(peak, [note(0, 60, 127)]), amountAt(peak))
  assert.equal(amountAt(peak, [note(0, 60, 0)]), 0)
})

test('Impact and track fades scale the whole gesture, zero is an exact bypass', () => {
  for (const seconds of [peak, 0.3, 0.6]) {
    const base = stateAt(seconds)
    const full = resolveActiveImpactWarp(base)!.amount
    assert.equal(resolveActiveImpactWarp({ ...base, params: { impact: 0.5 } })!.amount, full * 0.5)
    assert.equal(resolveActiveImpactWarp({ ...base, opacity: 0.5 })!.amount, full * 0.5)
    assert.equal(resolveActiveImpactWarp({ ...base, params: { impact: 0 } }), null)
    assert.equal(resolveActiveImpactWarp({ ...base, opacity: 0 }), null)
    assert.equal(resolveActiveImpactWarp({ ...base, blackedOut: true }), null)
  }
})

test('future notes, other pitches and missing state are inert', () => {
  assert.equal(amountAt(peak, [note(0, 40)]), 0)
  assert.equal(amountAt(peak, [note(8)]), 0)
  assert.equal(resolveActiveImpactWarp(undefined), null)
})

test('playback, reverse seeks and export frame stepping produce identical results', () => {
  const notes = [note(0), note(0.25), note(0.5, 60, 0.4), note(2)]
  const times = Array.from({ length: 180 }, (_, i) => i / 60)
  const playback = times.map(t => amountAt(t, notes))
  assert.deepEqual([...times].reverse().map(t => amountAt(t, notes)).reverse(), playback)
  times.forEach((t, i) => assert.ok(Math.abs(amountAt(t, [...notes].reverse()) - playback[i]) < 1e-12))
  for (const index of [113, 5, 64, 0, 28, 113]) assert.equal(amountAt(times[index], notes), playback[index])
})
