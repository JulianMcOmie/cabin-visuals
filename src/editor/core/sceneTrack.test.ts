import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyDocument } from '../../persistence/types'
import { hydrate, serialize } from '../../persistence/serialize'
import type { Scene, Track } from '../types'
import { useProjectStore } from '../store/ProjectStore'
import { dematerializeSceneTrack, isSceneTrackId, sceneTrackId, sceneTrackView } from './sceneTrack'

// The scene instrument is VIRTUAL: it must be visible to every reader as an
// ordinary track and invisible to the document. These pin both halves.

function track(partial: Partial<Track> & { id: string }): Track {
  return {
    name: partial.id,
    type: 'base',
    instrumentId: 'cube',
    color: '#fff',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
    ...partial,
  }
}

function scene(partial: Partial<Scene> = {}): Scene {
  return {
    id: 's1',
    name: 'Scene 1',
    isMain: false,
    backgroundColor: '#000000',
    backgroundTransparent: false,
    tracks: {},
    rootTrackIds: [],
    ...partial,
  }
}

test('a scene with no scene instrument hands back its own record, by identity', () => {
  const s = scene({ tracks: { a: track({ id: 'a' }) }, rootTrackIds: ['a'] })
  const view = sceneTrackView(s)
  assert.equal(view.tracks, s.tracks, 'no new object for the untouched path')
  assert.equal(view.rootTrackIds, s.rootTrackIds)
})

test('the view splices the scene track in FRONT of the roots', () => {
  const s = scene({ sceneTrackEnabled: true, tracks: { a: track({ id: 'a' }) }, rootTrackIds: ['a'] })
  const view = sceneTrackView(s)
  assert.deepEqual(view.rootTrackIds, [sceneTrackId('s1'), 'a'])
  const st = view.tracks[sceneTrackId('s1')]
  assert.equal(st.type, 'group', 'it materializes as a group so group machinery carries it')
  assert.equal(st.name, 'Scene 1')
  assert.deepEqual(st.childIds, [], 'the scene\'s own tracks are NOT its children')
})

test('the view is memoized on the Scene identity, so rows and graph reuse survive', () => {
  const s = scene({ sceneTrackEnabled: true })
  assert.equal(sceneTrackView(s), sceneTrackView(s))
})

test('lanes are reparented onto the scene track, keeping their reference stable', () => {
  const lane = track({ id: 'mv', type: 'mover', moverId: 'orbit', instrumentId: '' })
  const s = scene({ sceneTrackEnabled: true, tracks: { mv: lane }, sceneTrackChildIds: ['mv'] })
  const view = sceneTrackView(s)
  assert.equal(view.tracks.mv.parentId, sceneTrackId('s1'), 'isChainChild reads this')
  const again = sceneTrackView(scene({ sceneTrackEnabled: true, tracks: { mv: lane }, sceneTrackChildIds: ['mv'] }))
  assert.equal(again.tracks.mv, view.tracks.mv, 'same original track ref → same normalized ref')
})

test('a dangling lane id is dropped rather than left to stop the tree walk', () => {
  const s = scene({ sceneTrackEnabled: true, sceneTrackChildIds: ['gone'] })
  assert.deepEqual(sceneTrackView(s).tracks[sceneTrackId('s1')].childIds, [])
})

test('dematerialize is the inverse of the view', () => {
  const lane = track({ id: 'mv', type: 'mover', moverId: 'orbit', instrumentId: '', parentId: sceneTrackId('s1') })
  const s = scene({
    sceneTrackEnabled: true,
    tracks: { a: track({ id: 'a' }), mv: lane },
    rootTrackIds: ['a'],
    sceneTrackChildIds: ['mv'],
    sceneTrackParams: { tfX: 2 },
  })
  const view = sceneTrackView(s)
  const back = dematerializeSceneTrack('s1', view.tracks, view.rootTrackIds)
  assert.deepEqual(back.rootTrackIds, ['a'], 'the synthetic id never reaches rootTrackIds')
  assert.equal(back.tracks[sceneTrackId('s1')], undefined, 'nor the tracks record')
  assert.deepEqual(back.sceneTrackChildIds, ['mv'])
  assert.deepEqual(back.sceneTrackParams, { tfX: 2 })
})

test('an untouched scene instrument stores absence, not empty objects', () => {
  const view = sceneTrackView(scene({ sceneTrackEnabled: true }))
  const back = dematerializeSceneTrack('s1', view.tracks, view.rootTrackIds)
  assert.equal(back.sceneTrackParams, undefined)
  assert.equal(back.sceneTrackChildIds, undefined)
})

// ── Through the store ────────────────────────────────────────────────────────

function freshScene(): string {
  hydrate(emptyDocument())
  return useProjectStore.getState().activeSceneId
}

/** Root ids minus the seeded Lighting group every fresh scene is born with. */
function contentRoots(scene: { rootTrackIds: string[]; tracks: Record<string, Track> }): string[] {
  return scene.rootTrackIds.filter((id) => scene.tracks[id]?.name !== 'Lighting')
}

