import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResolvedNote } from '../core/visual/types'
import {
  WATER_DROP_LEVELS, WATER_DROP_PITCH_MIN, collectLiveDrops, waterDropHeight,
} from './waterDropCore'

function note(beat: number, pitch = WATER_DROP_PITCH_MIN, durationBeats = 1, velocity = 1): ResolvedNote {
  return { beat, pitch, durationBeats, velocity, blockStartBeat: 0, blockEndBeat: 64 }
}

/** 120 BPM: one beat == 0.5s, so ages in seconds are half the beat distance. */
function stateAt(beat: number, notes: ResolvedNote[]) {
  return { beat, notes, secPerBeat: 0.5 }
}

test('the eleven rows are an evenly spaced ladder centered on the origin', () => {
  const span = 10
  assert.equal(waterDropHeight(WATER_DROP_PITCH_MIN, span), -5)
  assert.equal(waterDropHeight(WATER_DROP_PITCH_MIN + WATER_DROP_LEVELS - 1, span), 5)
  assert.equal(waterDropHeight(WATER_DROP_PITCH_MIN + 5, span), 0)
  // One row up is always the same step, wherever you are on the ladder.
  const step = span / (WATER_DROP_LEVELS - 1)
  for (let level = 1; level < WATER_DROP_LEVELS; level++) {
    const rise = waterDropHeight(WATER_DROP_PITCH_MIN + level, span)
      - waterDropHeight(WATER_DROP_PITCH_MIN + level - 1, span)
    assert.ok(Math.abs(rise - step) < 1e-9)
  }
})

test('pitches outside the eleven rows clamp rather than fly off the ladder', () => {
  assert.equal(waterDropHeight(WATER_DROP_PITCH_MIN - 12, 10), -5)
  assert.equal(waterDropHeight(WATER_DROP_PITCH_MIN + 99, 10), 5)
})

test('a drop lives for its lifetime in SECONDS, not beats', () => {
  const notes = [note(0)]
  // Lifetime 2s at 120 BPM = 4 beats.
  assert.equal(collectLiveDrops(stateAt(0, notes), 2)[0].t, 0)
  assert.equal(collectLiveDrops(stateAt(2, notes), 2)[0].t, 0.5)
  assert.equal(collectLiveDrops(stateAt(3.9999, notes), 2).length, 1)
  assert.equal(collectLiveDrops(stateAt(4, notes), 2).length, 0)
})

test('notes in the future and off-vocabulary pitches contribute nothing', () => {
  assert.equal(collectLiveDrops(stateAt(0, [note(8)]), 4).length, 0)
  assert.equal(collectLiveDrops(stateAt(1, [note(0, WATER_DROP_PITCH_MIN - 1)]), 4).length, 0)
  assert.equal(collectLiveDrops(stateAt(1, [note(0, WATER_DROP_PITCH_MIN + WATER_DROP_LEVELS)]), 4).length, 0)
})

test('same-pitch notes on different beats get different seeds', () => {
  const drops = collectLiveDrops(stateAt(4, [note(0), note(1)]), 8)
  assert.equal(drops.length, 2)
  assert.notEqual(drops[0].seed, drops[1].seed)
})

test('velocity is normalized whichever convention the note stream uses', () => {
  assert.equal(collectLiveDrops(stateAt(0, [note(0, WATER_DROP_PITCH_MIN, 1, 0.5)]), 4)[0].velocity, 0.5)
  assert.equal(collectLiveDrops(stateAt(0, [note(0, WATER_DROP_PITCH_MIN, 1, 127)]), 4)[0].velocity, 1)
})

test('a dense passage keeps the newest drops, not the oldest', () => {
  const notes: ResolvedNote[] = []
  for (let i = 0; i < 30; i++) notes.push(note(i * 0.1))
  const drops = collectLiveDrops(stateAt(3, notes), 60)
  assert.equal(drops.length, 10)
  // The last one collected is the youngest note, i.e. the smallest age.
  assert.ok(drops[drops.length - 1].t < drops[0].t)
})
