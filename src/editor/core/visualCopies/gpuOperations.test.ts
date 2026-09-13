import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import { applyGpuOperation, axialRotationOperation, gpuOperationParameterCount, isGpuOperationSupported,
  mirrorDisplacementOperation, radialDisplacementOperation, type GpuOperation } from './gpuOperations'
import { mergeDefinitionSettings } from './definitions'
import { symmetricMotionMover } from './symmetricMotion'
import { symmetricRotationMover } from './symmetricRotation'
import { identityVisualCopy } from './identityVisualCopy'

function near(actual: readonly number[], expected: readonly number[], tolerance = 1e-10) {
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= tolerance * Math.max(1, Math.abs(expected[index])),
    `component ${index}: ${value} versus ${expected[index]}`))
}

test('displacement operations clamp at symmetry planes and preserve every affine basis', () => {
  const input = new Matrix4().set(1, .2, -.7, -2, .4, -3, .1, .5, 0, .6, 2, 1e-7, 0, 0, 0, 1)
  const before = input.elements.slice()
  const output = applyGpuOperation(mirrorDisplacementOperation([-5, 2, 9]), input, new Matrix4())
  near(output.elements.slice(12, 15), [0, 2.5, 1e-7])
  near(output.elements.slice(0, 12), before.slice(0, 12), 0)
  assert.deepEqual(input.elements, before)
  const radial = radialDisplacementOperation([0, 0, 1], false, -8, Math.PI / 2)
  const radialOutput = applyGpuOperation(radial, input, new Matrix4())
  near(radialOutput.elements.slice(12, 15), [0, 0, 1e-7])
  const expectedBasis = new Matrix4().makeRotationZ(Math.PI / 2).multiply(input)
  near(radialOutput.elements.slice(0, 12), expectedBasis.elements.slice(0, 12))
})

test('rotation channels use the original position and retain twist-fold-roll multiplication order', () => {
  const input = new Matrix4().makeScale(-2, 3, .5).setPosition(2, 0, 0)
  const output = applyGpuOperation(axialRotationOperation({ axis: [0, 0, 1], center: [0, 0, 0],
    angles: [Math.PI / 2, Math.PI / 2, Math.PI / 2], falloff: 0, span: 1, curve: 1, onAxis: true }), input, new Matrix4())
  // At +X, the three incoming-position axes are +Z, -Y, +X. Roll is
  // innermost and fixes the initial center; fold lifts it onto +Z, then twist
  // leaves it there. A sequentially re-aimed fold would choose another axis.
  near(output.elements.slice(12, 15), [0, 0, 2])
  const expectedBasis = new Matrix4().makeRotationZ(Math.PI / 2)
    .multiply(new Matrix4().makeRotationY(-Math.PI / 2))
    .multiply(new Matrix4().makeRotationX(Math.PI / 2)).multiply(input)
  near(output.elements.slice(0, 12), expectedBasis.elements.slice(0, 12))
})

test('operation records are serializable, immutable during evaluation, and support aliased output', () => {
  const axis = new Vector3(1, 2, -3).normalize()
  const operations = [mirrorDisplacementOperation([1, -2, .3]),
    radialDisplacementOperation([0, 1, 0], true, .7, -.3),
    axialRotationOperation({ axis: [axis.x, axis.y, axis.z], center: [1, -.2, .4],
      angles: [.7, -.3, .4], falloff: 1, span: 2, curve: .7, onAxis: true })]
  for (const operation of operations) {
    assert.equal(isGpuOperationSupported(operation), true)
    assert.equal(operation.parameters.length, gpuOperationParameterCount(operation.kind))
    const saved = structuredClone(operation)
    Object.freeze(operation.parameters); Object.freeze(operation)
    for (const scale of [0, 1e-13, -2]) {
      const input = new Matrix4().makeRotationY(.3).scale(new Vector3(scale, 3, .7)).setPosition(-3, 4, .2)
      const expected = applyGpuOperation(saved, input, new Matrix4())
      assert.equal(applyGpuOperation(operation, input, input), input)
      assert.deepEqual(input.elements, expected.elements)
    }
    assert.deepEqual(operation, saved)
  }
  for (const operation of [{ ...operations[0], kind: 999 }, { ...operations[0], parameters: [1, 2] },
    { ...operations[0], parameters: [1, NaN, 2] }, { ...operations[1], parameters: [2, 0, 0, 0, 1, 1] }]) {
    assert.equal(isGpuOperationSupported(operation), false)
  }
})

