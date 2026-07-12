import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { LocalTransform } from '../../instruments/types'
import type { StateVector } from './types'

const _pos = new Vector3()
const _axis = new Vector3()
const _quat = new Quaternion()
const _euler = new Euler()
const _scale = new Vector3()

export function identitySV(): StateVector {
  return { pos: [0, 0, 0], rot: [0, 0, 0], logScale: 0, opacity: 1, aux: {} }
}

export function resetSV(dst: StateVector): void {
  dst.pos[0] = 0
  dst.pos[1] = 0
  dst.pos[2] = 0
  dst.rot[0] = 0
  dst.rot[1] = 0
  dst.rot[2] = 0
  dst.logScale = 0
  dst.opacity = 1
  for (const key in dst.aux) delete dst.aux[key]
}


function axisAngleFromQuaternion(q: Quaternion, out: [number, number, number]): void {
  if (q.w > 1) q.normalize()
  const angle = 2 * Math.acos(q.w)
  const s = Math.sqrt(1 - q.w * q.w)
  if (s < 0.00001 || angle < 0.00001) {
    out[0] = 0
    out[1] = 0
    out[2] = 0
    return
  }
  out[0] = (q.x / s) * angle
  out[1] = (q.y / s) * angle
  out[2] = (q.z / s) * angle
}

export function localTransformToSV(t: LocalTransform, out: StateVector): void {
  resetSV(out)
  const [px, py, pz] = t.position ?? [0, 0, 0]
  out.pos[0] = px
  out.pos[1] = py
  out.pos[2] = pz

  const [rx, ry, rz] = t.rotation ?? [0, 0, 0]
  _euler.set(rx, ry, rz)
  _quat.setFromEuler(_euler)
  axisAngleFromQuaternion(_quat, out.rot)

  if (typeof t.scale === 'number') {
    out.logScale = Math.log(Math.max(0.000001, t.scale))
  } else if (t.scale) {
    const uniform = (t.scale[0] + t.scale[1] + t.scale[2]) / 3
    out.logScale = Math.log(Math.max(0.000001, uniform))
  }
}

export function composeMatrix(sv: StateVector, out: Matrix4): void {
  _pos.set(sv.pos[0], sv.pos[1], sv.pos[2])
  const angle = Math.hypot(sv.rot[0], sv.rot[1], sv.rot[2])
  if (angle < 0.000001) {
    _quat.identity()
  } else {
    _axis.set(sv.rot[0] / angle, sv.rot[1] / angle, sv.rot[2] / angle)
    _quat.setFromAxisAngle(_axis, angle)
  }
  const scale = Math.exp(sv.logScale)
  _scale.set(scale, scale, scale)
  out.compose(_pos, _quat, _scale)
}
