import { Matrix4, Vector3, Quaternion, Euler } from 'three'
import type { LocalTransform } from '../../instruments/types'

// Scratch objects reused every call — transform composition runs per object per
// frame, so it must not allocate.
const _pos = new Vector3()
const _quat = new Quaternion()
const _euler = new Euler()
const _scale = new Vector3()

/** Build a TRS matrix from a LocalTransform (missing fields → identity defaults). */
export function composeLocal(t: LocalTransform, out: Matrix4): Matrix4 {
  const [px, py, pz] = t.position ?? [0, 0, 0]
  _pos.set(px, py, pz)
  const [rx, ry, rz] = t.rotation ?? [0, 0, 0]
  _euler.set(rx, ry, rz)
  _quat.setFromEuler(_euler)
  if (typeof t.scale === 'number') _scale.set(t.scale, t.scale, t.scale)
  else { const [sx, sy, sz] = t.scale ?? [1, 1, 1]; _scale.set(sx, sy, sz) }
  return out.compose(_pos, _quat, _scale)
}
