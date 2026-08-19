import {
  MAX_ARMS, MAX_BEADS, MAX_DROPLETS,
  WATER_DROP_LEVELS, WATER_DROP_PITCH_MIN,
} from './waterDropCore'
import type { MidiRowDef, ObjectInstrumentDef, ParamDef } from './types'
import { lazyInstrument } from './lazyInstrument'

// Water Drop: each note is a drop of ink released into still water.
//
// The gesture is *release then diffuse*, not *explode*: a compact bead appears,
// throws a crown of tendrils outward, and the tendrils curl, thin, and dissolve.
// Particle Burst already owns "explode"; this one is deliberately slower and
// wetter, and its silhouette is a filled organic blob rather than a dust cloud.
//
// PITCH IS ALTITUDE. Eleven rows, one per height, spread evenly over
// `heightSpan` - so a rising line in the piano roll is a rising line on stage
// and the track plays like a vertical instrument. Nothing else about the drop
// changes with pitch; velocity owns size and density instead.
//
// The blob is a cluster of overlapping soft discs (see makeInkTexture): no
// silhouette of their own, so neighbours dissolve into one continuous mass with
// a wobbly outline - the edge quality liquid has. A raymarched SDF would be
// prettier and far more expensive for something that has to run 10 at a time.
//
// Everything is derived fresh from the note stream each frame (age = beats
// since onset), so there is no spawn-time state and scrub == playback.

// The "which drops exist, and how high" half lives in ./waterDropCore so it can
// be tested without dragging the engine in through `instrumentFrame`.
//
// The visual itself lives in ./WaterDropVisual (lazy: fetched when a project
// mounts a water drop); this file is the def - params, rows, and nothing heavy.

const PARAMS: ParamDef[] = [
  { key: 'color', label: 'Ink', type: 'color', default: '#2f8fff' },
  { key: 'tipColor', label: 'Tendril Tips', type: 'color', default: '#bff3ff' },
  // Defaults are sized for the editor's default camera (z = 5, 55° fov, so
  // roughly 5 world units of visible height at the origin): the ladder fits
  // inside the frame and one drop reads as an object, not as weather.
  { key: 'heightSpan', label: 'Pitch Height Span', min: 0, max: 20, step: 0.25, default: 3.6 },
  { key: 'dropSize', label: 'Drop Size', min: 0.02, max: 1, step: 0.01, default: 0.09 },
  { key: 'spread', label: 'Spread', min: 0.2, max: 8, step: 0.1, default: 1.1 },
  { key: 'lifetime', label: 'Lifetime (s)', min: 0.5, max: 12, step: 0.25, default: 3 },
  { key: 'arms', label: 'Tendrils', min: 3, max: MAX_ARMS, step: 1, default: 12 },
  { key: 'beads', label: 'Tendril Length', min: 1, max: MAX_BEADS, step: 1, default: 5 },
  { key: 'wobble', label: 'Curl', min: 0, max: 2, step: 0.05, default: 0.9 },
  { key: 'droplets', label: 'Droplets', min: 0, max: MAX_DROPLETS, step: 1, default: 6 },
  { key: 'drift', label: 'Drift', min: -4, max: 4, step: 0.1, default: 0.35 },
  { key: 'scatter', label: 'Scatter', min: 0, max: 8, step: 0.1, default: 0.7 },
  { key: 'fadePower', label: 'Fade', min: 0.3, max: 3, step: 0.05, default: 1.3 },
  { key: 'density', label: 'Density', min: 0.05, max: 1, step: 0.01, default: 0.4 },
]

// Eleven rows, top of the list = top of the stage. The color ramp is the same
// deep-to-shallow read a body of water has, so the piano roll shows altitude
// before you read a single label.
const ROW_COLORS = [
  '#1e3a8a', '#1b4bab', '#185ec7', '#1471dd', '#1084ea', '#0b97f0',
  '#0aa9ef', '#17bbea', '#35cce4', '#62dbe2', '#9aeae6',
]

const WATER_DROP_ROWS: MidiRowDef[] = Array.from({ length: WATER_DROP_LEVELS }, (_, i) => {
  const level = WATER_DROP_LEVELS - 1 - i  // first entry renders at the top
  return {
    pitch: WATER_DROP_PITCH_MIN + level,
    label: level === WATER_DROP_LEVELS - 1
      ? 'Drop · height 11 (top)'
      : level === 0
        ? 'Drop · height 1 (bottom)'
        : `Drop · height ${level + 1}`,
    color: ROW_COLORS[level],
    emphasized: level === 0,
  }
})

export const waterDropInstrument: ObjectInstrumentDef = {
  id: 'waterDrop',
  name: 'Water Drop',
  kind: 'object',
  identityColor: { param: 'color' },
  params: PARAMS,
  userInterfaceRenderer: 'parameters',
  midiRows: WATER_DROP_ROWS,
  component: lazyInstrument(() => import('./WaterDropVisual').then((m) => m.WaterDropVisual)),
}
