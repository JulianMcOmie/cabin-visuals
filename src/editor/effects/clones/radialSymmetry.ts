import { Matrix4, Vector3, Quaternion } from 'three'
import type { VisualEffect } from '../types'

const Z = new Vector3(0, 0, 1)
const IDENT_Q = new Quaternion()

/** Copies evenly spaced around a circle (2D radial), optionally spinning and facing out. */
export const radialSymmetryPlugin: VisualEffect = {
  id: 'radialSymmetry',
  name: 'Radial Symmetry',
  category: 'clone',
  params: [
    { key: 'folds', label: 'Folds', min: 2, max: 16, step: 1, default: 6 },
    { key: 'radius', label: 'Radius', min: 0, max: 10, step: 0.1, default: 2 },
    { key: 'rotation', label: 'Rotation', min: 0, max: 6.28, step: 0.05, default: 0 },
    { key: 'spin', label: 'Spin', min: -1, max: 1, step: 0.02, default: 0 },
    { key: 'includeCenter', label: 'Include Center · 0/1', min: 0, max: 1, step: 1, default: 0 },
    { key: 'faceOut', label: 'Face Outward · 0/1', min: 0, max: 1, step: 1, default: 0 },
  ],
  getClones: (s) => {
    const folds = Math.max(2, Math.round(s.folds ?? 6))
    const inc = (s.includeCenter ?? 0) >= 0.5
    return {
      count: inc ? folds + 1 : folds,
      getTransform: (i, s, time) => {
        const folds = Math.max(2, Math.round(s.folds ?? 6))
        const inc = (s.includeCenter ?? 0) >= 0.5
        if (inc && i === 0) return new Matrix4() // the center copy
        const arm = inc ? i - 1 : i
        const angle = arm * ((Math.PI * 2) / folds) + (s.rotation ?? 0) + time * (s.spin ?? 0) * Math.PI * 2
        const radius = s.radius ?? 2
        const pos = new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0)
        const q = (s.faceOut ?? 0) >= 0.5 ? new Quaternion().setFromAxisAngle(Z, angle) : IDENT_Q
        return new Matrix4().compose(pos, q, new Vector3(1, 1, 1))
      },
    }
  },
}
