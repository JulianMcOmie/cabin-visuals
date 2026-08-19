import type { ObjectInstrumentDef, ParamDef } from './types'
import { lazyInstrument } from './lazyInstrument'

// Ported from Excellent DAW's ParticleBurst. Each note is an InstancedMesh burst of
// particles that expands outward (7 selectable burst geometries + 5 ease curves) and fades.
// Bursts are derived fresh each frame from the note stream (age = beats since onset, in
// seconds at the current tempo), so they're fully scrub-accurate - no spawn-time state.
// Pitch (36–71) picks one of Tyler's hardcoded colour presets; velocity scales brightness.
// Tyler's palette colour-mode is dropped (no palettes here). Burst math + golden-ratio
// sphere distribution + easing are Tyler's verbatim; only state reads + params are rewired.
//
// The visual itself lives in ./ParticleBurstVisual (lazy: fetched when a project
// mounts a particle burst); this file is the def - params, rows, and nothing heavy.

// ── Config ──────────────────────────────────────────────────────────────────
export const MAX_PARTICLES = 8000

const PARAMS: ParamDef[] = [
  { key: 'burstType', label: 'Burst Type', type: 'select', options: [
    { value: 0, label: 'Sphere' },
    { value: 1, label: 'Cone' },
    { value: 2, label: 'Jet' },
    { value: 3, label: 'Spiral Out' },
    { value: 4, label: 'Polar Rose' },
    { value: 5, label: 'Ring' },
    { value: 6, label: 'Double Helix' },
  ], default: 0 },
  { key: 'count', label: 'Particles', min: 500, max: MAX_PARTICLES, step: 500, default: 3000 },
  { key: 'pointSize', label: 'Dot Size', min: 0.01, max: 0.1, step: 0.005, default: 0.035 },
  { key: 'burstRadius', label: 'Burst Radius', min: 1, max: 10, step: 0.25, default: 4 },
  { key: 'dissolveSpread', label: 'Dissolve Spread', min: 0, max: 15, step: 0.25, default: 5 },
  { key: 'fadePower', label: 'Fade Tail', min: 0.2, max: 2, step: 0.05, default: 0.6 },
  { key: 'burstPower', label: 'Curve Power', min: 0.5, max: 5, step: 0.1, default: 2 },
  { key: 'burstCurve', label: 'Ease Curve', type: 'select', options: [
    { value: 0, label: 'Logarithmic' },
    { value: 1, label: 'Exponential' },
    { value: 2, label: 'Power' },
    { value: 3, label: 'Circular' },
    { value: 4, label: 'Sine' },
  ], default: 0 },
  { key: 'burstLifetime', label: 'Lifetime (s)', min: 1, max: 8, step: 0.25, default: 4 },
  { key: 'coneAngle', label: 'Cone Angle', min: 0.1, max: 1.5, step: 0.05, default: 0.8 },
  { key: 'spiralTwists', label: 'Spiral Twists', min: 1, max: 10, step: 0.5, default: 3 },
  { key: 'polarPetals', label: 'Polar Petals', min: 2, max: 12, step: 1, default: 5 },
  { key: 'cylinderRadius', label: 'Cylinder Radius', min: 0, max: 20, step: 0.25, default: 0 },
]

export const particleBurstInstrument: ObjectInstrumentDef = {
  id: 'particleBurst',
  name: 'Particle Burst',
  kind: 'object',
  identityColor: '#e62b00',
  userInterfaceRenderer: 'particleBurst',
  params: PARAMS,
  // Pitch (36-71) selects one of the 36 color presets (pitch - 36 = preset index);
  // velocity scales brightness. Ten representative presets spanning the range
  // (higher pitch on top); in-between pitches pick the presets between them.
  midiRows: [
    { pitch: 71, label: 'Burst · Blood Moon', color: '#992626' },
    { pitch: 67, label: 'Burst · Diamond', color: '#a9b6bd' },
    { pitch: 64, label: 'Burst · Vaporwave', color: '#e600b8' },
    { pitch: 59, label: 'Burst · Prism (rainbow)', color: '#e61717' },
    { pitch: 54, label: 'Burst · Aurora Borealis', color: '#0a9bb8' },
    { pitch: 50, label: 'Burst · Pure White', color: '#bfbfbf' },
    { pitch: 48, label: 'Burst · Emerald', color: '#0bd06a' },
    { pitch: 45, label: 'Burst · Electric Blue', color: '#0066ff' },
    { pitch: 40, label: 'Burst · Rose', color: '#f20d59' },
    { pitch: 36, label: 'Burst · Ember', color: '#e62b00', emphasized: true },
  ],
  component: lazyInstrument(() => import('./ParticleBurstVisual').then((m) => m.ParticleBurstVisual)),
}
