import type { ObjectInstrumentDef, ParamDef } from './types'
import { lazyInstrument } from './lazyInstrument'

const PARAMS: ParamDef[] = [
  { key: 'color', label: 'Color', type: 'color', default: '#ffffff' },
  { key: 'lineWidth', label: 'Thickness', min: 1, max: 24, step: 1, default: 4 },
  { key: 'transparentBackground', label: 'Transparent Background', type: 'boolean', default: 1 },
  // The placement MODE. A select rather than a boolean so the size sliders can
  // gate on `=0` - showIf can only express "on", never "off".
  {
    key: 'fitToScreen',
    label: 'Placement',
    type: 'select',
    options: [
      { value: 0, label: 'In scene' },
      { value: 1, label: 'Fit to screen' },
    ],
    default: 0,
  },
  { key: 'panelWidth', label: 'Width', min: 0.2, max: 24, step: 0.1, default: 6, showIf: 'fitToScreen=0' },
  { key: 'panelHeight', label: 'Height', min: 0.2, max: 16, step: 0.1, default: 3, showIf: 'fitToScreen=0' },
]

export const oscilloscopeInstrument: ObjectInstrumentDef = {
  id: 'oscilloscope',
  name: 'Oscilloscope',
  kind: 'object',
  userInterfaceRenderer: 'oscilloscope',
  params: PARAMS,
  component: lazyInstrument(() => import('./OscilloscopeVisual').then((m) => m.OscilloscopeVisual)),
  // Full-frame is this instrument's "Fit to screen" MODE, not a fixed fact: by
  // default the scope is a real object in the scene with a position, a size and
  // a depth sort. The on-top pass follows the same param (see isOnTopTrack), so
  // fitting to the screen restores the old pinned-overlay behaviour whole.
  fullFrameParam: 'fitToScreen',
}
