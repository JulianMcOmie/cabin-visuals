import { lazyInstrument } from './lazyInstrument'
import { paramDefault, type ObjectInstrumentDef } from './types'

export const birdInstrument: ObjectInstrumentDef = {
  id: 'bird',
  name: 'Bird',
  kind: 'object',
  castsShadows: true,
  identityColor: { param: 'baseColor' },
  userInterfaceRenderer: 'parameters',
  params: [
    { key: 'baseColor', label: 'Feathers', type: 'color', default: '#52b8d6' },
    { key: 'bellyColor', label: 'Belly', type: 'color', default: '#fff1d6' },
    { key: 'beakColor', label: 'Beak & Feet', type: 'color', default: '#f6b94a' },
    { key: 'size', label: 'Size', min: 0.1, max: 4, step: 0.01, default: 1 },
    { key: 'flapSpeed', label: 'Flaps / Beat', min: 0, max: 4, step: 0.05, default: 0.5 },
    { key: 'wingSpread', label: 'Wing Spread', min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: 'reactivity', label: 'Note Response', min: 0, max: 1, step: 0.01, default: 0.65 },
  ],
  panelSpec: {
    accent: { param: 'baseColor', fallback: '#52b8d6' },
    testId: 'bird-panel',
    rows: [
      { row: ['size*', { pill: 'baseColor', label: 'FEATHERS' }, { pill: 'bellyColor', label: 'BELLY' }, { pill: 'beakColor', label: 'BEAK / FEET' }] },
      { row: ['flapSpeed:FLAP RATE', 'wingSpread:WINGS', 'reactivity:NOTE RESPONSE'] },
    ],
  },
  midiRows: [
    { pitch: 76, label: 'Flap · strong', emphasized: true },
    { pitch: 60, label: 'Flap · medium' },
    { pitch: 44, label: 'Flap · gentle' },
  ],
  localTransform: ({ params }) => ({ scale: params.size ?? paramDefault(birdInstrument, 'size') }),
  component: lazyInstrument(() => import('./BirdVisual').then(m => m.BirdVisual)),
}
