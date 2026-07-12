import assert from 'node:assert/strict'
import test from 'node:test'
import type { Scene, Track } from '../../types'
import { cutDirector } from './cut'

const scene = (id: string, name: string, isMain = false): Scene => ({
  id, name, isMain, backgroundColor: '#000000', tracks: {}, rootTrackIds: [],
})
const scenes = {
  main: scene('main', 'Main', true),
  one: scene('one', 'Scene 1'),
  two: scene('two', 'Scene 2'),
  three: scene('three', 'Scene 3'),
  four: scene('four', 'Scene 4'),
}

const makeTrack = (params: Record<string, number> = {}): Track => ({
  id: 'cut', name: 'Cut', type: 'director', instrumentId: '', directorId: 'cut',
  color: '#6366f1', muted: false, solo: false, childIds: [], params,
  sceneBindings: [
    { pitch: 60, sceneId: 'two' },
    { pitch: 61, sceneId: 'one' },
    { pitch: 62, sceneId: 'three' },
    { pitch: 63, sceneId: 'four' },
  ],
  blocks: [{
    id: 'b', startBar: 0, durationBars: 2, loop: false,
    notes: [
      { id: 'a', startBeat: 0, durationBeats: 2, pitch: 60, velocity: 100 },
      { id: 'b', startBeat: 1, durationBeats: 1, pitch: 61, velocity: 100 },
      { id: 'c', startBeat: 3, durationBeats: 1, pitch: 62, velocity: 100 },
    ],
  }],
})

const resolve = (track: Track, beat: number) => cutDirector.resolve(track, {
  beat, beatsPerBar: 4, totalBars: 8, scenes, sceneOrder: ['main', 'one', 'two', 'three', 'four'],
})

test('Cut defaults to three ordered scene rows and its count is adjustable', () => {
  assert.deepEqual(
    cutDirector.midiRows(makeTrack(), scenes, ['main', 'one', 'two', 'three', 'four']).map((row) => [row.pitch, row.label]),
    [[60, 'Scene 2'], [61, 'Scene 1'], [62, 'Scene 3']],
  )
  assert.deepEqual(
    cutDirector.midiRows(makeTrack({ sceneCount: 2 }), scenes, ['main', 'one', 'two', 'three', 'four']).map((row) => row.label),
    ['Scene 2', 'Scene 1'],
  )
})

test('each held row controls existence in its fixed screen partition', () => {
  const track = makeTrack()
  assert.deepEqual(resolve(track, -0.1), [])
  assert.deepEqual(resolve(track, 0).map((layer) => [layer.sceneId, layer.partition?.index, layer.partition?.count]), [['two', 0, 3]])
  assert.deepEqual(resolve(track, 1).map((layer) => [layer.sceneId, layer.partition?.index]), [['two', 0], ['one', 1]])
  assert.deepEqual(resolve(track, 2), [])
  assert.deepEqual(resolve(track, 3).map((layer) => [layer.sceneId, layer.partition?.index]), [['three', 2]])
})

test('straight and diagonal styles alter only the shared partition slant', () => {
  const slant = (style: number) => {
    const partition = resolve(makeTrack({ cutStyle: style }), 1)[0]?.partition
    return partition?.kind === 'linear' ? partition.slant : 0
  }
  assert.equal(slant(0), 0)
  assert.ok(slant(1) > 0)
  assert.ok(slant(2) < 0)
})
