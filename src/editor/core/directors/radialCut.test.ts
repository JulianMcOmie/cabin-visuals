import assert from 'node:assert/strict'
import test from 'node:test'
import type { Scene, Track } from '../../types'
import { radialCutDirector } from './radialCut'

const scene = (id: string, name: string, isMain = false): Scene => ({
  id, name, isMain, backgroundColor: '#000000', backgroundTransparent: false, tracks: {}, rootTrackIds: [],
})
const scenes = {
  main: scene('main', 'Main', true),
  one: scene('one', 'Scene 1'),
  two: scene('two', 'Scene 2'),
  three: scene('three', 'Scene 3'),
  four: scene('four', 'Scene 4'),
}

const track: Track = {
  id: 'radial', name: 'Radial Cut', type: 'director', instrumentId: '', directorId: 'radialCut',
  color: '#6366f1', muted: false, solo: false, childIds: [],
  sceneBindings: [
    { pitch: 60, sceneId: 'three' },
    { pitch: 61, sceneId: 'one' },
    { pitch: 62, sceneId: 'two' },
    { pitch: 63, sceneId: 'four' },
  ],
  blocks: [{
    id: 'b', startBar: 0, durationBars: 2, loop: false,
    notes: [
      { id: 'center', startBeat: 0, durationBeats: 2, pitch: 60, velocity: 100 },
      { id: 'middle', startBeat: 1, durationBeats: 1, pitch: 61, velocity: 100 },
      { id: 'outer', startBeat: 1, durationBeats: 2, pitch: 62, velocity: 100 },
    ],
  }],
}

const resolve = (beat: number, params: Record<string, number> = {}) => radialCutDirector.resolve({ ...track, params }, {
  beat, beatsPerBar: 4, totalBars: 8, scenes, sceneOrder: ['main', 'one', 'two', 'three', 'four'],
})

test('Radial Cut defaults to three ordered MIDI rows and supports an adjustable count', () => {
  assert.deepEqual(
    radialCutDirector.midiRows(track, scenes, ['main', 'one', 'two', 'three', 'four']).map((row) => [row.pitch, row.label]),
    [[60, 'Scene 3'], [61, 'Scene 1'], [62, 'Scene 2']],
  )
  assert.equal(radialCutDirector.midiRows({ ...track, params: { sceneCount: 2 } }, scenes, ['main', 'one', 'two', 'three', 'four']).length, 2)
})

test('new scenes append to an incomplete saved binding list', () => {
  const stale = {
    ...track,
    params: { sceneCount: 3 },
    sceneBindings: [{ pitch: 60, sceneId: 'one' }, { pitch: 61, sceneId: 'two' }],
  }
  assert.deepEqual(
    radialCutDirector.midiRows(stale, scenes, ['main', 'one', 'two', 'three', 'four']).map((row) => [row.pitch, row.label]),
    [[60, 'Scene 1'], [61, 'Scene 2'], [62, 'Scene 3']],
  )
})

test('held rows map to nested discs composited from largest to smallest', () => {
  assert.deepEqual(resolve(-0.1), [])
  assert.deepEqual(resolve(0).map((layer) => [layer.sceneId, layer.partition]), [
    ['three', { kind: 'radial', index: 0, count: 3 }],
  ])
  assert.deepEqual(resolve(1).map((layer) => [layer.sceneId, layer.partition?.index]), [
    ['two', 2], ['one', 1], ['three', 0],
  ])
  assert.deepEqual(resolve(2).map((layer) => [layer.sceneId, layer.partition?.index]), [['two', 2]])
})
