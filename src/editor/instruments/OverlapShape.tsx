import { OVERLAP_SHAPE_OPTIONS } from './overlapShapeCore'
import { lazyInstrument } from './lazyInstrument'
import type { MidiRowDef, ObjectInstrumentDef, ParamDef } from './types'

// OVERLAP SHAPE - a flat 2D shape standing in 3D space, painted one pure color.
// Wherever copies of it cross IN THE SAME PLANE (equal depth from the camera -
// splitter copies, mover-driven passes, even another Overlap Shape track), the
// overlap region flips: a clean cutout to whatever is behind, or a second
// picked color. Shapes at different depths just occlude like any solid.
//
// The whole mechanism is the five-pass stencil recipe in overlapShapeCore.ts
// (see the essay there); ./OverlapShapeVisual (lazy: fetched when a project
// mounts the instrument) maps that pure spec onto three.js materials - a
// per-copy path and an instanced one. It depends on the scene render target
// carrying a stencil buffer (VisualScene / ShaderWrapper enable one); on a
// context without stencil it degrades to a plain single-color shape.

export const DEFAULT_OVERLAP_SHAPE_BASE_COLOR = '#ff5470'
export const DEFAULT_OVERLAP_SHAPE_OVERLAP_COLOR = '#2dd4bf'

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
