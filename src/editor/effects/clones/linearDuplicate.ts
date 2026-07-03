import { Matrix4, Vector3, Quaternion } from 'three'
import type { VisualEffect } from '../types'

const IDENT_Q = new Quaternion()

/** Copies spread evenly along one axis, shrinking/fading toward the ends. */
export const linearDuplicatePlugin: VisualEffect = {
  id: 'linearDuplicate',
  name: 'Linear Duplicate',
  category: 'clone',
  params: [
    { key: 'copies', label: 'Copies', min: 2, max: 16, step: 1, default: 5 },
    { key: 'axis', label: 'Axis · 0X 1Y 2Z', min: 0, max: 2, step: 1, default: 0 },
    { key: 'spacing', label: 'Spacing', min: 0.1, max: 10, step: 0.05, default: 1 },
    { key: 'excludeCenter', label: 'Exclude Center · 0/1', min: 0, max: 1, step: 1, default: 0 },
    { key: 'scaleFalloff', label: 'Scale Falloff', min: 0, max: 0.5, step: 0.01, default: 0 },
    { key: 'opacityFalloff', label: 'Opacity Falloff', min: 0, max: 0.5, step: 0.01, default: 0 },
  ],
  getClones: (s) => {
    const total = Math.max(2, Math.round(s.copies ?? 5))
    return {
      count: total,
      getTransform: (i, s) => {
        const total = Math.max(2, Math.round(s.copies ?? 5))
        const posIndex = i - (total - 1) / 2
        if ((s.excludeCenter ?? 0) >= 0.5 && Math.abs(posIndex) < 0.001) {
          return new Matrix4().makeScale(0, 0, 0) // hidden center
        }
        const offset = posIndex * (s.spacing ?? 1)
        const axis = Math.round(s.axis ?? 0)
        const pos = axis === 0 ? new Vector3(offset, 0, 0)
          : axis === 1 ? new Vector3(0, offset, 0)
          : new Vector3(0, 0, offset)
        const scale = Math.max(0.05, 1 - (s.scaleFalloff ?? 0) * Math.abs(posIndex))
        return new Matrix4().compose(pos, IDENT_Q, new Vector3(scale, scale, scale))
      },
      getOpacity: (i, s) => {
        const total = Math.max(2, Math.round(s.copies ?? 5))
        const posIndex = i - (total - 1) / 2
        return Math.max(0, 1 - (s.opacityFalloff ?? 0) * Math.abs(posIndex))
      },
    }
  },
}
