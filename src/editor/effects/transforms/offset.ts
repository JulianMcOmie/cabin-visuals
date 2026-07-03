import type { VisualEffect } from '../types'

export const offsetPlugin: VisualEffect = {
  id: 'offset',
  name: 'Offset',
  category: 'transform',
  params: [
    { key: 'x', label: 'X', min: -10, max: 10, step: 0.1, default: 0 },
    { key: 'y', label: 'Y', min: -10, max: 10, step: 0.1, default: 0 },
    { key: 'z', label: 'Z', min: -10, max: 10, step: 0.1, default: 0 },
  ],
  applyTransform: (group, s) => {
    group.position.x += s.x ?? 0
    group.position.y += s.y ?? 0
    group.position.z += s.z ?? 0
  },
}
