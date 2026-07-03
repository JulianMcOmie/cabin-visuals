import type { VisualEffect } from '../types'

const DEG = Math.PI / 180

export const rotatePlugin: VisualEffect = {
  id: 'rotate',
  name: 'Rotate',
  category: 'transform',
  params: [
    { key: 'speedX', label: 'Spin X', min: -5, max: 5, step: 0.1, default: 0 },
    { key: 'speedY', label: 'Spin Y', min: -5, max: 5, step: 0.1, default: 0 },
    { key: 'speedZ', label: 'Spin Z', min: -5, max: 5, step: 0.1, default: 0.5 },
    { key: 'offsetX', label: 'Orientation X', min: -180, max: 180, step: 5, default: 0 },
    { key: 'offsetY', label: 'Orientation Y', min: -180, max: 180, step: 5, default: 0 },
    { key: 'offsetZ', label: 'Orientation Z', min: -180, max: 180, step: 5, default: 0 },
  ],
  applyTransform: (group, s, time) => {
    group.rotation.x = time * (s.speedX ?? 0) + (s.offsetX ?? 0) * DEG
    group.rotation.y = time * (s.speedY ?? 0) + (s.offsetY ?? 0) * DEG
    group.rotation.z = time * (s.speedZ ?? 0) + (s.offsetZ ?? 0) * DEG
  },
}
