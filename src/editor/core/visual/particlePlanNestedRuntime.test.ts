import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { Block, Track } from '../../types'
// Use the public entry point so instrument/registry initialization matches the
// editor rather than importing an implementation through a registry cycle.
import { createVisualEngine } from './VisualEngine'
import { PreviewFrameEncoder, PreviewFrameDecoder } from './previewFrameCodec'
import { resolveProject, type ProjectSnapshot } from './resolve'
import { resolveVisualCopies } from '../visualCopies/resolveVisualCopies'

const RADIALS = ['a', 'b', 'c'] as const
const COPIES = 32 ** 3
const SAMPLE_INDICES = [0, 31, 32, 1024, 12345, COPIES - 1]

function block(id: string, notes: { pitch: number; startBeat: number }[]): Block {
  return { id, startBar: 0, durationBars: 8, loop: false, notes: notes.map((note, i) => ({
    id: `${id}-${i}`, ...note, durationBeats: .25, velocity: 100,
  })) }
}

function fixture(nested: typeof RADIALS[number] = 'b', tfAutomation = false): ProjectSnapshot {
  const p: Track = { id: 'p', name: 'Particle', instrumentId: 'particle', type: 'base', color: '#fff',
    muted: false, solo: false, blocks: [], childIds: [...RADIALS], params: { size: .01, tfX: 2, tfRotY: 17 } }
  const tracks: Record<string, Track> = { p }
  RADIALS.forEach((id, i) => {
    tracks[id] = { ...p, id, name: `Radial ${i}`, instrumentId: '', type: 'splitter', parentId: 'p',
      splitterId: 'radial', params: {}, childIds: id === nested ? ['motion'] : [],
      inputValues: { copies: 32, radius: [2.1, .5, .1][i], tilt: [31, 17, -23][i], size: [.7, .6, .5][i] } }
  })
  tracks.motion = tfAutomation
    ? { ...p, id: 'motion', name: 'Rotation', instrumentId: '', type: 'automation', parentId: nested,
      childIds: [], params: {}, targetParam: 'tfRotY',
      blocks: [block('rotate', [{ pitch: 60, startBeat: 0 }, { pitch: 84, startBeat: 4 }])] }
    : { ...p, id: 'motion', name: 'Mover', instrumentId: '', type: 'mover', parentId: nested,
      moverId: 'mover', childIds: [], params: {},
      inputValues: { motion: 1, mode: 1, angleX: 17, angleY: 29, angleZ: 43 } }
  return { tracks, rootTrackIds: ['p'], beatsPerBar: 4, bpm: 120, totalBars: 8 }
}

function assertMatrixNear(actual: Matrix4, expected: Matrix4) {
  actual.elements.forEach((value, i) => assert.ok(Math.abs(value - expected.elements[i]) < 1e-9,
    `matrix element ${i}: ${value} != ${expected.elements[i]}`))
}

test('nested Mover under each of three 32-copy Radials stays compact and resamples through seeks', t => {
  for (const [position, nested] of RADIALS.entries()) {
    const document = fixture(nested)
    const engine = createVisualEngine()
    let clones = 0
    const clone = Matrix4.prototype.clone
    const observed = t.mock.method(Matrix4.prototype, 'clone', function (this: Matrix4) {
      clones++
      return clone.call(this)
    })
    engine.setProject(document)
    assert.equal(engine.getVisualCopyCount('p'), COPIES)
    assert.equal(engine.getObjectList().length, 1)
    assert.equal(engine.getObjectList()[0].proceduralCopies, true)
    const seen = new Map<number, number[][]>()
    for (const beat of [0, .7, 2.4, -.5, .7, 0]) {
      engine.computeAtBeat(beat)
      const plan = engine.getParticlePlan('p')!
      assert.ok(plan)
      assert.equal(plan.beat, beat)
      assert.equal(plan.count, COPIES)
      assert.equal(plan.program!.kinds[position], 2)
      assert.equal(plan.program!.kinds.filter(kind => kind === 2).length, 1)
      assert.ok(plan.matrices.length <= (32 * 5) * 16, 'one framed stage adds only its local internal and bare matrices')
      assert.deepEqual(plan.program!.guardOffsets, [-1, -1, -1])
      assert.equal(engine.getVisualCopies('p').length, 0)
      const matrices = SAMPLE_INDICES.map(index => engine.getVisualCopy('p', index)!.transform.elements.slice())
      if (seen.has(beat)) assert.deepEqual(matrices, seen.get(beat))
      seen.set(beat, matrices)
    }
    observed.mock.restore()
    assert.ok(clones < 4096, `${nested} used ${clones} matrix clones; structural/frame work must not expand 32³ copies`)
    assert.notDeepEqual(seen.get(0), seen.get(.7), `${nested} must animate`)
    engine.computeAtBeat(.7)
    const reference = resolveVisualCopies(resolveProject(document).objects[0].moverAndSplitterChain, .7)
    for (const index of SAMPLE_INDICES) assertMatrixNear(engine.getVisualCopy('p', index)!.transform, reference[index].transform)
  }
})

