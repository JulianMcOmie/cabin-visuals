import type { ObjectInstrumentDef, ParamDef } from './types'
import { lazyInstrument } from './lazyInstrument'

// FILM CARD - the Silent Film template's bookend cards
// (docs/lyric-template-silent-film.md), one instrument, two modes:
//
//   Intro Paper - a cold-cream graph-paper "playlist page": faint blurred
//                 list lines behind, the featured name in a hand-drawn ink box
//                 over an olive highlighter smear.
//   Title Outro - the song title in glowing Didone caps + a smaller artist
//                 line, over a seeded waveform of vertical bars that pulses
//                 with the track's note energy. Transparent - the Film Stock
//                 background shows through.
//
// Playfair Display is lazy-loaded (core/visual/fonts.ts); the frame callback
// returns false until it's usable so no frame ever renders the fallback face.
// All wobble/jitter derives from beat-time windows - scrub == playback.

const PARAMS: ParamDef[] = [
  {
    key: 'mode', label: 'Card', type: 'select', default: 0, options: [
      { value: 0, label: 'Intro Paper' },
      { value: 1, label: 'Title Outro' },
    ],
  },
  { key: 'title', label: 'Title', type: 'string', default: 'ARTIST NAME' },
  { key: 'subtitle', label: 'Subtitle', type: 'string', default: 'Song Title' },
  { key: 'listText', label: 'Backdrop Lines', type: 'string', multiline: true, default: 'FOLLOW ME\nFOR MORE\nLYRIC VIDEOS' },
  { key: 'paperColor', label: 'Paper', type: 'color', default: '#b5d9cc' },
  { key: 'inkColor', label: 'Ink', type: 'color', default: '#303820' },
  { key: 'highlightColor', label: 'Highlighter', type: 'color', default: '#b3c06d' },
  { key: 'textColor', label: 'Outro Text', type: 'color', default: '#fdfbfe' },
  { key: 'glow', label: 'Outro Glow', min: 0, max: 1, step: 0.05, default: 0.6, showIf: 'mode' },
  { key: 'waveHeight', label: 'Waveform Height', min: 0, max: 1, step: 0.05, default: 0.5, showIf: 'mode' },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.05, default: 0.5 },
  { key: 'jitterAmount', label: 'Frame Jitter', min: 0, max: 1, step: 0.05, default: 0.5 },
]

export const filmCardInstrument: ObjectInstrumentDef = {
  id: 'filmCard',
  name: 'Film Card',
  kind: 'object',
  identityColor: { param: 'paperColor' },
  userInterfaceRenderer: 'parameters',
  params: PARAMS,
  midiRows: [
    { pitch: 60, label: 'Flash / pulse', color: '#fdfbfe', emphasized: true },
  ],
  component: lazyInstrument(() => import('./FilmCardVisual').then((m) => m.FilmCardVisual)),
  fullFrame: true,
  defaultOnTop: true,
}
