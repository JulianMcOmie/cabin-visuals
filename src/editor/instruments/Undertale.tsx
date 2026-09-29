import { lazyInstrument } from './lazyInstrument'
import { paramDefault, type ObjectInstrumentDef } from './types'
import { UNDERTALE_CHARACTERS } from './undertaleCore'
import { UndertaleCharacterPicker } from '../userInterfaceRenderers/UndertaleCharacterPicker'

export const undertaleInstrument: ObjectInstrumentDef = {
  id: 'undertale',
  name: 'Undertale',
  kind: 'object',
  castsShadows: true,
  identityColor: '#f0474c',
  userInterfaceRenderer: 'parameters',
  params: [
    { key: 'character', label: 'Character', min: 0, max: UNDERTALE_CHARACTERS.length - 1, step: 1, integer: true,
      valueLabels: Object.fromEntries(UNDERTALE_CHARACTERS.map((label, value) => [value, label])), default: 0 },
    { key: 'size', label: 'Size', min: 0.1, max: 4, step: 0.01, default: 1 },
    { key: 'thickness', label: 'Thickness', min: 0.02, max: 0.8, step: 0.01, default: 0.16 },
    { key: 'turn', label: 'Turn', min: -180, max: 180, step: 1, default: -12 },
    { key: 'motion', label: 'Idle Motion', min: 0, max: 1, step: 0.01, default: 0 },
    { key: 'reactivity', label: 'Note Bounce', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  panelSpec: {
    accent: '#f0474c', testId: 'undertale-panel',
    rows: [
      { custom: UndertaleCharacterPicker, claims: ['character'] },
      { row: ['size*', 'thickness:DEPTH', { param: 'turn', bipolar: true, label: 'TURN' }] },
      { row: ['motion:IDLE MOTION', 'reactivity:NOTE BOUNCE'] },
    ],
  },
  midiRows: [
    { pitch: 76, label: 'Bounce · strong', emphasized: true },
    { pitch: 60, label: 'Bounce · medium' },
    { pitch: 44, label: 'Bounce · gentle' },
  ],
  localTransform: ({ params }) => ({ scale: params.size ?? paramDefault(undertaleInstrument, 'size') }),
  component: lazyInstrument(() => import('./UndertaleVisual').then(m => m.UndertaleVisual)),
}
