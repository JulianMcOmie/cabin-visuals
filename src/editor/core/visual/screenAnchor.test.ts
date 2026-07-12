import assert from 'node:assert/strict'
import test from 'node:test'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { composeScreenAnchor } from './screenAnchor'

function round(n: number) {
  const r = Math.round(n * 1e9) / 1e9
  return Object.is(r, -0) ? 0 : r
}

function decompose(m: Matrix4) {
  const pos = new Vector3()
  const quat = new Quaternion()
  const scale = new Vector3()
  m.decompose(pos, quat, scale)
  return { pos, quat, scale }
}

test('identity copy reproduces the legacy full-frame pinning exactly', () => {
  // A pitched-down camera looking at the origin from (0, 4, 8).
  const camPos = new Vector3(0, 4, 8)
  const camQuat = new Quaternion().setFromEuler(new Euler(-Math.atan2(4, 8), 0, 0))
  const out = new Matrix4()
  composeScreenAnchor(camPos, camQuat, undefined, out)
  const { pos, quat, scale } = decompose(out)

  // Legacy formula: camera.position + worldDirection * |camera.position|.
  const forward = new Vector3(0, 0, -1).applyQuaternion(camQuat)
  const expected = camPos.clone().addScaledVector(forward, camPos.length())
  assert.deepEqual(pos.toArray().map(round), expected.toArray().map(round))
  assert.deepEqual(quat.toArray().map(round), camQuat.toArray().map(round))
  assert.deepEqual(scale.toArray().map(round), [1, 1, 1])

  // The identity COPY composes to the same matrix as no copy at all.
  const withIdentity = new Matrix4()
  composeScreenAnchor(camPos, camQuat, new Matrix4(), withIdentity)
  assert.deepEqual(withIdentity.elements.map(round), out.elements.map(round))
})

test('a translated copy moves in screen space, not world space', () => {
  // Camera turned 90° to the left: screen-space +X is world -Z.
  const camPos = new Vector3(0, 0, 5)
  const camQuat = new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0))
  const out = new Matrix4()
  composeScreenAnchor(camPos, camQuat, new Matrix4().makeTranslation(2, 0, 0), out)
  const { pos } = decompose(out)

  const anchorOnly = new Matrix4()
  composeScreenAnchor(camPos, camQuat, undefined, anchorOnly)
  const anchorPos = decompose(anchorOnly).pos
  const offset = pos.clone().sub(anchorPos)
  assert.deepEqual(offset.toArray().map(round), [0, 0, -2])
})

test('a scaled copy scales inside the anchor', () => {
  const camPos = new Vector3(0, 0, 5)
  const camQuat = new Quaternion()
  const out = new Matrix4()
  composeScreenAnchor(camPos, camQuat, new Matrix4().makeScale(0.5, 0.5, 0.5), out)
  const { scale } = decompose(out)
  assert.deepEqual(scale.toArray().map(round), [0.5, 0.5, 0.5])
})
