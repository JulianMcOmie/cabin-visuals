import { overlapShapeInstrument } from './OverlapShape'
import { BLOOM_MAX_COPIES, BLOOM_PITCH_MIN } from './radialBloomCore'
import { lazyInstrument } from './lazyInstrument'
import type { ObjectInstrumentDef, ParamDef } from './types'

const overrides: Record<string, number> = { size: 0.9, pulse: 0.12, overlapMode: 1, overlapOrders: 4 }
const shapeLabels: Record<string, string> = { Triangle: 'Tri', Pentagon: 'Pent', Hexagon: 'Hex' }
const params: ParamDef[] = [
  ...overlapShapeInstrument.params.map(p => {
    if (p.key === 'shape' && p.type === 'select') return { ...p, options: p.options.map(o => ({ ...o, label: shapeLabels[o.label] ?? o.label })) }
    return p.key in overrides ? { ...p, default: overrides[p.key] } as ParamDef : p
  }),
  { key: 'radius', label: 'Radius', min: 0, max: 6, step: 0.01, default: 0.65 },
  { key: 'rotation', label: 'Rotation', min: -180, max: 180, step: 1, default: 0 },
  { key: 'attackBeats', label: 'Attack (beats)', min: 0, max: 8, step: 0.01, default: 0.04 },
  { key: 'decayBeats', label: 'Decay (beats)', min: 0, max: 8, step: 0.01, default: 0.18 },
  { key: 'sustainLevel', label: 'Sustain', min: 0, max: 1, step: 0.01, default: 0.85 },
  { key: 'releaseBeats', label: 'Release (beats)', min: 0, max: 8, step: 0.01, default: 0.65 },
]

export const radialBloomInstrument: ObjectInstrumentDef = {
  id: 'radialBloom',
  name: 'Radial Bloom',
  kind: 'object',
  identityColor: { param: 'baseColor' },
  userInterfaceRenderer: 'parameters',
  params,
  midiRows: Array.from({ length: BLOOM_MAX_COPIES }, (_, i) => {
    const copies = BLOOM_MAX_COPIES - i
    return { pitch: BLOOM_PITCH_MIN + copies - 1, label: `${copies} ${copies === 1 ? 'copy' : 'copies'}`, emphasized: copies === 6 }
  }),
  panelSpec: {
    accent: { param: 'baseColor', fallback: '#ff5470' },
    testId: 'radial-bloom-panel',
    rows: [
      { segmented: 'shape' },
      { row: ['size*', 'radius*', { param: 'rotation', bipolar: true }, { pill: 'baseColor' }] },
      { row: ['attackBeats:ATTACK', 'decayBeats:DECAY', 'sustainLevel:SUSTAIN', 'releaseBeats:RELEASE'], gutter: 'Envelope' },
      { segmented: 'overlapMode' },
      { row: ['overlapOrders?:DEPTH', 'pulse:HIT SIZE'] },
    ],
  },
  component: lazyInstrument(() => import('./RadialBloomVisual').then(m => m.RadialBloomVisual)),
}
