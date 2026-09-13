import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { Track } from '../../types'
import { createVisualEngine } from './VisualEngine'
import { PreviewFrameDecoder, PreviewFrameEncoder } from './previewFrameCodec'
import { resolveProject, type ProjectSnapshot } from './resolve'
import { compileParticlePlan, particlePlanMatrix } from '../visualCopies/particlePlan'
import { resolveVisualCopies, structuralCopyCount } from '../visualCopies/resolveVisualCopies'

function track(id: string, fields: Partial<Track>): Track {
  return { id, name: id, type: 'base', instrumentId: '', color: '#fff', muted: false, solo: false,
    blocks: [], childIds: [], ...fields }
}
function fixture(count = 4, levels = 3): ProjectSnapshot {
  const ids = Array.from({ length: levels }, (_, i) => `r${i}`)
  const tracks = [track('p', { instrumentId: 'particle', params: { size: .007 }, childIds: [...ids, 'fluid', 'x', 'y'] }),
    ...ids.map((id, index) => track(id, { type: 'splitter', splitterId: 'radial', parentId: 'p',
      inputValues: { copies: count, radius: 2 / 3 ** index, plane: index % 3 } })),
    track('fluid', { type: 'mover', moverId: 'fluidImpact', parentId: 'p', childIds: ['center'],
      inputValues: { strength: 1.2, radius: 4 }, blocks: [{ id: 'hits', startBar: 0, durationBars: 8, loop: false,
        notes: [{ id: 'hit', pitch: 60, startBeat: 0, durationBeats: 1, velocity: 100 },
          { id: 'hit2', pitch: 60, startBeat: .7, durationBeats: 1, velocity: 70 }] }] }),
    track('center', { type: 'automation', parentId: 'fluid', targetParam: 'centerX', interpolation: 'linear',
      automationRange: { min: -1, max: 1 }, blocks: [{ id: 'centers', startBar: 0, durationBars: 8, loop: false,
        notes: [{ id: 'left', pitch: 36, startBeat: 0, durationBeats: .25, velocity: 100 },
          { id: 'right', pitch: 84, startBeat: 4, durationBeats: .25, velocity: 100 }] }] }),
    track('x', { type: 'automation', parentId: 'p', targetParam: 'tfX', interpolation: 'linear',
      automationRange: { min: -.7, max: .7 }, blocks: [{ id: 'xs', startBar: 0, durationBars: 8, loop: false,
        notes: [{ id: 'x0', pitch: 36, startBeat: 0, durationBeats: .25, velocity: 100 },
          { id: 'x1', pitch: 84, startBeat: 4, durationBeats: .25, velocity: 100 }] }] }),
    track('y', { type: 'automation', parentId: 'p', targetParam: 'tfY', interpolation: 'linear',
      automationRange: { min: -.4, max: .4 }, blocks: [{ id: 'ys', startBar: 0, durationBars: 8, loop: false,
        notes: [{ id: 'y0', pitch: 84, startBeat: 0, durationBeats: .25, velocity: 100 },
          { id: 'y1', pitch: 36, startBeat: 4, durationBeats: .25, velocity: 100 }] }] })]
  return { tracks: Object.fromEntries(tracks.map(value => [value.id, value])), rootTrackIds: ['p'],
    beatsPerBar: 4, bpm: 120, totalBars: 8 }
}
function near(actual: Matrix4, expected: Matrix4) {
  actual.elements.forEach((value, i) => assert.ok(Math.abs(value - expected.elements[i]) <= 1e-9,
    `matrix ${i}: ${value} != ${expected.elements[i]}`))
}

test('Fluid Impact center automation and Particle X/Y placement retain compact reference parity through seeks', () => {
  const document = fixture(), chain = resolveProject(document).objects[0].moverAndSplitterChain
  const seen = new Map<number, Float64Array>()
  for (const beat of [0, .2, .9, 1.5, 4, -.5, .9, .2]) {
    const placement = new Matrix4().makeRotationX(.3).setPosition(2, 3, 4)
    const plan = compileParticlePlan(chain, 0, beat, placement)!
    assert.ok(plan, `automated field at ${beat} remains compact`)
    assert.equal(plan.cpuPrefix, undefined)
    assert.ok(plan.program?.operationKinds.some(kind => kind > 3))
    const fieldStage = plan.program!.operationKinds.findIndex(kind => kind === 4)
    const fieldOffset = plan.program!.operationOffsets[fieldStage]
    if (beat === 0 || beat === 4) assert.equal(plan.matrices[fieldOffset + 3], beat === 0 ? -1 : 1,
      'the automated center is sampled into the GPU field, not merely retained in the document')
    const copies = resolveVisualCopies(chain, beat, placement)
    assert.equal(plan.count, copies.length)
    copies.forEach((copy, index) => near(particlePlanMatrix(plan, index, new Matrix4()), copy.transform))
    if (seen.has(beat)) assert.deepEqual(plan.matrices, seen.get(beat))
    seen.set(beat, plan.matrices.slice())
  }
  assert.notDeepEqual(seen.get(.2), seen.get(.9), 'automation and note phase actually change uploaded field data')
})

