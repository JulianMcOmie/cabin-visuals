import test from 'node:test'
import assert from 'node:assert/strict'
import { Midi } from '@tonejs/midi'
import { parseMidiFile, isMidiFileName, isMidiMimeType } from './midiImport'
import { useProjectStore } from '../store/ProjectStore'

// The fixture is built with the library's own encoder, so the parser sees the
// same bytes a DAW export produces (velocities chosen to survive the encoder's
// 0-127 quantization exactly).
function fixtureBytes(): { bytes: ArrayBuffer; ppq: number } {
  const midi = new Midi()
  const ppq = midi.header.ppq
  const lead = midi.addTrack()
  lead.name = 'Lead'
  lead.addNote({ midi: 60, ticks: 0, durationTicks: ppq, velocity: 100 / 127 })
  lead.addNote({ midi: 61, ticks: ppq, durationTicks: 0, velocity: 64 / 127 })
  lead.addNote({ midi: 76, ticks: 9 * ppq, durationTicks: ppq / 2, velocity: 1 })
  const bass = midi.addTrack() // unnamed - callers number it
  bass.addNote({ midi: 36, ticks: 4 * ppq, durationTicks: 2 * ppq, velocity: 64 / 127 })
  midi.addTrack() // empty - must not become a track
  const arr = midi.toArray()
  return { bytes: arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer, ppq }
}

test('parseMidiFile maps ticks/PPQ to beats and keeps full pitch/velocity', () => {
  const { bytes } = fixtureBytes()
  const tracks = parseMidiFile(bytes)

  assert.equal(tracks.length, 2) // the empty third track is dropped
  const [lead, bass] = tracks
  assert.equal(lead.name, 'Lead')
  assert.equal(bass.name, '')

  assert.deepEqual(
    lead.notes.map((n) => ({ pitch: n.pitch, startBeat: n.startBeat, durationBeats: n.durationBeats, velocity: n.velocity })),
    [
      { pitch: 60, startBeat: 0, durationBeats: 1, velocity: 100 },
      { pitch: 61, startBeat: 1, durationBeats: 0.05, velocity: 64 }, // zero-length floors to 0.05
      { pitch: 76, startBeat: 9, durationBeats: 0.5, velocity: 127 },
    ],
  )
  assert.equal(lead.endBeat, 9.5)

  assert.equal(bass.notes.length, 1)
  assert.equal(bass.notes[0].startBeat, 4)
  assert.equal(bass.notes[0].durationBeats, 2)
  assert.equal(bass.endBeat, 6)
})

test('parseMidiFile throws on malformed bytes', () => {
  assert.throws(() => parseMidiFile(new TextEncoder().encode('not a midi file').buffer as ArrayBuffer))
})

test('MIDI file routing: extension always, dragover MIME types only', () => {
  assert.ok(isMidiFileName('song.mid'))
  assert.ok(isMidiFileName('SONG.MIDI'))
  assert.ok(!isMidiFileName('song.mid.wav'))
  assert.ok(!isMidiFileName('midi'))
  assert.ok(isMidiMimeType('audio/midi'))
  assert.ok(isMidiMimeType('audio/mid'))
  assert.ok(!isMidiMimeType('audio/mpeg'))
})

test('importMidiTracks places whole-bar blocks with block-relative notes and grows totalBars', () => {
  useProjectStore.setState({ tracks: {}, rootTrackIds: [], bpm: 120, beatsPerBar: 4, totalBars: 2 })
  const { bytes } = fixtureBytes()
  const ids = useProjectStore.getState().importMidiTracks(parseMidiFile(bytes))

  const s = useProjectStore.getState()
  assert.equal(ids.length, 2)
  assert.deepEqual(s.rootTrackIds, ids)

  const lead = s.tracks[ids[0]]
  assert.equal(lead.name, 'Lead')
  assert.equal(lead.instrumentId, 'cube')
  assert.equal(lead.type, 'base')
  assert.equal(lead.blocks.length, 1)
  // Notes span beats 0..9.5 → block covers bars 0..3 (whole bars).
  assert.equal(lead.blocks[0].startBar, 0)
  assert.equal(lead.blocks[0].durationBars, 3)
  assert.equal(lead.blocks[0].notes[2].startBeat, 9)

  const bass = s.tracks[ids[1]]
  assert.equal(bass.name, 'MIDI 2') // unnamed in the file
  // Single note at beats 4..6 → block starts at bar 1, note shifts block-relative.
  assert.equal(bass.blocks[0].startBar, 1)
  assert.equal(bass.blocks[0].durationBars, 1)
  assert.equal(bass.blocks[0].notes[0].startBeat, 0)

  // Content ends at bar 3 > the project's 2 bars → grown, not truncated.
  assert.equal(s.totalBars, 3)
})

test('importMidiTracks never shrinks the project', () => {
  useProjectStore.setState({ tracks: {}, rootTrackIds: [], bpm: 120, beatsPerBar: 4, totalBars: 32 })
  const { bytes } = fixtureBytes()
  useProjectStore.getState().importMidiTracks(parseMidiFile(bytes))
  assert.equal(useProjectStore.getState().totalBars, 32)
})
