import type { ObjectInstrumentDef } from './types'
import { lazyInstrument } from './lazyInstrument'

// The Light instrument: a scene light that is an ordinary object TRACK, so its
// position rides the canonical tf* transform - automatable, mover-able,
// splitter-multipliable (a ring splitter mints a ring of lamps) - and its
// knobs automate like any params. The mounted component (LightVisual) renders
// only an anchor plus an optional glowing bulb; the actual THREE lights are
// mirrored into every render pass by core/visual/sceneLights.ts, which is also
// where the "which passes see the light" story lives.
//
// Every visual scene is seeded with a "Lighting" group of these wearing the
// old hardcoded rig's exact values (core/defaultLighting.ts, persistence
// UPGRADES[17]); a scene with NO light tracks at all still gets the legacy
// baked rig (VisualScene's fallback), so unseeded fixtures keep rendering.
//
// TYPE values are append-only - they are saved in track params.

export const LIGHT_DEFAULT_COLOR = '#ffffff'

export const lightInstrument: ObjectInstrumentDef = {
  id: 'light',
  name: 'Light',
  kind: 'object',
  identityColor: { param: 'color' },
  userInterfaceRenderer: 'parameters',
  params: [
    {
      key: 'type',
      label: 'Type',
      type: 'select',
      default: 0,
      options: [
        { value: 0, label: 'Point (bulb)' },
        { value: 1, label: 'Spot (cone)' },
        { value: 2, label: 'Directional (sun)' },
        { value: 3, label: 'Ambient (sky wash)' },
        { value: 4, label: 'Area (soft panel)' },
      ],
    },
    { key: 'color', label: 'Color', type: 'color', default: LIGHT_DEFAULT_COLOR },
    { key: 'groundColor', label: 'Ground Color', type: 'color', default: '#170921', showIf: 'type=3' },
    { key: 'intensity', label: 'Intensity', min: 0, max: 12, step: 0.05, default: 3 },
    // Note flash: each note's energy pulse lifts the intensity by this factor.
    { key: 'flash', label: 'Note Flash', min: 0, max: 3, step: 0.05, default: 0 },
    { key: 'distance', label: 'Reach', min: 0, max: 40, step: 0.5, default: 20, showIf: 'type=0|1' },
    { key: 'decay', label: 'Falloff', min: 0, max: 4, step: 0.05, default: 2, showIf: 'type=0|1' },
    { key: 'angle', label: 'Cone Angle', min: 5, max: 90, step: 1, default: 45, showIf: 'type=1' },
    { key: 'penumbra', label: 'Softness', min: 0, max: 1, step: 0.01, default: 0.35, showIf: 'type=1' },
    // Where the beam points (spot/sun): a world-space target point, so several
    // copies of one track all converge on the same subject.
    { key: 'aimX', label: 'Aim X', min: -12, max: 12, step: 0.05, default: 0, showIf: 'type=1|2' },
    { key: 'aimY', label: 'Aim Y', min: -12, max: 12, step: 0.05, default: 0, showIf: 'type=1|2' },
    { key: 'aimZ', label: 'Aim Z', min: -12, max: 12, step: 0.05, default: 0, showIf: 'type=1|2' },
    { key: 'width', label: 'Panel Width', min: 0.5, max: 20, step: 0.1, default: 5, showIf: 'type=4' },
    { key: 'height', label: 'Panel Height', min: 0.5, max: 20, step: 0.1, default: 5, showIf: 'type=4' },
    // Flat fill riding along with the ambient hemisphere (the old rig's
    // <ambientLight intensity={0.12} /> half).
    { key: 'flat', label: 'Flat Fill', min: 0, max: 1, step: 0.01, default: 0.12, showIf: 'type=3' },
    { key: 'castShadow', label: 'Cast Shadows', type: 'boolean', default: 0, showIf: 'type=1|2' },
    // The visible glowing bulb at the light's position - how you SEE where the
    // light is. On for user-added lights; the seeded default rig turns it off.
    { key: 'bulb', label: 'Show Bulb', type: 'boolean', default: 1 },
  ],
  midiRows: [
    { pitch: 76, label: 'Flash · max', emphasized: true },
    { pitch: 60, label: 'Flash · medium' },
    { pitch: 44, label: 'Flash · gentle' },
  ],
  component: lazyInstrument(() => import('./LightVisual').then((m) => m.LightVisual)),
}
