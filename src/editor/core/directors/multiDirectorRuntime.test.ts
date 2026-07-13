import assert from 'node:assert/strict'
import test from 'node:test'
import type { ProjectState } from '../../store/ProjectStore'
import type { Scene, Track } from '../../types'
import { computeAtBeat, getCompositionLayers, setProject } from '../visual/VisualEngine'

const director = (id: string): Track => ({
  id, name: id, type: 'director', instrumentId: '', directorId: 'sceneSwitcher',
  color: '#6366f1', muted: false, solo: false, childIds: [],
  blocks: [{
    id: `${id}-block`, startBar: 0, durationBars: 2, loop: false,
    notes: [{ id: `${id}-note`, startBeat: 0, durationBeats: 8, pitch: 60, velocity: 100 }],
  }],
  sceneBindings: [{ pitch: 60, sceneId: 'visual' }],
})

test('Main resolves an ordered array of simultaneous directors, never a singular slot', () => {
  const a = { ...director('a'), params: { opacity: 0.25 } }
  const b = { ...director('b'), params: { opacity: 0.5 } }
  const main: Scene = { id: 'main', name: 'Main', isMain: true, backgroundColor: '#000000', backgroundTransparent: false, tracks: { a, b }, rootTrackIds: ['a', 'b'] }
  const visual: Scene = { id: 'visual', name: 'Scene 1', isMain: false, backgroundColor: '#000000', backgroundTransparent: false, tracks: {}, rootTrackIds: [] }
  setProject({
    scenes: { main, visual }, sceneOrder: ['main', 'visual'], activeSceneId: 'main',
    tracks: {}, rootTrackIds: [], audioTracks: {}, audioRootTrackIds: [],
    bpm: 120, beatsPerBar: 4, totalBars: 8,
  } as unknown as ProjectState)
  computeAtBeat(0)
  assert.deepEqual(
    getCompositionLayers().map((layer) => [layer.directorTrackId, layer.opacity]),
    [['b', 0.5], ['a', 0.25]],
  )
})

test('an active hold-gated director may intentionally resolve to an empty frame', () => {
  const cut: Track = {
    ...director('cut'), directorId: 'cut', sceneBindings: [{ pitch: 60, sceneId: 'visual' }], blocks: [],
  }
  const main: Scene = { id: 'main', name: 'Main', isMain: true, backgroundColor: '#000000', backgroundTransparent: false, tracks: { cut }, rootTrackIds: ['cut'] }
  const visual: Scene = { id: 'visual', name: 'Scene 1', isMain: false, backgroundColor: '#000000', backgroundTransparent: false, tracks: {}, rootTrackIds: [] }
  setProject({
    scenes: { main, visual }, sceneOrder: ['main', 'visual'], activeSceneId: 'main',
    tracks: {}, rootTrackIds: [], audioTracks: {}, audioRootTrackIds: [],
    bpm: 120, beatsPerBar: 4, totalBars: 8,
  } as unknown as ProjectState)
  computeAtBeat(0)
  assert.deepEqual(getCompositionLayers(), [])
})

test('an empty Radial Cut above an active director contributes nothing and reveals the lower layer', () => {
  const radial: Track = {
    ...director('radial'), directorId: 'radialCut', sceneBindings: [{ pitch: 60, sceneId: 'overlay' }], blocks: [],
  }
  const base = { ...director('base'), sceneBindings: [{ pitch: 60, sceneId: 'base-scene' }] }
  const main: Scene = {
    id: 'main', name: 'Main', isMain: true, backgroundColor: '#000000', backgroundTransparent: false,
    tracks: { radial, base }, rootTrackIds: ['radial', 'base'],
  }
  const baseScene: Scene = {
    id: 'base-scene', name: 'Base', isMain: false, backgroundColor: '#000000', backgroundTransparent: false,
    tracks: {}, rootTrackIds: [],
  }
  const overlay: Scene = {
    id: 'overlay', name: 'Overlay', isMain: false, backgroundColor: '#000000', backgroundTransparent: false,
    tracks: {}, rootTrackIds: [],
  }
  setProject({
    scenes: { main, 'base-scene': baseScene, overlay }, sceneOrder: ['main', 'base-scene', 'overlay'], activeSceneId: 'main',
    tracks: {}, rootTrackIds: [], audioTracks: {}, audioRootTrackIds: [],
    bpm: 120, beatsPerBar: 4, totalBars: 8,
  } as unknown as ProjectState)
  computeAtBeat(0)
  assert.deepEqual(getCompositionLayers().map((layer) => layer.directorTrackId), ['base'])
})
