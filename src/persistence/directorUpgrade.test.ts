import assert from 'node:assert/strict'
import test from 'node:test'
import type { Scene, Track } from '../editor/types'
import type { ProjectState } from '../editor/store/ProjectStore'
import { CURRENT_VERSION, upgradeDocument } from './upgrade'
import { computeAtBeat, getCompositionLayers, setProject } from '../editor/core/visual/VisualEngine'

// v11 → v12: directors de-specialized into composition instruments. These pin
// the migration (shape fidelity) and then feed the upgraded document through
// the real engine, so the upgrade is proven against behavior, not just shape.

const legacyDirector = (id: string, directorId: string | undefined, extra: Partial<Track> = {}): Track => ({
  id, name: id, type: 'director' as Track['type'], instrumentId: '',
  ...(directorId ? { directorId } : {}),
  color: '#6366f1', muted: false, solo: false, blocks: [], childIds: [],
  sceneBindings: [{ pitch: 60, sceneId: 'visual' }],
  ...extra,
} as Track)

const visualScene: Scene = { id: 'visual', name: 'Scene 1', isMain: false, backgroundColor: '#000000', backgroundTransparent: false, tracks: {}, rootTrackIds: [] }

function v11Doc(mainTracks: Record<string, Track>, rootTrackIds: string[]) {
  const main: Scene = { id: 'main', name: 'Main', isMain: true, backgroundColor: '#000000', backgroundTransparent: false, tracks: mainTracks, rootTrackIds }
  return {
    schemaVersion: 11,
    bpm: 120, beatsPerBar: 4, totalBars: 8,
    scenes: { main, visual: visualScene },
    sceneOrder: ['main', 'visual'],
    activeSceneId: 'main',
    audioTracks: {}, audioRootTrackIds: [], audioClips: {},
  }
}

test('v11 directors become base tracks named by their composition instrumentId', () => {
  const lane: Track = {
    id: 'lane', name: 'Angle', type: 'automation', instrumentId: '', parentId: 'crop1',
    targetParam: 'angle', interpolation: 'linear',
    color: '#fff', muted: false, solo: false, blocks: [], childIds: [],
  }
  const doc = upgradeDocument(v11Doc({
    switcher: legacyDirector('switcher', 'sceneSwitcher'),
    cut1: legacyDirector('cut1', 'cut', { params: { sceneCount: 2 } }),
    ring: legacyDirector('ring', 'radialCut'),
    crop1: legacyDirector('crop1', 'crop', { childIds: ['lane'], params: { divisions: 4 } }),
    lane,
    relic: legacyDirector('relic', undefined),
  }, ['switcher', 'cut1', 'ring', 'crop1', 'relic']))

  assert.equal(doc.schemaVersion, CURRENT_VERSION)
  const tracks = doc.scenes.main.tracks
  for (const [id, instrumentId] of [
    ['switcher', 'sceneSwitcher'], ['cut1', 'cut'], ['ring', 'radialCut'], ['crop1', 'crop'],
    // A directorId-less director can only be the pre-first-UI switcher.
    ['relic', 'sceneSwitcher'],
  ] as const) {
    assert.equal(tracks[id].type, 'base', `${id} type`)
    assert.equal(tracks[id].instrumentId, instrumentId, `${id} instrumentId`)
    assert.ok(!('directorId' in tracks[id]), `${id} sheds directorId`)
  }
  // Everything else rides through untouched: bindings, params, child lanes.
  assert.deepEqual(tracks.crop1.sceneBindings, [{ pitch: 60, sceneId: 'visual' }])
  assert.deepEqual(tracks.crop1.params, { divisions: 4 })
  assert.deepEqual(tracks.crop1.childIds, ['lane'])
  assert.ok(tracks.lane, 'lane still present')
  assert.equal(tracks.lane.type, 'automation')
  assert.equal(tracks.cut1.params?.sceneCount, 2)
})

test('an upgraded document composes through the real engine like the director era', () => {
  const held = (id: string, directorId: string, pitch: number): Track => legacyDirector(id, directorId, {
    blocks: [{
      id: `${id}-b`, startBar: 0, durationBars: 2, loop: false,
      notes: [{ id: `${id}-n`, startBeat: 0, durationBeats: 8, pitch, velocity: 100 }],
    }],
  })
  const doc = upgradeDocument(v11Doc({
    // Switcher holds its scene row; crop holds slice 1 of its bound scene.
    switcher: held('switcher', 'sceneSwitcher', 60),
    crop1: { ...held('crop1', 'crop', 60), params: { divisions: 3 } },
  }, ['switcher', 'crop1']))

  setProject(doc as unknown as ProjectState)
  computeAtBeat(1)
  const layers = getCompositionLayers()
  // Bottom-to-top: crop (lower row) resolves first, switcher renders last.
  assert.deepEqual(layers.map((l) => l.directorTrackId), ['crop1', 'switcher'])
  assert.equal(layers[0].sceneId, 'visual')
  assert.deepEqual(layers[0].partition, { kind: 'slice', index: 0, count: 3, angle: 0, radial: false })
  assert.equal(layers[1].sceneId, 'visual')
  assert.equal(layers[1].partition, undefined)
})
