import type { PerspectiveCamera } from 'three'

const REFERENCE_ASPECT = 16 / 9
const DEG = Math.PI / 180
const framing = new WeakMap<PerspectiveCamera, { fov: number }>()

/** FOV controls are authored against 16:9. Narrower frames reveal more above
 * and below that composition, keeping its entire width and perspective. */
export function framedCameraFov(fov: number, aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0 || aspect >= REFERENCE_ASPECT) return fov
  return 2 * Math.atan(Math.tan(fov * DEG / 2) * REFERENCE_ASPECT / aspect) / DEG
}

function updateFraming(camera: PerspectiveCamera, fov: number) {
  camera.fov = framedCameraFov(fov, camera.aspect)
  camera.updateProjectionMatrix()
}

/** Keep the authored FOV separately so repeated resizes never compound it. */
export function frameSceneCamera(camera: PerspectiveCamera, aspect: number): void {
  if (!Number.isFinite(aspect) || aspect <= 0) return
  let state = framing.get(camera)
  if (!state) {
    state = { fov: camera.fov }
    framing.set(camera, state)
  }
  camera.aspect = aspect
  updateFraming(camera, state.fov)
}

/** Camera instruments also run in isolated library previews. Only cameras
 * registered by the scene renderer receive the composition adjustment. */
export function setSceneCameraFov(camera: PerspectiveCamera, fov: number): void {
  const state = framing.get(camera)
  if (state) {
    state.fov = fov
    const target = framedCameraFov(fov, camera.aspect)
    if (camera.fov === target) return
    updateFraming(camera, fov)
  } else if (camera.fov !== fov) {
    camera.fov = fov
    camera.updateProjectionMatrix()
  }
}
