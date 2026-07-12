import assert from 'node:assert/strict'
import test from 'node:test'
import type { ProjectState } from '../../store/ProjectStore'
import type { Scene, Track } from '../../types'
import { computeAtBeat, getCompositionLayers, setProject } from '../visual/VisualEngine'

const director = (id: string): Track => ({
  id, name: id, type: 'director', instrumentId: '', directorId: 'sceneSwitcher',
  color: '#6366f1', muted: false, solo: false, blocks: [], childIds: [],
  sceneBindings: [{ pitch: 60, sceneId: 'visual' }],
})

test('Main resolves an ordered array of simultaneous directors, never a singular slot', () => {
  const a = director('a')
  const b = director('b')
  const main: Scene = { id: 'main', name: 'Main', isMain: true, tracks: { a, b }, rootTrackIds: ['a', 'b'] }
  const visual: Scene = { id: 'visual', name: 'Scene 1', isMain: false, tracks: {}, rootTrackIds: [] }
  setProject({
    scenes: { main, visual }, sceneOrder: ['main', 'visual'], activeSceneId: 'main',
    tracks: {}, rootTrackIds: [], audioTracks: {}, audioRootTrackIds: [],
    bpm: 120, beatsPerBar: 4, totalBars: 8,
  } as unknown as ProjectState)
  computeAtBeat(0)
  assert.deepEqual(getCompositionLayers().map((layer) => layer.directorTrackId), ['a', 'b'])
})
