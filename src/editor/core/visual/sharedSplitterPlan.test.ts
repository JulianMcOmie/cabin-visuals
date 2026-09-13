import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
// Load the public engine seam first, matching existing runtime tests' registry
// initialization order rather than importing the implementation directly.
import { createVisualEngine } from './VisualEngine'
import { compileParticlePlan, particlePlanCopy } from '../visualCopies/particlePlan'
import { resolveVisualCopies } from '../visualCopies/resolveVisualCopies'
import { getMoverOrSplitterDefinition } from '../visualCopies/registry'
import { mergeDefinitionSettings } from '../visualCopies/definitions'
import { splitterWithChildChain } from '../visualCopies/splitterChildChain'
import type { MoverOrSplitter, VisualCopy } from '../visualCopies/types'
import type { ResolvedNote } from './types'
import type { Track } from '../../types'

const spatialIds = ['radial', 'line', 'grid', 'symmetry', 'fractal', 'wallpaper', 'scatter',
  'polyhedron', 'parametricPattern', 'tunnel', 'duplicateTrail', 'approach']
const note = (beat: number, pitch: number, durationBeats = 2): ResolvedNote => ({
  beat, pitch, durationBeats, velocity: 100, blockStartBeat: 0, blockEndBeat: 32,
})
function entry(id: string, settings: Record<string, number> = {}, notes: ResolvedNote[] = []): MoverOrSplitter {
  const definition = getMoverOrSplitterDefinition(id)!
  assert(definition, id)
  return definition.resolve({ settings: mergeDefinitionSettings(definition, settings), notes })
}
function sameCopy(actual: VisualCopy, expected: VisualCopy, label: string) {
  actual.transform.elements.forEach((value, index) => assert(Math.abs(value - expected.transform.elements[index]) < 1e-8, `${label} matrix[${index}]`))
  assert(Math.abs(actual.opacity - expected.opacity) < 1e-12, `${label} opacity`)
  assert(Math.abs(actual.colorShift.hue - expected.colorShift.hue) < 1e-12, `${label} hue`)
  assert.deepEqual({ ...actual.colorShift, hue: 0 }, { ...expected.colorShift, hue: 0 }, `${label} other appearance`)
}
function parity(chain: MoverOrSplitter[], beat: number, placement = new Matrix4()) {
  const plan = compileParticlePlan(chain, 1, beat, placement)
  assert(plan, 'Shared spatial chain should compile')
  const reference = resolveVisualCopies(chain, beat, placement)
  assert.equal(plan.count, reference.length)
  reference.forEach((copy, index) => sameCopy(particlePlanCopy(plan, index)!, copy, `beat ${beat}, slot ${index}`))
  return { plan, reference }
}

test('all twelve spatial splitter defaults retain complete CPU transforms and appearance', () => {
  const placement = new Matrix4().makeRotationY(.31).scale(new Vector3(.7, 1.3, 1.9)).setPosition(.4, -.2, .7)
  for (const id of spatialIds) {
    const chain = [entry(id)]
    for (const beat of [0, .5, 2.3, -1, 0]) {
      assert.doesNotThrow(() => parity(chain, beat, placement), `${id} at beat ${beat}`)
    }
  }
  assert.equal(compileParticlePlan([entry('stagger')]), undefined, 'private clocks are not spatial slots')
})

test('slot opacity multiplies and trail hue accumulates through a mixed chain', () => {
  const trailA = entry('duplicateTrail', { speed: 8, density: 2, rainbow: 1, size: 1.2 }, [note(0, 60, 8)])
  const trailB = entry('duplicateTrail', { speed: 11, density: 3, rainbow: .4, size: .8 }, [note(0, 60, 8)])
  const polyhedron = entry('polyhedron', { shape: 0, radius: .5 }, [note(1, 127, 2)])
  let sawHidden = false, sawPartial = false, sawHue = false
  for (const beat of [.25, 1.75, 4.25, -1, 1.75]) {
    const { reference } = parity([trailA, polyhedron, trailB], beat)
    sawHidden ||= reference.some(copy => copy.opacity === 0)
    sawPartial ||= reference.some(copy => copy.opacity > 0 && copy.opacity < 1)
    sawHue ||= reference.some(copy => Math.abs(copy.colorShift.hue) > .01)
  }
  assert(sawHidden && sawPartial && sawHue, 'fixture must exercise all appearance channels')
})

test('nested shared slots preserve per-slot appearance while rotating', () => {
  const mover = entry('mover', { motion: 1, mode: 1, drive: 0, angleX: 17, angleY: 29, angleZ: 45 })
  const radial = entry('radial', { copies: 3, radius: .7 })
  const polyhedron = entry('polyhedron', { shape: 0, radius: .6 }, [note(1, 127, 2)])
  const trail = entry('duplicateTrail', { speed: 12, density: 2, rainbow: 1 }, [note(0, 60, 8)])
  for (const beat of [.25, 1.75, 4.25, -1, 1.75]) {
    parity([splitterWithChildChain(polyhedron, [mover]), radial], beat)
    parity([radial, splitterWithChildChain(trail, [mover])], beat)
  }
})

