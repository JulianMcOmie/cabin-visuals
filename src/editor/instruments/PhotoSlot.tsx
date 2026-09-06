import type { ObjectInstrumentDef, ParamDef } from './types'
import { lazyInstrument } from './lazyInstrument'

// PHOTO SLOT - one placeholder slot of a paper-card edit template (the Crazy
// Edit deconstruction). A slot is a rectangular region of the frame that shows
// ONE photo from the track's photo bank at a time: a note-on cuts to photo
// (pitch - 48) mod bankSize, exactly like the Photo instrument. Until the user
// fills the bank, the slot renders its PLACEHOLDER instead - a solid color
// from the palette param (picked by the same pitch) with the slot's label
// painted on top, which is precisely what an unfilled template looks like in
// the wild ('background pictures "37"', 'Character "spiderman"', ...).
//
// Region (x/y/w/h/rot) are ordinary automatable params, so a template can
// grow, shrink and tilt a slot over time with automation lanes the user can
// see and edit. The counter in the counter label style is the running sum of
// note velocities inside the current block - each note advances the picture
// AND ticks the counter by its velocity, a pure function of (beat, notes).

export const STYLE_COUNTER = 0
export const STYLE_CAPS = 1
export const STYLE_ARCS = 2
export const STYLE_VERTICAL = 3
export const STYLE_TITLE = 4
export const STYLE_PLAIN = 5
export const STYLE_NONE = 6

export const BORDER_NONE = 0
export const BORDER_CORNER_ARCS = 1
export const BORDER_WAVY = 2
export const BORDER_RAYS = 3

const PARAMS: ParamDef[] = [
  { key: 'x', label: 'Center X', min: -0.25, max: 1.25, step: 0.001, default: 0.5 },
  { key: 'y', label: 'Center Y', min: -0.25, max: 1.25, step: 0.001, default: 0.5 },
  { key: 'w', label: 'Width', min: 0, max: 1.5, step: 0.001, default: 1 },
  { key: 'h', label: 'Height', min: 0, max: 1.5, step: 0.001, default: 1 },
  { key: 'rot', label: 'Tilt', min: -60, max: 60, step: 0.1, default: 0 },
  { key: 'wobble', label: 'Paper Wobble', min: 0, max: 1, step: 0.05, default: 0.35 },
  { key: 'layer', label: 'Layer', min: 0, max: 20, step: 1, default: 5 },
  {
    key: 'labelStyle', label: 'Label Style', type: 'select',
    options: [
      { value: STYLE_COUNTER, label: 'Counter (label "N")' },
      { value: STYLE_CAPS, label: 'Caps lines' },
      { value: STYLE_ARCS, label: 'Arched top + bottom' },
      { value: STYLE_VERTICAL, label: 'Vertical (banner)' },
      { value: STYLE_TITLE, label: 'Blurred title' },
      { value: STYLE_PLAIN, label: 'Plain lines' },
      { value: STYLE_NONE, label: 'None' },
    ],
    default: STYLE_COUNTER,
  },
  { key: 'labelSize', label: 'Label Size', min: 0.02, max: 0.6, step: 0.005, default: 0.105 },
  { key: 'labelX', label: 'Label X', min: 0, max: 1, step: 0.005, default: 0.5 },
  { key: 'labelY', label: 'Label Y', min: 0, max: 1, step: 0.005, default: 0.5 },
  {
    key: 'borderStyle', label: 'Border', type: 'select',
    options: [
      { value: BORDER_NONE, label: 'None' },
      { value: BORDER_CORNER_ARCS, label: 'White corner arcs' },
      { value: BORDER_WAVY, label: 'Wavy band edges' },
      { value: BORDER_RAYS, label: 'Radial rays' },
    ],
    default: BORDER_NONE,
  },
  {
    key: 'hold', label: 'Hold', type: 'select',
    options: [
      { value: 0, label: 'Gate (note length)' },
      { value: 1, label: 'Latch (until next note)' },
    ],
    default: 0,
  },
  // 'alpha', not 'opacity': the envelope system reserves the 'opacity' target
  // for object visibility, so an automation lane needs a distinct key.
  { key: 'alpha', label: 'Opacity', min: 0, max: 1, step: 0.01, default: 1 },
  { key: 'label', label: 'Label', type: 'string', default: '' },
  { key: 'palette', label: 'Placeholder Palette', type: 'string', default: '#d8f4f0' },
  { key: 'textColor', label: 'Label Color', type: 'color', default: '#141414' },
]

export const photoSlotInstrument: ObjectInstrumentDef = {
  id: 'photoSlot',
  name: 'Photo Slot',
  kind: 'object',
  identityColor: '#eab308',
  userInterfaceRenderer: 'photo',
  params: PARAMS,
  component: lazyInstrument(() => import('./PhotoSlotVisual').then((m) => m.PhotoSlotVisual)),
  fullFrame: true,
  defaultOnTop: true,
}
