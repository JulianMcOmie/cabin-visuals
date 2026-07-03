import type { VisualEffect } from '../types'

export const scalePlugin: VisualEffect = {
  id: 'scale',
  name: 'Scale',
  category: 'transform',
  params: [
    { key: 'scale', label: 'Base Scale', min: 0.1, max: 3, step: 0.1, default: 1 },
    { key: 'pulseAmount', label: 'Pulse Amount', min: 0, max: 1, step: 0.05, default: 0 },
    { key: 'pulseSpeed', label: 'Pulse Speed', min: 0.1, max: 5, step: 0.1, default: 1 },
  ],
  applyTransform: (group, s, time) => {
    const pulse = Math.sin(time * (s.pulseSpeed ?? 1) * Math.PI * 2) * (s.pulseAmount ?? 0)
    group.scale.setScalar((s.scale ?? 1) + pulse)
  },
}
