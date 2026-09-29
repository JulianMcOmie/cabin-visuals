import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Midi } from '@tonejs/midi'
import { alignPlacement, Analysis, formatBars, placementIn, type RawAnalysis } from './analysis'
import type { ProjectDocument } from '../../../src/persistence/types'

// 120 BPM (0.5 s beats), first downbeat 0.25 s, 16 bars: quiet for 8, loud for 8.
function song(downbeat = 0.25): RawAnalysis {
  const fps = 10, duration = downbeat + 32 + 1
  const n = Math.ceil(duration * fps)
  const loud = (i: number) => (i / fps > downbeat + 16 ? 900 : 120)
  const env = Object.fromEntries(['kick', 'snare', 'hat', 'drums', 'bass', 'vocals', 'other', 'mix'].map((k) => [k, Array.from({ length: n }, (_, i) => loud(i))]))
  const kick = Array.from({ length: 64 }, (_, j) => ({ t: Math.round((downbeat + j * 0.5 + (j === 4 ? -0.00004 : 0)) * 1e4) / 1e4, v: j >= 32 ? 0.9 : 0.3 }))
  return {
    duration, fps,
    tempo: { bpm: 120, period: 0.5, phase: downbeat, downbeat, beatsPerBar: 4 },
    harmony: Array.from({ length: 64 }, (_, j) => ({ b: j < 32 ? 9 : 2, c: [9, 0, 0, 0, 7, 0, 0, 8, 0, 0, 0, 0] })),
    events: {
      kick, snare: [], hat: [],
      bass: [{ t: downbeat + 1, d: 0.5, v: 0.8, p: 45.2 }],
      vocal: [{ t: downbeat + 2.25, d: 1, v: 0.6, p: 64.9 }, { t: downbeat + 3, d: 0.4, v: 0.2, p: null }],
      other: [{ t: downbeat + 4, d: 0.25, v: 0.5, pc: 7, c: 0.4 }],
    },
    env,
  }
}

test('placement: a short lead-in is trimmed, a pickup lands ONE on bar 1', () => {
  assert.deepEqual(alignPlacement(song(0.25), 4), { startBar: 0, trimStart: 0.25 })
  const late = alignPlacement(song(1.1), 4)
  assert.equal(late.trimStart, 0)
  const a = new Analysis(song(1.1), late, 4)
  assert.equal(a.beatOf(1.1), 4)                           // the downbeat is bar 1
})

test('the audio block wins over the default alignment', () => {
  const doc = { beatsPerBar: 4, audioTracks: { t: { audioBlocks: [{ clipRef: 'x', startBar: 2, trimStart: 0.25 }] } } } as unknown as ProjectDocument
  assert.deepEqual(placementIn(doc, 'x', song()), { startBar: 2, trimStart: 0.25 })
  assert.deepEqual(placementIn(doc, 'other-clip', song()), { startBar: 0, trimStart: 0.25 })
})

test('events arrive in project beats, grid onsets snapped exactly', () => {
  const a = new Analysis(song(), { startBar: 0, trimStart: 0.25 }, 4)
  assert.deepEqual(a.kick.slice(0, 5).map((h) => h.beat), [0, 1, 2, 3, 4])  // #4 was 0.1 ms early
  assert.equal(a.bass[0].beat, 2)
  assert.equal(a.bass[0].dur, 1)
  assert.equal(a.vocal[0].beat, 4.5)
  assert.equal(a.vocal[1].pitch, null)
  assert.equal(a.other[0].pc, 7)
  assert.equal(a.secOf(a.beatOf(7.3)), 7.3)
  assert.equal(a.harmony[0].root, 9)
  assert.deepEqual(a.chordAt(0.5).tones, [0, 7, 4])
})

test('envelopes, bars and suggested sections', () => {
  const a = new Analysis(song(), { startBar: 0, trimStart: 0.25 }, 4)
  assert.ok(Math.abs(a.env('mix', 2) - 0.12) < 1e-9)
  assert.ok(Math.abs(a.envMean('mix', 40, 44) - 0.9) < 1e-9)
  const rows = a.bars(0, 16)
  assert.equal(rows.length, 16)
  assert.equal(rows[0].kick, 4)
  assert.equal(rows[0].root, 9)
  assert.equal(rows[12].root, 2)
  const secs = a.sections()
  assert.deepEqual(secs.map((s) => s.from), [0, 8])
  assert.ok(secs[1].energy > secs[0].energy)
  const table = formatBars(rows.slice(0, 2), [{ name: 'intro', from: 0 }])
  assert.match(table, /◀ intro/)
  assert.match(table.split('\n')[2], /^ {3}0 {2}0:00\.3/)
})

test('toMidi writes named tracks in project beats', () => {
  const a = new Analysis(song(), { startBar: 0, trimStart: 0.25 }, 4)
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cabin-')), 'a.mid')
  a.toMidi(file)
  const midi = new Midi(fs.readFileSync(file))
  assert.deepEqual(midi.tracks.map((t) => t.name), ['Kick', 'Snare', 'Hat', 'Bass', 'Vocal', 'Other', 'Root', 'Chord'])
  const kick = midi.tracks[0]
  assert.equal(kick.notes.length, 64)
  assert.equal(kick.notes[4].ticks, 4 * midi.header.ppq)
  assert.equal(midi.tracks[3].notes[0].midi, 45)
  assert.equal(midi.tracks[6].notes[0].midi, 36 + 9)          // root A, held...
  assert.equal(midi.tracks[6].notes[0].durationTicks, 32 * midi.header.ppq) // ...until it changes
})
