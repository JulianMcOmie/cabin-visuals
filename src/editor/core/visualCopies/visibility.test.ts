import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { ResolvedNote } from '../visual/types'
import {
  evaluateVisibilityOpacity,
  visibilityMover,
  type VisibilitySettings,
} from './visibility'
import { resolveVisualCopies } from './resolveVisualCopies'
import { identityVisualCopy } from './identityVisualCopy'
import { isGpuOperationSupported } from './gpuOperations'
import { compileParticlePlan, particlePlanCopy } from './particlePlan'
import { sharedLocalLayout } from './sharedLocalLayout'

const defaults: VisibilitySettings = {
  grouping: 0,
  attackBeats: 0,
  decayBeats: 0,
  sustainLevel: 1,
  releaseBeats: 0.05,
}

function note(beat: number, pitch: number, durationBeats = 1): ResolvedNote {
  return { beat, pitch, durationBeats, velocity: 0.2, blockStartBeat: 0, blockEndBeat: 1024 }
}

function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`)
}

test('visibility defaults are instant attack, full sustain, and quick release', () => {
  assert.equal(evaluateVisibilityOpacity([note(1, 127, 2)], 1, 0, 4, defaults), 1)
  assert.equal(evaluateVisibilityOpacity([note(1, 127, 2)], 2.5, 0, 4, defaults), 1)
  close(evaluateVisibilityOpacity([note(1, 127, 2)], 3.025, 0, 4, defaults), 0.5)
  assert.equal(evaluateVisibilityOpacity([note(1, 127, 2)], 3.05, 0, 4, defaults), 0)
})

test('one MIDI row controls each prior index and inactive indices stay at opacity zero', () => {
  const resolved = visibilityMover.resolve({
    settings: defaults,
    notes: [note(0, 127, 4), note(1, 125, 2)],
  })
  const at = (beat: number) => resolveVisualCopies([{
    apply(copy) {
      return Array.from({ length: 4 }, () => ({
        transform: copy.transform.clone(),
        opacity: copy.opacity,
        colorShift: { ...copy.colorShift },
      }))
    },
  }, resolved], beat).map((copy) => copy.opacity)

  assert.deepEqual(at(0.5), [1, 0, 0, 0])
  assert.deepEqual(at(1.5), [1, 0, 1, 0])
  assert.deepEqual(at(10), [0, 0, 0, 0])
})

test('adding visibility with no notes blacks out every prior copy immediately', () => {
  const resolved = visibilityMover.resolve({ settings: defaults, notes: [] })
  const copies = resolveVisualCopies([{
    apply(copy) {
      return Array.from({ length: 4 }, () => ({
        transform: copy.transform.clone(),
        opacity: copy.opacity,
        colorShift: { ...copy.colorShift },
      }))
    },
  }, resolved], 0)
  assert.deepEqual(copies.map((copy) => copy.opacity), [0, 0, 0, 0])
})

test('percentage grouping maps each note to a proportional range of prior indices', () => {
  const settings = { ...defaults, grouping: 25 }
  const gates = [note(0, 126, 4)] // second 25% group
  const opacities = Array.from({ length: 8 }, (_, index) =>
    evaluateVisibilityOpacity(gates, 1, index, 8, settings),
  )
  assert.deepEqual(opacities, [0, 0, 1, 1, 0, 0, 0, 0])
})

test('visibility ADSR is adjustable and remains a pure function of beat', () => {
  const settings: VisibilitySettings = {
    grouping: 0,
    attackBeats: 0.5,
    decayBeats: 0.5,
    sustainLevel: 0.4,
    releaseBeats: 1,
  }
  const notes = [note(0, 127, 2)]
  assert.equal(evaluateVisibilityOpacity(notes, 0.25, 0, 1, settings), 0.5)
  assert.equal(evaluateVisibilityOpacity(notes, 0.75, 0, 1, settings), 0.7)
  assert.equal(evaluateVisibilityOpacity(notes, 1.5, 0, 1, settings), 0.4)
  assert.equal(evaluateVisibilityOpacity(notes, 2.5, 0, 1, settings), 0.2)
  const first = evaluateVisibilityOpacity(notes, 0.75, 0, 1, settings)
  evaluateVisibilityOpacity(notes, 20, 0, 1, settings)
  assert.equal(evaluateVisibilityOpacity(notes, 0.75, 0, 1, settings), first)
})

test('the All mapping gates every copy from the single top row', () => {
  const settings = { ...defaults, grouping: -1 }
  const gates = [note(0, 127, 4)]
  const opacities = Array.from({ length: 8 }, (_, index) =>
    evaluateVisibilityOpacity(gates, 1, index, 8, settings),
  )
  assert.deepEqual(opacities, [1, 1, 1, 1, 1, 1, 1, 1])
  // Any other pitch is not a row in this mapping and gates nothing.
  assert.equal(evaluateVisibilityOpacity([note(0, 126, 4)], 1, 3, 8, settings), 0)
})

test('visibility MIDI rows label indices, count groups, or the single All row', () => {
  const indexRows = visibilityMover.midiRows!(defaults, { priorCount: 3 })
  assert.deepEqual(indexRows, [
    { pitch: 127, label: 'Index 1' },
    { pitch: 126, label: 'Index 2' },
    { pitch: 125, label: 'Index 3' },
  ])
  const groupRows = visibilityMover.midiRows!({ ...defaults, grouping: 25 }, { priorCount: 8 })
  assert.deepEqual(groupRows.map((row) => row.label), ['Group 1 of 4', 'Group 2 of 4', 'Group 3 of 4', 'Group 4 of 4'])
  const allRows = visibilityMover.midiRows!({ ...defaults, grouping: -1 }, { priorCount: 8 })
  assert.deepEqual(allRows, [{ pitch: 127, label: 'All copies' }])
})

test('shared visibility matches independent ADSR evaluation for every mapping and arbitrary seeks', () => {
  const notes = [note(.4, 126, 1.3), note(-.3, 127, .1), note(0, 127, 2), note(.2, 125, 0),
    note(.1, 124, -.2), note(0, -5, 2), note(0, 126.5, 4), note(0, 128, 4)]
  const input = identityVisualCopy()
  input.opacity = .37
  input.transform.makeRotationZ(.3).setPosition(2, -1, .7)
  input.colorShift = { hue: .2, saturation: -.1, lightness: .3, tint: '#AbCdEf', tintAmount: .4,
    tintPerceptual: true, huePerceptual: true }
  for (const grouping of [-2, -1, 0, 10, 20, 25, 12.5, 33.333333, .0001, 1000]) {
    for (const envelope of [{ attackBeats: .3, decayBeats: .4, sustainLevel: .35, releaseBeats: .7 },
      { attackBeats: 0, decayBeats: .2, sustainLevel: 1.3, releaseBeats: 0 },
      { attackBeats: -.2, decayBeats: -.1, sustainLevel: -.4, releaseBeats: .5 }]) {
      const settings = { grouping, ...envelope }, entry = visibilityMover.resolve({ settings, notes })
      for (const beat of [-1, 0, .15, .3, .6, 1.8, 2, 2.35, 8, .6]) {
        const operation = entry.gpuOperationAtBeat!(beat)
        assert.ok(isGpuOperationSupported(operation))
        assert.ok(operation.parameters.length < 100)
        for (const count of [1, 3, 22, 133, 1048576]) {
          for (const index of [...new Set([0, 1, 2, 15, 132, Math.floor(count / 2), count - 1])].filter(index => index < count)) {
            const actual = entry.apply(input, { beat, index, count })[0]
            close(actual.opacity, input.opacity * evaluateVisibilityOpacity(notes, beat, index, count, settings))
            assert.deepEqual(actual.transform.elements, input.transform.elements)
            assert.deepEqual(actual.colorShift, input.colorShift)
          }
        }
      }
    }
  }
})

test('each-index opacity uses exact sparse keys beyond float integer precision and ignores invalid rows', () => {
  const index = 16777217, settings = { ...defaults, releaseBeats: 0 }
  const notes = [note(0, 127-index, 4), note(0, 126.5, 4), note(0, 128, 4)]
  const entry = visibilityMover.resolve({ settings, notes })
  const operation = entry.gpuOperationAtBeat!(1)
  assert.ok(isGpuOperationSupported(operation))
  assert.equal(operation.parameters.length, 31)
  for (const current of [0, 1, index - 1, index, index + 1]) {
    const actual = entry.apply(identityVisualCopy(), { beat: 1, index: current, count: 33554432 })[0]
    assert.equal(actual.opacity, evaluateVisibilityOpacity(notes, 1, current, 33554432, settings))
  }
})

test('visibility retains full million-copy execution with sparse All, group and index data', () => {
  const prefix = sharedLocalLayout({ transforms: Array.from({ length: 32 }, () => new Matrix4()),
    opacities: Array.from({ length: 32 }, () => .8) })
  const forbidden = () => { throw new Error('Visibility must not expand the particle prefix') }
  const level = { ...prefix, apply: forbidden }
  const notes = [note(0, 127, 4), note(0, 125, 4), note(0, 127-1048575, 4)]
  for (const grouping of [-1, 25, 0]) {
    const settings = { ...defaults, grouping }, entry = visibilityMover.resolve({ settings, notes })
    const plan = compileParticlePlan([level, level, level, level, { ...entry, apply: forbidden }], 0, .5)
    assert.ok(plan)
    assert.equal(plan.count, 1048576)
    assert.equal(plan.cpuPrefix, undefined)
    assert.ok(plan.matrices.length < 10000)
    for (const index of [0, 1, 2, 262143, 262144, 524288, 1048575]) {
      const copy = particlePlanCopy(plan, index)!
      close(copy.opacity, .8 ** 4 * evaluateVisibilityOpacity(notes, .5, index, plan.count, settings))
    }
  }
})
