import type { VisualEffect } from '../types'

/** Glow is a multipass device. The renderer owns source visibility, HDR targets,
 * filtering and separate core/emission outputs; no material injection is used. */
export const glowPlugin: VisualEffect = {
  id: 'glow',
  name: 'Glow',
  category: 'shader',
  multipass: 'glow',
  accent: '#a5b4fc',
  params: [
    { key: 'strength', label: 'Strength', min: 0, max: 8, step: 0.01, default: 1.2, curve: 2 },
    { key: 'radius', label: 'Radius', min: 1, max: 240, step: 1, default: 36, curve: 2 },
    { key: 'spread', label: 'Spread', min: 0, max: 1, step: 0.01, default: 0.4 },
    {
      key: 'source',
      label: 'Source',
      type: 'select',
      options: [
        { value: 0, label: 'Highlights' },
        { value: 1, label: 'Whole Object' },
        { value: 2, label: 'Outline' },
      ],
      default: 1,
    },
    { key: 'threshold', label: 'Threshold', min: 0, max: 4, step: 0.01, default: 0.7, showIf: 'source=0' },
    { key: 'softness', label: 'Softness', min: 0, max: 1, step: 0.01, default: 0.3, showIf: 'source=0' },
    { key: 'tintMix', label: 'Tint blend', min: 0, max: 1, step: 0.01, default: 0 },
    { key: 'tintHue', label: 'Tint hue', min: 0, max: 360, step: 1, default: 220 },
    { key: 'tintSaturation', label: 'Tint saturation', min: 0, max: 1, step: 0.01, default: 0.8 },
    { key: 'coreBrightness', label: 'Core brightness', min: 1, max: 5, step: 0.01, default: 1 },
    { key: 'coreWhite', label: 'White-hot core', min: 0, max: 1, step: 0.01, default: 0 },
    { key: 'stretch', label: 'Stretch', min: 1, max: 12, step: 0.1, default: 1 },
    { key: 'angle', label: 'Orientation', min: 0, max: 180, step: 1, default: 0 },
  ],
}

export const GLOW_DEFAULTS = Object.fromEntries(glowPlugin.params.map((p) => [p.key, p.default])) as Record<
  string,
  number
>
export const GLOW_PRESETS: Record<string, Record<string, number>> = {
  Neon: { ...GLOW_DEFAULTS, strength: 2.2, radius: 24, spread: 0.15 },
  'Soft Halo': { ...GLOW_DEFAULTS, strength: 1.1, radius: 48, spread: 0.5 },
  Dreamy: { ...GLOW_DEFAULTS, strength: 1.8, radius: 110, spread: 0.9 },
  'Hot Filament': {
    ...GLOW_DEFAULTS,
    strength: 2.6,
    radius: 20,
    spread: 0.2,
    source: 0,
    threshold: 0.4,
    coreBrightness: 2.5,
    coreWhite: 0.8,
  },
  Anamorphic: { ...GLOW_DEFAULTS, strength: 2, radius: 28, spread: 0.45, stretch: 8 },
}

export function glowSettings(values: Record<string, number>): Record<string, number> {
  const result = { ...GLOW_DEFAULTS }
  for (const p of glowPlugin.params) {
    const v = values[p.key]
    if (!Number.isFinite(v)) continue
    result[p.key] = 'min' in p ? Math.min(p.max, Math.max(p.min, v)) : Math.round(Math.min(2, Math.max(0, v)))
  }
  return result
}
export function glowIsNeutral(s: Record<string, number>): boolean {
  const v = glowSettings(s)
  return v.strength === 0 && v.coreBrightness === 1 && v.coreWhite === 0
}
/** Fixed authored frame pixels. A 36px radius occupies 1/30 of frame height. */
export function glowAxes(radius: number, stretch: number, angle: number, width: number, height: number) {
  const r = radius / 1080,
    a = (angle * Math.PI) / 180,
    aspect = width / Math.max(1, height)
  return [
    [(Math.cos(a) * r * stretch) / aspect, Math.sin(a) * r * stretch],
    [(-Math.sin(a) * r) / aspect, Math.cos(a) * r],
  ]
}
/** Energy-normalized scales: broad veil trades tight-halo energy, never core gain. */
export function glowWeights(spread: number) {
  return [0.72 * (1 - spread) + 0.08, 0.2, 0.72 * spread]
}
