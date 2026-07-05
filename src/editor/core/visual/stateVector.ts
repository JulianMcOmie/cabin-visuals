import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { LocalTransform } from '../../instruments/types'
import type { StateVector } from './types'

const _pos = new Vector3()
const _axis = new Vector3()
const _quat = new Quaternion()
const _euler = new Euler()
const _scale = new Vector3()

const _auxKeys: string[] = []
const _auxSeen: Record<string, true> = {}
const _auxA: Record<string, number> = {}
const _auxB: Record<string, number> = {}

export function identitySV(): StateVector {
  return { pos: [0, 0, 0], rot: [0, 0, 0], logScale: 0, opacity: 1, aux: {} }
}

export function cloneSVInto(dst: StateVector, src: StateVector): void {
  dst.pos[0] = src.pos[0]
  dst.pos[1] = src.pos[1]
  dst.pos[2] = src.pos[2]
  dst.rot[0] = src.rot[0]
  dst.rot[1] = src.rot[1]
  dst.rot[2] = src.rot[2]
  dst.logScale = src.logScale
  dst.opacity = src.opacity
  for (const key in dst.aux) delete dst.aux[key]
  for (const key in src.aux) dst.aux[key] = src.aux[key]
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

/** Componentwise state interpolation. Axis-angle lerp is an intentional Phase 1 approximation. */
export function lerpSV(dst: StateVector, a: StateVector, b: StateVector, t: number): void {
  const ax = a.pos[0], ay = a.pos[1], az = a.pos[2]
  const arx = a.rot[0], ary = a.rot[1], arz = a.rot[2]
  const alog = a.logScale
  const aopacity = a.opacity
  const bx = b.pos[0], by = b.pos[1], bz = b.pos[2]
  const brx = b.rot[0], bry = b.rot[1], brz = b.rot[2]
  const blog = b.logScale
  const bopacity = b.opacity

  _auxKeys.length = 0
  for (const key in _auxSeen) delete _auxSeen[key]
  for (const key in _auxA) delete _auxA[key]
  for (const key in _auxB) delete _auxB[key]
  for (const key in a.aux) {
    _auxSeen[key] = true
    _auxKeys.push(key)
    _auxA[key] = a.aux[key]
  }
  for (const key in b.aux) {
    if (!_auxSeen[key]) {
      _auxSeen[key] = true
      _auxKeys.push(key)
    }
    _auxB[key] = b.aux[key]
  }

  dst.pos[0] = ax + (bx - ax) * t
  dst.pos[1] = ay + (by - ay) * t
  dst.pos[2] = az + (bz - az) * t
  dst.rot[0] = arx + (brx - arx) * t
  dst.rot[1] = ary + (bry - ary) * t
  dst.rot[2] = arz + (brz - arz) * t
  dst.logScale = alog + (blog - alog) * t
  dst.opacity = aopacity + (bopacity - aopacity) * t
  for (const key in dst.aux) delete dst.aux[key]
  for (const key of _auxKeys) {
    const av = _auxA[key] ?? 0
    const bv = _auxB[key] ?? 0
    dst.aux[key] = av + (bv - av) * t
  }
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
