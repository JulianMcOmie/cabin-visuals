import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyDocument } from '../../persistence/types'
import { hydrate, serialize } from '../../persistence/serialize'
import { useProjectStore } from './ProjectStore'
import { placeDrumMidi } from '../utils/drumMidi'
import type { AudioBlock } from '../types'

const audio: AudioBlock = { id: 'song', clipRef: 'u/p/c', startBar: 2, trimStart: 1, trimEnd: 8 }
test('MIDI imports are additive, persist, and retain manual edits through BPM changes in inactive scenes', () => {
  hydrate(emptyDocument())
  let s = useProjectStore.getState()
  s.addTrack({ id: 'audio', name: 'Song', type: 'audio', instrumentId: 'audio', color: '#fff', muted: false, solo: false, blocks: [], childIds: [], audioBlocks: [audio] })
  const originalTracks = useProjectStore.getState().tracks
  const originalTempo = s.bpm
  const imported = placeDrumMidi([{ time: 2, velocity: 80 }, { time: 3, velocity: 90 }], 'kick', audio, s.bpm, s.beatsPerBar)
  const [id] = s.importMidiTracks([imported])
  s = useProjectStore.getState()
  const track = s.tracks[id]
  assert.equal(track.instrumentId, 'midiRoll')
  assert.equal(track.blocks[0].notes.length, 2)
  for (const [key, value] of Object.entries(originalTracks)) assert.deepEqual(s.tracks[key], value)
  // Simulate a cleaned-up note list through the document action: deleting a
  // detection must stay deleted, including after serialization and tempo edits.
  s.updateBlockNotes(id, track.blocks[0].id, [track.blocks[0].notes[0]])
  hydrate(serialize())
  s = useProjectStore.getState()
  const sceneId = s.activeSceneId
  const before = s.tracks[id]
  s.setActiveScene(s.sceneOrder.find((sid) => sid !== sceneId)!)
  s.setBpm(originalTempo * 1.25)
  s = useProjectStore.getState()
  const after = s.scenes[sceneId].tracks[id]
  assert.equal(after.blocks[0].notes.length, 1)
  assert.equal(after.blocks[0].notes[0].id, before.blocks[0].notes[0].id)
  const abs = (t: typeof after) => t.blocks[0].startBar * s.beatsPerBar + t.blocks[0].notes[0].startBeat
  const anchor = audio.startBar * s.beatsPerBar
  assert.ok(Math.abs((abs(after) - anchor) / s.bpm - (abs(before) - anchor) / originalTempo) < 1e-8)
  s.setActiveScene(sceneId)
  s.setBpm(originalTempo)
  assert.ok(Math.abs(abs(useProjectStore.getState().tracks[id]) - abs(before)) < 1e-8)
})

test('a single tempo edit rescales drum tracks in both active and inactive scenes', () => {
  hydrate(emptyDocument())
  let s = useProjectStore.getState()
  const tempo = s.bpm
  const firstScene = s.activeSceneId
  const [first] = s.importMidiTracks([placeDrumMidi([{ time: 2, velocity: 80 }], 'kick', audio, tempo, s.beatsPerBar)])
  s.setActiveScene(s.sceneOrder.find((id) => id !== firstScene)!)
  s = useProjectStore.getState()
  const [second] = s.importMidiTracks([placeDrumMidi([{ time: 2, velocity: 80 }], 'snare', audio, tempo, s.beatsPerBar)])
  s.setBpm(tempo * 1.2)
  s = useProjectStore.getState()
  const a = s.scenes[firstScene].tracks[first].blocks[0]
  const b = s.tracks[second].blocks[0]
  assert.equal(a.startBar, b.startBar)
  assert.equal(a.notes[0].startBeat, b.notes[0].startBeat)
  assert.equal(a.notes[0].durationBeats, b.notes[0].durationBeats)
})
