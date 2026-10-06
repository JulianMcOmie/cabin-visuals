import type { MidiRowDef, ObjectInstrumentDef } from './types'
import { lazyInstrument } from './lazyInstrument'
import { DUST_AXIS_STEPS, DUST_PITCH_X, DUST_PITCH_Y, DUST_PITCH_Z } from './dustSphereCore'

// Dust Sphere: every note is a ball that starts crumbling to dust the moment it
// lands - a ragged front crosses it, and each grain it frees glows, drifts
// downwind, and thins away. The notes say WHERE: three five-row bands name the
// X, Y and Z coordinate, and axes that start together combine into one position
// (dustSphereCore.ts owns that rule; DustSphereVisual.tsx the shader).

export const DUST_SPHERE_MAX_GRAINS = 1_000_000
/** Radius before the track's own size (the canonical transform scales it). */
export const DUST_SPHERE_RADIUS = 0.6

const DEFAULT_COLOR = '#d9b48f'
const DEFAULT_EMBER = '#ff7a2e'

// Axis colours follow the gizmo convention (X red, Y green, Z blue) so the row
// list reads as three bands at a glance. Top row of each band = the positive end.
const AXIS_ROWS: { base: number; color: string; labels: string[] }[] = [
  { base: DUST_PITCH_X, color: '#f0705f', labels: ['X · far left', 'X · left', 'X · centre', 'X · right', 'X · far right'] },
  { base: DUST_PITCH_Y, color: '#6fd08a', labels: ['Y · bottom', 'Y · low', 'Y · centre', 'Y · high', 'Y · top'] },
  { base: DUST_PITCH_Z, color: '#6aa5f5', labels: ['Z · far back', 'Z · back', 'Z · centre', 'Z · front', 'Z · near'] },
]

const MIDI_ROWS: MidiRowDef[] = AXIS_ROWS.flatMap(({ base, color, labels }) =>
  Array.from({ length: DUST_AXIS_STEPS }, (_, k) => {
    const index = DUST_AXIS_STEPS - 1 - k
    return { pitch: base + index, label: labels[index], color, emphasized: index === (DUST_AXIS_STEPS - 1) / 2 || undefined }
  }),
)

export const dustSphereInstrument: ObjectInstrumentDef = {
  id: 'dustSphere',
  name: 'Dust Sphere',
  kind: 'object',
  identityColor: { param: 'color' },
  userInterfaceRenderer: 'parameters',
  panelSpec: {
    accent: { param: 'color', fallback: DEFAULT_COLOR },
    testId: 'dust-sphere-user-interface',
    rows: [
      { row: ['count*:GRAINS', 'grain:GRAIN', 'spread:SPREAD', { pill: 'color' }] },
      { row: ['dissolve:SWEEP', 'life:LIFE', 'drift:DRIFT', 'turbulence:SWIRL', { param: 'windAngle', label: 'WIND', bipolar: true, suffix: '°' }, 'glow:GLOW', { pill: 'ember', label: 'EMBER', haloParam: 'glow' }] },
    ],
  },
  // Position and size are the canonical track transform (core/transform.ts).
  params: [
    { key: 'color', label: 'Dust Color', type: 'color', default: DEFAULT_COLOR },
    { key: 'ember', label: 'Ember Color', type: 'color', default: DEFAULT_EMBER },
    { key: 'count', label: 'Grains', min: 20_000, max: DUST_SPHERE_MAX_GRAINS, step: 10_000, curve: 2, default: 300_000 },
    // A multiple of the spacing between grains, not a world size: 1 is grains
    // just touching, so the ball stays solid whatever the count.
    { key: 'grain', label: 'Grain Size', min: 0.6, max: 4, step: 0.05, default: 1.7 },
    { key: 'spread', label: 'Position Spread', min: 0, max: 5, step: 0.05, default: 1.1 },
    { key: 'dissolve', label: 'Sweep (beats)', min: 0.05, max: 8, step: 0.05, default: 1 },
    { key: 'life', label: 'Dust Life (beats)', min: 0.25, max: 16, step: 0.25, default: 3 },
    // 0 by default: the dust hangs and swirls where the ball was. WIND still
    // picks which side goes first; DRIFT is how far it then carries the grains.
    { key: 'drift', label: 'Drift', min: 0, max: 8, step: 0.05, default: 0 },
    { key: 'turbulence', label: 'Swirl', min: 0, max: 3, step: 0.05, default: 0.6 },
    { key: 'windAngle', label: 'Wind Direction', min: -180, max: 180, step: 1, default: 25 },
    { key: 'glow', label: 'Ember Glow', min: 0, max: 10, step: 0.1, default: 3 },
  ],
  midiRows: MIDI_ROWS,
  component: lazyInstrument(() => import('./DustSphereVisual').then((m) => m.DustSphereVisual)),
}
