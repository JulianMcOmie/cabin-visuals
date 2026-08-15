import assert from 'node:assert/strict'
import test from 'node:test'
import type { Scene } from '../editor/types'
import { CURRENT_VERSION, upgradeDocument } from './upgrade'

// v15 → v16: the Main scene is called "Composite" now. isMain scenes were
// never user-renamable, so the rename is unconditional; ordinary scenes keep
// whatever the user named them.

function v15Doc() {
  const main: Scene = { id: 'main', name: 'Main', isMain: true, backgroundColor: '#000000', backgroundTransparent: false, tracks: {}, rootTrackIds: [] }
  const visual = { id: 'visual', name: 'My Chorus', isMain: false, backgroundColor: '#000000', backgroundTransparent: false, tracks: {}, rootTrackIds: [] }
  return {
    schemaVersion: 15,
    bpm: 120, beatsPerBar: 4, totalBars: 8,
    scenes: { main, visual },
    sceneOrder: ['main', 'visual'],
    activeSceneId: 'visual',
    audioTracks: {}, audioRootTrackIds: [], audioClips: {},
  }
}

test('the isMain scene is renamed to Composite; user-named scenes are untouched', () => {
  const doc = upgradeDocument(v15Doc())
  assert.equal(doc.schemaVersion, CURRENT_VERSION)
  assert.equal(doc.scenes.main.name, 'Composite')
  assert.equal(doc.scenes.visual.name, 'My Chorus')
})
