import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../editor/types'
import { upgradeDocument } from './upgrade'

const visual: Track = { id: 'visual', name: 'Cube', type: 'base', instrumentId: 'cube', color: '#fff', muted: false, solo: false, blocks: [], childIds: [] }
const audio: Track = { id: 'audio', name: 'Audio', type: 'audio', instrumentId: '', color: '#0ff', muted: false, solo: false, blocks: [], childIds: [], audioBlocks: [] }

test('v4 migration creates Main and Scene 1 with exclusive visual ownership', () => {
  const doc = upgradeDocument({
    schemaVersion: 4,
    bpm: 120,
    beatsPerBar: 4,
    totalBars: 32,
    tracks: { visual, audio },
    rootTrackIds: ['audio', 'visual'],
    audioClips: {},
  })
  const main = doc.sceneOrder.map((id) => doc.scenes[id]).find((s) => s.isMain)
  const first = doc.sceneOrder.map((id) => doc.scenes[id]).find((s) => !s.isMain)
  assert.ok(main)
  assert.ok(first)
  assert.deepEqual(main.rootTrackIds, [])
  assert.deepEqual(first.rootTrackIds, ['visual'])
  assert.equal(first.tracks.visual, visual)
  assert.equal(doc.audioTracks.audio, audio)
  assert.deepEqual(doc.audioRootTrackIds, ['audio'])
  assert.equal(main.backgroundColor, '#000000')
  assert.equal(first.backgroundColor, '#000000')
})

test('v5 migration gives every existing scene a black background', () => {
  const doc = upgradeDocument({
    schemaVersion: 5,
    bpm: 120,
    beatsPerBar: 4,
    totalBars: 32,
    scenes: {
      main: { id: 'main', name: 'Main', isMain: true, tracks: {}, rootTrackIds: [] },
      one: { id: 'one', name: 'Scene 1', isMain: false, tracks: { visual }, rootTrackIds: ['visual'] },
    },
    sceneOrder: ['main', 'one'],
    activeSceneId: 'one',
    audioTracks: {},
    audioRootTrackIds: [],
    audioClips: {},
  })

  assert.equal(doc.schemaVersion, 6)
  assert.equal(doc.scenes.main.backgroundColor, '#000000')
  assert.equal(doc.scenes.one.backgroundColor, '#000000')
})
