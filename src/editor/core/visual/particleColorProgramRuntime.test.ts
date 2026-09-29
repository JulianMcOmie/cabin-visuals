import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { Track } from '../../types'
import { createVisualEngine } from './VisualEngine'
import { PreviewFrameDecoder, PreviewFrameEncoder } from './previewFrameCodec'
import { resolveProject, type ProjectSnapshot } from './resolve'
import { compileParticlePlan, particlePlanCopy } from '../visualCopies/particlePlan'
import { COLOR_IDS } from '../../../../scripts/perf/particle-color-program-fixtures'

function track(id: string, fields: Partial<Track>): Track {
  return { id, name: id, type: 'base', instrumentId: '', color: '#fff', muted: false, solo: false,
    blocks: [], childIds: [], ...fields }
}
function fixture(id: typeof COLOR_IDS[number]): ProjectSnapshot {
  const parameter = { cosinePalette: 'scroll', gradient: 'offset', riso: 'tone', hueRotate: 'rotate', calmHueRotate: 'intensity' }[id]!
  const lane = (id: string, parentId: string, targetParam: string, min: number, max: number) => track(id, {
    type: 'automation', parentId, targetParam, interpolation: 'linear', automationRange: { min, max },
    blocks: [{ id: id + '-block', startBar: 0, durationBars: 8, loop: false, notes: [
      { id: id + '-low', pitch: 36, startBeat: 0, durationBeats: .25, velocity: 100 },
      { id: id + '-high', pitch: 84, startBeat: 4, durationBeats: .25, velocity: 100 },
    ] }],
  })
  const tracks = [track('p', { instrumentId: 'particle', params: { size: .007, tfRotY: 13 }, childIds: ['x', 'a', 'y', 'b', 'c', 'color'] }),
    ...['a', 'b', 'c'].map((key, i) => track(key, { type: 'splitter', splitterId: 'radial', parentId: 'p',
      inputValues: { copies: 32, radius: 2.1 / 3.5 ** i, plane: i % 3 } })),
    track('color', { type: 'mover', moverId: id, parentId: 'p', childIds: ['parameter'],
      inputValues: { mode: 0 }, blocks: [{ id: 'notes', startBar: 0, durationBars: 8, loop: false, notes: [
        { id: 'flash', pitch: 60, startBeat: 0, durationBeats: 4, velocity: 100 },
        { id: 'rainbow', pitch: 61, startBeat: .5, durationBeats: 3, velocity: 80 },
      ] }] }),
    lane('parameter', 'color', parameter, 0, 1), lane('x', 'p', 'tfX', -.7, .7), lane('y', 'p', 'tfY', -.4, .4)]
  return { tracks: Object.fromEntries(tracks.map(value => [value.id, value])), rootTrackIds: ['p'], beatsPerBar: 4, bpm: 120, totalBars: 8 }
}
function near(actual: Matrix4, expected: Matrix4) {
  actual.elements.forEach((value, i) => assert.ok(Math.abs(value - expected.elements[i]) < 1e-8))
}

