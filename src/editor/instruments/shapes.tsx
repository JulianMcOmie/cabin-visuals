import { BASIC_SHAPE_COLOR, basicShapeTransform, type BasicShape } from './basicShapeCore'
import { lazyInstrument } from './lazyInstrument'
import type { MidiRowDef, ObjectInstrumentDef, ParamDef } from './types'

const SHAPE_PARAMS: ParamDef[] = [
  { key: 'baseColor', label: 'Base Color', type: 'color', default: BASIC_SHAPE_COLOR },
]

// Notes drive the shared pulse envelope (scale swell + emissive glow);
// higher pitch = stronger pulse — the same vocabulary as the Cube.
const SHAPE_MIDI_ROWS: MidiRowDef[] = [
  { pitch: 76, label: 'Pulse · max', emphasized: true },
  { pitch: 68, label: 'Pulse · strong' },
  { pitch: 60, label: 'Pulse · medium' },
  { pitch: 52, label: 'Pulse · soft' },
  { pitch: 44, label: 'Pulse · gentle' },
  { pitch: 36, label: 'Pulse · faint' },
]

function basicShape(id: BasicShape, name: string): ObjectInstrumentDef {
  return {
    id,
    name,
    kind: 'object',
    castsShadows: true,
    userInterfaceRenderer: 'parameters',
    params: SHAPE_PARAMS,
    midiRows: SHAPE_MIDI_ROWS,
    localTransform: basicShapeTransform,
    component: lazyInstrument(() => import('./BasicShapeVisual').then((m) => id === 'circle' ? m.CircleVisual : m.TriangleVisual)),
  }
}

export const circleInstrument = basicShape('circle', 'Circle')
export const triangleInstrument = basicShape('triangle', 'Triangle')
