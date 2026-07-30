import assert from 'node:assert/strict'
import { test } from 'node:test'
import { barrelTwist } from './kaleidoTwist'
import type { ResolvedNote } from '../core/visual/types'

function note(partial: Partial<ResolvedNote> & { beat: number }): ResolvedNote {
  return {
    beat: partial.beat,
    blockStartBeat: partial.blockStartBeat ?? 0,
    blockEndBeat: partial.blockEndBeat ?? 64,
    pitch: partial.pitch ?? 60,
    velocity: partial.velocity ?? 100,
    durationBeats: partial.durationBeats ?? 1,
  }
}

test('no notes means no twist', () => {
  assert.equal(barrelTwist([], 8), 0)
})

test('a note in the future does not turn the barrel yet', () => {
  assert.equal(barrelTwist([note({ beat: 4 })], 2), 0)
})

test('the twist eases in from the onset rather than jumping', () => {
  const notes = [note({ beat: 4 })]
  const atOnset = barrelTwist(notes, 4)
  const justAfter = barrelTwist(notes, 4.1)
  const settled = barrelTwist(notes, 6)
  assert.equal(atOnset, 0, 'zero at the exact onset')
  assert.ok(justAfter > 0, 'moving shortly after')
  assert.ok(settled > justAfter, 'still approaching its final offset')
})

test('a twist settles to a stable offset and stays there', () => {
  const notes = [note({ beat: 0 })]
  const settled = barrelTwist(notes, 8)
  const muchLater = barrelTwist(notes, 64)
  assert.ok(Math.abs(muchLater - settled) < 1e-6, 'holds its arrangement between notes')
})

test('twists accumulate, so each note lands on a new arrangement', () => {
  const one = barrelTwist([note({ beat: 0 })], 16)
  const three = barrelTwist([note({ beat: 0 }), note({ beat: 4 }), note({ beat: 8 })], 16)
  assert.ok(three > one * 2.9, 'three equal notes turn the barrel about three times as far')
})

test('velocity scales the twist', () => {
  const soft = barrelTwist([note({ beat: 0, velocity: 30 })], 8)
  const hard = barrelTwist([note({ beat: 0, velocity: 127 })], 8)
  assert.ok(hard > soft, 'harder hits turn the barrel further')
})

test('velocity is read on both the 0-1 and 0-127 scales', () => {
  // Full strength on either scale must agree. NOTE the inherited ambiguity in
  // this convention (Cube and the movers share it): velocity 1 reads as unit-scale
  // FULL strength, so a MIDI velocity of exactly 1 is treated as hard, not soft.
  const unit = barrelTwist([note({ beat: 0, velocity: 1 })], 8)
  const midi = barrelTwist([note({ beat: 0, velocity: 127 })], 8)
  assert.ok(Math.abs(unit - midi) < 1e-9, '1.0 and 127 are both full strength')

  const halfUnit = barrelTwist([note({ beat: 0, velocity: 0.5 })], 8)
  const halfMidi = barrelTwist([note({ beat: 0, velocity: 64 })], 8)
  assert.ok(Math.abs(halfUnit - halfMidi) < 0.01, 'half strength agrees across scales')
})

test('pitch sets the coarse size of the flick', () => {
  const nudge = barrelTwist([note({ beat: 0, pitch: 44 })], 8)
  const hard = barrelTwist([note({ beat: 0, pitch: 76 })], 8)
  assert.ok(hard > nudge * 2, 'the top row flicks much harder than the bottom')
})

test('pitches outside the declared rows clamp instead of running away', () => {
  const low = barrelTwist([note({ beat: 0, pitch: 0 })], 8)
  const atBottom = barrelTwist([note({ beat: 0, pitch: 44 })], 8)
  const high = barrelTwist([note({ beat: 0, pitch: 127 })], 8)
  const atTop = barrelTwist([note({ beat: 0, pitch: 76 })], 8)
  assert.ok(Math.abs(low - atBottom) < 1e-9, 'below the bottom row clamps to it')
  assert.ok(Math.abs(high - atTop) < 1e-9, 'above the top row clamps to it')
})

test('twist is a pure function of the notes and the beat', () => {
  // The pause invariant: the same beat must always give the same barrel angle,
  // so scrubbing shows exactly what playback shows.
  const notes = [note({ beat: 1 }), note({ beat: 3.5, pitch: 72, velocity: 90 })]
  for (const beat of [0, 1, 2.25, 3.5, 9, 40]) {
    assert.equal(barrelTwist(notes, beat), barrelTwist(notes, beat), `stable at beat ${beat}`)
  }
})

test('note order in the stream does not change the result', () => {
  const a = [note({ beat: 0 }), note({ beat: 2, pitch: 70 }), note({ beat: 5, velocity: 40 })]
  const reversed = [...a].reverse()
  assert.ok(Math.abs(barrelTwist(a, 8) - barrelTwist(reversed, 8)) < 1e-9)
})
