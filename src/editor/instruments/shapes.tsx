import { specInstrument } from './specInstrument'
import type { ParamDef, PortDef } from './types'
import type { Primitive } from '../core/visual/renderSpec'

// Basic shapes share the Cube's params/ports so they self-pulse and respond to the same
// modulators — the only difference between them is the geometry primitive. Their whole
// behaviour lives in the RenderSpec (as data), not a hand-written component.
const SHAPE_PARAMS: ParamDef[] = [
  { key: 'baseSize', label: 'Base Size', min: 0.2, max: 4, step: 0.05, default: 1.6 },
  { key: 'baseHue', label: 'Base Color', min: 0, max: 360, step: 1, default: 240 },
  { key: 'baseXPosition', label: 'Base X Position', min: -10, max: 10, step: 0.1, default: 0 },
  { key: 'baseYPosition', label: 'Base Y Position', min: -10, max: 10, step: 0.1, default: 0 },
  { key: 'baseZPosition', label: 'Base Z Position', min: -10, max: 10, step: 0.1, default: 0 },
]

const SHAPE_PORTS: PortDef[] = [
  { key: 'energy', label: 'Energy', combine: 'add', default: 0 },
  { key: 'scale', label: 'Scale', combine: 'add', default: 0 },
  { key: 'hue', label: 'Hue', combine: 'add', default: 0 },
]

function basicShape(id: string, name: string, primitive: Primitive) {
  return specInstrument({
    id,
    name,
    params: SHAPE_PARAMS,
    ports: SHAPE_PORTS,
    spec: {
      primitive,
      transform: {
        position: ['param.baseXPosition', 'param.baseYPosition', 'param.baseZPosition'],
        rotation: ['beat * 0.09', 'beat * 0.22', '0'],
        // breathe × energy pulse (matches the Cube), plus the `scale` port for headroom.
        scale: '(param.baseSize / 1.6) * (1.15 + sin(beat * 0.9) * 0.2) * (1 + port.energy * 0.35 + port.scale)',
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
