import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { Track } from '../../types'
import type { MoverOrSplitterDefinition } from '../visualCopies/definitions'
import {
  registerMoverOrSplitterDefinition,
  unregisterMoverOrSplitterDefinitionForTests,
} from '../visualCopies/registry'
import { resolveVisualCopies } from '../visualCopies/resolveVisualCopies'
import type { VisualCopy } from '../visualCopies/types'
import { getPriorVisualCopyCount, resolveProject, type ProjectSnapshot } from './resolve'

// Chain resolution wiring tests: which tracks enter the new ordered
// mover-and-splitter chain, and in what order. Definitions here are fakes that
// log their application order (impure on purpose - these tests observe the
// wiring, not the kernel's purity, which resolveVisualCopies.test.ts covers).

const log: string[] = []

function cloneCopy(copy: VisualCopy): VisualCopy {
  return {
    transform: copy.transform.clone(),
    opacity: copy.opacity,
    colorShift: { ...copy.colorShift },
  }
}

/** Mover that logs 'lift(<distance>)' per application and translates up. */
const chainLift: MoverOrSplitterDefinition<{ distance: number }> = {
  id: 'test.chainLift',
  label: 'Chain Lift',
  kind: 'mover',
  params: [{ key: 'distance', label: 'Distance', min: 0, max: 10, step: 0.1, default: 1 }],
  resolve({ settings }) {
    return {
      apply(visualCopy) {
        log.push(`lift(${settings.distance})`)
        const next = cloneCopy(visualCopy)
        next.transform.multiply(new Matrix4().makeTranslation(0, settings.distance, 0))
        return [next]
      },
    }
  },
}

/** Splitter that logs 'split' per application and emits two copies. */
const chainSplit: MoverOrSplitterDefinition<{ spacing: number }> = {
  id: 'test.chainSplit',
  label: 'Chain Split',
  kind: 'splitter',
  params: [{ key: 'spacing', label: 'Spacing', min: 0, max: 20, step: 0.5, default: 2 }],
  resolve({ settings }) {
    return {
      apply(visualCopy) {
        log.push('split')
        return [-1, 1].map((side) => {
          const next = cloneCopy(visualCopy)
          next.transform.multiply(new Matrix4().makeTranslation(side * settings.spacing, 0, 0))
          return next
        })
      },
    }
  },
}

registerMoverOrSplitterDefinition(chainLift)
registerMoverOrSplitterDefinition(chainSplit)
test.after(() => {
  unregisterMoverOrSplitterDefinitionForTests('test.chainLift')
  unregisterMoverOrSplitterDefinitionForTests('test.chainSplit')
})

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

function snapshot(tracks: Track[], rootTrackIds: string[]): ProjectSnapshot {
  return {
    tracks: Object.fromEntries(tracks.map((t) => [t.id, t])),
    rootTrackIds,
    beatsPerBar: 4,
    bpm: 120,
  }
}

function objectByTrackId(p: ProjectSnapshot, trackId: string) {
  const obj = resolveProject(p).objects.find((o) => o.trackId === trackId)
  assert.ok(obj, `object ${trackId} resolved`)
  return obj
}

test('mixed local movers and splitters resolve in exact childIds order', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['a', 's', 'b'] }),
    track({ id: 'a', type: 'mover', moverId: 'test.chainLift', parentId: 'cube', inputValues: { distance: 1 } }),
    track({ id: 's', type: 'splitter', splitterId: 'test.chainSplit', parentId: 'cube' }),
    track({ id: 'b', type: 'mover', moverId: 'test.chainLift', parentId: 'cube', inputValues: { distance: 9 } }),
  ], ['cube'])
  const obj = objectByTrackId(p, 'cube')
  assert.equal(obj.moverAndSplitterChain.length, 3)

  log.length = 0
  const copies = resolveVisualCopies(obj.moverAndSplitterChain, 0)
  // lift(1) once (count 1), split once, lift(9) twice (post-split count 2).
  assert.deepEqual(log, ['lift(1)', 'split', 'lift(9)', 'lift(9)'])
  assert.equal(copies.length, 2)
})

test('prior copy count stops at the selected chain entry', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['before', 'visibility', 'after'] }),
    track({ id: 'before', type: 'splitter', splitterId: 'test.chainSplit', parentId: 'cube' }),
    track({ id: 'visibility', type: 'mover', moverId: 'visibility', parentId: 'cube' }),
    track({ id: 'after', type: 'splitter', splitterId: 'test.chainSplit', parentId: 'cube' }),
  ], ['cube'])
  assert.equal(getPriorVisualCopyCount('visibility', p), 2)
})

