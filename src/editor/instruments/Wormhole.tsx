import type { ObjectInstrumentDef, ParamDef } from './types'
import { lazyInstrument } from './lazyInstrument'

// A noise-warped point tube you fly through, from Bobby Roe's three.js wormhole demo.
// The vertex lattice, the radial noise displacement and the hue ramp are the
// original's verbatim; everything that MOVED had to be rebuilt, because the original
// is a requestAnimationFrame loop and this engine forbids one:
//
//  - `points.rotation.y += 0.005` and `points.position.z += speed` were accumulators.
//    Both are now closed-form in `tSec` (spin = tSec * spin, scroll = a modulo of
//    tSec * speed), so scrubbing to a beat lands on exactly the frame playback shows.
//  - The camera orbit (`camera.position.x = cos(t)`) is gone - the camera belongs to
//    the cameraControl instrument. The tube sways by the negative offset instead,
//    which is the same relative motion from a fixed camera.
//  - `scene.fog = FogExp2` mutated the shared scene, which would have fogged every
//    other track. The same exp2 falloff is computed per-point in the shader and
//    applied to ALPHA, so distant points fade out over whatever is behind them
//    rather than fading toward a hardcoded black.
//  - The 4096-segment cylinder (~528k points, drawn twice) is down to a
//    parameterised lattice defaulting to ~49k, shared by both tubes.
//
// DELIBERATELY NOT BLOCK-GATED. Every other ambient instrument here renders nothing
// without a block at the playhead; Julia asked for the opposite on this one, so the
// tunnel flies continuously and the MIDI grid is a pulse-intensity lane instead of an
// on/off region. Blocks still bound where notes live - they just no longer gate the
// tube itself. If this ever needs to go back, `beatInBlock(state)` from
// core/visual/instrumentFrame is the one-line restore.
//
// Two tubes chase each other end-to-end; when the leader passes the camera it wraps
// to the back, so the flight never ends.

// Lattice ceilings, shared by the sliders here and the builder in the visual.
export const MAX_RADIAL = 192
export const MAX_LENGTH = 768

const PARAMS: ParamDef[] = [
  // Ceiling raised from 40: the Wormhole template pins this to the top, which is
  // a sign the range ran out before the look did. Nothing else needs to change -
  // scroll position is a modulo of the tube's 400-unit cycle, so higher speeds
  // wrap exactly as before rather than running off the end.
  { key: 'speed', label: 'Flight Speed', min: 0, max: 200, step: 1, default: 12 },
  { key: 'spin', label: 'Spin', min: -2, max: 2, step: 0.05, default: 0.3 },
  { key: 'radius', label: 'Tunnel Width', min: 0.5, max: 8, step: 0.1, default: 3 },
  // World units, NOT fog density. This slider used to be the density itself, so
  // dragging it up thickened the fog and you saw LESS - backwards from its label.
  // It is now the distance at which points fade out, and the reciprocal is taken
  // at the uniform. Bigger = see further.
  { key: 'viewDistance', label: 'View Distance', min: 10, max: 250, step: 1, default: 40 },
  { key: 'dotSize', label: 'Dot Size', min: 0.005, max: 0.2, step: 0.005, default: 0.03 },
  { key: 'brightness', label: 'Brightness', min: 0, max: 3, step: 0.05, default: 1 },
  // Cyan at full saturation is HSL(0.5, 1, 0.5) - the exact centre of the original's
  // ramp, so the defaults here are pixel-identical to the demo.
  { key: 'color', label: 'Color', type: 'color', default: '#00ffff' },
  { key: 'colorSpread', label: 'Color Spread', min: 0, max: 1, step: 0.02, default: 1 },
  { key: 'sway', label: 'Sway', min: 0, max: 4, step: 0.1, default: 1.5 },
  { key: 'swaySpeed', label: 'Sway Speed', min: 0, max: 4, step: 0.05, default: 1 },
  { key: 'noiseAmount', label: 'Wall Warp', min: 0, max: 2, step: 0.05, default: 0.5 },
  { key: 'noiseScale', label: 'Warp Scale', min: 0.01, max: 0.5, step: 0.01, default: 0.1 },
  { key: 'ringDetail', label: 'Ring Detail', min: 16, max: MAX_RADIAL, step: 8, default: 128 },
  { key: 'lengthDetail', label: 'Length Detail', min: 64, max: MAX_LENGTH, step: 32, default: 384 },
  // The pulse channels, roughly in order of how strongly they read from INSIDE the
  // tube. Size and Depth were added after Widen alone turned out to be nearly
  // invisible from in there (see the frame callback for why).
  { key: 'pulseSize', label: 'Pulse · Dot Size', min: 0, max: 4, step: 0.05, default: 1.4 },
  { key: 'pulseDepth', label: 'Pulse · See Deeper', min: 0, max: 1, step: 0.02, default: 0.55 },
  { key: 'pulseFlash', label: 'Pulse · Flash', min: 0, max: 4, step: 0.05, default: 1.3 },
  { key: 'pulseWidth', label: 'Pulse · Widen', min: 0, max: 2, step: 0.05, default: 0.4 },
  { key: 'pulseThrust', label: 'Pulse · Thrust', min: 0, max: 30, step: 0.5, default: 2 },
  { key: 'pulseAttack', label: 'Pulse · Attack (s)', min: 0.02, max: 1, step: 0.01, default: 0.12 },
  { key: 'pulseDecay', label: 'Pulse · Decay (s)', min: 0.05, max: 2.5, step: 0.05, default: 0.45 },
]

export const wormholeInstrument: ObjectInstrumentDef = {
  id: 'wormhole',
  name: 'Wormhole',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  params: PARAMS,
  // An intensity ladder, not a keyboard: the row sets how hard the tunnel throbs,
  // velocity scales it further. Eight contiguous rows so the grid reads like a fader,
  // coloured cool-to-hot to match. Notes outside the range clamp to the nearest row.
  midiRows: [
    { pitch: 67, label: 'Pulse 8 · full force', color: '#db2777' },
    { pitch: 66, label: 'Pulse 7', color: '#dc2626' },
    { pitch: 65, label: 'Pulse 6', color: '#ea580c' },
    { pitch: 64, label: 'Pulse 5', color: '#ca8a04' },
    { pitch: 63, label: 'Pulse 4', color: '#059669' },
    { pitch: 62, label: 'Pulse 3', color: '#0891b2' },
    { pitch: 61, label: 'Pulse 2', color: '#1d4ed8' },
    { pitch: 60, label: 'Pulse 1 · subtle', color: '#1e3a8a', emphasized: true },
  ],
  component: lazyInstrument(() => import('./WormholeVisual').then((m) => m.WormholeVisual)),
  // The tube has to surround the camera to read as a tunnel, so it opts out of the
  // placement transform the way the other immersive instruments do.
  fullFrame: true,
}
