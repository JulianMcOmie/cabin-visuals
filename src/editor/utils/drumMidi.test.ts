import assert from 'node:assert/strict'
import test from 'node:test'
import { placeDrumMidi, rescaleDrumMidi } from './drumMidi'
import type { AudioBlock, Track } from '../types'
const audio: AudioBlock = { id: 'song', clipRef: 'ref', startBar: 3, trimStart: 1.25, trimEnd: 5 }
test('only audible onsets survive trim, with fractional BPM and bar offset', () => {
  const result = placeDrumMidi([0, 1.24, 1.25, 2.25, 4.99, 5, 6].map((time) => ({ time, velocity: 100 })), 'snare', audio, 106.4, 3)
  assert.equal(result.notes.length, 3)
  assert.equal(result.notes[0].startBeat, 9)
  assert.equal(result.notes[1].startBeat, 9 + 106.4 / 60)
  assert.equal(result.notes[0].pitch, 38)
  assert.ok(result.notes.at(-1)!.durationBeats < 0.1)
})
test('tempo rescale preserves hand edits, IDs, loops and absolute sung seconds', () => {
  const track: Track = { id: 't', name: 'Kick MIDI', type: 'base', instrumentId: 'midiRoll', color: '#fff', muted: false, solo: false, childIds: [],
    drumMidi: { audioBlockId: 'song', anchorBar: 3 },
    blocks: [{ id: 'b', startBar: 4, durationBars: 2, loop: true, loopLengthBars: 1,
      notes: [{ id: 'edited', pitch: 37, startBeat: 0.31, durationBeats: 0.17, velocity: 63 }] }] }
  const result = rescaleDrumMidi(track, 1.5, 3)
  const b = result.blocks[0], n = b.notes[0]
  assert.equal(b.startBar, 4.5)
  assert.equal(b.loopLengthBars, 1.5)
  assert.equal(n.id, 'edited'); assert.equal(n.pitch, 37); assert.equal(n.velocity, 63)
  assert.equal(n.startBeat, 0.31 * 1.5)
  assert.equal(track.blocks[0].startBar, 4)
})
