import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { Track } from '../../types'
import { createVisualEngine } from './VisualEngine'
import { PreviewFrameDecoder, PreviewFrameEncoder } from './previewFrameCodec'
import { resolveProject, type ProjectSnapshot } from './resolve'
import { identityVisualCopy } from '../visualCopies/identityVisualCopy'
import { registerMoverOrSplitterDefinition, unregisterMoverOrSplitterDefinitionForTests } from '../visualCopies/registry'
import { sharedLocalLayout } from '../visualCopies/sharedLocalLayout'
import { resolveVisualCopies } from '../visualCopies/resolveVisualCopies'
import { compileParticlePlan, particlePlanMatrix } from '../visualCopies/particlePlan'
import type { MoverOrSplitter, MoverOrSplitterContext } from '../visualCopies/types'

function track(id: string, fields: Partial<Track>): Track {
  return { id, name: id, type: 'base', instrumentId: '', color: '#fff', muted: false, solo: false,
    blocks: [], childIds: [], ...fields }
}
function fixture(prefixId: string, suffixId = 'radial'): ProjectSnapshot {
  const tracks = [track('p', { instrumentId: 'particle', params: { size: .007 }, childIds: ['prefix', 'a', 'b', 'c'] }),
    track('prefix', { type: 'mover', moverId: prefixId, parentId: 'p' }),
    ...['a', 'b', 'c'].map(id => track(id, { type: 'splitter', splitterId: suffixId, parentId: 'p',
      inputValues: { copies: 32, radius: .2 } }))]
  return { tracks: Object.fromEntries(tracks.map(value => [value.id, value])), rootTrackIds: ['p'], beatsPerBar: 4, bpm: 120 }
}

function assertNear(actual: Matrix4, expected: Matrix4) {
  actual.elements.forEach((value, i) => assert.ok(Math.abs(value - expected.elements[i]) <= 1e-10,
    `matrix element ${i}: ${value} != ${expected.elements[i]}`))
}

test('bounded CPU seeds preserve internals, appearance, paused placement and worker roundtrips without expanding GPU suffixes', t => {
  const prefixId = 'testHybridSeed', suffixId = 'testHybridFanout'
  t.after(() => { unregisterMoverOrSplitterDefinitionForTests(prefixId); unregisterMoverOrSplitterDefinitionForTests(suffixId) })
  const layout = Array.from({ length: 32 }, (_, index) => new Matrix4().makeRotationX(index * .01).setPosition(index * .03, 0, 0))
  const seeds = (_copy: ReturnType<typeof identityVisualCopy>, context: MoverOrSplitterContext) => context.beat < 0 ? []
    : [0, 1].map(index => {
      const copy = identityVisualCopy()
      copy.transform.makeRotationZ(context.beat * .1).setPosition(context.beat + (context.placementTransform?.elements[12] ?? 0), index, 0)
      copy.opacity = .3 + index * .2
      copy.colorShift = { hue: .1 + index * .2, saturation: .05, lightness: -.03,
        tint: index ? '#3366aa' : '#aa6633', tintAmount: .7, tintPerceptual: true, huePerceptual: true }
      return { visualCopy: copy, internalTransform: new Matrix4().makeRotationY(.3 + index) }
    })
  const prefix: MoverOrSplitter = { maxOutputCount: 2, applyFramed: seeds,
    apply(copy, context) { return seeds(copy, context).map(value => ({ ...value.visualCopy,
      transform: value.visualCopy.transform.clone().multiply(value.internalTransform) })) } }
  registerMoverOrSplitterDefinition({ id: prefixId, label: prefixId, kind: 'mover', params: [], resolve: () => prefix })
  registerMoverOrSplitterDefinition({ id: suffixId, label: suffixId, kind: 'splitter', params: [], resolve: () => ({
    ...sharedLocalLayout({ transforms: layout }), apply() { throw new Error('GPU suffix was expanded on the CPU') },
  }) })
  let document = fixture(prefixId, suffixId)
  const engine = createVisualEngine(), receiver = createVisualEngine()
  const encoder = new PreviewFrameEncoder(), decoder = new PreviewFrameDecoder()
  engine.setProject(document)
  assert.equal(engine.getVisualCopyCount('p'), 2 * 32 ** 3)
  assert.equal(engine.getObjectList().length, 1)
  const compactObjects = engine.getObjectList()
  let packetId = 0
  for (const beat of [0, .8, -1, .8]) {
    for (const x of [0, 2]) {
      document = { ...document, tracks: { ...document.tracks, p: { ...document.tracks.p, params: { size: .007, tfX: x } } } }
      engine.syncParams(document); engine.computeAtBeat(beat)
      const plan = engine.getParticlePlan('p')!
      assert.ok(plan.cpuPrefix)
      assert.equal(plan.cpuPrefix.count, beat < 0 ? 0 : 2)
      assert.equal(engine.getVisualCopies('p').length, 0)
      assert.equal(engine.getObjectList(), compactObjects)
      const world = engine.getObjectState('p')!.world
      const source = seeds(identityVisualCopy(), { beat, index: 0, count: 1, placementTransform: world })
      for (const index of [0, 32767, 32768, 54321, 65535]) {
        const actual = engine.getVisualCopy('p', index)!
        if (beat < 0) { assert.equal(actual.opacity, 0); continue }
        const seedIndex = Math.floor(index / (32 ** 3))
        const localIndex = index % (32 ** 3)
        const slots = [Math.floor(localIndex / 1024), Math.floor(localIndex / 32) % 32, localIndex % 32]
        const expected = source[seedIndex].visualCopy.transform.clone()
        for (const slot of slots) expected.multiply(layout[slot])
        expected.multiply(source[seedIndex].internalTransform)
        assertNear(actual.transform, expected)
        assert.deepEqual(actual.colorShift, source[seedIndex].visualCopy.colorShift)
        assert.equal(actual.opacity, source[seedIndex].visualCopy.opacity)
      }
      receiver.applyFrame(decoder.decode(structuredClone(encoder.encode(engine.captureFrame(), packetId++, 0, decoder.id))))
      assert.deepEqual(receiver.getParticlePlan('p'), plan)
      for (const index of [0, 32768, 65535]) assert.deepEqual(receiver.getVisualCopy('p', index), engine.getVisualCopy('p', index))
    }
  }
})

