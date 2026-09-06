import type { ObjectInstrumentDef, ParamDef } from './types'
import { lazyInstrument } from './lazyInstrument'

// RETRO ARCADE - chunky 8-bit detonations. Every note is an explosion of square
// particles that fly out along 16 quantized directions and SNAP to a pixel grid
// (positions rounded to pixelSize), shrinking in three discrete chunk-steps and
// blinking out at the end - pure sprite-sheet energy. Pitch → position: pitch
// class picks the X column (12 lanes across spreadX), octave picks the Y band.
// Velocity → size and particle count. The palette cycles per pitch class through
// six baked retro palettes. Everything is derived per frame from note age
// (state.beat - note.beat), seeded per particle - scrub == playback.

// Six PICO-8-ish palettes; palette index = (pitch % 12) % 6.
// Exported for the settings UI's palette reference strip (presentation only).
export const PALETTES: string[][] = [
  ['#ff004d', '#ff77a8', '#ffccaa', '#fff1e8'],
  ['#ffa300', '#ffec27', '#ff6c24', '#fff1e8'],
  ['#00e436', '#a8e72e', '#eaffd0', '#008751'],
  ['#29adff', '#00ffff', '#c7f0ff', '#5f9df7'],
  ['#b26bff', '#ff77a8', '#e6c9ff', '#7e2553'],
  ['#fff1e8', '#c2c3c7', '#ffec27', '#83769c'],
]

const PARAMS: ParamDef[] = [
  { key: 'life', label: 'Blast Life (s)', min: 0.3, max: 2.5, step: 0.05, default: 0.9 },
  { key: 'pixelSize', label: 'Pixel Grid', min: 0.05, max: 0.4, step: 0.01, default: 0.12 },
  { key: 'speed', label: 'Blast Speed', min: 0.5, max: 10, step: 0.25, default: 3 },
  { key: 'count', label: 'Particles', min: 6, max: 48, step: 1, default: 24 },
  { key: 'spreadX', label: 'X Spread', min: 1, max: 10, step: 0.25, default: 4.5 },
  { key: 'spreadY', label: 'Octave Y Step', min: 0, max: 3, step: 0.1, default: 1.1 },
  { key: 'gravity', label: 'Gravity', min: 0, max: 5, step: 0.1, default: 1.2 },
  { key: 'flashScale', label: 'Core Flash Size', min: 0, max: 4, step: 0.1, default: 1.4 },
  { key: 'sizeScale', label: 'Chunk Size', min: 0.4, max: 3, step: 0.1, default: 1 },
  { key: 'blinkOut', label: 'Blink Out', type: 'boolean', default: 1 },
]

export const pixelBlastInstrument: ObjectInstrumentDef = {
  id: 'pixelBlast',
  name: 'Pixel Blast',
  kind: 'object',
  identityColor: '#ff3d81',
  userInterfaceRenderer: 'pixelBlast',
  params: PARAMS,
  // Pitch class = X column (0 far left … 11 far right), octave = Y band
  // (higher octave explodes higher). Velocity = blast size + particle count.
  midiRows: [
    { pitch: 95, label: 'Explode · top right' },
    { pitch: 89, label: 'Explode · top center' },
    { pitch: 84, label: 'Explode · top left' },
    { pitch: 71, label: 'Explode · mid right' },
    { pitch: 66, label: 'Explode · center screen', emphasized: true },
    { pitch: 60, label: 'Explode · mid left' },
    { pitch: 47, label: 'Explode · bottom right' },
    { pitch: 41, label: 'Explode · bottom center' },
    { pitch: 36, label: 'Explode · bottom left' },
  ],
  component: lazyInstrument(() => import('./PixelBlastVisual').then((m) => m.PixelBlastVisual)),
}
