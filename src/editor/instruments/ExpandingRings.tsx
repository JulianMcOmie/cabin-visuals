import type { ObjectInstrumentDef } from './types'
import { lazyInstrument } from './lazyInstrument'

// A passive instrument: no MIDI. Concentric shapes are born at the center and
// expand forever, colored along a two-stop gradient. Math: expandingRingsCore.ts.

export const EXPANDING_RINGS_A = '#ff5470'
export const EXPANDING_RINGS_B = '#7c5cff'

export const expandingRingsInstrument: ObjectInstrumentDef = {
  id: 'expandingRings',
  name: 'Expanding Rings',
  kind: 'object',
  identityColor: { param: 'colorA' },
  userInterfaceRenderer: 'parameters',
  params: [
    { key: 'shape', type: 'select', label: 'Shape', default: 0, options: [
      { value: 0, label: 'Circle' }, { value: 1, label: 'Triangle' }, { value: 2, label: 'Square' },
      { value: 3, label: 'Pentagon' }, { value: 4, label: 'Hexagon' }, { value: 5, label: 'Octagon' },
    ] },
    { key: 'colorMode', type: 'select', label: 'Gradient', default: 0, options: [
      { value: 0, label: 'Radius' }, { value: 1, label: 'Cycle' },
    ] },
    { key: 'rings', label: 'Rings', min: 1, max: 32, step: 1, integer: true, default: 8 },
    { key: 'period', label: 'Period (beats)', min: 0.25, max: 32, step: 0.01, curve: 2, default: 4 },
    { key: 'curve', label: 'Curve', min: -1, max: 1, step: 0.01, default: 0 },
    { key: 'reach', label: 'Reach', min: 0.5, max: 12, step: 0.01, default: 5.5 },
    { key: 'thickness', label: 'Thickness', min: 0.01, max: 1, step: 0.01, curve: 2, default: 0.08 },
    { key: 'rotation', label: 'Rotation', min: -180, max: 180, step: 1, default: 0 },
    { key: 'fade', label: 'Fade out', min: 0, max: 1, step: 0.01, default: 0.4 },
    { key: 'colorA', label: 'Center color', type: 'color', default: EXPANDING_RINGS_A },
    { key: 'colorB', label: 'Edge color', type: 'color', default: EXPANDING_RINGS_B },
  ],
  panelSpec: {
    accent: { param: 'colorA', fallback: EXPANDING_RINGS_A },
    testId: 'expanding-rings-panel',
    rows: [
      { segmented: 'shape' },
      { segmented: 'colorMode' },
      { row: ['period*:PERIOD', { param: 'curve', label: 'CURVE', bipolar: true }, 'rings:RINGS', 'reach:REACH'] },
      { row: ['thickness:WIDTH', 'fade:FADE', { param: 'rotation', bipolar: true }, { pill: 'colorA', label: 'CENTER' }, { pill: 'colorB', label: 'EDGE' }] },
    ],
  },
  component: lazyInstrument(() => import('./ExpandingRingsVisual').then(m => m.ExpandingRingsVisual)),
}