test('automated Fluid Impact after a million particles never invokes per-copy CPU apply during compilation', () => {
  const chain = resolveProject(fixture(32, 4)).objects[0].moverAndSplitterChain
  for (const entry of chain) {
    entry.apply = () => { throw new Error('A GPU-compatible field expanded the particle population') }
    for (const variant of entry.structuralVariants ?? []) variant.apply = entry.apply
  }
  assert.equal(structuralCopyCount(chain), 32 ** 4)
  for (const beat of [.2, .9, 1.5, -.5, .2]) {
    const plan = compileParticlePlan(chain, 0, beat)!
    assert.ok(plan)
    assert.equal(plan.count, 32 ** 4)
    assert.equal(plan.cpuPrefix, undefined)
    assert.ok(plan.matrices.length < 10000, 'GPU payload grows with splitter slots, not their Cartesian product')
    for (const index of [0, 31, 1024, 54321, 32 ** 4 - 1]) {
      assert.ok(particlePlanMatrix(plan, index, new Matrix4()).elements.every(Number.isFinite))
    }
  }
})

test('the engine keeps one Fluid Impact particle object through animation, edits and worker/picking roundtrips', () => {
  let document = fixture(32)
  const engine = createVisualEngine(), receiver = createVisualEngine()
  const encoder = new PreviewFrameEncoder(), decoder = new PreviewFrameDecoder()
  engine.setProject(document)
  const objects = engine.getObjectList()
  assert.equal(objects.length, 1)
  assert.equal(engine.getVisualCopyCount('p'), 32 ** 3)
  let packet = 0
  for (const beat of [.2, .9, 1.5, -.5, .9]) {
    engine.computeAtBeat(beat)
    const plan = engine.getParticlePlan('p')!
    assert.ok(plan)
    assert.equal(plan.cpuPrefix, undefined)
    assert.equal(engine.getObjectList(), objects)
    assert.equal(engine.getVisualCopies('p').length, 0)
    receiver.applyFrame(decoder.decode(structuredClone(encoder.encode(engine.captureFrame(), packet++, 0, decoder.id))))
    assert.deepEqual(receiver.getParticlePlan('p'), plan)
    for (const index of [0, 31, 1024, 16384, 32 ** 3 - 1]) {
      assert.deepEqual(receiver.getVisualCopy('p', index), engine.getVisualCopy('p', index))
      near(engine.getVisualCopy('p', index)!.transform, particlePlanMatrix(plan, index, new Matrix4()))
    }
  }
  const before = engine.getParticlePlan('p')!.matrices.slice()
  document = { ...document, tracks: { ...document.tracks,
    fluid: { ...document.tracks.fluid, inputValues: { ...document.tracks.fluid.inputValues, centerY: .7 } } } }
  engine.setProject(document); engine.computeAtBeat(.9)
  assert.ok(engine.getParticlePlan('p'))
  assert.notDeepEqual(engine.getParticlePlan('p')!.matrices, before, 'held-beat edits update field data')
  assert.equal(engine.getObjectList(), objects)
})

test('adding an empty or constant automation lane keeps a nested Fluid Impact field in the same reference frame', () => {
  const original = fixture(4, 1)
  original.tracks.p = { ...original.tracks.p, childIds: ['r0'] }
  original.tracks.r0 = { ...original.tracks.r0, childIds: ['fluid'] }
  original.tracks.fluid = { ...original.tracks.fluid, parentId: 'r0', childIds: [],
    inputValues: { ...original.tracks.fluid.inputValues, centerX: 0 } }
  const source = resolveProject(original).objects[0].moverAndSplitterChain
  for (const withNotes of [false, true]) {
    const document = { ...original, tracks: { ...original.tracks,
      fluid: { ...original.tracks.fluid, childIds: ['center'] },
      center: { ...original.tracks.center, automationRange: { min: 0, max: 0 },
        blocks: withNotes ? original.tracks.center.blocks : [] },
    } }
    const automated = resolveProject(document).objects[0].moverAndSplitterChain
    for (const beat of [.2, .3, .9]) {
      const expected = resolveVisualCopies(source, beat)
      const actual = resolveVisualCopies(automated, beat)
      assert.equal(actual.length, expected.length)
      actual.forEach((copy, index) => near(copy.transform, expected[index].transform))
      const plan = compileParticlePlan(automated, 0, beat)!
      assert.ok(plan)
      expected.forEach((copy, index) => near(particlePlanMatrix(plan, index, new Matrix4()), copy.transform))
    }
  }
})
