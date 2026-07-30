import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResolvedNote } from '../core/visual/types'
import {
  IMPACT_STYLE_RUPTURE,
  IMPACT_STYLE_SHOCKWAVE,
  IMPACT_WARP_PITCH,
  impactEnvelope,
  impactShoveDirection,
  resolveActiveImpactWarp,
} from './ImpactWarp'

function note(beat: number, pitch = IMPACT_WARP_PITCH, velocity = 1, durationBeats = 1): ResolvedNote {
  return { beat, pitch, durationBeats, velocity, blockStartBeat: 0, blockEndBeat: 64 }
}

function stateAt(beat: number, notes: ResolvedNote[], params: Record<string, number> = {}) {
  return {
    beat,
    notes,
    // Impact is pinned to full scale so the envelope assertions read as plain
    // fractions; the shipped default is 0.7.
    params: { impact: 1, release: 1, ...params },
    opacity: 1,
    blackedOut: false,
  }
}

test('the attack is instantaneous - full displacement on the very frame of the hit', () => {
  const notes = [note(4)]
  assert.equal(resolveActiveImpactWarp(stateAt(3.99, notes)), null)
  assert.equal(resolveActiveImpactWarp(stateAt(4, notes))?.amount, 1)
})

test('the envelope rebounds through zero and settles at the end of release', () => {
  // Zero crossing a third of the way in (three quarters of a cosine cycle).
  assert.ok(Math.abs(impactEnvelope(1 / 3)) < 1e-12)
  // Past it the displacement is negative: the frame swings back the other way.
  assert.ok(impactEnvelope(0.5) < 0)
  assert.ok(impactEnvelope(2 / 3) < 0)
  // The rebound is a fraction of the strike, not a second strike of its own.
  assert.ok(Math.abs(impactEnvelope(2 / 3)) < 0.2)
  assert.equal(impactEnvelope(1), 0)
  assert.equal(impactEnvelope(1.5), 0)
})

test('a note ignores its own duration - length is not a parameter of a strike', () => {
  const long = resolveActiveImpactWarp(stateAt(0.2, [note(0, IMPACT_WARP_PITCH, 1, 8)]))
  const short = resolveActiveImpactWarp(stateAt(0.2, [note(0, IMPACT_WARP_PITCH, 1, 0.01)]))
  assert.deepEqual(long, short)
})

test('release scales the whole recovery, in beats', () => {
  const notes = [note(0)]
  // Same normalized age, so the same displacement, at twice the beat distance.
  const quick = resolveActiveImpactWarp(stateAt(0.25, notes, { release: 1 }))?.amount
  const slow = resolveActiveImpactWarp(stateAt(0.5, notes, { release: 2 }))?.amount
  assert.ok(quick !== undefined && Math.abs(quick - (slow ?? 0)) < 1e-12)
  // And the hit is over exactly one release after it landed.
  assert.equal(resolveActiveImpactWarp(stateAt(2, notes, { release: 2 })), null)
})

test('a roll compounds - it stays pinned where a single hit would already be decaying', () => {
  const roll = [note(0), note(0.05), note(0.1), note(0.15), note(0.2)]
  const single = resolveActiveImpactWarp(stateAt(0.2, [note(0)]))!.amount
  const stacked = resolveActiveImpactWarp(stateAt(0.2, roll))!.amount
  assert.ok(single < 0.5)
  assert.ok(stacked > single)
  // Saturated rather than unbounded: a dense roll cannot displace the frame
  // further than one maximum-strength hit does.
  assert.equal(stacked, 1)
})

test('velocity scales the hit', () => {
  const soft = resolveActiveImpactWarp(stateAt(0, [note(0, IMPACT_WARP_PITCH, 0.25)]))!.amount
  assert.equal(soft, 0.25)
  // 0-127 velocities are accepted on the same scale as 0-1 ones.
  assert.equal(resolveActiveImpactWarp(stateAt(0, [note(0, IMPACT_WARP_PITCH, 127)]))!.amount, 1)
})

test('Impact and track opacity both scale the hit', () => {
  const notes = [note(0)]
  assert.equal(resolveActiveImpactWarp(stateAt(0, notes, { impact: 0.5 }))!.amount, 0.5)
  const dimmed = { ...stateAt(0, notes), opacity: 0.5 }
  assert.equal(resolveActiveImpactWarp(dimmed)!.amount, 0.5)
})

test('consecutive hits never shove the frame the same way twice', () => {
  const directions = Array.from({ length: 12 }, (_, index) => impactShoveDirection(index))
  for (const direction of directions) {
    assert.ok(Math.abs(Math.hypot(direction.x, direction.y) - 1) < 1e-12)
  }
  for (let index = 1; index < directions.length; index++) {
    const dot = directions[index].x * directions[index - 1].x + directions[index].y * directions[index - 1].y
    // 137.5 degrees apart: nowhere near a repeat.
    assert.ok(dot < 0.5)
  }
})

test('a hit keeps its shove direction as the playhead passes later notes', () => {
  const notes = [note(0), note(4)]
  const alone = resolveActiveImpactWarp(stateAt(0, [note(0)]))!
  const withFuture = resolveActiveImpactWarp(stateAt(0, notes))!
  assert.equal(withFuture.dirX, alone.dirX)
  assert.equal(withFuture.dirY, alone.dirY)
})

test('shockwave weakens monotonically as its ring crosses the frame', () => {
  const notes = [note(0)]
  const params = { release: 2, style: IMPACT_STYLE_SHOCKWAVE }
  const at = (beat: number) => resolveActiveImpactWarp(stateAt(beat, notes, params))!
  const strengths = [0, 0.5, 1, 1.5].map((beat) => at(beat).amount)
  for (let i = 1; i < strengths.length; i++) {
    // No rebound: a wave passing through does not spring back the other way.
    assert.ok(strengths[i] > 0)
    assert.ok(strengths[i] < strengths[i - 1])
  }
  // And the ring's travel is the phase, so it is still crossing the frame at the
  // point the deformation styles have already settled.
  assert.equal(at(1.5).phase, 0.75)
})

test('the freshest hit owns the shockwave phase and the rupture seed', () => {
  const notes = [note(0), note(1)]
  const state = stateAt(1.5, notes, { release: 4, style: IMPACT_STYLE_RUPTURE })
  const hit = resolveActiveImpactWarp(state)!
  assert.equal(hit.phase, 0.125)
  assert.equal(hit.seed, 1)
  assert.equal(hit.style, IMPACT_STYLE_RUPTURE)
})

test('unrecognized pitches and future notes never hit the scene', () => {
  assert.equal(resolveActiveImpactWarp(stateAt(0.5, [note(0, 40)])), null)
  assert.equal(resolveActiveImpactWarp(stateAt(0, [note(8)])), null)
})

test('a blacked-out or fully transparent track hits nothing', () => {
  const notes = [note(0)]
  assert.equal(resolveActiveImpactWarp({ ...stateAt(0, notes), blackedOut: true }), null)
  assert.equal(resolveActiveImpactWarp({ ...stateAt(0, notes), opacity: 0 }), null)
})
