import type { ObjectInstrumentDef, ParamDef } from './types'
import { lazyInstrument } from './lazyInstrument'

// Ported from Excellent DAW. A hypnotic fractal-flower tunnel: a recursive branching
// "flower" is drawn twice (near + far), connected by tunnel lines, projected with a
// simple perspective. The spiral, spread and hue slowly oscillate over musical beats;
// new notes bump the hue (or spawn colour-inversion pulse rings). Drawing math is
// Tyler's verbatim; state reads are rewired to the engine, and all motion derives
// from `state.beat` - hue bumps and pulse rings are computed from `state.notes` each
// frame (note-onset ages, not a spawned list), so scrub == playback.
//
// RENDERING IS GPU LINE GEOMETRY, not a canvas. The flower is ~1,500 line segments;
// stroking those on a 2D canvas with shadowBlur (and uploading the result as a
// multi-megabyte texture every frame) made this the most expensive instrument in the
// engine, and Color Pulse doubled it by rendering a second, inverted offscreen copy.
// Now the same projected segments are packed into instanced line buffers - one draw
// per generation, because that is the granularity at which line WIDTH changes - and
// the GPU rasterizes them. A fragment shader would be the wrong tool here: this is
// explicit geometry, and per-pixel distance to 1,500 segments is far more work than
// simply drawing them.
//
// Deliberate differences from the canvas original, all in service of speed:
//  - Glow is a second, wider, dimmer pass per generation (the neon core+glow pattern
//    HopfFibration uses) instead of canvas shadowBlur.
//  - Segments blend ADDITIVELY, so per-segment alpha is baked into its colour.
//    Over the near-black backdrop this matches; where branches overlap it reads
//    slightly hotter, which suits the neon look.
//  - Color Pulse rings are a hue rotation applied per-fragment inside the ring
//    bands (injected into the line shader) rather than a composited second render.

const PARAMS: ParamDef[] = [
  { key: 'symmetry', label: 'Symmetry', min: 2, max: 12, step: 1, default: 6 },
  { key: 'branchCount', label: 'Branches', min: 1, max: 5, step: 1, default: 3 },
  { key: 'generations', label: 'Generations', min: 1, max: 5, step: 1, default: 3 },
  { key: 'spiralAmount', label: 'Spiral', min: 0, max: 2, step: 0.1, default: 0.9 },
  { key: 'lengthDecay', label: 'Length Decay', min: 0.4, max: 1, step: 0.05, default: 0.8 },
  { key: 'spreadAngle', label: 'Spread Angle', min: 0.5, max: 3, step: 0.1, default: 1.6 },
  { key: 'hueShift', label: 'Hue Shift', min: 0, max: 0.3, step: 0.01, default: 0.09 },
  { key: 'baseHue', label: 'Base Hue', min: 0, max: 1, step: 0.05, default: 0.48 },
  { key: 'lineWidth', label: 'Line Width', min: 1, max: 10, step: 0.5, default: 4 },
  { key: 'glowIntensity', label: 'Glow', min: 0, max: 1, step: 0.1, default: 0.9 },
  { key: 'bgColor', label: 'Background Color', type: 'color', default: '#050508' },
  { key: 'colorPulse', label: 'Color Pulse', type: 'boolean', default: 0 },
  { key: 'pulseSpeed', label: 'Pulse Speed', min: 50, max: 500, step: 10, default: 200, showIf: 'colorPulse' },
  { key: 'pulseBandWidth', label: 'Band Width', min: 10, max: 100, step: 5, default: 40, showIf: 'colorPulse' },
  { key: 'pulseFadeDuration', label: 'Fade Duration', min: 0.5, max: 5, step: 0.1, default: 2.0, showIf: 'colorPulse' },
]

export const fractalTunnelInstrument: ObjectInstrumentDef = {
  id: 'fractalTunnel',
  name: 'Fractal Tunnel',
  kind: 'object',
  identityColor: '#c084fc',
  userInterfaceRenderer: 'fractalTunnel',
  params: PARAMS,
  // Every note does the same thing regardless of pitch: it steps the flower's
  // hue by 30° (or, with Color Pulse on, fires an inverted-color ring instead).
  midiRows: [
    { pitch: 60, label: 'Color jolt · hue step / pulse ring', emphasized: true },
  ],
  component: lazyInstrument(() => import('./FractalTunnelVisual').then((m) => m.FractalTunnelVisual)),
  fullFrame: true,
}
