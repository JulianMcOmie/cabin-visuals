import test from 'node:test'
import assert from 'node:assert/strict'
import { makeNoteQueries } from './notes'
import type { ResolvedNote } from '../../core/visual/types'

const note = (beat: number, pitch: number, durationBeats = 0.5, velocity = 127): ResolvedNote =>
  ({ beat, pitch, durationBeats, velocity, blockStartBeat: 0, blockEndBeat: 64 })

// Deliberately unsorted: queries must not depend on the stream's order.
const NOTES = [note(4, 60), note(0, 60), note(2, 62, 2), note(1, 60), note(6, 60, 1, 64), note(3, 64)]

test('hits: newest first, windowed, indexed among matching onsets', () => {
  const q = makeNoteQueries(NOTES, 4.25, 0.5)
  const h = q.hits(60)
  assert.deepEqual(h.map((x) => x.beat), [4, 1, 0])
  assert.deepEqual(h.map((x) => x.index), [2, 1, 0])
  assert.equal(h[0].age, 0.25)
  assert.equal(h[0].ageSec, 0.125)
  assert.deepEqual(q.hits(60, 3.5).map((x) => x.beat), [4, 1])
  assert.deepEqual(q.hits([60, 64], Infinity, 2).map((x) => x.beat), [4, 3])
  assert.deepEqual(q.hits((p) => p > 61).map((x) => x.pitch), [64, 62])
})

test('last / held / holding', () => {
  const q = makeNoteQueries(NOTES, 3.2, 0.5)
  assert.equal(q.last()?.beat, 3)
  assert.equal(q.held(62)?.beat, 2)
  assert.equal(q.held(60), null)
  assert.deepEqual(q.holding().map((x) => x.pitch).sort(), [62, 64])
  assert.equal(q.last(99), null)
})

test('next / upcoming see the future (score-aware visuals)', () => {
  const q = makeNoteQueries(NOTES, 1.5, 0.5)
  assert.equal(q.next(60)?.beat, 4)
  assert.equal(q.next(60)?.in, 2.5)
  assert.equal(q.next(60)?.index, 2)
  assert.deepEqual(q.upcoming(undefined, 2).map((x) => x.beat), [2, 3])
})

test('count, pulse and gate are pure functions of the beat', () => {
  const q = makeNoteQueries(NOTES, 4.5, 0.5)
  assert.equal(q.count(60), 3)
  assert.equal(q.count(60, 1), 2)
  assert.ok(q.pulse(60, 0.5) > Math.exp(-1) - 1e-9)
  // gate: held → full (after the attack), released → decaying
  const held = makeNoteQueries(NOTES, 2.5, 0.5)
  assert.equal(held.gate(62, 0.01, 0.25), 1)
  const released = makeNoteQueries(NOTES, 4.25, 0.5)
  const g = released.gate(62, 0.01, 0.25)
  assert.ok(g > 0.3 && g < 0.4, `gate after release ${g}`)
  // same inputs, same answer, however often asked
  assert.equal(makeNoteQueries(NOTES, 4.5, 0.5).pulse(60), q.pulse(60))
})

test('velocity is normalized to 0..1', () => {
  const q = makeNoteQueries(NOTES, 6.1, 0.5)
  assert.equal(q.last(60)?.velocity, 64 / 127)
})

test('between returns notes in time order', () => {
  const q = makeNoteQueries(NOTES, 0, 0.5)
  assert.deepEqual(q.between(undefined, 1, 4).map((x) => x.beat), [1, 2, 3])
})
