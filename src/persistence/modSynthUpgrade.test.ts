import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../editor/types'
import { emptyDocument } from './types'
import { CURRENT_VERSION, upgradeDocument } from './upgrade'

function legacyTrack(id: string): Track & { synthMods?: unknown[] } {
  return {
    id, name: 'Mod Synth', type: 'base', instrumentId: 'modSynth',
    color: '#f5b455', muted: false, solo: false, childIds: [],
    blocks: [{ id: 'phrase', startBar: 0, durationBars: 2, loop: false,
      notes: [{ id: 'note', pitch: 61, startBeat: 1, durationBeats: 3, velocity: 100 }] }],
    synthMods: [{ id: 'custom-envelope', target: 'size' }],
  }
}

test('retired synth tracks become cubes across scenes, preserving the arrangement and source document', () => {
  const raw = emptyDocument()
  raw.schemaVersion = 21
  const [main, visual] = Object.values(raw.scenes)
  main.tracks.synth = legacyTrack('synth')
  main.rootTrackIds.push('synth')
  const customized = {
    ...legacyTrack('custom'), name: 'My chorus', parentId: 'group', childIds: ['lane'],
    params: { size: 2.5, tfX: 4, tfOpacity: 0.6 }, stringParams: { color: '#123456' },
    paramsByInstrument: { modSynth: { params: { size: 3 } }, circle: { params: { size: 0.4 } } },
    effects: [],
  }
  visual.tracks.custom = customized
  visual.tracks.group = { ...legacyTrack('group'), type: 'group', instrumentId: '', childIds: ['custom'], blocks: [] }
  visual.tracks.lane = { ...legacyTrack('lane'), type: 'automation', instrumentId: '', parentId: 'custom', targetParam: 'size' }
  visual.rootTrackIds.push('group')
  const before = structuredClone(raw)
  const doc = upgradeDocument(raw)
  const basic = doc.scenes[main.id].tracks.synth
  const custom = doc.scenes[visual.id].tracks.custom
  assert.equal(doc.schemaVersion, CURRENT_VERSION)
  assert.equal(basic.instrumentId, 'cube')
  assert.equal(basic.name, '3D Shape')
  assert.deepEqual(basic.stringParams, { geometry: 'cube', baseColor: '#f5b455' })
  assert.equal(basic.params?.size, 1)
  assert.equal(custom.name, 'My chorus')
  assert.deepEqual(custom.params, customized.params)
  assert.deepEqual(custom.stringParams, { geometry: 'cube', baseColor: '#123456' })
  assert.deepEqual(custom.blocks, customized.blocks)
  assert.deepEqual(custom.effects, customized.effects)
  assert.equal(custom.parentId, 'group')
  assert.deepEqual(custom.childIds, ['lane'])
  assert.equal(doc.scenes[visual.id].tracks.lane.targetParam, 'size')
  assert.deepEqual(doc.scenes[visual.id].rootTrackIds, visual.rootTrackIds)
  assert.deepEqual(custom.paramsByInstrument, { circle: { params: { size: 0.4 } } })
  assert.ok(!('synthMods' in custom))
  assert.deepEqual(raw, before)
  assert.deepEqual(upgradeDocument(doc), doc)
})

test('retirement cleans stale synth data on swapped and audio tracks without changing their instruments', () => {
  const raw = emptyDocument()
  raw.schemaVersion = 21
  const visual = raw.scenes[raw.activeSceneId!]
  visual.tracks.swapped = { ...legacyTrack('swapped'), instrumentId: 'circle',
    paramsByInstrument: { modSynth: { params: { size: 2 } } } }
  raw.audioTracks.audio = { ...legacyTrack('audio'), type: 'audio', instrumentId: '', audioBlocks: [] }
  raw.audioRootTrackIds = ['audio']
  const doc = upgradeDocument(raw)
  const swapped = doc.scenes[visual.id].tracks.swapped
  assert.equal(swapped.instrumentId, 'circle')
  assert.ok(!('synthMods' in swapped))
  assert.ok(!('paramsByInstrument' in swapped))
  assert.equal(doc.audioTracks.audio.type, 'audio')
  assert.ok(!('synthMods' in doc.audioTracks.audio))
  assert.deepEqual(doc.audioRootTrackIds, ['audio'])
})

test('unrelated tracks and fresh documents are unaffected by synth retirement', () => {
  const raw = emptyDocument()
  const before = structuredClone(raw)
  assert.equal(raw.schemaVersion, CURRENT_VERSION)
  assert.deepEqual(upgradeDocument(raw), before)
  raw.schemaVersion = 21
  const doc = upgradeDocument(raw)
  assert.deepEqual(doc, before)
})