test('scale, determinant and position bounds cover aimed rotations, negative axes and near-center positions', () => {
  const axis = new Vector3(.3, -.7, .2).normalize()
  const operations: GpuOperation[] = [mirrorDisplacementOperation([-3, 2, -.4]),
    radialDisplacementOperation([0, 1, 0], false, -4, .7),
    radialDisplacementOperation([0, 0, 1], true, 3, -.9)]
  for (const onAxis of [false, true]) for (const falloff of [0, 1, 2, 3]) {
    operations.push(axialRotationOperation({ axis: [axis.x, axis.y, axis.z], center: [2, -3, .7],
      angles: [.7, -.9, 1.3], span: .4, curve: .3, onAxis, falloff }))
  }
  const positions = [[0, 0, 0], [1e-7, 0, 0], [1e-6, 0, 0], [1.00001e-6, 0, 0],
    [-20, 3, .7], [2, -3, .7], [.3, -.7, .2], [30, -40, 90]]
  for (const operation of operations) for (const position of positions) for (const scale of [0, 1e-5, -2]) {
    const input = new Matrix4().makeRotationX(.3).scale(new Vector3(scale, .7, 1.3))
      .setPosition(...position as [number, number, number])
    const output = applyGpuOperation(operation, input, new Matrix4())
    near([output.determinant()], [input.determinant()], 1e-9)
    for (const column of [0, 1, 2]) {
      near([new Vector3().setFromMatrixColumn(output, column).length()],
        [new Vector3().setFromMatrixColumn(input, column).length() * operation.scaleBound], 1e-9)
    }
    assert.ok(new Vector3().setFromMatrixPosition(output).length()
      <= (operation.positionScaleBound ?? 1) * Math.hypot(...position) + operation.translationBound + 1e-9)
  }
})

test('both mover definitions sample one shared operation per beat and reproduce backward seeks', () => {
  const notes = [{ beat: 0, pitch: 60, velocity: .7, durationBeats: 3, blockStartBeat: 0, blockEndBeat: 8 },
    { beat: 1, pitch: 62, velocity: 1, durationBeats: 2, blockStartBeat: 0, blockEndBeat: 8 }]
  for (const definition of [symmetricMotionMover, symmetricRotationMover]) for (const mode of [0, 1, 2, 3]) {
    const entry = definition.resolve({ settings: mergeDefinitionSettings(definition, {
      motion: mode, mode, twist: 23, fold: 37, roll: 19, axisYaw: 31, axisPitch: -17 }) as never, notes })
    const seen = new Map<number, GpuOperation>()
    for (const beat of [0, .7, 2, -1, .7, 0]) {
      const operation = entry.gpuOperationAtBeat!(beat)
      assert.equal(entry.gpuOperationAtBeat!(beat), operation)
      assert.ok(isGpuOperationSupported(operation))
      if (seen.has(beat)) assert.deepEqual(operation, seen.get(beat))
      seen.set(beat, structuredClone(operation))
      const input = identityVisualCopy(); input.opacity = .3
      input.colorShift = { ...input.colorShift, hue: -.2, tint: '#123456', tintAmount: .7 }
      input.transform.makeRotationX(.3).setPosition(2, -3, .7)
      const result = entry.apply(input, { beat, index: 124, count: 1000, placementTransform: new Matrix4().makeScale(0, 0, 0) })[0]
      assert.deepEqual(result.transform, applyGpuOperation(operation, input.transform, new Matrix4()))
      assert.equal(result.opacity, input.opacity)
      assert.deepEqual(result.colorShift, input.colorShift)
    }
  }
})
