import { specInstrument } from './specInstrument'
import type { MidiRowDef, ParamDef } from './types'
import type { Primitive } from '../core/visual/renderSpec'

// Basic shapes share the Cube's params/ports so they respond to the same
// modulators - the only difference between them is the geometry primitive. Their whole
// behaviour lives in the RenderSpec (as data), not a hand-written component.
const SHAPE_PARAMS: ParamDef[] = [
  { key: 'baseSize', label: 'Base Size', min: 0.2, max: 4, step: 0.05, default: 1.6 },
  { key: 'baseHue', label: 'Base Color', min: 0, max: 360, step: 1, default: 240 },
  { key: 'baseXPosition', label: 'Base X Position', min: -10, max: 10, step: 0.1, default: 0 },
  { key: 'baseYPosition', label: 'Base Y Position', min: -10, max: 10, step: 0.1, default: 0 },
  { key: 'baseZPosition', label: 'Base Z Position', min: -10, max: 10, step: 0.1, default: 0 },
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

function basicShape(id: string, name: string, primitive: Primitive) {
  return specInstrument({
    id,
    name,
    params: SHAPE_PARAMS,
    midiRows: SHAPE_MIDI_ROWS,
    spec: {
      primitive,
      transform: {
        position: ['param.baseXPosition', 'param.baseYPosition', 'param.baseZPosition'],
        rotation: ['beat * 0.09', 'beat * 0.22', '0'],
        // Static base size, plus note energy and the explicit `scale` port.
        scale: '(param.baseSize / 1.6) * (1 + port.energy * 0.35 + port.scale)',
      },
      appearance: {
        hue: 'param.baseHue + port.hue * 60',
        emissive: '0.2 + port.energy * 1.2',
      },
    },
  })
}

export const circleInstrument = basicShape('circle', 'Circle', 'sphere')
export const triangleInstrument = basicShape('triangle', 'Triangle', 'tetrahedron')