test('all automated colorizers keep a compact particle object and their exact colors through worker and picking paths', () => {
  for (const id of COLOR_IDS) {
    const document = fixture(id), chain = resolveProject(document).objects[0].moverAndSplitterChain
    const engine = createVisualEngine(), receiver = createVisualEngine()
    const encoder = new PreviewFrameEncoder(), decoder = new PreviewFrameDecoder()
    engine.setProject(document)
    const objects = engine.getObjectList()
    assert.equal(objects.length, 1, `${id} must mount a compact object`)
    const seen = new Map<number, ReturnType<typeof engine.getVisualCopy>>()
    let packet = 0
    for (const beat of [.2, .9, 2.1, -.5, .9]) {
      engine.computeAtBeat(beat)
      const plan = engine.getParticlePlan('p')!
      assert.ok(plan, `${id} retains a compact plan through automation`)
      assert.equal(plan.count, 32 ** 3)
      assert.equal(plan.cpuPrefix, undefined)
      assert.equal(engine.getObjectList(), objects)
      assert.equal(engine.getVisualCopies('p').length, 0)
      const placement = engine.getObjectState('p')!.world
      const prefix = compileParticlePlan(chain.slice(0, -1), 0, beat, placement)!
      assert.ok(prefix)
      for (const index of [0, 31, 1024, 16384, 32 ** 3 - 1]) {
        const input = particlePlanCopy(prefix, index)!
        const reference = chain.at(-1)!.apply(input, { beat, index, count: prefix.count, placementTransform: placement })[0]
        const actual = engine.getVisualCopy('p', index)!
        near(actual.transform, reference.transform)
        assert.equal(actual.opacity, reference.opacity)
        for (const key of ['hue', 'saturation', 'lightness', 'tintAmount'] as const) {
          assert.ok(Math.abs(actual.colorShift[key] - reference.colorShift[key]) < 1e-8, `${id} ${key}`)
        }
        assert.equal(actual.colorShift.tint?.toLowerCase(), reference.colorShift.tint?.toLowerCase())
        assert.equal(!!actual.colorShift.tintPerceptual, !!reference.colorShift.tintPerceptual)
        assert.equal(!!actual.colorShift.huePerceptual, !!reference.colorShift.huePerceptual)
      }
      receiver.applyFrame(decoder.decode(structuredClone(encoder.encode(engine.captureFrame(), packet++, 0, decoder.id))))
      assert.deepEqual(receiver.getParticlePlan('p'), plan)
      for (const index of [0, 16384, 32767]) assert.deepEqual(receiver.getVisualCopy('p', index), engine.getVisualCopy('p', index))
      if (seen.has(beat)) assert.deepEqual(engine.getVisualCopy('p', 16384), seen.get(beat))
      seen.set(beat, engine.getVisualCopy('p', 16384))
    }
  }
})


test('a moved world-color field retains placement overrides through worker transport and paused placement edits', () => {
  let document = fixture('cosinePalette')
  document.tracks.color = { ...document.tracks.color, childIds: ['parameter', 'frame'] }
  document.tracks.frame = track('frame', { type: 'mover', moverId: 'mover', parentId: 'color',
    inputValues: { motion: 1, mode: 1, angleY: 17, angleZ: 29 } })
  const engine = createVisualEngine(), receiver = createVisualEngine()
  const encoder = new PreviewFrameEncoder(), decoder = new PreviewFrameDecoder()
  engine.setProject(document)
  const objects = engine.getObjectList()
  assert.equal(objects.length, 1)
  let packet = 0
  for (const beat of [.2, .9, 2.1, .9]) for (const x of [.2, -.4]) {
    document = { ...document, tracks: { ...document.tracks, p: { ...document.tracks.p,
      params: { ...document.tracks.p.params, tfZ: x } } } }
    engine.syncParams(document); engine.computeAtBeat(beat)
    const plan = engine.getParticlePlan('p')!
    assert.ok(plan)
    assert.ok(plan.program?.operationPlacementOffsets?.some(offset => offset >= 0))
    assert.equal(plan.cpuPrefix, undefined)
    assert.equal(engine.getObjectList(), objects)
    const chain = resolveProject(document).objects[0].moverAndSplitterChain, placement = engine.getObjectState('p')!.world
    const prefix = compileParticlePlan(chain.slice(0, -1), 0, beat, placement)!
    for (const index of [0, 327, 16384, 32767]) {
      const expected = chain.at(-1)!.apply(particlePlanCopy(prefix, index)!, { beat, index, count: plan.count, placementTransform: placement })[0]
      const actual = engine.getVisualCopy('p', index)!
      near(actual.transform, expected.transform)
      assert.equal(actual.colorShift.tint, expected.colorShift.tint)
    }
    receiver.applyFrame(decoder.decode(structuredClone(encoder.encode(engine.captureFrame(), packet++, 0, decoder.id))))
    assert.deepEqual(receiver.getParticlePlan('p'), plan)
    for (const index of [0, 16384, 32767]) assert.deepEqual(receiver.getVisualCopy('p', index), engine.getVisualCopy('p', index))
  }
})
