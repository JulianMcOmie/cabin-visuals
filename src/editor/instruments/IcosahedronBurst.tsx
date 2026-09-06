import type { ObjectInstrumentDef, ParamDef } from './types'
import { lazyInstrument } from './lazyInstrument'

// Ported from Excellent DAW. Nested icosahedron wireframes spawn on each note and expand
// outward, fading as they grow. Each shell's size/opacity is closed-form in how long ago
// (in beats → seconds) its note played, so it's fully scrub-accurate. Lines are pooled.

const PARAMS: ParamDef[] = [
  { key: 'startSize', label: 'Start Size', min: 0.05, max: 1, step: 0.05, default: 0.15 },
  { key: 'expansionSpeed', label: 'Expansion Speed', min: 0.5, max: 15, step: 0.5, default: 4 },
  { key: 'maxSize', label: 'Max Size', min: 2, max: 20, step: 0.5, default: 6 },
  { key: 'fadeStart', label: 'Fade Start', min: 0.1, max: 0.9, step: 0.05, default: 0.5 },
  { key: 'hueStep', label: 'Hue Step', min: 0, max: 0.5, step: 0.01, default: 0.08 },
  { key: 'baseHue', label: 'Base Hue', min: 0, max: 1, step: 0.05, default: 0.55 },
  { key: 'saturation', label: 'Saturation', min: 0, max: 1, step: 0.05, default: 0.9 },
  { key: 'lightness', label: 'Lightness', min: 0.1, max: 1, step: 0.05, default: 0.6 },
]

export const icosahedronBurstInstrument: ObjectInstrumentDef = {
  id: 'icosahedronBurst',
  name: 'Icosahedron Burst',
  kind: 'object',
  identityColor: '#7c5cff',
  userInterfaceRenderer: 'icosahedronBurst',
  params: PARAMS,
  // Every note spawns one expanding shell regardless of pitch (hue steps per note in
  // play order), so the vocabulary is a single trigger row.
  midiRows: [
    { pitch: 60, label: 'Spawn expanding shell', emphasized: true },
  ],
  component: lazyInstrument(() => import('./IcosahedronBurstVisual').then((m) => m.IcosahedronBurstVisual)),
}