test('settings merge definition defaults with the track inputValues', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['m'] }),
    track({ id: 'm', type: 'mover', moverId: 'test.chainLift', parentId: 'cube' }), // no inputValues
  ], ['cube'])
  const obj = objectByTrackId(p, 'cube')
  log.length = 0
  resolveVisualCopies(obj.moverAndSplitterChain, 0)
  assert.deepEqual(log, ['lift(1)']) // the param's declared default
})

test('unknown mover ids (e.g. deleted legacy movers) resolve to nothing', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['legacy', 'new'] }),
    track({ id: 'legacy', type: 'mover', moverId: 'spin', parentId: 'cube' }),
    track({ id: 'new', type: 'mover', moverId: 'test.chainLift', parentId: 'cube' }),
  ], ['cube'])
  const obj = objectByTrackId(p, 'cube')
  assert.equal(obj.moverAndSplitterChain.length, 1, 'only the registered mover enters the chain')
})

test('muted entries drop out; solo pools among new-chain children', () => {
  const base = [
    track({ id: 'cube', instrumentId: 'cube', childIds: ['a', 'b'] }),
    track({ id: 'a', type: 'mover', moverId: 'test.chainLift', parentId: 'cube', muted: true }),
    track({ id: 'b', type: 'splitter', splitterId: 'test.chainSplit', parentId: 'cube' }),
  ]
  assert.equal(objectByTrackId(snapshot(base, ['cube']), 'cube').moverAndSplitterChain.length, 1)

  const soloed = [
    track({ id: 'cube', instrumentId: 'cube', childIds: ['a', 'b'] }),
    track({ id: 'a', type: 'mover', moverId: 'test.chainLift', parentId: 'cube', solo: true }),
    track({ id: 'b', type: 'splitter', splitterId: 'test.chainSplit', parentId: 'cube' }),
  ]
  const obj = objectByTrackId(snapshot(soloed, ['cube']), 'cube')
  assert.equal(obj.moverAndSplitterChain.length, 1)
  log.length = 0
  resolveVisualCopies(obj.moverAndSplitterChain, 0)
  assert.deepEqual(log, ['lift(1)'])
})

test('global entries target by track, tag, and subtree, appending after local entries', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['local'], tags: ['neon'] }),
    track({ id: 'local', type: 'mover', moverId: 'test.chainLift', parentId: 'cube', inputValues: { distance: 1 } }),
    track({ id: 'parent', instrumentId: 'cube', childIds: ['nested'] }),
    track({ id: 'nested', instrumentId: 'cube', parentId: 'parent' }),
    track({
      id: 'gTrack', type: 'splitter', splitterId: 'test.chainSplit',
      targets: [{ port: '', scope: { kind: 'track', id: 'cube' }, amount: 1 }],
    }),
    track({
      id: 'gTag', type: 'mover', moverId: 'test.chainLift', inputValues: { distance: 5 },
      targets: [{ port: '', scope: { kind: 'tag', tag: 'neon' }, amount: 1 }],
    }),
    track({
      id: 'gSubtree', type: 'mover', moverId: 'test.chainLift', inputValues: { distance: 7 },
      targets: [{ port: '', scope: { kind: 'subtree', id: 'parent' }, amount: 1 }],
    }),
  ], ['cube', 'parent', 'gTrack', 'gTag', 'gSubtree'])

  const graph = resolveProject(p)
  const cube = graph.objects.find((o) => o.trackId === 'cube')!
  const parent = graph.objects.find((o) => o.trackId === 'parent')!
  const nested = graph.objects.find((o) => o.trackId === 'nested')!

  // cube: local lift(1), then globals in rootTrackIds order: split, lift(5).
  log.length = 0
  resolveVisualCopies(cube.moverAndSplitterChain, 0)
  assert.deepEqual(log, ['lift(1)', 'split', 'lift(5)', 'lift(5)'])

  // The subtree global applies independently to each object in the subtree.
  assert.equal(parent.moverAndSplitterChain.length, 1)
  assert.equal(nested.moverAndSplitterChain.length, 1)
  log.length = 0
  resolveVisualCopies(parent.moverAndSplitterChain, 0)
  assert.deepEqual(log, ['lift(7)'])
})

