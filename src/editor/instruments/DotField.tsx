import type { ObjectInstrumentDef, ParamDef } from './types'
import { lazyInstrument } from './lazyInstrument'

// Ported from Excellent DAW's DotField. A 3D field of dots arranged by golden-angle
// (sunflower) distribution, displaced by a rotating roster of wave/displacement effects,
// disruptor blades, and water ripples. NOT full-frame - the field sits in the scene at a
// fixed world radius so the engine's placement/transform chain applies.
//
// Adaptation: Tyler keyed each effect to a specific MIDI pitch via `pitchNoteOnCounts`.
// The cabin engine exposes `activeNotes` plus the full resolved note stream. So:
//   - held notes in the low range (0-11 of the field) drive the bass shake, verbatim;
//   - each note's ordinal position in the stream advances the displacement effect
//     roster and, at intervals, marks disruptor-blade / center-ripple / scale-kick
//     spawns - a lively note-reactive field rather than a control-surface. All of it
//     is derived per frame from `state.beat` + `state.notes` (pause invariant: no
//     wall clock, no spawn lists), with each event aged by beat-distance from its
//     note. Displacement/shake/ripple/blade math is Tyler's verbatim. Tyler's
//     palette color-mode is dropped; colorMode selects one of his three hardcoded
//     schemes.
//
// The visual itself lives in ./DotFieldVisual (lazy: fetched when a project
// mounts a dot field); this file is the def - params, rows, and nothing heavy.

export const MAX_PARTICLES = 2000

export const EFFECT_COUNT = 10

export const DEFAULTS = {
  particleCount: 800,
  dotSize: 3,
  speed: 1,
  intensity: 1,
  bladeCount: 3,
  disruptorStrength: 0.08,
  disruptorSpeed: 2,
  disruptorLifetime: 2,
  rippleSpeed: 1.2,
  rippleStrength: 0.06,
  opacity: 1,
}

// --- Params / ports ---

const PARAMS: ParamDef[] = [
  { key: 'particleCount', label: 'Particles', min: 50, max: MAX_PARTICLES, step: 50, default: DEFAULTS.particleCount },
  { key: 'dotSize', label: 'Dot Size', min: 1, max: 24, step: 0.5, default: 6 },
  { key: 'speed', label: 'Speed', min: 0.1, max: 3, step: 0.1, default: DEFAULTS.speed },
  { key: 'intensity', label: 'Intensity', min: 0, max: 20, step: 0.1, default: DEFAULTS.intensity },
  {
    key: 'colorMode', label: 'Color Scheme', type: 'select', default: 0,
    options: [
      { value: 0, label: 'Crimson Sunrise' },
      { value: 1, label: 'Ocean Depths' },
      { value: 2, label: 'Aurora Borealis' },
    ],
  },
  { key: 'activeEffects', label: 'Active Effects', min: 0, max: EFFECT_COUNT, step: 1, default: 2 },
  { key: 'bladeCount', label: 'Blade Count', min: 1, max: 8, step: 1, default: DEFAULTS.bladeCount },
  { key: 'disruptorStrength', label: 'Disruptor Strength', min: 0.01, max: 0.3, step: 0.01, default: DEFAULTS.disruptorStrength },
  { key: 'disruptorSpeed', label: 'Disruptor Speed', min: 0.5, max: 5, step: 0.1, default: DEFAULTS.disruptorSpeed },
  { key: 'disruptorLifetime', label: 'Disruptor Life (s)', min: 0.5, max: 5, step: 0.1, default: DEFAULTS.disruptorLifetime },
  { key: 'rippleSpeed', label: 'Ripple Speed', min: 0.3, max: 3, step: 0.1, default: DEFAULTS.rippleSpeed },
  { key: 'rippleStrength', label: 'Ripple Strength', min: 0.01, max: 0.2, step: 0.01, default: DEFAULTS.rippleStrength },
  { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.05, default: DEFAULTS.opacity },
]

// --- Instrument export ---

export const dotFieldInstrument: ObjectInstrumentDef = {
  id: 'dotField',
  name: 'Dot Field',
  kind: 'object',
  identityColor: '#3ddc97',
  userInterfaceRenderer: 'dotField',
  params: PARAMS,
  // Held notes in 36-47 shake the field - higher rows shake harder and sharper
  // (quantized to 6 labelled steps). EVERY note also kicks the field scale,
  // and every 2nd/4th note fires a ripple / disruptor blades; the top row
  // triggers those without adding any shake.
  midiRows: [
    { pitch: 60, label: 'Field kick · ripple, no shake' },
    { pitch: 47, label: 'Bass shake · hardest, sharp (hold)', emphasized: true },
    { pitch: 45, label: 'Bass shake · aggressive (hold)' },
    { pitch: 43, label: 'Bass shake · driving (hold)' },
    { pitch: 41, label: 'Bass shake · punchy (hold)' },
    { pitch: 38, label: 'Bass shake · deep (hold)' },
    { pitch: 36, label: 'Bass shake · deepest, smooth (hold)' },
  ],
  component: lazyInstrument(() => import('./DotFieldVisual').then((m) => m.DotFieldVisual)),
  fullFrame: true,
}
