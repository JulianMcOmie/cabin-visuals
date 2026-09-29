import test from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera } from 'three'
import { applyCameraPose, cameraOwner, claimCamera, releaseCameraIfIdle } from './cameraOwner'

test('a camera claim is released - default pose restored - when its track leaves the screen', () => {
  const cam = new PerspectiveCamera(55, 16 / 9, 0.1, 100)
  cam.position.set(0, 0, 5)
  applyCameraPose(cam, { position: [2, 1, 3], target: [0, 0, 0], fov: 70, roll: 0.3 })
  claimCamera('rig')
  assert.equal(cam.fov, 70)
  assert.equal(releaseCameraIfIdle(cam, (id) => id === 'rig'), false)
  assert.equal(cameraOwner(), 'rig')
  assert.equal(releaseCameraIfIdle(cam, () => false), true)
  assert.equal(cameraOwner(), null)
  assert.deepEqual(cam.position.toArray(), [0, 0, 5])
  assert.equal(cam.fov, 55)
})
