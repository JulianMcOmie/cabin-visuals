import { Matrix4, Vector3, Quaternion } from 'three'
import type { VisualPlugin } from '../types'

const IDENT_Q = new Quaternion()

/** Trailing copies along a (rotating) offset, shrinking and fading with each step. */
export const echoPlugin: VisualPlugin = {
  id: 'echo',
  name: 'Echo',
  category: 'clone',
  params: [
    { key: 'copies', label: 'Copies', min: 1, max: 12, step: 1, default: 4 },
    { key: 'separationX', label: 'Separation X', min: -2, max: 2, step: 0.05, default: 0.35 },
    { key: 'separationY', label: 'Separation Y', min: -2, max: 2, step: 0.05, default: 0 },
    { key: 'separationZ', label: 'Separation Z', min: -2, max: 2, step: 0.05, default: 0 },
    { key: 'scaleFalloff', label: 'Scale Falloff', min: 0, max: 0.5, step: 0.01, default: 0.08 },
    { key: 'opacityFalloff', label: 'Opacity Falloff', min: 0, max: 0.5, step: 0.01, default: 0.12 },
    { key: 'rotationSpeed', label: 'Rotation Speed', min: -3, max: 3, step: 0.1, default: 0 },
    { key: 'rotationAxis', label: 'Rotation Axis · 0X 1Y 2Z', min: 0, max: 2, step: 1, default: 1 },
    { key: 'phaseDelay', label: 'Phase Delay', min: 0, max: 2, step: 0.05, default: 0.2 },
  ],
  getClones: (s) => ({
    count: Math.max(1, Math.round(s.copies ?? 4)) + 1,
    getTransform: (i, s, time) => {
      const m = new Matrix4()
      if (i === 0) return m // the original
      const axis = Math.round(s.rotationAxis ?? 1)
      const axisVec = new Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0)
      const angle = time * (s.rotationSpeed ?? 0) + i * (s.phaseDelay ?? 0)
      const q = new Quaternion().setFromAxisAngle(axisVec, angle)
      const offset = new Vector3(s.separationX ?? 0, s.separationY ?? 0, s.separationZ ?? 0)
        .applyQuaternion(q)
        .multiplyScalar(i)
      const scale = Math.max(0.1, 1 - (s.scaleFalloff ?? 0) * i)
      return m.compose(offset, IDENT_Q, new Vector3(scale, scale, scale))
    },
    getOpacity: (i, s) => Math.max(0, 1 - (s.opacityFalloff ?? 0) * i),
  }),
}
