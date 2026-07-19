import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import { cubeSpinRotation } from './cubeSpin'

const roundedPosition = (matrix: Matrix4): [number, number, number] => [
  Number(matrix.elements[12].toFixed(10)),
  Number(matrix.elements[13].toFixed(10)),
  Number(matrix.elements[14].toFixed(10)),
]

test('cube spin is intrinsic to each rendered copy rather than its outer placement', () => {
  assert.deepEqual(cubeSpinRotation(8, 2), [1.44, 3.52, 0])

  const spin = new Matrix4().makeRotationZ(Math.PI / 2)
  const gridCell = new Matrix4().makeTranslation(2, 0, 0)
  assert.deepEqual(roundedPosition(gridCell.clone().multiply(spin)), [2, 0, 0])
  assert.deepEqual(roundedPosition(spin.clone().multiply(gridCell)), [0, 2, 0])
})
