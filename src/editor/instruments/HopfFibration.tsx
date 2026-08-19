import type { ObjectInstrumentDef, ParamDef } from './types'
import { lazyInstrument } from './lazyInstrument'

// Ported from Excellent DAW. A neon 3D Hopf fibration - nested interlocking tori of
// fiber curves, driven by 12 octave-looped MIDI transformations. The Hopf map / quaternion /
// stereographic-projection math and fiber-curve geometry are Tyler's verbatim; only the
// state reads are rewired (the note history is folded into the fibration state each frame,
// so everything is a pure function of the playhead - pause is static, scrub == playback).
// Tyler's palette is dropped. Not full-frame - it renders fiber curves in 3D space.
//
// The visual itself lives in ./HopfFibrationVisual (lazy: fetched when a project
// mounts a fibration); this file is the def - params, rows, and nothing heavy.

const PARAMS: ParamDef[] = [
  { key: 'coreWidth', label: 'Core Width', min: 0.5, max: 6, step: 0.5, default: 2.5 },
  { key: 'glowWidth', label: 'Glow Width', min: 2, max: 20, step: 1, default: 8 },
  { key: 'projScale', label: 'Projection Scale', min: 0.5, max: 4, step: 0.1, default: 1.5 },
  { key: 'maxDist', label: 'Max Distance', min: 3, max: 15, step: 1, default: 8 },
  { key: 'driftSpeed', label: 'Drift', min: 0, max: 0.3, step: 0.01, default: 0.08 },
  { key: 'rotationSpeed', label: 'Rotation', min: 0, max: 1, step: 0.05, default: 0.2 },
  { key: 'pointsPerFiber', label: 'Fiber Detail', min: 32, max: 200, step: 8, default: 80 },
  { key: 'fibersPerLayer', label: 'Fibers / Torus', min: 4, max: 20, step: 1, default: 10 },
  { key: 'flowSpeed', label: 'Flow Speed', min: 0, max: 0.5, step: 0.01, default: 0.15 },
  { key: 'thetaSpread', label: 'Torus Spread', min: 0.2, max: 2.0, step: 0.1, default: 0.9 },
]
export const hopfFibrationInstrument: ObjectInstrumentDef = {
  id: 'hopfFibration',
  name: 'Hopf Fibration',
  kind: 'object',
  identityColor: '#2dd4bf',
  userInterfaceRenderer: 'hopfFibration',
  params: PARAMS,
  // Transforms are octave-looped (pitch % 12); one octave (48-59) is exposed.
  // Display order groups related actions (layers, bursts/twists, rotates/flips,
  // color); pitches are load-bearing for saved projects and stay unchanged.
  midiRows: [
    { pitch: 50, label: 'Add torus layer', emphasized: true },
    { pitch: 51, label: 'Remove torus layer' },
    { pitch: 48, label: 'Shift torus family · new nesting' },
    { pitch: 57, label: 'Scale burst', emphasized: true },
    { pitch: 49, label: 'Pole burst · stretch to infinity' },
    { pitch: 55, label: 'Dehn twist · corkscrew the fibers' },
    { pitch: 52, label: 'Turn inside-out' },
    { pitch: 53, label: 'Rotate rings · latitude step' },
    { pitch: 54, label: 'Rotate rings · longitude step' },
    { pitch: 56, label: 'Mirror flip' },
    { pitch: 59, label: 'Reverse spin direction' },
    { pitch: 58, label: 'Shift colors · rotate hues' },
  ],
  component: lazyInstrument(() => import('./HopfFibrationVisual').then((m) => m.HopfFibrationVisual)),
}
