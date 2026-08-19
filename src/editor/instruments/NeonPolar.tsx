import type { ObjectInstrumentDef, ParamDef } from './types'
import { lazyInstrument } from './lazyInstrument'

// Ported from Excellent DAW's NeonPolar. A 3D neon polar harmonograph: 6 oscillator
// layers of drifting polar curves drawn as fat neon lines. Notes in the jitter range
// (48-59) perturb the curves and shift their base frequency (velocity-scaled). The
// polar-curve math (layerRadius / updateLayerCurve) is Tyler's verbatim. Tyler's
// palette-toggle notes (60-63) are replaced by a `color` param + `hue` port.
//
// The visual itself lives in ./NeonPolarVisual (lazy: fetched when a project
// mounts a neon polar); this file is the def - params, rows, and nothing heavy.

// --- Configuration ---
export const DEFAULT_CYCLES = 8
export const DEFAULT_MIN_RADIUS = 0
export const DEFAULT_MAX_RADIUS = 5
export const LINE_WIDTH = 1.5

// ---------------------------------------------------------------------------
// Params + ports
// ---------------------------------------------------------------------------

const PARAMS: ParamDef[] = [
  { key: 'speed', label: 'Speed', min: 0.1, max: 3, step: 0.1, default: 1 },
  { key: 'complexity', label: 'Complexity', min: 0.2, max: 2, step: 0.1, default: 1 },
  { key: 'lineWidth', label: 'Line Width', min: 0.5, max: 5, step: 0.5, default: LINE_WIDTH },
  { key: 'cycles', label: 'Cycles', min: 1, max: 20, step: 1, default: DEFAULT_CYCLES },
  { key: 'minRadius', label: 'Min Radius', min: -3, max: 3, step: 0.1, default: DEFAULT_MIN_RADIUS },
  { key: 'maxRadius', label: 'Max Radius', min: 1, max: 10, step: 0.1, default: DEFAULT_MAX_RADIUS },
  { key: 'color', label: 'Color', type: 'color', default: '#d4a843' },
  { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.05, default: 0.75 },
]

export const neonPolarInstrument: ObjectInstrumentDef = {
  id: 'neonPolar',
  name: 'Neon Polar',
  kind: 'object',
  userInterfaceRenderer: 'neonPolar',
  params: PARAMS,
  // Held notes in 48-59 jitter the curves and shift their frequency: higher
  // rows shake harder/sharper and multiply the curve frequency (more petals),
  // lower rows soften and slow it. Quantized to 6 labelled steps.
  midiRows: [
    { pitch: 59, label: 'Jitter · frantic, curves sped up (hold)', emphasized: true },
    { pitch: 57, label: 'Jitter · intense (hold)' },
    { pitch: 55, label: 'Jitter · strong (hold)' },
    { pitch: 53, label: 'Jitter · medium (hold)' },
    { pitch: 50, label: 'Jitter · gentle (hold)' },
    { pitch: 48, label: 'Jitter · subtle, curves slowed (hold)' },
  ],
  component: lazyInstrument(() => import('./NeonPolarVisual').then((m) => m.NeonPolarVisual)),
}
