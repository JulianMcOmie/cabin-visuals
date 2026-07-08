import { Matrix4, Vector3, Quaternion } from 'three'
import type { VisualEffect } from '../types'

const IDENT_Q = new Quaternion()
const UP = new Vector3(0, 1, 0)
const GOLDEN = Math.PI * (1 + Math.sqrt(5))
const _look = new Matrix4()

// Deterministic pseudo-random in [0,1) from an integer seed (for random3d mode).
function rand(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** Copies arranged in 3D - a sphere (Fibonacci), a ring, a helix, or a random cloud. */
export const rotationalSymmetryPlugin: VisualEffect = {
  id: 'rotationalSymmetry',
  name: 'Rotational Symmetry',
  category: 'clone',
  params: [
    { key: 'copies', label: 'Copies', min: 2, max: 24, step: 1, default: 8 },
    { key: 'mode', label: 'Mode · 0Sph 1Ring 2Helix 3Rnd', min: 0, max: 3, step: 1, default: 0 },
    { key: 'radius', label: 'Radius', min: 0.5, max: 10, step: 0.1, default: 2.5 },
    { key: 'spin', label: 'Spin', min: -1, max: 1, step: 0.02, default: 0 },
    { key: 'includeCenter', label: 'Include Center · 0/1', min: 0, max: 1, step: 1, default: 0 },
    { key: 'faceCenter', label: 'Face Center · 0/1', min: 0, max: 1, step: 1, default: 0 },
  ],
  getClones: (s) => {
    const copies = Math.max(2, Math.round(s.copies ?? 8))
    const inc = (s.includeCenter ?? 0) >= 0.5
    return {
      count: inc ? copies + 1 : copies,
      getTransform: (i, s, time) => {
        const copies = Math.max(2, Math.round(s.copies ?? 8))
        const inc = (s.includeCenter ?? 0) >= 0.5
        if (inc && i === 0) return new Matrix4()
        const idx = inc ? i - 1 : i
        const mode = Math.round(s.mode ?? 0)
        const radius = s.radius ?? 2.5
        const spinAngle = time * (s.spin ?? 0) * Math.PI * 2
        const pos = new Vector3()

        if (mode === 1) {
          // ring
          const a = (idx / copies) * Math.PI * 2 + spinAngle
          pos.set(Math.cos(a) * radius, 0, Math.sin(a) * radius)
        } else if (mode === 2) {
          // helix (two turns)
          const t = idx / copies
          const a = t * Math.PI * 4 + spinAngle
          pos.set(Math.cos(a) * radius, (t - 0.5) * radius * 2, Math.sin(a) * radius)
        } else if (mode === 3) {
          // random cloud on a sphere shell
          const u = rand(idx + 1)
          const v = rand(idx + 101)
          const phi = Math.acos(2 * u - 1)
          const theta = 2 * Math.PI * v + spinAngle
          pos.set(
            Math.sin(phi) * Math.cos(theta) * radius,
            Math.cos(phi) * radius,
            Math.sin(phi) * Math.sin(theta) * radius,
          )
        } else {
          // sphere - Fibonacci distribution
          const phi = Math.acos(1 - (2 * (idx + 0.5)) / copies)
          const theta = GOLDEN * idx + spinAngle
          pos.set(
            Math.sin(phi) * Math.cos(theta) * radius,
            Math.cos(phi) * radius,
            Math.sin(phi) * Math.sin(theta) * radius,
          )
        }

        let q = IDENT_Q
        if ((s.faceCenter ?? 0) >= 0.5) {
          _look.lookAt(pos, new Vector3(0, 0, 0), UP)
          q = new Quaternion().setFromRotationMatrix(_look)
        }
        return new Matrix4().compose(pos, q, new Vector3(1, 1, 1))
      },
    }
  },
}
