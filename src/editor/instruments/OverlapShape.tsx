import {
  OVERLAP_MAX_ORDERS,
  OVERLAP_RAMP_GRADIENT,
  OVERLAP_RAMP_PER_DEPTH,
  OVERLAP_SHAPE_OPTIONS,
} from './overlapShapeCore'
import { lazyInstrument } from './lazyInstrument'
import type { MidiRowDef, ObjectInstrumentDef, ParamDef } from './types'

// OVERLAP SHAPE - a flat 2D shape standing in 3D space, painted one pure color.
// Wherever copies of it cross IN THE SAME PLANE (equal depth from the camera -
// splitter copies, mover-driven passes, even another Overlap Shape track), the
// overlap region flips: a clean cutout to whatever is behind, or a second
// picked color. Shapes at different depths just occlude like any solid.
//
// ORDERS is how many overlap colors that second one grows into. At 1 the rule
// is the parity flip it shipped with - odd coverage base, even coverage
// overlap, so three stacked shapes come back to the base color. Past 1 the
// instrument stops flipping and starts COUNTING: two crossing shapes wear the
// first overlap color, three the second, and coverage deeper than the last
// color HOLDS it. The two rules are different stencil recipes (parity inverts
// a bit; counting tallies a nibble), which is why 1 is not merely "the ramp
// with one stop" and why every project written before ORDERS existed renders
// exactly as it did.
//
// Those colors are a GRADIENT by default: two ends, and the depths in between
// are the OKLCH stops between them. Picking a color per depth is the other
// mode, kept for the looks a ramp cannot say - the point of the default is
// that "deeper = further along" is the thing you almost always mean, and it
// stays true when ORDERS changes, where four hand-picked colors have to be
// re-dialled. The ramp deliberately starts at the FIRST OVERLAP color rather
// than the shape's own: running it from the base would make two crossing
// shapes nearly the color of one.
//
// The whole mechanism is the five-pass stencil recipe in overlapShapeCore.ts
// (see the essay there); ./OverlapShapeVisual (lazy: fetched when a project
// mounts the instrument) maps that pure spec onto three.js materials - a
// per-copy path and an instanced one. It depends on the scene render target
// carrying a stencil buffer (VisualScene / ShaderWrapper enable one); on a
// context without stencil it degrades to a plain single-color shape.

export const DEFAULT_OVERLAP_SHAPE_BASE_COLOR = '#ff5470'
export const DEFAULT_OVERLAP_SHAPE_OVERLAP_COLOR = '#2dd4bf'
/** Depths 3, 4 and 5+, defaulted as a continuing walk (teal → blue → violet →
 *  a warm near-white), so raising ORDERS shows a ramp rather than four pills
 *  of the same teal that all have to be dialled before anything reads. */
export const DEFAULT_OVERLAP_SHAPE_DEEP_COLORS = ['#3b82f6', '#a855f7', '#fff1c9'] as const
/** The ramp's far end. Teal → violet travels enough hue that three or four
 *  stops are told apart at a glance, which is the whole job of the default. */
export const DEFAULT_OVERLAP_SHAPE_DEEP_COLOR = '#a855f7'

export const OVERLAP_MODE = { cutOut: 0, color: 1 } as const

const PARAMS: ParamDef[] = [
  {
    key: 'shape',
    label: 'Shape',
    type: 'select',
    options: OVERLAP_SHAPE_OPTIONS.map(({ value, label }) => ({ value, label })),
    default: 0,
  },
  { key: 'size', label: 'Size', min: 0.1, max: 6, step: 0.05, default: 1.2 },
  { key: 'pulse', label: 'Note Pulse', min: 0, max: 1, step: 0.01, default: 0.35 },
  { key: 'baseColor', label: 'Color', type: 'color', default: DEFAULT_OVERLAP_SHAPE_BASE_COLOR },
  {
    key: 'overlapMode',
    label: 'Overlap',
    type: 'select',
    options: [
      { value: OVERLAP_MODE.cutOut, label: 'Cut out' },
      { value: OVERLAP_MODE.color, label: 'Color' },
    ],
    default: OVERLAP_MODE.cutOut,
  },
  {
    key: 'overlapColor',
    label: 'Overlap Color',
    type: 'color',
    default: DEFAULT_OVERLAP_SHAPE_OVERLAP_COLOR,
    showIf: 'overlapMode=1',
  },
  // How many overlap colors deep the count goes. showIf pins it to Color mode
  // (cut-out has nothing to grade); the per-depth colors below can only gate
  // on the same mode - `showIf` compares against 0.5 or pins ONE select value,
  // so "orders >= 3" is not sayable - and the bespoke panel reveals them one
  // by one from the knob, exactly as Radial's RINGS reveals its own knobs.
  {
    key: 'overlapOrders',
    label: 'Orders',
    min: 1,
    max: OVERLAP_MAX_ORDERS,
    step: 1,
    default: 1,
    showIf: 'overlapMode=1',
  },
  // Gradient is the primary mode, so it is 0 and it is the default: a save
  // written before this (only possible since ORDERS shipped the same week)
  // reads as a ramp between its first overlap color and this deep default.
  {
    key: 'overlapColorMode',
    label: 'Overlap Colors',
    type: 'select' as const,
    options: [
      { value: OVERLAP_RAMP_GRADIENT, label: 'Gradient' },
      { value: OVERLAP_RAMP_PER_DEPTH, label: 'Per depth' },
    ],
    default: OVERLAP_RAMP_GRADIENT,
    showIf: 'overlapMode=1',
  },
  {
    key: 'overlapColorDeep',
    label: 'Deep Color',
    type: 'color' as const,
    default: DEFAULT_OVERLAP_SHAPE_DEEP_COLOR,
    showIf: 'overlapMode=1',
  },
  ...DEFAULT_OVERLAP_SHAPE_DEEP_COLORS.map((hex, i) => ({
    // Keyed by the coverage DEPTH they paint (overlapColor is depth 2), so a
    // key says what it colors: overlapColor3 is three shapes crossing.
    key: `overlapColor${i + 3}`,
    label: `${i + 3}× Color`,
    type: 'color' as const,
    default: hex,
    showIf: 'overlapMode=1',
  })),
]

// The basic-shapes pulse vocabulary: notes swell the shape, pitch = strength.
const MIDI_ROWS: MidiRowDef[] = [
  { pitch: 76, label: 'Pulse · max', emphasized: true },
  { pitch: 68, label: 'Pulse · strong' },
  { pitch: 60, label: 'Pulse · medium' },
  { pitch: 52, label: 'Pulse · soft' },
  { pitch: 44, label: 'Pulse · gentle' },
  { pitch: 36, label: 'Pulse · faint' },
]

export const overlapShapeInstrument: ObjectInstrumentDef = {
  id: 'overlapShape',
  name: 'Overlap Shape',
  kind: 'object',
  // Two color params, so the automatic single-color identity doesn't apply:
  // the track follows the shape's own fill.
  identityColor: { param: 'baseColor' },
  userInterfaceRenderer: 'overlapShape',
  params: PARAMS,
  midiRows: MIDI_ROWS,
  component: lazyInstrument(() => import('./OverlapShapeVisual').then((m) => m.OverlapShapeVisual)),
  instancedComponent: lazyInstrument(() => import('./OverlapShapeVisual').then((m) => m.OverlapShapeInstanced)),
}
