import type { ObjectInstrumentDef, ParamDef } from './types'
import { lazyInstrument } from './lazyInstrument'

// SILENT FILM - the "degraded film stock" pair for the Silent Film lyric
// template (docs/lyric-template-silent-film.md). Two instruments share this
// file because the aesthetic needs both sides of the text:
//
//   Film Stock  - the projected-stock BACKGROUND: tinted charcoal base, faint
//                 graph grid, coarse grain, dust/hairs, a wandering scratch,
//                 luminance flicker, vignette and barrel warp.
//   Film Grain  - the degradation OVERLAY: the same wear on a transparent
//                 plane that composites OVER everything (defaultOnTop + a high
//                 renderOrder), so text and background degrade together - that
//                 shared wear is what welds the frame into one piece of film.
//
// BOTH ARE PURE GPU. Every mark is evaluated per-pixel in a fragment shader
// from a handful of scalar uniforms, so a frame costs no CPU rasterization and
// no texture upload at all - only uniform writes. That is what makes stacking
// them (plus Scribble and Film Card) affordable in playback and export alike;
// the canvas implementation they replaced was the template's bottleneck.
//
// The pause invariant survives the move to the GPU: the shaders are given a
// QUANTIZED beat-time frame index (24fps, film cadence) and derive every
// "random" value from hashes of that index plus screen position. Same beat in,
// same pixels out - scrub still equals playback, and export still matches
// preview.

// ---------------------------------------------------------------------------
// Film Stock - the background.
// ---------------------------------------------------------------------------

const STOCK_PARAMS: ParamDef[] = [
  { key: 'baseColor', label: 'Stock Color', type: 'color', default: '#1a171b' },
  { key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.05, default: 0.55 },
  { key: 'grainSize', label: 'Grain Size', min: 1, max: 4, step: 1, default: 2 },
  { key: 'dust', label: 'Dust', min: 0, max: 1, step: 0.05, default: 0.5 },
  { key: 'scratch', label: 'Wandering Scratch', min: 0, max: 1, step: 0.05, default: 0.5 },
  { key: 'grid', label: 'Graph Grid', min: 0, max: 1, step: 0.05, default: 0.25 },
  { key: 'flicker', label: 'Flicker', min: 0, max: 1, step: 0.05, default: 0.35 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.05, default: 0.65 },
  { key: 'warp', label: 'Barrel Warp', min: 0, max: 1, step: 0.05, default: 0.2 },
  { key: 'flashColor', label: 'Burn Flash Color', type: 'color', default: '#ffe3b8' },
  { key: 'flashDur', label: 'Flash Fade (s)', min: 0.1, max: 2, step: 0.05, default: 0.5 },
]

export const filmStockInstrument: ObjectInstrumentDef = {
  id: 'filmStock',
  name: 'Film Stock',
  kind: 'object',
  identityColor: { param: 'flashColor' },
  userInterfaceRenderer: 'parameters',
  params: STOCK_PARAMS,
  midiRows: [
    { pitch: 64, label: 'Scratch streak', color: '#cccccc', emphasized: true },
    { pitch: 60, label: 'Burn flash', color: '#f0b41c' },
  ],
  component: lazyInstrument(() => import('./FilmStockVisual').then((m) => m.FilmStockVisual)),
  fullFrame: true,
}

// ---------------------------------------------------------------------------
// Film Grain - the on-top degradation overlay.
// ---------------------------------------------------------------------------

const GRAIN_PARAMS: ParamDef[] = [
  { key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.05, default: 0.35 },
  { key: 'grainSize', label: 'Grain Size', min: 1, max: 4, step: 1, default: 2 },
  { key: 'dust', label: 'Dust', min: 0, max: 1, step: 0.05, default: 0.3 },
  // Constant analog-static level; the Static burst MIDI row adds on top.
  { key: 'static', label: 'Static', min: 0, max: 1, step: 0.05, default: 0 },
  { key: 'staticSize', label: 'Static Size', min: 0.5, max: 3, step: 0.05, default: 1, showIf: 'static' },
  { key: 'staticStreak', label: 'Static Streak Length', min: 0, max: 1, step: 0.05, default: 0.6, showIf: 'static' },
  { key: 'flicker', label: 'Flicker', min: 0, max: 1, step: 0.05, default: 0.35 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.05, default: 0.55 },
  { key: 'warp', label: 'Barrel Warp', min: 0, max: 1, step: 0.05, default: 0.2 },
]

export const filmGrainInstrument: ObjectInstrumentDef = {
  id: 'filmGrain',
  name: 'Film Grain',
  kind: 'object',
  identityColor: '#c9a86b',
  userInterfaceRenderer: 'parameters',
  params: GRAIN_PARAMS,
  midiRows: [
    { pitch: 62, label: 'Flicker pop', color: '#ffffff', emphasized: true },
    { pitch: 60, label: 'Dust burst', color: '#e8e4da' },
    { pitch: 56, label: 'Static burst (held)', color: '#9aa3b5' },
  ],
  component: lazyInstrument(() => import('./FilmStockVisual').then((m) => m.FilmGrainVisual)),
  fullFrame: true,
  defaultOnTop: true,
}
