import assert from 'node:assert/strict'
import test from 'node:test'
import type { ProjectState } from '../../store/ProjectStore'
import type { Scene, Track } from '../../types'
import { getObjectList, getVisualCopyCount, setProject, subscribeObjects } from './VisualEngine'

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

// The copy-pool probe (a matrix per copy per variant) used to run for every
// object in every scene after any structural edit - most of a note nudge's
// cost on a copy-heavy project. Pools are keyed on the chain's entries now.
test('a note edit keeps unchanged pools and does not republish an identical list', () => {
  const line = (copies: number): Track => ({
    id: 'la', name: 'la', type: 'splitter', splitterId: 'line', parentId: 'a', inputValues: { copies },
    color: '#fff', muted: false, solo: false, blocks: [], childIds: [],
  })
  const withSplitter = (a: Track, copies: number): Scene => ({
    ...scene('one', { a: { ...a, childIds: ['la'] }, la: line(copies) }), rootTrackIds: ['a'],
  })
  const a = cube('a')
  const two = scene('two', { b: cube('b') })
  setProject(projectWith({ one: withSplitter(a, 4), two }, 'one'))
  const list = getObjectList()
  assert.equal(getVisualCopyCount('a'), 4)
  let notified = 0
  const unsub = subscribeObjects(() => { notified++ })

  // One note moved: same objects, same counts - nothing to republish.
  const block = a.blocks[0]
  const edited: Track = { ...a, blocks: [{ ...block, notes: [{ ...block.notes[0], pitch: 62 }] }] }
  setProject(projectWith({ one: withSplitter(edited, 4), two }, 'one'))
  assert.equal(notified, 0, 'identical list is not republished')
  assert.equal(getObjectList(), list)
  assert.equal(getVisualCopyCount('a'), 4)
  assert.equal(getVisualCopyCount('b'), 1)

  // A real count change still re-probes and republishes.
  setProject(projectWith({ one: withSplitter(edited, 6), two }, 'one'))
  assert.equal(getVisualCopyCount('a'), 6)
  assert.equal(notified, 1)
  unsub()
})
