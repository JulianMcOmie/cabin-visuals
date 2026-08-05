import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../editor/types'
import { CURRENT_VERSION, upgradeDocument } from './upgrade'

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
  assert.deepEqual(first.tracks.visual, {
    ...visual,
    params: {},
    stringParams: { baseColor: '#5757db' },
  })
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

  assert.equal(doc.schemaVersion, CURRENT_VERSION)
  assert.equal(doc.scenes.main.backgroundColor, '#000000')
  assert.equal(doc.scenes.one.backgroundColor, '#000000')
})

test('v6 migration removes modifiers and promotes their nested tracks', () => {
  const modifier = {
    id: 'modifier', name: 'Suppress', type: 'suppress', instrumentId: '', color: '#f00',
    muted: false, solo: false, blocks: [], childIds: ['modifier-child'], parentId: 'visual',
  }
  const modifierChild: Track = {
    id: 'modifier-child', name: 'Nested lane', type: 'automation', instrumentId: '', color: '#333',
    muted: false, solo: false, blocks: [], childIds: [], parentId: 'modifier',
  }
  const visualWithModifier: Track = { ...visual, childIds: ['modifier'] }
  const doc = upgradeDocument({
    schemaVersion: 6,
    bpm: 120,
    beatsPerBar: 4,
    totalBars: 32,
    scenes: {
      main: { id: 'main', name: 'Main', isMain: true, backgroundColor: '#000', tracks: {}, rootTrackIds: [] },
      one: {
        id: 'one', name: 'Scene 1', isMain: false, backgroundColor: '#000',
        tracks: { visual: visualWithModifier, modifier, 'modifier-child': modifierChild },
        rootTrackIds: ['visual'],
      },
    },
    sceneOrder: ['main', 'one'],
    activeSceneId: 'one',
    audioTracks: {},
    audioRootTrackIds: [],
    audioClips: {},
  })

  assert.equal(doc.schemaVersion, CURRENT_VERSION)
  assert.deepEqual(doc.scenes.one.rootTrackIds, ['visual'])
  assert.deepEqual(doc.scenes.one.tracks.visual.childIds, ['modifier-child'])
  assert.equal(doc.scenes.one.tracks.modifier, undefined)
  assert.equal(doc.scenes.one.tracks['modifier-child'].parentId, 'visual')
})

test('v7 migration keeps existing scene backgrounds opaque', () => {
  const doc = upgradeDocument({
    schemaVersion: 7,
    bpm: 120,
    beatsPerBar: 4,
    totalBars: 32,
    scenes: {
      main: { id: 'main', name: 'Main', isMain: true, backgroundColor: '#000', tracks: {}, rootTrackIds: [] },
      one: { id: 'one', name: 'Scene 1', isMain: false, backgroundColor: '#123456', tracks: { visual }, rootTrackIds: ['visual'] },
    },
    sceneOrder: ['main', 'one'],
    activeSceneId: 'one',
    audioTracks: {},
    audioRootTrackIds: [],
    audioClips: {},
  })

  assert.equal(doc.schemaVersion, CURRENT_VERSION)
  assert.equal(doc.scenes.main.backgroundTransparent, false)
  assert.equal(doc.scenes.one.backgroundTransparent, false)
})

test('v8 migration converts basic-shape hue sliders to concrete colors', () => {
  const hueCube: Track = { ...visual, params: { baseHue: 200, baseSize: 2 } }
  const doc = upgradeDocument({
    schemaVersion: 8,
    bpm: 120,
    beatsPerBar: 4,
    totalBars: 32,
    scenes: {
      main: { id: 'main', name: 'Main', isMain: true, backgroundColor: '#000', backgroundTransparent: false, tracks: {}, rootTrackIds: [] },
      one: { id: 'one', name: 'Scene 1', isMain: false, backgroundColor: '#000', backgroundTransparent: false, tracks: { visual: hueCube }, rootTrackIds: ['visual'] },
    },
    sceneOrder: ['main', 'one'],
    activeSceneId: 'one',
    audioTracks: {},
    audioRootTrackIds: [],
    audioClips: {},
  })

  assert.equal(doc.schemaVersion, CURRENT_VERSION)
  assert.equal(doc.scenes.one.tracks.visual.stringParams?.baseColor, '#57afdb')
  assert.deepEqual(doc.scenes.one.tracks.visual.params, { tfSize: 1.25 })
})

test('v10 migration pins existing oscilloscopes to the screen', () => {
  // The scope became a real in-scene object at v11; everything authored before
  // that was drawn against the pinned full-frame overlay, so it keeps it. Other
  // instruments must not pick up the param.
  const scope: Track = { ...visual, id: 'scope', name: 'Oscilloscope', instrumentId: 'oscilloscope', params: { lineWidth: 8 } }
  const doc = upgradeDocument({
    schemaVersion: 10,
    bpm: 120,
    beatsPerBar: 4,
    totalBars: 32,
    scenes: {
      main: { id: 'main', name: 'Main', isMain: true, backgroundColor: '#000', backgroundTransparent: false, tracks: {}, rootTrackIds: [] },
      one: { id: 'one', name: 'Scene 1', isMain: false, backgroundColor: '#000', backgroundTransparent: false, tracks: { scope, visual }, rootTrackIds: ['scope', 'visual'] },
    },
    sceneOrder: ['main', 'one'],
    activeSceneId: 'one',
    audioTracks: {},
    audioRootTrackIds: [],
    audioClips: {},
  })

  assert.equal(doc.schemaVersion, CURRENT_VERSION)
  assert.deepEqual(doc.scenes.one.tracks.scope.params, { lineWidth: 8, fitToScreen: 1 })
  assert.equal(doc.scenes.one.tracks.visual.params?.fitToScreen, undefined)
})
