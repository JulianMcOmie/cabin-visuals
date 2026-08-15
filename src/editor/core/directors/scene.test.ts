import assert from 'node:assert/strict'
import test from 'node:test'
import type { Scene, Track } from '../../types'
import { sceneDirector } from './scene'

const scene = (id: string, name: string, isMain = false): Scene => ({ id, name, isMain, backgroundColor: '#000000', backgroundTransparent: false, tracks: {}, rootTrackIds: [] })
const scenes = { main: scene('main', 'Main', true), one: scene('one', 'Scene 1'), two: scene('two', 'Scene 2') }
const sceneOrder = ['main', 'one', 'two']

const track = (overrides: Partial<Track> = {}): Track => ({
  id: 'sceneTrack', name: 'Scene', type: 'base', instrumentId: 'scene',
  color: '#34d399', muted: false, solo: false, childIds: [],
  sceneBindings: [{ pitch: 60, sceneId: 'two' }],
  blocks: [],
  ...overrides,
})

const resolve = (t: Track, beat: number) => sceneDirector.resolve(t, {
  beat, beatsPerBar: 4, totalBars: 8, scenes, sceneOrder,
})

test('with no notes the bound scene fills the frame at every beat', () => {
  const t = track()
  for (const beat of [0, 3.5, 17]) {
    assert.deepEqual(resolve(t, beat), [{
      directorTrackId: 'sceneTrack',
      sceneId: 'two',
      opacity: 1,
      viewport: { x: 0, y: 0, width: 1, height: 1 },
    }])
  }
})

test('the scene is the FIRST binding, not whichever scene sorts first', () => {
  assert.equal(resolve(track(), 0)[0]?.sceneId, 'two')
  assert.equal(resolve(track({ sceneBindings: [{ pitch: 60, sceneId: 'one' }] }), 0)[0]?.sceneId, 'one')
})

test('once notes exist the track becomes a gate', () => {
  const gated = track({
    blocks: [{
      id: 'b', startBar: 0, durationBars: 4, loop: false,
      notes: [{ id: 'n', startBeat: 2, durationBeats: 2, pitch: 60, velocity: 100 }],
    }],
  })
  assert.deepEqual(resolve(gated, 1.999), [])
  assert.equal(resolve(gated, 2)[0]?.sceneId, 'two')
  assert.equal(resolve(gated, 3.999)[0]?.sceneId, 'two')
  assert.deepEqual(resolve(gated, 4), [])
})

test('a gating note off the declared row still shows the scene', () => {
  // The vocabulary is one row, so a stray pitch (import, re-binding) means
  // "show it" rather than doing nothing at all.
  const gated = track({
    blocks: [{
      id: 'b', startBar: 0, durationBars: 4, loop: false,
      notes: [{ id: 'n', startBeat: 0, durationBeats: 1, pitch: 72, velocity: 100 }],
    }],
  })
  assert.equal(resolve(gated, 0.5)[0]?.sceneId, 'two')
  assert.deepEqual(resolve(gated, 1), [])
})

test('no visual scenes means no layer', () => {
  const onlyMain = { main: scenes.main }
  assert.deepEqual(
    sceneDirector.resolve(track(), { beat: 0, beatsPerBar: 4, totalBars: 8, scenes: onlyMain, sceneOrder: ['main'] }),
    [],
  )
})

test('the single MIDI row is labelled with the chosen scene', () => {
  assert.deepEqual(
    sceneDirector.midiRows(track(), scenes, sceneOrder).map((row) => [row.pitch, row.label]),
    [[60, 'Scene 2']],
  )
})
