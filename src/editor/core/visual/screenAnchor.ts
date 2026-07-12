import { Matrix4, Quaternion, Vector3 } from 'three'

// The camera-facing screen anchor for full-frame instruments. A full-frame
// instrument is a SCREEN: pinned dead-ahead of the camera and parallel to it,
// at the same distance r3f's `viewport` sizing assumes (camera → origin), so a
// viewport-sized plane fills the frame exactly. Full-frame used to BYPASS copy
// transforms entirely; the anchor turns that bypass into an outer coordinate
// frame: the occurrence's VisualCopy transform applies INSIDE it, so an
// identity copy reproduces the legacy pinning pixel-for-pixel while translated
// or scaled copies move in screen space.

const _forward = new Vector3()
const _anchorPos = new Vector3()
const _unit = new Vector3(1, 1, 1)
const _anchor = new Matrix4()

/** Compose `screen anchor * copyTransform` into `out` (anchor alone when the
 *  copy is not resolved yet). Callers pass the camera's position/orientation. */
export function composeScreenAnchor(
  cameraPosition: Vector3,
  cameraQuaternion: Quaternion,
  copyTransform: Matrix4 | undefined,
  out: Matrix4,
): Matrix4 {
  _forward.set(0, 0, -1).applyQuaternion(cameraQuaternion)
  _anchorPos.copy(cameraPosition).addScaledVector(_forward, cameraPosition.length())
  _anchor.compose(_anchorPos, cameraQuaternion, _unit)
  if (copyTransform) out.multiplyMatrices(_anchor, copyTransform)
  else out.copy(_anchor)
  return out
}
