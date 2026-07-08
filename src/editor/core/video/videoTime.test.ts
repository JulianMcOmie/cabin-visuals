import test from 'node:test'
import assert from 'node:assert/strict'
import { activeVideoAt, clipTimeAt } from './videoTime'
import type { ResolvedNote } from '../visual/types'

const note = (beat: number, pitch: number, blockStartBeat: number, blockEndBeat: number): ResolvedNote =>
  ({ id: `n${beat}-${pitch}`, beat, pitch, velocity: 100, durationBeats: 0.5, blockStartBeat, blockEndBeat }) as ResolvedNote

const BASE = 48 // C3

test('no notes yet → nothing showing', () => {
  const notes = [note(4, 48, 0, 16)]
  assert.equal(activeVideoAt(notes, 2, BASE, 4), null)
})

test('note-on selects clip by pitch offset and latches past the note end', () => {
  const notes = [note(0, 50, 0, 16)] // D3 → clip 2
  const at8 = activeVideoAt(notes, 8, BASE, 4)
  assert.deepEqual(at8, { clipIndex: 2, noteBeat: 0 })
})

test('a later note-on replaces the latch', () => {
  const notes = [note(0, 48, 0, 16), note(6, 51, 0, 16)]
  assert.deepEqual(activeVideoAt(notes, 5.9, BASE, 4), { clipIndex: 0, noteBeat: 0 })
  assert.deepEqual(activeVideoAt(notes, 6, BASE, 4), { clipIndex: 3, noteBeat: 6 })
})

test('re-triggering the same pitch restarts the clip clock', () => {
  const notes = [note(0, 48, 0, 16), note(10, 48, 0, 16)]
  assert.deepEqual(activeVideoAt(notes, 12, BASE, 4), { clipIndex: 0, noteBeat: 10 })
})

test('pitch wraps modulo the clip count, including below baseNote', () => {
  const notes = [note(0, 53, 0, 16)] // +5 over C3, 4 clips → clip 1
  assert.equal(activeVideoAt(notes, 1, BASE, 4)?.clipIndex, 1)
  const below = [note(0, 47, 0, 16)] // −1 → wraps to last clip
  assert.equal(activeVideoAt(below, 1, BASE, 4)?.clipIndex, 3)
})

test('the latch dies at its own block end (no leak across block gaps)', () => {
  const notes = [note(2, 48, 0, 8), note(34, 50, 32, 48)]
  assert.notEqual(activeVideoAt(notes, 7.9, BASE, 4), null)
  assert.equal(activeVideoAt(notes, 8, BASE, 4), null) // block over, next hasn't begun
  assert.equal(activeVideoAt(notes, 20, BASE, 4), null) // the gap
  assert.deepEqual(activeVideoAt(notes, 40, BASE, 4), { clipIndex: 2, noteBeat: 34 })
})

test('zero clips → null regardless of notes', () => {
  assert.equal(activeVideoAt([note(0, 48, 0, 16)], 1, BASE, 0), null)
})

test('clip time advances with the beat and loops modulo duration', () => {
  const spb = 0.5 // 120bpm
  assert.equal(clipTimeAt(4, 0, spb, 10, true), 2)
  assert.equal(clipTimeAt(44, 0, spb, 10, true), 2) // 22s into a 10s loop → 2s
})

test('non-looping clips hold just before the end', () => {
  const t = clipTimeAt(100, 0, 0.5, 10, false)
  assert.ok(t < 10 && t > 9.9)
})

test('scrub == playback: same beat, same answer, any order of queries', () => {
  const notes = [note(0, 48, 0, 16), note(6, 51, 0, 16), note(10, 48, 0, 16)]
  const a = activeVideoAt(notes, 12.25, BASE, 4)
  for (const probe of [3, 15, 7, 12.25, 0.1]) activeVideoAt(notes, probe, BASE, 4)
  assert.deepEqual(activeVideoAt(notes, 12.25, BASE, 4), a)
})