test('a Radial own rotation automation stays compact and updates the runtime frame plan', () => {
  const document = fixture('b', true)
  const engine = createVisualEngine()
  engine.setProject(document)
  const seen = new Map<number, number[][]>()
  let previous: ReturnType<typeof engine.getParticlePlan>
  for (const beat of [0, 1.3, 4, -1, 1.3, 0]) {
    engine.computeAtBeat(beat)
    const plan = engine.getParticlePlan('p')!
    assert.ok(plan.program)
    assert.equal(plan.count, COPIES)
    assert.equal(plan.beat, beat)
    if (previous) assert.notEqual(plan, previous, 'a changed automation beat produces new metadata for render/worker consumers')
    previous = plan
    assert.equal(engine.getVisualCopies('p').length, 0)
    const matrices = SAMPLE_INDICES.map(index => engine.getVisualCopy('p', index)!.transform.elements.slice())
    if (seen.has(beat)) assert.deepEqual(matrices, seen.get(beat))
    seen.set(beat, matrices)
  }
  assert.notDeepEqual(seen.get(0), seen.get(1.3))
  engine.computeAtBeat(1.3)
  const reference = resolveVisualCopies(resolveProject(document).objects[0].moverAndSplitterChain, 1.3)
  for (const index of SAMPLE_INDICES) assertMatrixNear(engine.getVisualCopy('p', index)!.transform, reference[index].transform)
})

test('worker frame codec preserves correlated program offsets and mixed-prefix guard bits', () => {
  const document = fixture('b')
  // Growth straddles the incoming-frame singularity threshold, requiring an
  // actual per-prefix guard table instead of one always-active/bare flag.
  document.tracks.a = { ...document.tracks.a, splitterId: 'line',
    inputValues: { copies: 32, spacing: .2, size: .05, growth: .5 } }
  const engine = createVisualEngine(), receiver = createVisualEngine()
  const encoder = new PreviewFrameEncoder(), decoder = new PreviewFrameDecoder()
  engine.setProject(document)
  for (const [id, beat] of [0, .7, -1, .7].entries()) {
    engine.computeAtBeat(beat)
    const sent = engine.getParticlePlan('p')!
    assert.ok(sent.program)
    const guardOffset = sent.program.guardOffsets[1]
    assert.ok(guardOffset >= 0, 'mixed prefix determinants require stored guard flags')
    const guards = [...sent.matrices.slice(guardOffset, guardOffset + 32)]
    assert.ok(guards.includes(0) && guards.includes(1))
    const packet = encoder.encode(engine.captureFrame(), id, 0, decoder.id)
    assert.ok(packet.particlePlans, 'animated framed matrices cross the worker boundary')
    receiver.applyFrame(decoder.decode(structuredClone(packet)))
    const received = receiver.getParticlePlan('p')!
    assert.deepEqual(received.program, sent.program)
    assert.deepEqual(received.counts, sent.counts)
    assert.deepEqual(received.offsets, sent.offsets)
    assert.deepEqual(received.matrices, sent.matrices)
    assert.equal(received.count, sent.count)
    assert.equal(receiver.getVisualCopies('p').length, 0)
    assert.equal(receiver.getObjectState('p')!.beat, beat)
    for (const index of SAMPLE_INDICES) assert.deepEqual(receiver.getVisualCopy('p', index), engine.getVisualCopy('p', index))
  }
  const acknowledged = encoder.encode(engine.captureFrame(), 4, 0, decoder.id)
  assert.equal(acknowledged.particlePlans, undefined, 'unchanged acknowledged plans do not repeat across the worker boundary')
  receiver.applyFrame(decoder.decode(structuredClone(acknowledged)))
  assert.deepEqual(receiver.getParticlePlan('p')!.program, engine.getParticlePlan('p')!.program)
})

test('editing a nested chain through color and target fallbacks restores its compact representation', () => {
  const document = fixture('b')
  const engine = createVisualEngine()
  engine.setProject(document); engine.computeAtBeat(.7)
  const original = engine.getVisualCopy('p', 12345)!.transform.elements.slice()
  let publications = 0
  engine.subscribeObjects(() => publications++)
  const colored = structuredClone(document)
  colored.tracks.b.childIds.push('color')
  colored.tracks.color = { ...colored.tracks.motion, id: 'color', moverId: 'gradient',
    inputValues: { mode: 1, amount: 1 }, stringParams: { colorA: '#ff0000', colorB: '#0000ff' } }
  const targeted = structuredClone(document)
  targeted.tracks.motion.copyTargets = { rule: 'every', slices: 2, on: [0] }
  for (const edit of [colored, targeted]) {
    engine.setProject(edit); engine.computeAtBeat(.7)
    assert.equal(engine.getParticlePlan('p'), undefined)
    assert.equal(engine.getVisualCopyCount('p'), COPIES)
    assert.equal(engine.getVisualCopies('p').length, COPIES)
    assert.equal(engine.getObjectList().length, COPIES)
    assert.ok(engine.getObjectList().every(entry => !entry.proceduralCopies))
    if (edit === colored) assert.ok(engine.getVisualCopy('p', 12345)!.colorShift.tint)
    engine.setProject(document); engine.computeAtBeat(.7)
    assert.ok(engine.getParticlePlan('p')!.program)
    assert.equal(engine.getObjectList().length, 1)
    assert.equal(engine.getVisualCopies('p').length, 0)
    assert.deepEqual(engine.getVisualCopy('p', 12345)!.transform.elements, original)
  }
  assert.equal(publications, 4, 'each representation transition publishes the new render object list')
})
