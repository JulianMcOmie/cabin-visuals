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
})