test('duplicate routes from one global entry to the same object are deduplicated', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', tags: ['neon'] }),
    track({
      id: 'g', type: 'splitter', splitterId: 'test.chainSplit',
      targets: [
        { port: '', scope: { kind: 'track', id: 'cube' }, amount: 1 },
        { port: '', scope: { kind: 'tag', tag: 'neon' }, amount: 1 },
      ],
    }),
  ], ['cube', 'g'])
  const obj = objectByTrackId(p, 'cube')
  assert.equal(obj.moverAndSplitterChain.length, 1)
})

test('a mover nested under a non-instrument track routes globally through its targets', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube' }),
    track({ id: 'group', childIds: ['gm'] }), // plain group track - no instrument
    track({
      id: 'gm', type: 'mover', moverId: 'test.chainLift', parentId: 'group', inputValues: { distance: 3 },
      targets: [{ port: '', scope: { kind: 'track', id: 'cube' }, amount: 1 }],
    }),
  ], ['cube', 'group'])
  const obj = objectByTrackId(p, 'cube')
  assert.equal(obj.moverAndSplitterChain.length, 1)
  log.length = 0
  resolveVisualCopies(obj.moverAndSplitterChain, 0)
  assert.deepEqual(log, ['lift(3)'])
})

test('nested globals append in depth-first order after root globals', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube' }),
    track({
      id: 'bm', type: 'mover', moverId: 'test.chainLift', childIds: ['gm'], inputValues: { distance: 1 },
      targets: [{ port: '', scope: { kind: 'track', id: 'cube' }, amount: 1 }],
    }),
    track({
      id: 'gm', type: 'mover', moverId: 'test.chainLift', parentId: 'bm', inputValues: { distance: 3 },
      targets: [{ port: '', scope: { kind: 'track', id: 'cube' }, amount: 1 }],
    }),
  ], ['cube', 'bm'])
  const obj = objectByTrackId(p, 'cube')
  log.length = 0
  resolveVisualCopies(obj.moverAndSplitterChain, 0)
  assert.deepEqual(log, ['lift(1)', 'lift(3)'])
})

test('a mover with a parent instrument stays local even when it has targets', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['lm'] }),
    track({ id: 'other', instrumentId: 'cube' }),
    track({
      id: 'lm', type: 'mover', moverId: 'test.chainLift', parentId: 'cube',
      targets: [{ port: '', scope: { kind: 'track', id: 'other' }, amount: 1 }],
    }),
  ], ['cube', 'other'])
  assert.equal(objectByTrackId(p, 'cube').moverAndSplitterChain.length, 1)
  assert.equal(objectByTrackId(p, 'other').moverAndSplitterChain.length, 0)
})

test('a nested global mover without targets affects nothing', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube' }),
    track({ id: 'group', childIds: ['gm'] }),
    track({ id: 'gm', type: 'mover', moverId: 'test.chainLift', parentId: 'group' }),
  ], ['cube', 'group'])
  assert.equal(objectByTrackId(p, 'cube').moverAndSplitterChain.length, 0)
})

test('prior copy count includes nested globals that precede the track', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube' }),
    track({
      id: 'g', type: 'splitter', splitterId: 'test.chainSplit',
      targets: [{ port: '', scope: { kind: 'track', id: 'cube' }, amount: 1 }],
    }),
    track({ id: 'group', childIds: ['gm'] }),
    track({
      id: 'gm', type: 'mover', moverId: 'visibility', parentId: 'group',
      targets: [{ port: '', scope: { kind: 'track', id: 'cube' }, amount: 1 }],
    }),
  ], ['cube', 'g', 'group'])
  // The nested global 'gm' is preceded by the root global splitter, so its
  // MIDI lane addresses two copies.
  assert.equal(getPriorVisualCopyCount('gm', p), 2)
})

test('every instrument track exposes a chain; empty chains yield one identity copy', () => {
  const p = snapshot([track({ id: 'cube', instrumentId: 'cube' })], ['cube'])
  const obj = objectByTrackId(p, 'cube')
  assert.deepEqual(obj.moverAndSplitterChain, [])
  const copies = resolveVisualCopies(obj.moverAndSplitterChain, 0)
  assert.equal(copies.length, 1)
  assert.equal(copies[0].opacity, 1)
})
