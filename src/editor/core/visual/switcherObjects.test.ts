import assert from 'node:assert/strict'
import test from 'node:test'
import type { Block, Track } from '../../types'
import { SWITCHER_GATE, SWITCHER_LATCH, SWITCHER_SOLO } from '../visualCopies/switcher'
import { computeAtBeat, getObjectState, setProject } from './VisualEngine'
import { resolveProject, type ProjectSnapshot } from './resolve'

// The OBJECT arm: a rack whose rows are instrument tracks switches which of
// them is on screen. The device arm is switcherRuntime.test.ts; what has to be
// proven here is that the gate is per-FRAME (not resolve-time like mute), that
// the object list never changes with it, that a rack still passes its
// ancestors' transform down, and that a MIXED rack does both jobs at once.

function track(partial: Partial<Track> & { id: string }): Track {
  return {
    name: partial.id,
    type: 'base',
    instrumentId: '',
    color: '#fff',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
    ...partial,
  }
}

const cube = (id: string, parentId?: string, extra: Partial<Track> = {}): Track =>
  track({ id, instrumentId: 'cube', parentId, ...extra })

/** One block of held notes, each `[pitch, startBeat, durationBeats]`. */
function lane(notes: [number, number, number][]): Block[] {
  return [{
    id: `blk-${notes.length}-${notes[0]?.[0] ?? 0}`,
    startBar: 0,
    durationBars: 8,
    loop: false,
    notes: notes.map(([pitch, startBeat, durationBeats], i) => ({
      id: `n${i}-${pitch}`, startBeat, durationBeats, pitch, velocity: 100,
    })),
  }]
}

const rack = (id: string, childIds: string[], mode: number, notes: [number, number, number][], extra: Partial<Track> = {}): Track =>
  track({ id, type: 'switcher', childIds, params: { mode }, blocks: lane(notes), ...extra })

function snapshot(tracks: Track[], rootTrackIds: string[]): ProjectSnapshot {
  return {
    tracks: Object.fromEntries(tracks.map((t) => [t.id, t])),
    rootTrackIds,
    beatsPerBar: 4,
    bpm: 120,
  }
}

/** Which of the racked objects are actually on screen at `beat`. */
function visibleAt(p: ProjectSnapshot, beat: number, ids: string[]): string[] {
  setProject(p)
  computeAtBeat(beat)
  return ids.filter((id) => getObjectState(id)?.blackedOut === false)
}

const twoShapes = (mode: number, notes: [number, number, number][]) => snapshot([
  rack('sw', ['a', 'b'], mode, notes),
  cube('a', 'sw'),
  cube('b', 'sw'),
], ['sw'])

test('a rack of objects switches which one is on screen, per frame', () => {
  const p = twoShapes(SWITCHER_LATCH, [[60, 0, 1], [61, 4, 1]])
  assert.deepEqual(visibleAt(p, 2, ['a', 'b']), ['a'])
  assert.deepEqual(visibleAt(p, 6, ['a', 'b']), ['b'])
})

test('Gate shows several at once; Solo shows one', () => {
  const both: [number, number, number][] = [[60, 0, 8], [61, 0, 8]]
  assert.deepEqual(visibleAt(twoShapes(SWITCHER_GATE, both), 4, ['a', 'b']), ['a', 'b'])
  assert.deepEqual(visibleAt(twoShapes(SWITCHER_SOLO, both), 4, ['a', 'b']), ['b'], 'newest onset wins')
})

test('an empty lane shows everything - racking objects changes nothing', () => {
  assert.deepEqual(visibleAt(twoShapes(SWITCHER_GATE, []), 4, ['a', 'b']), ['a', 'b'])
})

test('switching gates VISIBILITY, never structure: the object list is constant', () => {
  // The copy-count contract's sibling. If a rack added or removed objects with
  // the beat, VisualScene would reconcile mounts per frame - which is exactly
  // what the structural object list exists to prevent.
  const p = twoShapes(SWITCHER_SOLO, [[60, 0, 1], [61, 4, 1]])
  const ids = resolveProject(p).objects.map((o) => o.trackId).sort()
  assert.deepEqual(ids, ['a', 'b'])
  setProject(p)
  for (const beat of [0, 2, 4, 6, 20]) {
    computeAtBeat(beat)
    assert.ok(getObjectState('a'), 'a stays mounted at every beat')
    assert.ok(getObjectState('b'), 'b stays mounted at every beat')
  }
})

