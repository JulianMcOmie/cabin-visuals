import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../editor/types'
import { CURRENT_VERSION, upgradeDocument } from './upgrade'
import { defaultLightingTracks, isLightingOnlyTrack } from '../editor/core/defaultLighting'

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

test('v18 upgrade seeds the default Lighting group into pre-lighting scenes', () => {
  const doc = upgradeDocument(v17Doc({ visual: cube }, ['visual']))
  assert.equal(doc.schemaVersion, CURRENT_VERSION)

  // Main composes scenes and gets no lights.
  assert.deepEqual(doc.scenes.main.rootTrackIds, [])

  const scene = doc.scenes.one
  assert.equal(scene.rootTrackIds.length, 2)
  const [groupId, contentId] = scene.rootTrackIds
  assert.equal(contentId, 'visual')
  const group = scene.tracks[groupId]
  assert.equal(group.type, 'group')
  assert.equal(group.name, 'Lighting')
  assert.equal(group.childIds.length, 5)

  const lights = group.childIds.map((id) => scene.tracks[id])
  for (const light of lights) {
    assert.equal(light.type, 'base')
    assert.equal(light.instrumentId, 'light')
    assert.equal(light.parentId, groupId)
    assert.equal(light.params?.bulb, 0)
  }
  // The seeded values are the old hardcoded rig's - spot-check the key light.
  const key = lights.find((t) => t.name === 'Key Light')!
  assert.equal(key.params?.type, 2)
  assert.equal(key.params?.intensity, 2.4)
  assert.equal(key.params?.castShadow, 1)
  assert.deepEqual([key.params?.tfX, key.params?.tfY, key.params?.tfZ], [4, 7, 5])
  // The group qualifies as lighting-only, so the empty-scene helper stays.
  assert.ok(isLightingOnlyTrack(group, scene.tracks))
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
