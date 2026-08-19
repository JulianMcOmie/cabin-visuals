import type { ObjectInstrumentDef, ParamDef } from './types'
import { lazyInstrument } from './lazyInstrument'

// Ported from Excellent DAW. Generative metronome-ball line drawings: three
// foreground panels + a rotating background "flower", all built from balls that
// pendulum outward, alternating kick/snare turns each beat. The trajectory math
// (computePattern / computePatternBounce) is Tyler's VERBATIM. Full-frame 2D scene,
// sized to the viewport. All state is derived PURELY from the
// current beat: angles/rotation/palette come from counting/folding the notes with
// beat <= state.beat, so any scrub path lands on the identical picture. Tyler's
// Managed* line/dot pools, displacement shader, ink/spiral/snare-bounce sub-effects
// are collapsed away - this keeps the signature look with plain three primitives.
//
// The visual itself lives in ./MetronomeBallsVisual (lazy: fetched when a
// project mounts one); this file is the def - params, rows, and nothing heavy.

// MIDI trigger pitches (subset of Tyler's - the ones that map to what we render)
export const PITCH_FG = 48          // nudge foreground angles + rotate
export const PITCH_BG = 50          // nudge background angles + rotate flower
export const PITCH_INVERT = 56      // swap bg/fg
export const PITCH_PAL_SEPIA = 58
export const PITCH_PAL_MIDNIGHT = 60
export const PITCH_PAL_BOTANICAL = 62
export const PITCH_PAL_PLUM = 64
export const PITCH_PAL_CRIMSON = 65
export const PITCH_PAL_SCARLET = 92

// Ball-count ceiling, shared by the slider here and the buffer builder in the visual.
export const MAX_BALLS = 80

const PARAMS: ParamDef[] = [
  { key: 'balls', label: 'Balls', min: 1, max: MAX_BALLS, step: 1, default: 24 },
  { key: 'kickStart', label: 'Kick Start (deg)', min: 1, max: 180, step: 1, default: 37 },
  { key: 'snareStart', label: 'Snare Start (deg)', min: 1, max: 180, step: 1, default: 53 },
  { key: 'kickStep', label: 'Kick Step (deg)', min: -10, max: 10, step: 0.1, default: 3 },
  { key: 'snareStep', label: 'Snare Step (deg)', min: -10, max: 10, step: 0.1, default: 2 },
  { key: 'speed', label: 'Speed', min: 0.5, max: 8, step: 0.1, default: 2 },
  { key: 'dotSize', label: 'Dot Size', min: 0.5, max: 8, step: 0.5, default: 2 },
  { key: 'lineOpacity', label: 'Line Opacity', min: 0.02, max: 0.6, step: 0.02, default: 0.2 },
  { key: 'fgMultiplier', label: 'FG Multiplier', min: 0.1, max: 10, step: 0.1, default: 1 },
  { key: 'bgMultiplier', label: 'BG Multiplier', min: 0.1, max: 20, step: 0.1, default: 4 },
  { key: 'bgRotateRate', label: 'BG Rotate/Beat', min: 0, max: 2, step: 0.05, default: 0.5 },
]
export const metronomeBallsInstrument: ObjectInstrumentDef = {
  id: 'metronomeBalls',
  name: 'Metronome Balls',
  kind: 'object',
  identityColor: '#f59e0b',
  userInterfaceRenderer: 'metronomeBalls',
  params: PARAMS,
  midiRows: [
    { pitch: PITCH_FG, label: 'Evolve pattern · foreground', emphasized: true },
    { pitch: PITCH_BG, label: 'Evolve + rotate · background flower' },
    { pitch: PITCH_INVERT, label: 'Invert · swap ink and paper' },
    { pitch: PITCH_PAL_SEPIA, label: 'Palette · Sepia (toggle)', color: '#8b5e34' },
    { pitch: PITCH_PAL_MIDNIGHT, label: 'Palette · Midnight (toggle)', color: '#d4a847' },
    { pitch: PITCH_PAL_BOTANICAL, label: 'Palette · Botanical (toggle)', color: '#2d4a3e' },
    { pitch: PITCH_PAL_PLUM, label: 'Palette · Plum (toggle)', color: '#c25a7c' },
    { pitch: PITCH_PAL_CRIMSON, label: 'Palette · Crimson (toggle)', color: '#dc143c' },
    { pitch: PITCH_PAL_SCARLET, label: 'Palette · Scarlet (toggle)', color: '#8b0000' },
  ],
  component: lazyInstrument(() => import('./MetronomeBallsVisual').then((m) => m.MetronomeBallsVisual)),
  fullFrame: true,
}
