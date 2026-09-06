import {
  DEFAULT_FUNDAMENTAL_COLOR,
  DEFAULT_SIDES,
  DEFAULT_TUBE_FRACTION,
  MAX_SIDES,
  MIN_SIDES,
} from './FundamentalGeometry'
import { POSTER_SHADE_DEFAULT } from './posterShading'
import type { ObjectInstrumentDef } from './types'
import { lazyInstrument } from './lazyInstrument'

export const DEFAULT_BASE_COLOR = DEFAULT_FUNDAMENTAL_COLOR

// The cube's definition lives next to its visual - schema and component can't drift.
export const cubeInstrument: ObjectInstrumentDef = {
  id: 'cube',
  name: '3D Shape',
  kind: 'object',
  castsShadows: true, // FundamentalMesh + the shatter fragments (CubeVisual)
  userInterfaceRenderer: 'cube',
  // Position and size are the canonical track transform now (core/transform.ts,
  // edited via the track strip's panel) - instruments keep only behavior params.
  params: [
    { key: 'baseColor', label: 'Base Color', type: 'color', default: DEFAULT_BASE_COLOR },
    { key: 'geometry', label: 'Geometry', type: 'string', default: 'cube' },
    // Per-INSTANCE size: a mesh-local scale (first in the chain), so each copy
    // a splitter mints grows in place - unlike the canonical tfSize, which is
    // a group fader scaling the whole formation and its layout offsets.
    { key: 'size', label: 'Size', min: 0.05, max: 4, step: 0.01, default: 1 },
    // The solid's proportions: per-axis stretch applied to the mesh itself
    // (a cube becomes a slab or a pillar, a cylinder a disc), kept out of the
    // placement matrix so movers and children never inherit the stretch.
    { key: 'dimX', label: 'Width', min: 0.25, max: 3, step: 0.01, default: 1 },
    { key: 'dimY', label: 'Height', min: 0.25, max: 3, step: 0.01, default: 1 },
    { key: 'dimZ', label: 'Depth', min: 0.25, max: 3, step: 0.01, default: 1 },
    // Tube thickness for the torus family, as a fraction of the ring radius -
    // the ring shrinks as the tube grows, so overall size holds still.
    { key: 'tube', label: 'Tube', min: 0.12, max: 0.85, step: 0.01, default: DEFAULT_TUBE_FRACTION },
    // The N-gon family: how many sides the prism/cone cross-section has -
    // 3 = triangular prism / pyramid, high counts approach round.
    { key: 'sides', label: 'Sides', min: MIN_SIDES, max: MAX_SIDES, step: 1, default: DEFAULT_SIDES, integer: true },
    // Spin is opt-in: 0 = still (the default), 1 = the classic steady tumble.
    { key: 'spinSpeed', label: 'Spin Speed', min: 0, max: 4, step: 0.05, default: 0 },
    // The FINISH: Matte is the Overlap instruments' poster surface (flat color
    // + a fixed-light lambert, tone-map-free - pretty without glaring) and the
    // default for NEW tracks; Gloss is the original physical material.
    // Existing projects are pinned to Gloss by persistence UPGRADES[13], so no
    // saved look changes.
    {
      key: 'finish',
      label: 'Finish',
      type: 'select',
      options: [
        { value: 0, label: 'Matte' },
        { value: 1, label: 'Gloss' },
      ],
      default: 0,
    },
    // How much of the lambert model the Matte finish mixes over the flat fill.
    { key: 'shading', label: 'Shading', min: 0, max: 1, step: 0.01, default: POSTER_SHADE_DEFAULT, showIf: 'finish=0' },
    // Surface toggles - resolved through fundamentalMaterialSettings, and only
    // meaningful on the Gloss finish (Matte ignores scene light entirely).
    // Defaults reproduce the original material exactly.
    { key: 'reflective', label: 'Reflective', type: 'boolean', default: 0, showIf: 'finish=1' },
    { key: 'refractive', label: 'Refractive', type: 'boolean', default: 0, showIf: 'finish=1' },
    { key: 'shaded', label: 'Lit', type: 'boolean', default: 1, showIf: 'finish=1' },
    { key: 'textured', label: 'Textured', type: 'boolean', default: 0, showIf: 'finish=1' },
  ],
  // Notes drive the pulse envelope (scale swell + emissive glow); higher pitch = stronger pulse.
  midiRows: [
    { pitch: 76, label: 'Pulse · max', emphasized: true },
    { pitch: 68, label: 'Pulse · strong' },
    { pitch: 60, label: 'Pulse · medium' },
    { pitch: 52, label: 'Pulse · soft' },
    { pitch: 44, label: 'Pulse · gentle' },
    { pitch: 36, label: 'Pulse · faint' },
  ],
  // The instrument's signature ability: play a note on its Shatter lane and the solid bursts
  // into fragments that fly out and reassemble over the note's length (its velocity
  // sets the blast radius). Bespoke and intrinsic to this instrument.
  abilities: [
    { key: 'shatter', label: 'Shatter', color: '#f472b6' },
  ],
  // The note-pulse swell is the only local transform left: it is a mesh property
  // (kept out of the placement matrix), so movers and children never inherit the
  // pulse. Placement itself comes from the canonical track transform. Spin is
  // applied inside each rendered copy below, so splitters duplicate a spinning
  // solid without rotating their own layout offsets.
  localTransform: ({ energy, params }) => ({
    scale: (1 + energy * 0.35) * (params.size ?? 1),
  }),
  component: lazyInstrument(() => import('./CubeVisual').then((m) => m.Cube)),
  instancedComponent: lazyInstrument(() => import('./CubeVisual').then((m) => m.CubeInstanced)),
}
