import assert from 'node:assert/strict'
import test from 'node:test'
import { PerspectiveCamera, Vector3 } from 'three'
import { frameSceneCamera, setSceneCameraFov } from './cameraFraming'

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`)
}

test('portrait preserves landscape horizontal framing at every depth and extends vertically without stretching', () => {
  const camera = new PerspectiveCamera(55, 16 / 9, 0.1, 1000)
  camera.position.set(1, 2, 8)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const points = [new Vector3(-3, 2, 0), new Vector3(3, -2, -5), new Vector3(0, 6, 1)]
  const landscape = points.map(p => p.clone().project(camera))
  const position = camera.position.clone(), rotation = camera.quaternion.clone()
  for (const aspect of [9 / 16, 4 / 5, 1, 4 / 3]) {
    frameSceneCamera(camera, aspect)
    for (const [i, point] of points.entries()) {
      const projected = point.clone().project(camera)
      close(projected.x, landscape[i].x)
      // Convert NDC y into units of frame width: uniform scaling, no stretch.
      close(projected.y / aspect, landscape[i].y / (16 / 9))
      close(projected.z, landscape[i].z)
    }
    assert.deepEqual(camera.position, position)
    assert.ok(camera.quaternion.equals(rotation))
  }
})

test('repeated resize, export and return retain the authored FOV, including camera animation', () => {
  const camera = new PerspectiveCamera(55, 16 / 9)
  for (const authored of [10, 55, 90, 120, 179]) {
    frameSceneCamera(camera, 16 / 9)
    setSceneCameraFov(camera, authored)
    const horizontal = camera.projectionMatrix.elements[0]
    for (const aspect of [9 / 16, 1080 / 1920, 1, 9 / 16, 16 / 9, 2]) {
      frameSceneCamera(camera, aspect)
      setSceneCameraFov(camera, authored)
      if (aspect <= 16 / 9) close(camera.projectionMatrix.elements[0], horizontal)
      else close(camera.fov, authored)
      assert.ok(camera.fov > 0 && camera.fov < 180)
    }
    frameSceneCamera(camera, 16 / 9)
    close(camera.fov, authored)
  }
})

test('isolated camera previews keep their FOV and zero-sized frames cannot corrupt projection', () => {
  const camera = new PerspectiveCamera(55, 1)
  setSceneCameraFov(camera, 70)
  close(camera.fov, 70)
  const matrix = camera.projectionMatrix.clone()
  for (const aspect of [0, -1, NaN, Infinity]) frameSceneCamera(camera, aspect)
  assert.deepEqual(camera.projectionMatrix, matrix)
})
