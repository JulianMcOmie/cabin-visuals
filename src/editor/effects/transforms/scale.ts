import type { VisualEffect } from '../types'

export function evaluateScaleEffect(settings: Record<string, number>, time: number): number {
  const pulse = Math.sin(time * (settings.pulseSpeed ?? 1) * Math.PI * 2) * (settings.pulseAmount ?? 0)
  return (settings.scale ?? 1) + pulse
}

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
    group.scale.setScalar(evaluateScaleEffect(s, time))
  },
}
