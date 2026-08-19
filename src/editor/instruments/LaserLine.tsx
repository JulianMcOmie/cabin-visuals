import { paramDefault, type ObjectInstrumentDef } from './types'
import { lazyInstrument } from './lazyInstrument'
import { DEFAULT_WHITE_CORE } from './laserSphereCore'

// The Laser Line def - params, panel spec, rows, transform. The visual itself
// (the shader emitter + its GLSL) lives in ./LaserLineVisual, lazy: fetched
// when a project mounts a laser line.

export const DEFAULT_COLOR = '#25dfff'

export const laserLineInstrument: ObjectInstrumentDef = {
  id: 'laserLine',
  name: 'Laser Line',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  // The settings console, declared as data (console/spec.tsx): the panel
  // needs no component file and no registry entry. Same family as Laser
  // Sphere's - the COLOR pill is the emitter, its halo driven by GLOW.
  panelSpec: {
    accent: { param: 'color', fallback: DEFAULT_COLOR },
    testId: 'laser-line-user-interface',
    rows: [
      { row: ['length*:LENGTH', 'thickness:THICK', 'glow:GLOW', 'whiteCore:CORE', 'light:LIGHT', { pill: 'color', haloParam: 'glow' }] },
    ],
  },
  params: [
    { key: 'length', label: 'Length', min: 0.25, max: 60, step: 0.05, curve: 2, default: 4 },
    { key: 'thickness', label: 'Thickness', min: 0.01, max: 0.5, step: 0.01, default: 0.06 },
    { key: 'color', label: 'Laser Color', type: 'color', default: DEFAULT_COLOR },
    { key: 'glow', label: 'Glow', min: 1.5, max: 12, step: 0.1, default: 5.5 },
    { key: 'whiteCore', label: 'White-hot core', min: 0, max: 1, step: 0.01, default: DEFAULT_WHITE_CORE },
    { key: 'light', label: 'Scene Light', min: 0, max: 50, step: 1, default: 14 },
  ],
  midiRows: [
    { pitch: 76, label: 'Flare · max', emphasized: true },
    { pitch: 68, label: 'Flare · strong' },
    { pitch: 60, label: 'Flare · medium' },
    { pitch: 52, label: 'Flare · soft' },
    { pitch: 44, label: 'Flare · gentle' },
    { pitch: 36, label: 'Flare · faint' },
  ],
  // Position is the canonical track transform; length/thickness stay - they are
  // the line's shape, not its placement.
  localTransform: ({ params, energy }) => {
    const pulse = 1 + energy * 0.22
    return {
      scale: [
        (params.length ?? paramDefault(laserLineInstrument, 'length')) / 4 * pulse,
        (params.thickness ?? paramDefault(laserLineInstrument, 'thickness')) / 0.06 * pulse,
        1,
      ],
    }
  },
  component: lazyInstrument(() => import('./LaserLineVisual').then((m) => m.LaserLine)),
}
