import test from 'node:test'
import assert from 'node:assert/strict'
import { Matrix4, Object3D, Vector3 } from 'three'
import { applyObjectPlacement } from './applyObjectPlacement'

test('ordinary and instanced placement agree for a sheared copy after world updates', () => {
  const object = new Object3D()
  const placement = new Matrix4().set(1, 0.7, 0, 3, 0.2, 1, 0, 4, 0, 0, 1, 5, 0, 0, 0, 1)
  applyObjectPlacement(object, placement, 2)
  object.updateMatrixWorld(true)
  assert.deepEqual(object.matrixWorld, placement.clone().scale(new Vector3(2, 2, 2)))
  assert.deepEqual(object.position.toArray(), [3, 4, 5])
  assert.equal(placement.elements[0], 1, 'source matrix remains immutable')
  applyObjectPlacement(object, new Matrix4())
  object.updateMatrixWorld(true)
  assert.deepEqual(object.matrixWorld, new Matrix4(), 'release clears the warp completely')
})


test('zero mesh size keeps placement and orientation finite', () => {
  const object = new Object3D()
  applyObjectPlacement(object, new Matrix4().makeTranslation(2, 3, 4), 0)
  object.updateMatrixWorld(true)
  assert.ok(object.quaternion.toArray().every(Number.isFinite))
  assert.ok(object.matrixWorld.elements.every(Number.isFinite))
  assert.deepEqual(object.position.toArray(), [2, 3, 4])
  assert.deepEqual(object.scale.toArray(), [0, 0, 0])
})
