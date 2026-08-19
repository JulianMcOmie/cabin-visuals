import type { ObjectInstrumentDef, ParamDef } from './types'
import { lazyInstrument } from './lazyInstrument'

// SCRIBBLE - glowing hand-drawn pen strokes for the Silent Film lyric template
// (docs/lyric-template-silent-film.md): the underline swoosh, lasso loop,
// S-flourish and circled-word marks that punctuate big lyric moments. Each
// note draws one stroke on: the path reveals over `drawTime`, holds while the
// note sounds, and fades over `fadeTime` after release. Pitch picks the path
// preset; position and wobble are seeded from the note, so every stroke is a
// pure function of the beat (scrub == playback) while no two look alike.
// Full-frame canvas plane (CrtScanlines' plumbing), transparent, on top.
//
// The visual itself lives in ./ScribbleVisual (lazy: fetched when a project
// mounts a scribble); this file is the def - params, rows, and nothing heavy.

export const PITCH_SWOOSH = 60
export const PITCH_LOOP = 62
export const PITCH_FLOURISH = 64
export const PITCH_CIRCLE = 66

const PARAMS: ParamDef[] = [
  { key: 'color', label: 'Ink Color', type: 'color', default: '#87dcfb' },
  { key: 'size', label: 'Stroke Size', min: 0.2, max: 1, step: 0.05, default: 0.55 },
  { key: 'lineWidth', label: 'Line Width', min: 0.2, max: 2, step: 0.1, default: 0.8 },
  { key: 'glow', label: 'Glow', min: 0, max: 1, step: 0.05, default: 0.7 },
  { key: 'wobble', label: 'Hand Wobble', min: 0, max: 1, step: 0.05, default: 0.5 },
  { key: 'drawTime', label: 'Draw-on (s)', min: 0.1, max: 1.5, step: 0.05, default: 0.4 },
  { key: 'fadeTime', label: 'Fade (s)', min: 0.1, max: 2, step: 0.05, default: 0.6 },
]

export const scribbleInstrument: ObjectInstrumentDef = {
  id: 'scribble',
  name: 'Scribble',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  params: PARAMS,
  midiRows: [
    { pitch: PITCH_SWOOSH, label: 'Underline swoosh', color: '#87dcfb', emphasized: true },
    { pitch: PITCH_LOOP, label: 'Lasso loop', color: '#87dcfb' },
    { pitch: PITCH_FLOURISH, label: 'S flourish', color: '#c261d0' },
    { pitch: PITCH_CIRCLE, label: 'Circle', color: '#c261d0' },
  ],
  component: lazyInstrument(() => import('./ScribbleVisual').then((m) => m.ScribbleVisual)),
  fullFrame: true,
  defaultOnTop: true,
}
