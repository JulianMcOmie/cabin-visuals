import test from 'node:test'
import assert from 'node:assert/strict'
import { activePhotoAt } from './photoTime'
import type { ResolvedNote } from '../visual/types'

const note = (beat: number, pitch: number, blockStartBeat: number, blockEndBeat: number): ResolvedNote =>
  ({ id: `n${beat}-${pitch}`, beat, pitch, velocity: 100, durationBeats: 0.5, blockStartBeat, blockEndBeat }) as ResolvedNote

const BASE = 48 // C3

test('no notes yet -> nothing showing', () => {
  const notes = [note(4, 48, 0, 16)]
  assert.equal(activePhotoAt(notes, 2, BASE, 4), null)
})

test('note-on selects photo by pitch offset and latches past the note end', () => {
  const notes = [note(0, 50, 0, 16)] // D3 -> photo 2
  const at8 = activePhotoAt(notes, 8, BASE, 4)
  assert.deepEqual(at8, { photoIndex: 2, noteBeat: 0 })
})

test('a later note-on replaces the latch', () => {
  const notes = [note(0, 48, 0, 16), note(6, 51, 0, 16)]
  assert.deepEqual(activePhotoAt(notes, 5.9, BASE, 4), { photoIndex: 0, noteBeat: 0 })
  assert.deepEqual(activePhotoAt(notes, 6, BASE, 4), { photoIndex: 3, noteBeat: 6 })
})

test('re-triggering the same pitch restamps the latch origin', () => {
  const notes = [note(0, 48, 0, 16), note(10, 48, 0, 16)]
  assert.deepEqual(activePhotoAt(notes, 12, BASE, 4), { photoIndex: 0, noteBeat: 10 })
})

test('pitch wraps modulo the photo count, including below baseNote', () => {
  const notes = [note(0, 53, 0, 16)] // +5 over C3, 4 photos -> photo 1
  assert.equal(activePhotoAt(notes, 1, BASE, 4)?.photoIndex, 1)
  const below = [note(0, 47, 0, 16)] // -1 -> wraps to last photo
  assert.equal(activePhotoAt(below, 1, BASE, 4)?.photoIndex, 3)
})

test('the latch dies at its own block end (no leak across block gaps)', () => {
  const notes = [note(2, 48, 0, 8), note(34, 50, 32, 48)]
  assert.notEqual(activePhotoAt(notes, 7.9, BASE, 4), null)
  assert.equal(activePhotoAt(notes, 8, BASE, 4), null) // block over, next hasn't begun
  assert.equal(activePhotoAt(notes, 20, BASE, 4), null) // the gap
  assert.deepEqual(activePhotoAt(notes, 40, BASE, 4), { photoIndex: 2, noteBeat: 34 })
})

test('zero photos -> null regardless of notes', () => {
  assert.equal(activePhotoAt([note(0, 48, 0, 16)], 1, BASE, 0), null)
})

test('scrub == playback: same beat, same answer, any order of queries', () => {
  const notes = [note(0, 48, 0, 16), note(6, 51, 0, 16), note(10, 48, 0, 16)]
  const a = activePhotoAt(notes, 12.25, BASE, 4)
  for (const probe of [3, 15, 7, 12.25, 0.1]) activePhotoAt(notes, probe, BASE, 4)
  assert.deepEqual(activePhotoAt(notes, 12.25, BASE, 4), a)
})
