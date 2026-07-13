import assert from 'node:assert/strict'
import test from 'node:test'
import { Vector3 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { mergeDefinitionSettings } from './definitions'
import { identityVisualCopy } from './identityVisualCopy'
import {
  constantOrbitMover,
  constantRotateMover,
  evaluateConstantRotationAngles,
  orbitBurstMover,
  rotateBurstMover,
  type ConstantRotationSettings,
  type RotationBurstSettings,
} from './rotationMovers'

function note(beat: number, pitch: number, durationBeats = 1, velocity = 1): ResolvedNote {
  return { beat, pitch, durationBeats, velocity, blockStartBeat: 0, blockEndBeat: 1024 }
}

function burstSettings(overrides: Partial<RotationBurstSettings> = {}): RotationBurstSettings {
  return { ...mergeDefinitionSettings(rotateBurstMover, undefined), ...overrides } as unknown as RotationBurstSettings
}

function constantSettings(overrides: Partial<ConstantRotationSettings> = {}): ConstantRotationSettings {
  return { ...mergeDefinitionSettings(constantRotateMover, undefined), ...overrides } as unknown as ConstantRotationSettings
}

function transformedDirection(matrix: ReturnType<typeof identityVisualCopy>['transform'], direction: Vector3): Vector3 {
  return direction.clone().applyMatrix4(matrix).normalize()
}

function position(matrix: ReturnType<typeof identityVisualCopy>['transform']): Vector3 {
  return new Vector3().setFromMatrixPosition(matrix)
}

function closeVector(actual: Vector3, expected: [number, number, number]): void {
  const target = new Vector3(...expected)
  assert.ok(actual.distanceTo(target) < 1e-9, `${actual.toArray()} != ${expected}`)
}

test('Rotate Burst permanently eases a signed note into a self rotation', () => {
  const mover = rotateBurstMover.resolve({
    settings: burstSettings({ easing: 5, angleZ: 90 }),
    notes: [note(0, 64)],
  })
  const before = mover.apply(identityVisualCopy(), { beat: 0, index: 0, count: 1 })[0]
  const landed = mover.apply(identityVisualCopy(), { beat: 1, index: 0, count: 1 })[0]
  const later = mover.apply(identityVisualCopy(), { beat: 20, index: 0, count: 1 })[0]
  closeVector(transformedDirection(before.transform, new Vector3(1, 0, 0)), [1, 0, 0])
  closeVector(transformedDirection(landed.transform, new Vector3(1, 0, 0)), [0, 1, 0])
  assert.deepEqual(later.transform.elements, landed.transform.elements)
  closeVector(position(landed.transform), [0, 0, 0])
})

test('Rotate Burst supports both directions and editable basis vectors', () => {
  const cancelled = rotateBurstMover.resolve({
    settings: burstSettings({ easing: 5, angleZ: 90 }),
    notes: [note(0, 64), note(0, 65)],
  }).apply(identityVisualCopy(), { beat: 1, index: 0, count: 1 })[0]
  closeVector(transformedDirection(cancelled.transform, new Vector3(1, 0, 0)), [1, 0, 0])

  const changedBasis = rotateBurstMover.resolve({
    settings: burstSettings({
      easing: 5,
      angleX: 90,
      basisXX: 0,
      basisXY: 1,
      basisXZ: 0,
    }),
    notes: [note(0, 60)],
  }).apply(identityVisualCopy(), { beat: 1, index: 0, count: 1 })[0]
  closeVector(transformedDirection(changedBasis.transform, new Vector3(0, 0, 1)), [1, 0, 0])
})

test('Orbit Burst rotates the prior copy position around the center pivot', () => {
  const input = identityVisualCopy()
  input.transform.makeTranslation(2, 0, 0)
  const output = orbitBurstMover.resolve({
    settings: burstSettings({ easing: 5, angleZ: 90, pivotX: 0, pivotY: 0, pivotZ: 0 }),
    notes: [note(0, 64)],
  }).apply(input, { beat: 1, index: 0, count: 1 })[0]
  closeVector(position(output.transform), [0, 2, 0])
})

test('Orbit Burst honors an adjustable pivot', () => {
  const input = identityVisualCopy()
  input.transform.makeTranslation(3, 0, 0)
  const output = orbitBurstMover.resolve({
    settings: burstSettings({ easing: 5, angleZ: 90, pivotX: 1, pivotY: 0, pivotZ: 0 }),
    notes: [note(0, 64)],
  }).apply(input, { beat: 1, index: 0, count: 1 })[0]
  closeVector(position(output.transform), [1, 2, 0])
})

test('Constant Rotate turns only while a signed note is held and then keeps its angle', () => {
  const settings = constantSettings({ speedZ: 90 })
  const notes = [note(0, 64, 2)]
  const atOne = evaluateConstantRotationAngles(notes, settings, 1)
  const afterRelease = evaluateConstantRotationAngles(notes, settings, 3)
  assert.ok(Math.abs(atOne[2] - Math.PI / 2) < 1e-9)
  assert.ok(Math.abs(afterRelease[2] - Math.PI) < 1e-9)
})

test('Return gently removes accumulated constant rotation and stays returned', () => {
  const settings = constantSettings({ speedZ: 90, returnBeats: 1 })
  const notes = [note(0, 64, 2), note(3, 66, 1)]
  const halfway = evaluateConstantRotationAngles(notes, settings, 3.5)
  const returned = evaluateConstantRotationAngles(notes, settings, 4)
  const later = evaluateConstantRotationAngles(notes, settings, 20)
  assert.ok(Math.abs(halfway[2] - Math.PI / 2) < 1e-9)
  assert.ok(Math.abs(returned[2]) < 1e-9)
  assert.ok(Math.abs(later[2]) < 1e-9)
})

test('Return takes the gentle shortest path after multiple accumulated turns', () => {
  const settings = constantSettings({ speedZ: 450, returnBeats: 1 })
  const notes = [note(0, 64, 1), note(2, 66, 1)] // 450° is equivalent to +90°
  const halfway = evaluateConstantRotationAngles(notes, settings, 2.5)
  assert.ok(Math.abs(halfway[2] - Math.PI / 4) < 1e-9)
})

test('Constant Orbit uses the same held-note and Return grammar around a pivot', () => {
  const input = identityVisualCopy()
  input.transform.makeTranslation(2, 0, 0)
  const mover = constantOrbitMover.resolve({
    settings: constantSettings({ speedZ: 90 }),
    notes: [note(0, 64, 2)],
  })
  const moving = mover.apply(input, { beat: 1, index: 0, count: 1 })[0]
  const stopped = mover.apply(input, { beat: 3, index: 0, count: 1 })[0]
  closeVector(position(moving.transform), [0, 2, 0])
  closeVector(position(stopped.transform), [-2, 0, 0])
})

test('constant rotation movers expose six signed rows plus Return', () => {
  const selfRows = constantRotateMover.midiRows!(constantSettings())
  const orbitRows = constantOrbitMover.midiRows!(constantSettings())
  assert.equal(selfRows.length, 7)
  assert.deepEqual(selfRows.map((row) => row.pitch), [62, 63, 60, 61, 64, 65, 66])
  assert.deepEqual(orbitRows, selfRows)
})

test('all rotation evaluators reproduce the same result after scrubbing away', () => {
  const settings = constantSettings({ speedX: 37, speedY: 83, speedZ: 19 })
  const notes = [note(1, 60, 2), note(1.5, 63, 4), note(7, 66, 0.5)]
  const first = evaluateConstantRotationAngles(notes, settings, 4.25)
  evaluateConstantRotationAngles(notes, settings, 100)
  assert.deepEqual(evaluateConstantRotationAngles(notes, settings, 4.25), first)
})
