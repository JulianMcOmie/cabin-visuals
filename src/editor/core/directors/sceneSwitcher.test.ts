import assert from 'node:assert/strict'
import test from 'node:test'
import type { Scene, Track } from '../../types'
import { sceneSwitcherDirector } from './sceneSwitcher'

const scene = (id: string, name: string, isMain = false): Scene => ({ id, name, isMain, tracks: {}, rootTrackIds: [] })
const scenes = { main: scene('main', 'Main', true), one: scene('one', 'Scene 1'), two: scene('two', 'Scene 2') }
const track: Track = {
  id: 'switcher', name: 'Scene Switcher', type: 'director', instrumentId: '', directorId: 'sceneSwitcher',
  color: '#6366f1', muted: false, solo: false, childIds: [],
  sceneBindings: [{ pitch: 60, sceneId: 'one' }, { pitch: 61, sceneId: 'two' }],
  blocks: [{
    id: 'b', startBar: 0, durationBars: 4, loop: false,
    notes: [
      { id: 'n1', startBeat: 2, durationBeats: 0.25, pitch: 61, velocity: 100 },
      { id: 'n2', startBeat: 6, durationBeats: 0.25, pitch: 60, velocity: 100 },
    ],
  }],
}

const resolve = (beat: number) => sceneSwitcherDirector.resolve(track, {
  beat, beatsPerBar: 4, totalBars: 8, scenes, sceneOrder: ['main', 'one', 'two'],
})

test('Scene Switcher defaults to the first visual scene before any trigger', () => {
  assert.equal(resolve(0)[0]?.sceneId, 'one')
})

test('Scene Switcher cuts exactly on note onset and reconstructs when scrubbing', () => {
  assert.equal(resolve(1.999)[0]?.sceneId, 'one')
  assert.equal(resolve(2)[0]?.sceneId, 'two')
  assert.equal(resolve(5)[0]?.sceneId, 'two')
  assert.equal(resolve(6)[0]?.sceneId, 'one')
  assert.equal(resolve(3)[0]?.sceneId, 'two')
})

test('MIDI rows retain stable scene-id bindings independent of scene order', () => {
  const rows = sceneSwitcherDirector.midiRows(track, scenes, ['main', 'two', 'one'])
  assert.deepEqual(rows.map((row) => [row.pitch, row.label]), [[61, 'Scene 2'], [60, 'Scene 1']])
})