test('world-space CPU mover seeds preserve near-zero engine placement and explicit singular placement', () => {
  let document = fixture('forceFieldPush')
  document.tracks.prefix = { ...document.tracks.prefix, inputValues: { centerX: 2, strength: 2 },
    blocks: [{ id: 'push', startBar: 0, durationBars: 4, loop: false,
      notes: [{ id: 'hit', pitch: 60, startBeat: 0, durationBeats: 4, velocity: 100 }] }] }
  const engine = createVisualEngine()
  engine.setProject(document)
  assert.ok(engine.getParticlePlan('p')!.cpuPrefix)
  for (const size of [1, 0, 1]) {
    document = { ...document, tracks: { ...document.tracks, p: { ...document.tracks.p, params: { size: .007, tfSize: size } } } }
    engine.syncParams(document)
    assert.doesNotThrow(() => engine.computeAtBeat(.5))
    const world = engine.getObjectState('p')!.world
    const reference = resolveVisualCopies(resolveProject(document).objects[0].moverAndSplitterChain, .5, world)
    if (size === 0) {
      assert.ok(world.determinant() > 0 && world.determinant() < 1e-12,
        'the engine clamps track scale to 1e-6, so zero-size settings remain invertible')
    } else assert.equal(world.determinant(), 1)
    for (const index of [0, 31, 1024, 32767]) assertNear(engine.getVisualCopy('p', index)!.transform, reference[index].transform)
    assert.equal(engine.getVisualCopies('p').length, 0)
  }
  // Direct pipeline callers can supply a genuinely singular placement. Unlike
  // the engine's clamped track scale, its inverse is the all-zero matrix.
  const chain = resolveProject(document).objects[0].moverAndSplitterChain
  const singular = new Matrix4().makeScale(0, 0, 0)
  const plan = compileParticlePlan(chain, 0, .5, singular)!
  assert.ok(plan.cpuPrefix)
  const reference = resolveVisualCopies(chain, .5, singular)
  assert.deepEqual(reference[0].transform.elements, new Array(16).fill(0), 'the active field produces a zero inverse')
  for (const index of [0, 31, 1024, 32767]) assertNear(particlePlanMatrix(plan, index, new Matrix4()), reference[index].transform)
})

test('projective CPU seed internals retain matrix parity and cannot certify a point-size bound', () => {
  const internal = new Matrix4()
  internal.elements[3] = 2
  const seed: MoverOrSplitter = {
    maxOutputCount: 1,
    apply(copy) { return [{ ...copy, transform: copy.transform.clone().multiply(internal) }] },
    applyFramed(copy) { return [{ visualCopy: copy, internalTransform: internal }] },
  }
  const suffix = sharedLocalLayout({ transforms: [new Matrix4().makeTranslation(100, 0, 0)] })
  const plan = compileParticlePlan([seed, suffix])!
  assert.ok(plan.cpuPrefix)
  assert.equal(plan.scaleBound, Infinity, 'a later translation can magnify a projective internal linear part')
  const reference = resolveVisualCopies([seed, suffix], 0)[0].transform
  assert.equal(reference.elements[0], 201)
  assert.deepEqual(particlePlanMatrix(plan, 0, new Matrix4()).elements, reference.elements)
})
