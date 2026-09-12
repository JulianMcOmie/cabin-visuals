import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../../types'
import { getInstrument } from '../../instruments'
import { createVisualEngine } from './VisualEngine'
import { registerMoverOrSplitterDefinition, unregisterMoverOrSplitterDefinitionForTests } from '../visualCopies/registry'
import type { MoverOrSplitterDefinition } from '../visualCopies/definitions'

function track(id: string, values: Partial<Track> = {}): Track {
  return { id, name: id, type: 'base', instrumentId: '', color: '#fff', muted: false, solo: false, childIds: [], blocks: [], ...values }
}
function project(tracks: Track[]) {
  return { tracks: Object.fromEntries(tracks.map(t => [t.id, t])), rootTrackIds: ['cube'], beatsPerBar: 4, bpm: 120, totalBars: 8 }
}
function register(id: string, resolve: MoverOrSplitterDefinition<object>['resolve']) {
  registerMoverOrSplitterDefinition({ id, label: id, kind: 'splitter', emitsCopyClocks: true, params: [], resolve })
}

test('splitter fanout shares complete equal-clock states, including instrument local calculations', () => {
  const cube = getInstrument('cube')!
  const local = cube.localTransform!
  let calls = 0
  cube.localTransform = input => { calls++; return local(input) }
  try {
    const engine = createVisualEngine()
    engine.setProject(project([
      track('cube', { instrumentId: 'cube', childIds: ['stagger', 'radial'] }),
      track('stagger', { type: 'splitter', splitterId: 'stagger', parentId: 'cube', inputValues: { copies: 2, duration: 4 } }),
      track('radial', { type: 'splitter', splitterId: 'radial', parentId: 'cube', inputValues: { copies: 4 } }),
    ]))
    calls = 0
    engine.computeAtBeat(10)
    assert.equal(engine.getVisualCopies('cube').length, 8)
    assert.equal(calls, 3, 'one base state and two distinct copy-clock calculations')
    assert.equal(engine.getObjectState('cube', 0), engine.getObjectState('cube', 3))
    assert.equal(engine.getObjectState('cube', 4), engine.getObjectState('cube', 7))
    assert.notEqual(engine.getObjectState('cube', 0), engine.getObjectState('cube', 4))
  } finally { cube.localTransform = local }
})

test('shared copy states can diverge, become unshifted, and rejoin on later seeks without alias corruption', () => {
  const id = 'test.cache-changing-clocks'
  register(id, () => ({
    emitsCopyClocks: true,
    apply: copy => [copy, copy],
    applyFramed(copy, { beat }) {
      return [1, beat < 4 ? 1 : beat < 6 ? 2 : 0].map(offset => ({
        visualCopy: { ...copy, transform: copy.transform.clone() }, beatOffset: offset, birthBeat: 0,
      }))
    },
  }))
  try {
    const engine = createVisualEngine()
    engine.setProject(project([track('cube', { instrumentId: 'cube', childIds: ['emitter'] }), track('emitter', { type: 'splitter', splitterId: id, parentId: 'cube' })]))
    for (const [beat, expected] of [[3, [2, 2]], [5, [4, 3]], [7, [6, 7]], [3, [2, 2]], [5, [4, 3]]] as const) {
      engine.computeAtBeat(beat)
      assert.deepEqual([0, 1].map(i => engine.getObjectState('cube', i)!.beat), expected)
      assert.equal(engine.getObjectState('cube', 0) === engine.getObjectState('cube', 1), beat === 3)
    }
  } finally { unregisterMoverOrSplitterDefinitionForTests(id) }
})

test('equal total lag with different emitter checkpoints retains different automation states', () => {
  const firstId = 'test.cache-first-clock', secondId = 'test.cache-second-clock'
  const offsets = [1, 2, 3, 2, 3, 1]
  register(firstId, () => ({
    emitsCopyClocks: true,
    apply: copy => offsets.map(() => copy),
    applyFramed: copy => offsets.map(offset => ({ visualCopy: { ...copy, transform: copy.transform.clone() }, beatOffset: offset, birthBeat: 0 })),
  }))
  register(secondId, () => ({
    emitsCopyClocks: true,
    apply: copy => [copy],
    applyFramed: (copy, context) => [{ visualCopy: copy, beatOffset: 4 - offsets[context.index] }],
  }))
  try {
    const engine = createVisualEngine()
    engine.setProject(project([
      track('cube', { instrumentId: 'cube', childIds: ['first', 'auto', 'second'] }),
      track('first', { type: 'splitter', splitterId: firstId, parentId: 'cube' }),
      track('auto', { type: 'automation', targetParam: 'size', parentId: 'cube', blocks: [{ id: 'ab', startBar: 0, durationBars: 8, loop: false, notes: [
        { id: 'a0', pitch: 36, velocity: 100, startBeat: 0, durationBeats: .25 },
        { id: 'a1', pitch: 84, velocity: 100, startBeat: 12, durationBeats: .25 },
      ] }] }),
      track('second', { type: 'splitter', splitterId: secondId, parentId: 'cube' }),
    ]))
    engine.computeAtBeat(8)
    const a = engine.getObjectState('cube', 0)!, b = engine.getObjectState('cube', 1)!, c = engine.getObjectState('cube', 2)!
    assert.equal(a.beat, 4); assert.equal(b.beat, 4); assert.equal(c.beat, 4)
    assert.notEqual(a.params.size, b.params.size)
    assert.notEqual(b.params.size, c.params.size)
    assert.notEqual(a, b)
    assert.notEqual(b, c)
    assert.equal(a, engine.getObjectState('cube', 5))
    assert.equal(b, engine.getObjectState('cube', 3))
    assert.equal(c, engine.getObjectState('cube', 4))
  } finally { unregisterMoverOrSplitterDefinitionForTests(firstId); unregisterMoverOrSplitterDefinitionForTests(secondId) }
})

test('retained evaluator invalidates document edits and survives varying structural padding', () => {
  const engine = createVisualEngine()
  const source = track('cube', { instrumentId: 'cube', childIds: ['radial'] })
  const splitter = track('radial', { type: 'splitter', splitterId: 'radial', parentId: 'cube', inputValues: { copies: 4, radius: 1 }, blocks: [{ id: 'count', startBar: 0, durationBars: 4, loop: false, notes: [
    { id: 'small', pitch: 37, velocity: 100, startBeat: 1, durationBeats: .25 },
    { id: 'large', pitch: 39, velocity: 100, startBeat: 3, durationBeats: .25 },
  ] }] })
  engine.setProject(project([source, splitter]))
  for (const beat of [0, 2, 4, 2, 0]) {
    engine.computeAtBeat(beat)
    const copies = engine.getVisualCopies('cube')
    assert.equal(copies.length, 4)
    assert.equal(copies.filter(copy => copy.opacity > 0).length, beat === 2 ? 2 : 4)
  }
  engine.setProject(project([source, { ...splitter, blocks: [], inputValues: { copies: 2, radius: 3 } }]))
  engine.computeAtBeat(0)
  assert.equal(engine.getVisualCopies('cube').length, 2)
  assert.equal(engine.getVisualCopy('cube', 0)!.transform.elements[12], 3)
})