test('a switched-off object gets no note energy either', () => {
  // Both beats are measured ON one of the cube's own note ONSETS - energy is a
  // decaying pulse, so anywhere else it is near zero for reasons that have
  // nothing to do with the rack and the test would pass while proving nothing.
  const p = snapshot([
    rack('sw', ['a'], SWITCHER_SOLO, [[60, 8, 4]]),
    cube('a', 'sw', { blocks: lane([[64, 2, 1], [64, 8, 1]]) }),
  ], ['sw'])
  setProject(p)
  computeAtBeat(2)
  assert.equal(getObjectState('a')?.blackedOut, true)
  assert.equal(getObjectState('a')?.energy, 0, 'an off object is not pulsing behind the curtain')
  computeAtBeat(8)
  assert.equal(getObjectState('a')?.blackedOut, false)
  assert.ok((getObjectState('a')?.energy ?? 0) > 0, 'the same onset does pulse once the row is on')
})

test('a rack passes its ancestors transform down to its members', () => {
  // The trap this arm had to solve: computeAtBeat composes an object's world
  // from worldMatrices.get(parentId). A rack standing between an object and its
  // group has to HAVE a matrix under its own id, or the object silently loses
  // the group's transform and quietly renders at the origin.
  const p = snapshot([
    track({ id: 'g', type: 'group', childIds: ['sw'], params: { tfX: 3 } }),
    rack('sw', ['a'], SWITCHER_GATE, [], { parentId: 'g' }),
    cube('a', 'sw'),
  ], ['g'])
  setProject(p)
  computeAtBeat(1)
  assert.equal(getObjectState('a')?.world.elements[12], 3, 'the group tfX reached through the rack')
})

test('a rack carries its own transform, like a group', () => {
  const p = snapshot([
    rack('sw', ['a'], SWITCHER_GATE, [], { params: { mode: SWITCHER_GATE, tfX: -2 } }),
    cube('a', 'sw'),
  ], ['sw'])
  setProject(p)
  computeAtBeat(1)
  assert.equal(getObjectState('a')?.world.elements[12], -2)
})

test('muting the rack silences its whole subtree', () => {
  const p = snapshot([
    rack('sw', ['a'], SWITCHER_GATE, [], { muted: true }),
    cube('a', 'sw'),
  ], ['sw'])
  assert.deepEqual(visibleAt(p, 4, ['a']), [])
})

test('a muted row never comes on, however its row is played', () => {
  const p = snapshot([
    rack('sw', ['a', 'b'], SWITCHER_GATE, [[60, 0, 8], [61, 0, 8]]),
    cube('a', 'sw', { muted: true }),
    cube('b', 'sw'),
  ], ['sw'])
  assert.deepEqual(visibleAt(p, 4, ['a', 'b']), ['b'])
})

test('a GROUP row switches every object under it as one', () => {
  const p = snapshot([
    rack('sw', ['g', 'c'], SWITCHER_SOLO, [[60, 0, 2], [61, 4, 2]]),
    track({ id: 'g', type: 'group', parentId: 'sw', childIds: ['a', 'b'] }),
    cube('a', 'g'),
    cube('b', 'g'),
    cube('c', 'sw'),
  ], ['sw'])
  assert.deepEqual(visibleAt(p, 1, ['a', 'b', 'c']), ['a', 'b'], 'the whole group is one row')
  assert.deepEqual(visibleAt(p, 5, ['a', 'b', 'c']), ['c'])
})

test('nested racks compose by AND - an inner one cannot re-enable an outer', () => {
  const p = snapshot([
    rack('outer', ['inner'], SWITCHER_GATE, [[60, 4, 4]]),
    rack('inner', ['a'], SWITCHER_GATE, [[60, 0, 16]], { parentId: 'outer' }),
    cube('a', 'inner'),
  ], ['outer'])
  assert.deepEqual(visibleAt(p, 1, ['a']), [], 'inner says on, outer says off')
  assert.deepEqual(visibleAt(p, 5, ['a']), ['a'], 'both on')
})

test('a MIXED rack switches a device row and an object row from one lane', () => {
  // The genericity claim, stated as a test: the lane does not know or care
  // which kind of thing a row is.
  const p = snapshot([
    rack('sw', ['m', 'obj'], SWITCHER_GATE, [[61, 0, 8]]),
    track({ id: 'm', type: 'mover', moverId: 'visibility', parentId: 'sw' }),
    cube('obj', 'sw'),
  ], ['sw'])
  // Row 1 (the object) is played; row 0 (the device) is not.
  assert.deepEqual(visibleAt(p, 4, ['obj']), ['obj'])
  const chain = resolveProject(p).objects.find((o) => o.trackId === 'obj')?.moverAndSplitterChain
  assert.equal(chain?.length, 0, 'the device row belongs to the rack, not to the racked object')
})
