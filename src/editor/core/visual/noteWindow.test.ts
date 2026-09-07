import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MIN_SOUNDING_BEATS, noteArrayIndex, noteWindow, soundingNoteWindow } from './noteWindow'
import { evaluatePulse } from './energy'
import type { ResolvedNote } from './types'

// The windows exist to skip work, never to change an answer: every consumer
// applies its own exact predicate inside the window, so a bisected walk must
// agree with the full scan it replaced on every beat - including the edges,
// where the margin and the `<=`/`<` conventions live.

function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function stream(count: number, seed: number): ResolvedNote[] {
  const rand = seeded(seed)
  const notes: ResolvedNote[] = []
  for (let i = 0; i < count; i++) {
    const beat = Math.floor(rand() * 64 * 4) / 4
    // A mix of ordinary, long, and zero-length notes so every branch of the
    // duration rule (`|| MIN_SOUNDING_BEATS`) is exercised.
    const roll = rand()
    const durationBeats = roll < 0.15 ? 0 : roll < 0.3 ? 4 + rand() * 6 : rand() * 1.5
    notes.push({
      id: `n${i}`,
      beat,
      blockStartBeat: Math.floor(beat / 16) * 16,
      blockEndBeat: Math.floor(beat / 16) * 16 + 16,
      pitch: 36 + Math.floor(rand() * 40),
      velocity: 0.2 + rand() * 0.8,
      durationBeats,
    })
  }
  return notes.sort((a, b) => a.beat - b.beat)
}

const beats: number[] = []
for (let b = -1; b <= 70; b += 0.0625) beats.push(b)
// Beats sitting exactly on onsets and exactly on note ends, where `<` vs `<=`
// and the DECAY/reach edges are decided.
function edgeBeats(notes: ResolvedNote[]): number[] {
  const out: number[] = []
  for (const n of notes) {
    out.push(n.beat, n.beat + (n.durationBeats || MIN_SOUNDING_BEATS), n.beat + 0.45, n.beat - 0.45)
  }
  return out
}

test('soundingNoteWindow reproduces the full active-note filter exactly', () => {
  for (const seed of [1, 7, 42]) {
    const notes = stream(300, seed)
    for (const beat of [...beats, ...edgeBeats(notes)]) {
      const expected = notes.filter((n) => beat >= n.beat && beat < n.beat + (n.durationBeats || MIN_SOUNDING_BEATS))
      const { start, end } = soundingNoteWindow(notes, beat)
      const got: ResolvedNote[] = []
      for (let i = start; i < end; i++) {
        const n = notes[i]
        if (beat >= n.beat && beat < n.beat + (n.durationBeats || MIN_SOUNDING_BEATS)) got.push(n)
      }
      assert.deepEqual(got, expected, `beat ${beat}`)
    }
  }
})

test('evaluatePulse over the window equals the full scan bit for bit', () => {
  // The pre-window evaluator, kept verbatim as the oracle.
  const DECAY_BEATS = 0.45
  const oracle = (triggers: ResolvedNote[], beat: number) => {
    let closest = Infinity
    let intensity = 1
    for (const n of triggers) {
      if (beat < n.blockStartBeat || beat > n.blockEndBeat) continue
      if (n.beat <= beat) {
        const since = beat - n.beat
        if (since < closest) {
          intensity = n.pitch - 24 + 1
          closest = since
        }
      }
    }
    if (closest === Infinity) return 0
    return Math.max(0, (intensity / 20) * (1 - closest / DECAY_BEATS))
  }
  for (const seed of [3, 11]) {
    const notes = stream(400, seed)
    for (const beat of [...beats, ...edgeBeats(notes)]) {
      assert.ok(Object.is(evaluatePulse(notes, beat), oracle(notes, beat)), `beat ${beat}`)
    }
  }
})

test('an unsorted array falls back to the whole range', () => {
  const notes = stream(20, 2).reverse()
  const { start, end } = noteWindow(notes, 10, 1)
  assert.equal(start, 0)
  assert.equal(end, notes.length)
  assert.equal(noteArrayIndex(notes).sorted, false)
})

test('the index re-measures an array that grew since it was first seen', () => {
  const notes = stream(10, 4)
  const first = noteArrayIndex(notes)
  const longest = notes.reduce((m, n) => Math.max(m, n.durationBeats || MIN_SOUNDING_BEATS), 0)
  assert.equal(first.maxSounding, longest)
  notes.push({ id: 'late', beat: 200, blockStartBeat: 192, blockEndBeat: 208, pitch: 60, velocity: 1, durationBeats: 40 })
  assert.equal(noteArrayIndex(notes).maxSounding, 40)
})

test('an empty array and NaN beats answer with an empty window', () => {
  assert.deepEqual({ ...noteWindow([], 3, 1) }, { start: 0, end: 0 })
  const notes = stream(10, 6)
  assert.deepEqual({ ...soundingNoteWindow(notes, Number.NaN) }, { start: 0, end: 0 })
})