test('the toggle publishes the row into the flattened view and back out', () => {
  const id = freshScene()
  useProjectStore.getState().addTrack(track({ id: 'a' }))
  assert.equal(useProjectStore.getState().tracks[sceneTrackId(id)], undefined)

  useProjectStore.getState().setSceneTrackEnabled(id, true)
  assert.ok(useProjectStore.getState().tracks[sceneTrackId(id)], 'visible as an ordinary track')
  assert.equal(useProjectStore.getState().rootTrackIds[0], sceneTrackId(id))
  assert.equal(useProjectStore.getState().scenes[id].tracks[sceneTrackId(id)], undefined, 'never in the document')

  useProjectStore.getState().setSceneTrackEnabled(id, false)
  assert.equal(useProjectStore.getState().tracks[sceneTrackId(id)], undefined)
  assert.equal(useProjectStore.getState().scenes[id].sceneTrackEnabled, undefined, 'off is absence')
})

test('an ordinary track action writes the scene instrument through to the Scene', () => {
  const id = freshScene()
  useProjectStore.getState().setSceneTrackEnabled(id, true)
  useProjectStore.getState().setTrackParam(sceneTrackId(id), 'tfX', 3)
  assert.deepEqual(useProjectStore.getState().scenes[id].sceneTrackParams, { tfX: 3 })
  assert.equal(useProjectStore.getState().tracks[sceneTrackId(id)].params?.tfX, 3, 'and reads back')
})

test('a colorizer added under the scene row lands in sceneTrackChildIds', () => {
  const id = freshScene()
  useProjectStore.getState().setSceneTrackEnabled(id, true)
  useProjectStore.getState().addTrack(track({
    id: 'cz', type: 'mover', moverId: 'colorizer', instrumentId: '', parentId: sceneTrackId(id),
  }))
  const s = useProjectStore.getState().scenes[id]
  assert.deepEqual(s.sceneTrackChildIds, ['cz'])
  assert.deepEqual(contentRoots(s), [], 'a scene lane is not a root track')
  assert.ok(s.tracks.cz, 'but the lane itself is a real track in the document')
})

test('an object dropped on the scene row lands at root instead', () => {
  const id = freshScene()
  useProjectStore.getState().setSceneTrackEnabled(id, true)
  useProjectStore.getState().addTrack(track({ id: 'a', parentId: sceneTrackId(id) }))
  assert.deepEqual(contentRoots(useProjectStore.getState().scenes[id]), ['a'])
  assert.deepEqual(useProjectStore.getState().scenes[id].sceneTrackChildIds, undefined)
})

test('the scene instrument cannot be deleted, moved or dissolved', () => {
  const id = freshScene()
  useProjectStore.getState().setSceneTrackEnabled(id, true)
  useProjectStore.getState().setTrackParam(sceneTrackId(id), 'tfX', 5)
  useProjectStore.getState().deleteTrack(sceneTrackId(id))
  useProjectStore.getState().ungroupTrack(sceneTrackId(id))
  useProjectStore.getState().setTrackParent(sceneTrackId(id), null, 0)
  assert.ok(useProjectStore.getState().tracks[sceneTrackId(id)], 'still there')
  assert.deepEqual(useProjectStore.getState().scenes[id].sceneTrackParams, { tfX: 5 }, 'and unharmed')
})

test('it survives a serialize/hydrate round trip, lanes included', () => {
  const id = freshScene()
  useProjectStore.getState().setSceneTrackEnabled(id, true)
  useProjectStore.getState().setTrackParam(sceneTrackId(id), 'tfSize', 2)
  useProjectStore.getState().addTrack(track({
    id: 'cz', type: 'mover', moverId: 'colorizer', instrumentId: '', parentId: sceneTrackId(id),
  }))
  hydrate(serialize())
  const s = useProjectStore.getState().scenes[id]
  assert.equal(s.sceneTrackEnabled, true)
  assert.deepEqual(s.sceneTrackParams, { tfSize: 2 })
  assert.deepEqual(s.sceneTrackChildIds, ['cz'])
  assert.ok(useProjectStore.getState().tracks[sceneTrackId(id)], 'and re-materializes on load')
})

test('duplicating a scene clones its scene instrument onto fresh lane ids', () => {
  const id = freshScene()
  useProjectStore.getState().setSceneTrackEnabled(id, true)
  useProjectStore.getState().addTrack(track({
    id: 'cz', type: 'mover', moverId: 'colorizer', instrumentId: '', parentId: sceneTrackId(id),
  }))
  const copyId = useProjectStore.getState().duplicateScene(id)!
  const copy = useProjectStore.getState().scenes[copyId]
  assert.equal(copy.sceneTrackEnabled, true)
  assert.equal(copy.sceneTrackChildIds?.length, 1)
  assert.notEqual(copy.sceneTrackChildIds?.[0], 'cz', 'fresh ids, per the clone convention')
  assert.equal(copy.tracks[copy.sceneTrackChildIds![0]].parentId, sceneTrackId(copyId))
})

test('isSceneTrackId only claims scene track ids', () => {
  assert.equal(isSceneTrackId(sceneTrackId('abc')), true)
  assert.equal(isSceneTrackId('abc'), false)
  assert.equal(isSceneTrackId(undefined), false)
})
