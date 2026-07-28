import assert from 'node:assert/strict'
import test from 'node:test'
import type { ProjectState } from '../../store/ProjectStore'
import type { Scene, Track } from '../../types'
import { getObjectList, setProject } from './VisualEngine'

// setProject's per-scene graph reuse: store changes that touch no scene
// content (selecting a scene, transport fields) must not re-resolve graphs or
// re-publish the object list - re-publishing re-renders the whole scene tree,
// which is the frozen half-second a scene click used to cost.

const cube = (id: string): Track => ({
  id, name: id, type: 'base', instrumentId: 'cube', color: '#fff',
  muted: false, solo: false, childIds: [],
  blocks: [{
    id: `${id}-block`, startBar: 0, durationBars: 2, loop: false,
    notes: [{ id: `${id}-note`, startBeat: 0, durationBeats: 1, pitch: 60, velocity: 100 }],
  }],
})

const scene = (id: string, tracks: Record<string, Track>): Scene => ({
  id, name: id, isMain: false, backgroundColor: '#000000', backgroundTransparent: false,
  tracks, rootTrackIds: Object.keys(tracks),
})

const projectWith = (scenes: Record<string, Scene>, activeSceneId: string) => ({
  scenes: {
    main: { id: 'main', name: 'Main', isMain: true, backgroundColor: '#000000', backgroundTransparent: false, tracks: {}, rootTrackIds: [] },
    ...scenes,
  },
  sceneOrder: ['main', ...Object.keys(scenes)],
  activeSceneId,
  tracks: {}, rootTrackIds: [], audioTracks: {}, audioRootTrackIds: [],
  bpm: 120, beatsPerBar: 4, totalBars: 8,
}) as unknown as ProjectState

test('a scene click (same scene contents) keeps the published object list', () => {
  const one = scene('one', { a: cube('a') })
  const two = scene('two', { b: cube('b') })
  setProject(projectWith({ one, two }, 'one'))
  const list = getObjectList()
  assert.ok(list.length >= 2, 'objects resolved for both scenes')

  // Only the selection changed - the scenes records are the SAME references.
  setProject(projectWith({ one, two }, 'two'))
  assert.equal(getObjectList(), list, 'no re-publish on a selection-only change')
})

test('editing one scene re-resolves and re-publishes', () => {
  const one = scene('one', { a: cube('a') })
  const two = scene('two', { b: cube('b') })
  setProject(projectWith({ one, two }, 'one'))
  const list = getObjectList()

  const edited = scene('one', { a: cube('a'), c: cube('c') })
  setProject(projectWith({ one: edited, two }, 'one'))
  const next = getObjectList()
  assert.notEqual(next, list, 'content change re-publishes')
  assert.ok(next.some((o) => o.trackId === 'c'), 'the new track resolved')
})
