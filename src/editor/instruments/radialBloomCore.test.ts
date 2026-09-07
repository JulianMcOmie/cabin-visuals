import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResolvedNote } from '../core/visual/types'
import { bloomOpacity, resolveBloom } from './radialBloomCore'

const envelope = { attackBeats: 0.1, decayBeats: 0.2, sustainLevel: 0.85, releaseBeats: 0.5 }
const note = (pitch = 41, beat = 0, durationBeats = 8): ResolvedNote => ({
  pitch, beat, durationBeats, velocity: 1, blockStartBeat: 0, blockEndBeat: 100,
})

test('silence is invisible and MIDI counts map to the same rows as Radial', () => {
  assert.deepEqual(resolveBloom([], 1, envelope), { copies: 0, opacity: 0 })
  for (let count = 1; count <= 12; count++) {
    assert.equal(resolveBloom([note(35 + count)], 1, envelope).copies, count)
  }
  assert.equal(resolveBloom([note(35), note(48), note(36.5)], 1, envelope).copies, 0)
})

test('a hit attacks, decays to sustain, and stays there until note-off', () => {
  const n = note(41, 0, 100)
  assert.equal(bloomOpacity(n, -1, envelope), 0)
  assert.equal(bloomOpacity(n, 0, envelope), 0)
  assert.equal(bloomOpacity(n, 0.05, envelope), 0.5)
  assert.equal(bloomOpacity(n, 0.1, envelope), 1)
  assert.equal(bloomOpacity(n, 0.2, envelope), 0.925)
  assert.equal(bloomOpacity(n, 99, envelope), 0.85)
  assert.equal(bloomOpacity(n, 100.25, envelope), 0.425)
  assert.equal(bloomOpacity(n, 100.5, envelope), 0)
})

test('releasing during attack fades immediately from the actual held value', () => {
  const n = note(41, 0, 0.05)
  assert.equal(bloomOpacity(n, 0.05, envelope), 0.5)
  assert.ok(Math.abs(bloomOpacity(n, 0.075, envelope) - 0.475) < 1e-9)
  assert.equal(bloomOpacity(n, 0.55, envelope), 0)
  assert.equal(bloomOpacity(n, 0.05, { ...envelope, releaseBeats: 0 }), 0)
})

test('release retains count; newest held note wins and chords choose the largest count', () => {
  assert.deepEqual(resolveBloom([note(41, 0, 1)], 1.25, envelope), { copies: 6, opacity: 0.425 })
  const notes = [note(38, 0, 10), note(41, 1, 1), note(44, 1, 1)]
  assert.equal(resolveBloom(notes, 1.5, envelope).copies, 9)
  assert.equal(resolveBloom([...notes].reverse(), 1.5, envelope).copies, 9)
  assert.equal(resolveBloom(notes, 2.1, envelope).copies, 3)
  const direct = resolveBloom(notes, 1.5, envelope)
  resolveBloom(notes, 50, envelope)
  assert.deepEqual(resolveBloom(notes, 1.5, envelope), direct)
})

test('zero attack/decay and full sustain hold at full opacity', () => {
  const instant = { attackBeats: 0, decayBeats: 0, sustainLevel: 1, releaseBeats: 0 }
  assert.equal(bloomOpacity(note(), 0, instant), 1)
  assert.equal(bloomOpacity(note(), 7.99, instant), 1)
  assert.equal(bloomOpacity(note(), 8, instant), 0)
})
