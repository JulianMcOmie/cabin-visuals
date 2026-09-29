import type { Camera, PerspectiveCamera } from 'three'

// The editor has ONE camera (the Canvas default: [0,0,5], fov 55), shared by
// every scene. A camera instrument (Camera Control, Camera Orbit, a code
// instrument with `camera()`) owns it while its track is on screen - and when
// that scene is cut away, nothing used to hand it back, so the next scene
// inherited the last pose. Owners now CLAIM the camera; VisualScene releases a
// claim whose track is no longer on screen by restoring the default pose.
// Two camera tracks on screen at once: the last to claim wins (as before).

export const DEFAULT_CAMERA = { position: [0, 0, 5] as const, fov: 55 }

let owner: string | null = null

export function claimCamera(trackId: string) {
  owner = trackId
}

export function cameraOwner(): string | null {
  return owner
}

/** Restore the default pose when the owner's track has left the screen. Returns true if it reset. */
export function releaseCameraIfIdle(camera: Camera, isActive: (trackId: string) => boolean): boolean {
  if (!owner || isActive(owner)) return false
  owner = null
  resetCamera(camera)
  return true
}

export function resetCamera(camera: Camera) {
  camera.position.set(DEFAULT_CAMERA.position[0], DEFAULT_CAMERA.position[1], DEFAULT_CAMERA.position[2])
  camera.up.set(0, 1, 0)
  camera.rotation.set(0, 0, 0)
  camera.lookAt(0, 0, 0)
  const pc = camera as PerspectiveCamera
  if (pc.isPerspectiveCamera && pc.fov !== DEFAULT_CAMERA.fov) {
    pc.fov = DEFAULT_CAMERA.fov
    pc.updateProjectionMatrix()
  }
}

/** A pose a code instrument asks for: where the camera is, what it looks at. */
export interface CameraPose {
  position?: readonly [number, number, number]
  /** Look-at point (default: keep the orientation, or the origin if nothing set it). */
  target?: readonly [number, number, number]
  /** Up vector (default +Y). */
  up?: readonly [number, number, number]
  /** Roll about the view axis, radians (after aiming). */
  roll?: number
  /** Vertical field of view, degrees. */
  fov?: number
}

export function applyCameraPose(camera: Camera, pose: CameraPose) {
  if (pose.position) camera.position.set(pose.position[0], pose.position[1], pose.position[2])
  if (pose.up) camera.up.set(pose.up[0], pose.up[1], pose.up[2])
  else camera.up.set(0, 1, 0)
  if (pose.target) camera.lookAt(pose.target[0], pose.target[1], pose.target[2])
  if (pose.roll) camera.rotateZ(pose.roll)
  const pc = camera as PerspectiveCamera
  if (pose.fov !== undefined && pc.isPerspectiveCamera && pc.fov !== pose.fov) {
    pc.fov = pose.fov
    pc.updateProjectionMatrix()
  }
}
