import { particleInstrument, PARTICLE_COLOR } from './Particle'
import { lazyInstrument } from './lazyInstrument'
import { STREAM_MAX_COUNT, STREAM_MAX_DENSITY, STREAM_PATTERNS, STREAM_MIDI_ROWS } from './particleStreamCore'
import type { ObjectInstrumentDef } from './types'

export const particleStreamInstrument: ObjectInstrumentDef = {
  id: 'particleStream',
  name: 'Particle Stream',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  params: [
    { key: 'count', label: 'Streams', min: 1, max: STREAM_MAX_COUNT, step: 1, integer: true, default: 6 },
    { key: 'twist', label: 'Twist', min: -2, max: 2, step: 0.01, default: 0.35 },
    { key: 'speed', label: 'Flight speed', min: 0.1, max: 4, step: 0.05, default: 1 },
    { key: 'spread', label: 'Spread', min: 0.1, max: 12, step: 0.1, default: 4 },
    { key: 'pattern', label: 'Intersection pattern', type: 'select', options: STREAM_PATTERNS, default: 1 },
    { key: 'density', label: 'Particle density', min: 2, max: STREAM_MAX_DENSITY, step: 1, integer: true, default: 16 },
    { key: 'meetX', label: 'Meeting point X', min: -8, max: 8, step: 0.1, default: 0 },
    { key: 'meetY', label: 'Meeting point Y', min: -8, max: 8, step: 0.1, default: 0 },
    ...particleInstrument.params,
  ],
  panelSpec: {
    accent: { param: 'color', fallback: PARTICLE_COLOR },
    testId: 'particle-stream-panel',
    rows: [
      { row: ['count*:STREAMS', { param: 'twist', label: 'TWIST', large: true, bipolar: true }] },
      { segmented: 'pattern' },
      { row: ['speed:SPEED', 'spread:SPREAD', 'density:DENSITY'] },
      { row: ['size:SIZE', 'glow:GLOW', { pill: 'color', haloParam: 'glow' }] },
    ],
  },
  midiRows: STREAM_MIDI_ROWS,
  // An ambient flow along local -Z, away from the default camera. Normal
  // track transforms can aim the field; MIDI plans routes ahead so intersections land on the note beats.
  component: lazyInstrument(() => import('./ParticleStreamVisual').then(m => m.ParticleStreamVisual)),
}
