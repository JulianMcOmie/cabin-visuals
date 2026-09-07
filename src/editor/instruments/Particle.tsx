import type { ObjectInstrumentDef } from './types'
import { lazyInstrument } from './lazyInstrument'

export const PARTICLE_COLOR = '#7dd3fc'
export const PARTICLE_SIZE = 0.12
export const PARTICLE_GLOW = 0.5

export const particleInstrument: ObjectInstrumentDef = {
  id: 'particle',
  name: 'Particle',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  panelSpec: {
    accent: { param: 'color', fallback: PARTICLE_COLOR },
    testId: 'particle-user-interface',
    rows: [{ row: ['size*:SIZE', 'glow:GLOW', { pill: 'color', haloParam: 'glow' }] }],
  },
  params: [
    { key: 'size', label: 'Size', min: 0.005, max: 2, step: 0.005, curve: 2, default: PARTICLE_SIZE },
    { key: 'color', label: 'Color', type: 'color', default: PARTICLE_COLOR },
    { key: 'glow', label: 'Glow', min: 0, max: 3, step: 0.01, default: PARTICLE_GLOW },
  ],
  localTransform: ({ params }) => ({ scale: params.size ?? PARTICLE_SIZE }),
  component: lazyInstrument(() => import('./ParticleVisual').then(m => m.ParticleVisual)),
  instancedComponent: lazyInstrument(() => import('./ParticleVisual').then(m => m.ParticleInstanced)),
}
