import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyDocument } from './types'
import { CURRENT_VERSION, upgradeDocument } from './upgrade'

const track = (id: string, type = 'base', parentId?: string, childIds: string[] = []) => ({
  id, name: id, type, instrumentId: type === 'base' ? 'cube' : '',
  color: '#fff', muted: false, solo: false, blocks: [], parentId, childIds,
})

test('v19 drops unsupported track subtrees and their arrangement references without mutating the save', () => {
  const raw = {
    ...emptyDocument(), schemaVersion: 18,
    scenes: {
      visual: {
        id: 'visual', name: 'Visual', rootTrackIds: ['cube', 'oldRoot', 'rack'], sceneTrackChildIds: ['oldSceneLane'],
        tracks: {
          cube: track('cube', 'base', undefined, ['oldLane', 'automation']),
          oldLane: track('oldLane', 'unsupported', 'cube', ['nested']),
          nested: track('nested', 'automation', 'oldLane'),
          automation: track('automation', 'automation', 'cube'),
          oldRoot: track('oldRoot', 'unsupported'),
          oldSceneLane: track('oldSceneLane', 'unsupported'),
          rack: { ...track('rack', 'switcher'), switcherBindings: [{ pitch: 60, childTrackId: 'oldRoot' }] },
        },
      },
    },
    audioTracks: { audio: track('audio', 'audio'), oldAudio: track('oldAudio', 'unsupported') },
    audioRootTrackIds: ['audio', 'oldAudio'],
  }
  const before = structuredClone(raw)
  const doc = upgradeDocument(raw)
  assert.equal(doc.schemaVersion, CURRENT_VERSION)
  const scene = doc.scenes.visual
  assert.deepEqual(Object.keys(scene.tracks), ['cube', 'automation', 'rack'])
  assert.deepEqual(scene.tracks.cube.childIds, ['automation'])
  assert.deepEqual(scene.rootTrackIds, ['cube', 'rack'])
  assert.deepEqual(scene.sceneTrackChildIds, [])
  assert.deepEqual(scene.tracks.rack.switcherBindings, [])
  assert.deepEqual(doc.audioRootTrackIds, ['audio'])
  assert.deepEqual(Object.keys(doc.audioTracks), ['audio'])
  assert.deepEqual(raw, before)
  assert.deepEqual(upgradeDocument(doc), doc)
})

test('new documents carry the current schema version', () => {
  assert.equal(emptyDocument().schemaVersion, CURRENT_VERSION)
})
