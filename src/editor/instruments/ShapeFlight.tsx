import type { ObjectInstrumentDef, ParamDef } from './types'
import { lazyInstrument } from './lazyInstrument'

// Ported from Excellent DAW. Spirograph / polygon / polar shapes stream toward the camera
// during held notes, dissolving on arrival. Each note emits a train of copies (spawnRate
// copies per beat over its duration); depth = how long ago the copy played, so it's fully
// scrub-accurate. n.pitch picks the shape (edge count). Thick lines are drawn with a batched
// screen-space line shader - all copies in one BufferGeometry. Palette / automation lanes
// from Tyler's source are dropped. The geometry / flight / burst math is Tyler's verbatim.

const PARAMS: ParamDef[] = [
  { key: 'shapeMode', type: 'select', label: 'Shape Mode', options: [
    { value: 0, label: 'Spirograph' }, { value: 1, label: 'Polygon' }, { value: 2, label: 'Polar Graph' },
  ], default: 0 },
  { key: 'speed', label: 'Flight Speed', min: 2, max: 40, step: 1, default: 12 },
  { key: 'spawnRate', label: 'Copies per Beat', min: 1, max: 32, step: 1, default: 8 },
  { key: 'scale', label: 'Scale', min: 0.1, max: 5, step: 0.1, default: 1 },
  { key: 'rotationStep', label: 'Rotation Step', min: -1, max: 1, step: 0.01, default: 0.15 },
  { key: 'spread', label: 'Spread', min: 0, max: 10, step: 0.5, default: 0 },
  { key: 'farZ', label: 'Spawn Depth', min: 10, max: 100, step: 5, default: 40 },
  { key: 'shapeSize', label: 'Shape Size', min: 0.1, max: 2, step: 0.1, default: 0.4 },
  { key: 'fadeOutZ', label: 'Fade Out Distance', min: 2, max: 30, step: 1, default: 10 },
  { key: 'hueStep', label: 'Hue Step', min: 0, max: 0.5, step: 0.01, default: 0.08 },
  { key: 'baseHue', label: 'Base Hue', min: 0, max: 1, step: 0.05, default: 0.55 },
  { key: 'saturation', label: 'Saturation', min: 0, max: 1, step: 0.05, default: 1 },
  { key: 'lightness', label: 'Lightness', min: 0.1, max: 1, step: 0.05, default: 0.55 },
  { key: 'rBase', label: 'R Base', min: 0.05, max: 0.5, step: 0.01, default: 0.25 },
  { key: 'dBase', label: 'D Base', min: 0.1, max: 1.0, step: 0.05, default: 0.7 },
  { key: 'burstMode', type: 'select', label: 'Burst Mode', options: [
    { value: 0, label: 'Noisy (Random)' }, { value: 1, label: 'Linear Radial' },
    { value: 2, label: 'Spiral Out' }, { value: 3, label: 'Spiral In' },
  ], default: 0 },
  { key: 'burstRadius', label: 'Burst Radius', min: 0.5, max: 10, step: 0.5, default: 3 },
  { key: 'burstTwists', label: 'Burst Twists', min: 1, max: 12, step: 0.5, default: 4 },
  { key: 'curveX', label: 'Path Curve X', min: -20, max: 20, step: 0.5, default: 0 },
  { key: 'curveY', label: 'Path Curve Y', min: -20, max: 20, step: 0.5, default: 0 },
  { key: 'glowAmount', label: 'Glow Amount', min: 0, max: 5, step: 0.1, default: 1 },
  { key: 'approachGrowth', label: 'Approach Growth', min: 0, max: 20, step: 0.5, default: 0 },
  { key: 'lineWidth', label: 'Line Width', min: 1, max: 100, step: 0.5, default: 6 },
]
export const shapeFlightInstrument: ObjectInstrumentDef = {
  id: 'shapeFlight',
  name: 'Shape Flight',
  kind: 'object',
  identityColor: '#38bdf8',
  userInterfaceRenderer: 'shapeFlight',
  params: PARAMS,
  midiRows: [
    { pitch: 64, label: 'Stream shape · 19 points (intricate)' },
    { pitch: 62, label: 'Stream shape · 17 points' },
    { pitch: 60, label: 'Stream shape · 15 points' },
    { pitch: 59, label: 'Stream shape · 14 points' },
    { pitch: 57, label: 'Stream shape · 12 points' },
    { pitch: 55, label: 'Stream shape · 10 points' },
    { pitch: 52, label: 'Stream shape · 7 points' },
    { pitch: 48, label: 'Stream shape · 3 points (simplest)' },
  ],
  component: lazyInstrument(() => import('./ShapeFlightVisual').then((m) => m.ShapeFlightVisual)),
}
