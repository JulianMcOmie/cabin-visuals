import assert from 'node:assert/strict'
import test from 'node:test'
import type { ProjectState } from '../../store/ProjectStore'
import type { Scene, Track } from '../../types'
import { computeAtBeat, getCompositionLayers, setProject } from '../visual/VisualEngine'

// Director params are automatable: lanes under a director track are gathered and
// sampled per frame inside resolveComposition (directors never enter the resolved
// graph), over directorAutomatableParams = Opacity + the def's own params.

const scene = (id: string, isMain = false): Scene => ({
  id, name: id, isMain, backgroundColor: '#000000', backgroundTransparent: false, tracks: {}, rootTrackIds: [],
})

/** A keyframe lane: each note is a value keyframe, pitch 36..84 → param [min,max]. */
const lane = (id: string, targetParam: string, notes: { beat: number; pitch: number }[], overrides: Partial<Track> = {}): Track => ({
  id, name: targetParam, type: 'automation', instrumentId: '', targetParam, interpolation: 'linear',
  color: '#6366f1', muted: false, solo: false, childIds: [], parentId: 'dir',
  blocks: [{
    id: `${id}-block`, startBar: 0, durationBars: 8, loop: false,
    notes: notes.map((n, i) => ({ id: `${id}-n${i}`, startBeat: n.beat, durationBeats: 1, pitch: n.pitch, velocity: 100 })),
  }],
  ...overrides,
})

function setMainProject(directorTrack: Track, lanes: Track[]) {
  const main: Scene = {
    ...scene('main', true),
    tracks: { dir: { ...directorTrack, childIds: lanes.map((l) => l.id) }, ...Object.fromEntries(lanes.map((l) => [l.id, l])) },
    rootTrackIds: ['dir'],
  }
  setProject({
    scenes: { main, visual: scene('visual') }, sceneOrder: ['main', 'visual'], activeSceneId: 'main',
    tracks: {}, rootTrackIds: [], audioTracks: {}, audioRootTrackIds: [],
    bpm: 120, beatsPerBar: 4, totalBars: 8,
  } as unknown as ProjectState)
}

const cropTrack: Track = {
  id: 'dir', name: 'Crop', type: 'director', instrumentId: '', directorId: 'crop',
  color: '#6366f1', muted: false, solo: false, childIds: [],
  // Hold crop's slice-0 row (pitch 60) so the director emits a layer to inspect.
  blocks: [{
    id: 'dir-block', startBar: 0, durationBars: 8, loop: false,
    notes: [{ id: 'dir-note', startBeat: 0, durationBeats: 32, pitch: 60, velocity: 100 }],
  }],
  sceneBindings: [{ pitch: 60, sceneId: 'visual' }],
}

test('a keyframe lane on crop.angle drives the resolved partition angle', () => {
  // Keyframes: beat 0 → pitch 36 (angle 0), beat 4 → pitch 60 (angle 180).
  setMainProject(cropTrack, [lane('angle-lane', 'angle', [{ beat: 0, pitch: 36 }, { beat: 4, pitch: 60 }])])

  computeAtBeat(0)
  let partition = getCompositionLayers()[0]?.partition
  assert.equal(partition?.kind, 'slice')
  assert.equal(partition && 'angle' in partition ? partition.angle : NaN, 0)

  computeAtBeat(2) // halfway between the keyframes → 90
  partition = getCompositionLayers()[0]?.partition
  assert.equal(partition && 'angle' in partition ? partition.angle : NaN, 90)

  computeAtBeat(4)
  partition = getCompositionLayers()[0]?.partition
  assert.equal(partition && 'angle' in partition ? partition.angle : NaN, 180)
})

test('a muted lane is inert - the director keeps its stored param', () => {
  setMainProject(
    { ...cropTrack, params: { angle: 45 } },
    [lane('angle-lane', 'angle', [{ beat: 0, pitch: 84 }], { muted: true })],
  )
  computeAtBeat(0)
  const partition = getCompositionLayers()[0]?.partition
  assert.equal(partition && 'angle' in partition ? partition.angle : NaN, 45)
})

test('the shared Opacity param is automatable on any director', () => {
  const switcher: Track = {
    ...cropTrack, directorId: 'sceneSwitcher',
  }
  // Pitch 60 is the midpoint of [0,1] → opacity 0.5.
  setMainProject(switcher, [lane('op-lane', 'opacity', [{ beat: 0, pitch: 60 }])])
  computeAtBeat(0)
  assert.equal(getCompositionLayers()[0]?.opacity, 0.5)
})

test('an unknown target param is skipped rather than written into the director', () => {
  setMainProject(
    { ...cropTrack, params: { angle: 45 } },
    [lane('bogus-lane', 'notAParam', [{ beat: 0, pitch: 84 }])],
  )
  computeAtBeat(0)
  const partition = getCompositionLayers()[0]?.partition
  assert.equal(partition && 'angle' in partition ? partition.angle : NaN, 45)
})