test('placement-sensitive layouts resample at the same beat and preserve exact seeks', () => {
  const identity = new Matrix4(), scaled = new Matrix4().makeScale(2, 3, 4)
  for (const id of ['tunnel', 'approach', 'duplicateTrail']) {
    const chain = [entry(id, id === 'duplicateTrail' ? { rainbow: 1 } : {}, [note(0, 60, 8)])]
    const first = parity(chain, 1.75, identity)
    const second = parity(chain, 1.75, scaled)
    const restored = parity(chain, 1.75, identity)
    assert.notDeepEqual([...first.plan.matrices], [...second.plan.matrices], `${id} must account for changed placement`)
    assert.deepEqual([...restored.plan.matrices], [...first.plan.matrices], `${id} seek restored`)
  }
})

function track(id: string, fields: Partial<Track>): Track {
  return { id, name: id, instrumentId: '', type: 'base', color: '#ffffff', muted: false, solo: false, blocks: [], childIds: [], ...fields }
}

test('Fractal depth MIDI stays compact through count changes and backward seeks', () => {
  const particle = track('p', { instrumentId: 'particle', childIds: ['f', 'r'], params: { size: .007 } })
  const f = track('f', { type: 'splitter', splitterId: 'fractal', parentId: 'p', childIds: ['spin'], inputValues: { branches: 5, depth: 4 },
    blocks: [{ id: 'depth', startBar: 0, durationBars: 8, loop: false, notes: [
      { id: 'seed', pitch: 36, velocity: 100, startBeat: 1, durationBeats: .25 },
      { id: 'full', pitch: 40, velocity: 100, startBeat: 3, durationBeats: .25 },
    ] }] })
  const r = track('r', { type: 'splitter', splitterId: 'radial', parentId: 'p', inputValues: { copies: 32, radius: .2 } })
  const spin = track('spin', { type: 'mover', moverId: 'mover', parentId: 'f', inputValues: { motion: 1, mode: 1, angleZ: 45, angleX: 0, angleY: 0 } })
  const engine = createVisualEngine()
  engine.setProject({ tracks: { p: particle, f, r, spin }, rootTrackIds: ['p'], bpm: 120, beatsPerBar: 4, totalBars: 8 })
  const frames = new Map<number, number[]>()
  for (const beat of [0, 2, 4, -1, 2, 0]) {
    engine.computeAtBeat(beat)
    assert.equal(engine.getVisualCopyCount('p'), 781 * 32)
    assert.equal(engine.getVisualCopies('p').length, 0)
    assert.equal(engine.getObjectList().filter(item => item.trackId === 'p').length, 1)
    assert.equal(engine.getParticlePlan('p')!.count, beat === 2 ? 32 : 781 * 32)
    const values = [...engine.getVisualCopy('p', 13)!.transform.elements]
    if (frames.has(beat)) assert.deepEqual(values, frames.get(beat))
    frames.set(beat, values)
    if (beat === 2) assert.equal(engine.getVisualCopy('p', 781 * 32 - 1)!.opacity, 0)
  }
})

test('engine recomputes shared placement-dependent layouts when placement changes at a held beat', () => {
  const particle = track('p', { instrumentId: 'particle', childIds: ['t', 'g'], params: { size: .007, tfSize: 1 } })
  const t = track('t', { type: 'splitter', splitterId: 'tunnel', parentId: 'p', inputValues: { copiesPerRing: 4, rings: 4, depth: 12, nearEnd: 3, fadeDistance: 1 } })
  const g = track('g', { type: 'splitter', splitterId: 'grid', parentId: 'p', inputValues: { columns: 32, rows: 32, depth: 1, spacing: .05 } })
  const project = { tracks: { p: particle, t, g }, rootTrackIds: ['p'], bpm: 120, beatsPerBar: 4, totalBars: 8 }
  const engine = createVisualEngine()
  const frame = (tfSize: number) => {
    engine.setProject({ ...project, tracks: { ...project.tracks, p: { ...particle, params: { ...particle.params, tfSize } } } })
    engine.computeAtBeat(1.75)
    assert.equal(engine.getVisualCopies('p').length, 0)
    const state = engine.getObjectState('p')!
    const expected = compileParticlePlan([entry('tunnel', t.inputValues), entry('grid', g.inputValues)], 1, 1.75, state.world)!
    for (const index of [0, 1, 1024, 16383]) sameCopy(engine.getVisualCopy('p', index)!, particlePlanCopy(expected, index)!, `engine slot ${index}`)
    return [...engine.getVisualCopy('p', 1024)!.transform.elements]
  }
  const first = frame(1), second = frame(4), restored = frame(1)
  assert.notDeepEqual(first, second)
  assert.deepEqual(first, restored)
})
