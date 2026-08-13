import assert from 'node:assert/strict'
import test from 'node:test'
import type { Scene, Track } from '../editor/types'
import { CURRENT_VERSION, upgradeDocument } from './upgrade'

// v13 → v14: the 3D Shape's FINISH param arrives defaulting to the new Matte
// poster look; tracks saved before it existed were authored against the
// physical material and get pinned to Gloss so no saved project changes look.

const baseTrack = (id: string, instrumentId: string, params?: Record<string, number>): Track => ({
  id, name: id, type: 'base', instrumentId,
  color: '#6366f1', muted: false, solo: false, blocks: [], childIds: [],
  ...(params ? { params } : {}),
} as Track)

function v13Doc(tracks: Record<string, Track>, rootTrackIds: string[]) {
  const main: Scene = { id: 'main', name: 'Main', isMain: true, backgroundColor: '#000000', backgroundTransparent: false, tracks: {}, rootTrackIds: [] }
  const visual: Scene = { id: 'visual', name: 'Scene 1', isMain: false, backgroundColor: '#000000', backgroundTransparent: false, tracks, rootTrackIds }
  return {
    schemaVersion: 13,
    bpm: 120, beatsPerBar: 4, totalBars: 8,
    scenes: { main, visual },
    sceneOrder: ['main', 'visual'],
    activeSceneId: 'visual',
    audioTracks: {}, audioRootTrackIds: [], audioClips: {},
  }
}

test('v13 cube tracks get pinned to the Gloss finish; everything else is untouched', () => {
  const doc = upgradeDocument(v13Doc({
    plain: baseTrack('plain', 'cube'),
    withParams: baseTrack('withParams', 'cube', { size: 2, spinSpeed: 1 }),
    // A save that somehow already carries a finish keeps it.
    already: baseTrack('already', 'cube', { finish: 0 }),
    other: baseTrack('other', 'overlapSolid', { size: 1 }),
  }, ['plain', 'withParams', 'already', 'other']))

  assert.equal(doc.schemaVersion, CURRENT_VERSION)
  const tracks = doc.scenes.visual.tracks
  assert.equal(tracks.plain.params?.finish, 1)
  assert.deepEqual(tracks.withParams.params, { size: 2, spinSpeed: 1, finish: 1 })
  assert.equal(tracks.already.params?.finish, 0)
  assert.equal(tracks.other.params?.finish, undefined)
})
