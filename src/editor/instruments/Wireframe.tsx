import { paramDefault, type ObjectInstrumentDef } from './types'
import { lazyInstrument } from './lazyInstrument'
import { WIREFRAME_DEFAULT_SHAPE, WIREFRAME_SHAPES } from './wireframeCore'

// The Wireframe def - params, rows, transform. The visual itself lives in
// ./WireframeVisual (lazy: fetched when a project mounts a wireframe), and
// the pure shape catalog + geometry in ./wireframeCore.

export const DEFAULT_COLOR = '#7dd3fc'

export const wireframeInstrument: ObjectInstrumentDef = {
  id: 'wireframe',
  name: 'Wireframe',
  kind: 'object',
  userInterfaceRenderer: 'wireframe',
  params: [
    {
      key: 'shape', label: 'Shape', type: 'select', default: WIREFRAME_DEFAULT_SHAPE,
      options: WIREFRAME_SHAPES.map((shape, index) => ({ value: index, label: shape.name })),
    },
    { key: 'color', label: 'Color', type: 'color', default: DEFAULT_COLOR },
    { key: 'size', label: 'Size', min: 0.05, max: 8, step: 0.01, curve: 2, default: 1 },
    { key: 'glow', label: 'Glow', min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: 'weight', label: 'Weight', min: 0.5, max: 6, step: 0.1, default: 1.5 },
    { key: 'detail', label: 'Detail', min: 0, max: 1, step: 0.01, default: 0.8 },
    { key: 'spin', label: 'Spin', min: -1, max: 1, step: 0.01, default: 0.25 },
  ],
  midiRows: [
    { pitch: 76, label: 'Pulse · max', emphasized: true },
    { pitch: 68, label: 'Pulse · strong' },
    { pitch: 60, label: 'Pulse · medium' },
    { pitch: 52, label: 'Pulse · soft' },
    { pitch: 44, label: 'Pulse · gentle' },
    { pitch: 36, label: 'Pulse · faint' },
  ],
  // SIZE is the instance's own scale (a mesh property - movers and children
  // keep working in unscaled units); notes swell it via the energy pulse.
  localTransform: ({ params, energy }) => ({
    scale: (params.size ?? paramDefault(wireframeInstrument, 'size')) * (1 + energy * 0.18),
  }),
  component: lazyInstrument(() => import('./WireframeVisual').then((m) => m.Wireframe)),
}
