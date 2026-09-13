import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../editor/types'
import { CURRENT_VERSION, upgradeDocument } from './upgrade'
import { defaultLightingTracks } from './fixtures/defaultLighting'
import { isLightingOnlyTrack } from '../editor/core/lightingTracks'
import { emptyDocument } from './types'

const cube: Track = { id: 'visual', name: 'Cube', type: 'base', instrumentId: 'cube', color: '#fff', muted: false, solo: false, blocks: [], childIds: [] }

function v17Doc(sceneTracks: Record<string, Track>, rootTrackIds: string[]) {
  return {
    schemaVersion: 17,
    bpm: 120,
    beatsPerBar: 4,
    totalBars: 32,
    scenes: {
      main: { id: 'main', name: 'Composite', isMain: true, backgroundColor: '#000', backgroundTransparent: false, tracks: {}, rootTrackIds: [] },
      one: { id: 'one', name: 'Scene 1', isMain: false, backgroundColor: '#000', backgroundTransparent: false, tracks: sceneTracks, rootTrackIds },
    },
    sceneOrder: ['main', 'one'],
    activeSceneId: 'one',
    audioTracks: {},
    audioRootTrackIds: [],
    audioClips: {},
  }
}

test('pre-lighting documents finish upgrading without a default rig', () => {
  const doc = upgradeDocument(v17Doc({ visual: cube }, ['visual']))
  assert.equal(doc.schemaVersion, CURRENT_VERSION)
  assert.deepEqual(doc.scenes.main.rootTrackIds, [])
  assert.deepEqual(doc.scenes.one.rootTrackIds, ['visual'])
  assert.deepEqual(doc.scenes.one.tracks, { visual: cube })
})

test('v18 upgrade leaves scenes that already have a light track alone', () => {
  const myLight: Track = { id: 'lamp', name: 'My Lamp', type: 'base', instrumentId: 'light', color: '#ff0', muted: false, solo: false, blocks: [], childIds: [] }
  const doc = upgradeDocument(v17Doc({ visual: cube, lamp: myLight }, ['visual', 'lamp']))
  assert.deepEqual(doc.scenes.one.rootTrackIds, ['visual', 'lamp'])
  assert.equal(Object.keys(doc.scenes.one.tracks).length, 2)
})

test('defaultLightingTracks builds a consistent, freshly-idd rig', () => {
  const a = defaultLightingTracks()
  const b = defaultLightingTracks()
  const group = a.tracks[a.rootId]
  assert.equal(group.type, 'group')
  assert.equal(group.childIds.length, 5)
  for (const id of group.childIds) {
    const light = a.tracks[id]
    assert.equal(light.instrumentId, 'light')
    assert.equal(light.parentId, a.rootId)
  }
  // Fresh ids on every call - two scenes never share track ids.
  assert.ok(!(a.rootId in b.tracks))
  assert.ok(isLightingOnlyTrack(group, a.tracks))
  assert.ok(!isLightingOnlyTrack(a.tracks[group.childIds[0]] && { ...cube }, a.tracks))
})

function seededDocument() {
  const rig = defaultLightingTracks()
  const doc = { ...v17Doc({ ...rig.tracks, visual: cube }, [rig.rootId, 'visual']), schemaVersion: 22 }
  return { doc, rig }
}

test('saved default rigs are removed without mutating the source or visual content', () => {
  const { doc, rig } = seededDocument()
  const before = structuredClone(doc)
  const upgraded = upgradeDocument(doc)
  assert.deepEqual(upgraded.scenes.one.tracks, { visual: cube })
  assert.deepEqual(upgraded.scenes.one.rootTrackIds, ['visual'])
  assert.deepEqual(doc, before)
  assert.ok(doc.scenes.one.tracks[rig.rootId])
  assert.deepEqual(upgradeDocument(upgraded), upgraded)
})

test('customized rigs and manually added lights survive upgrading', () => {
  const changes: Array<(tracks: Record<string, Track>, groupId: string, lightId: string) => void> = [
    (tracks, _group, light) => { tracks[light].params!.intensity = 8 },
    (tracks, group) => { tracks[group].name = 'My Lighting' },
    (tracks, group) => { tracks[group].params = { tfX: 2 } },
    (tracks, _group, light) => { tracks[light].muted = true },
    (tracks, group, light) => {
      tracks[light].childIds = ['automation']
      tracks.automation = { ...cube, id: 'automation', type: 'automation', parentId: light }
    },
    (tracks, group) => {
      tracks.visual.targets = [{ port: 'transform', amount: 1, scope: { kind: 'track', id: group } }]
    },
  ]
  for (const change of changes) {
    const { doc, rig } = seededDocument()
    change(doc.scenes.one.tracks, rig.rootId, rig.tracks[rig.rootId].childIds[0])
    assert.deepEqual(upgradeDocument(doc).scenes, doc.scenes)
  }
})

test('fresh documents have no lights and remain empty after upgrading', () => {
  const doc = emptyDocument()
  assert.equal(doc.schemaVersion, CURRENT_VERSION)
  for (const scene of Object.values(upgradeDocument(doc).scenes)) {
    assert.deepEqual(scene.tracks, {})
    assert.deepEqual(scene.rootTrackIds, [])
  }
})
