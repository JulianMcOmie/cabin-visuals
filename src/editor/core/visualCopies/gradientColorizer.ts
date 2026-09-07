// The Gradient: a PASSIVE colorizer. Drop it on any instrument and the copies
// wear a two-stop gradient - no notes, no envelope, no performance. It is the
// "fill" of this library: where the note Colorizer answers "what does this HIT
// look like", the Gradient answers "what does this FIELD look like".
//
// Ways to spread the ramp across copies, one select:
//  - DEPTH maps world Z between near and far.
//  - LINE / CURVE map distance along, or distance from, a world-space path.
//  - POSITION paints by where each copy sits in the world, like dragging a
//    linear gradient across a Figma frame: an axis (ANGLE), a length (SPAN),
//    and a center (OFFSET). Copies past either end clamp to the end colors,
//    exactly as a gradient fill pads past its stops.
//  - INDEX paints by each copy's index in the chain (first copy = start color,
//    last = end color), so a splitter's ordering IS the gradient's axis: a
//    Radial sweeps around the circle, a Tunnel recedes with depth, however the
//    copies land in space.
//
// The blend walks OKLCH, not sRGB: equal steps LOOK equal (a straight sRGB lerp
// between saturated hues sags through grey mud in the middle - the reason
// gradient tools grew "perceptual" modes). Hue takes the short way around and a
// grey endpoint borrows the other stop's hue, so black→red deepens instead of
// detouring through green.
//
// Each copy's sampled color travels as the ABSOLUTE `tint` channel (a gradient
// stop is "be this color", which relative HSL cannot say), so it composes with
// the note Colorizer the same way the rainbow does: the flash's later chain
// entry takes the tint over, and relative hue sweeps ride on top of the ramp.

import { Vector3 } from 'three'
import { buildGradientPath, sampleGradientPath, DEFAULT_GRADIENT_PATH } from './gradientPath'
import type { ParamDef } from '../../instruments/types'
import { gradientStops } from '../../utils/oklch'
import type { MoverOrSplitterDefinition } from './definitions'
import { GRADIENT_COLORIZER_COLOR } from './identityColors'
import { clamp01 } from '../../utils/math'

// The ramp itself lives in utils/oklch (a leaf module) so a second consumer
// can walk the same stops without importing this definition - and therefore
// three - into its bundle. Re-exported here because it is still THIS
// definition's ramp as far as its panel and its test are concerned.
export { gradientStops } from '../../utils/oklch'

export const GRADIENT_MODE_POSITION = 0
export const GRADIENT_MODE_INDEX = 1

export const GRADIENT_MODE_DEPTH = 2
export const GRADIENT_MODE_LINE = 3
export const GRADIENT_MODE_CURVE = 4

export interface GradientColorizerSettings {
  near?: number
  far?: number
  mapping?: number
  width?: number
  path?: string
  /** Persisted mode values: position 0, index 1, depth 2, line 3, curve 4. */
  mode: number
  /** How far toward the sampled gradient color each copy pulls, 0..1. */
  amount: number
  /** Position mode: the gradient axis in the XY plane, degrees CCW from +X
   *  (0 = left→right, 90 = bottom→top). Z is deliberately ignored, matching
   *  the note Colorizer's rainbow: layouts face the camera. */
  angle: number
  /** Position mode: world units from the start color to the end color. */
  span: number
  /** Position mode: world units the gradient's center slides along its axis. */
  offset: number
  /** 0 = A→B, 1 = B→A. Figma's flip button; mainly for INDEX mode, where
   *  there is no ANGLE to turn around. */
  flip: number
  /** The two stops, '#rrggbb'. */
  colorA: string
  colorB: string
}

const GRADIENT_PARAMS: ParamDef[] = [
  {
    key: 'mode',
    label: 'Apply by',
    type: 'select',
    options: [
      { value: GRADIENT_MODE_POSITION, label: 'Position' },
      { value: GRADIENT_MODE_DEPTH, label: 'Depth' },
      { value: GRADIENT_MODE_LINE, label: 'Line' },
      { value: GRADIENT_MODE_CURVE, label: 'Curve' },
      { value: GRADIENT_MODE_INDEX, label: 'Copy index' },
    ],
    default: GRADIENT_MODE_POSITION,
  },
  { key: 'near', label: 'Near Z', min: -40, max: 40, step: 0.1, default: 3 },
  { key: 'far', label: 'Far Z', min: -40, max: 40, step: 0.1, default: -3 },
  { key: 'mapping', label: 'Mapping', type: 'select', options: [{ value: 0, label: 'Along' }, { value: 1, label: 'Distance from' }], default: 0 },
  { key: 'width', label: 'Width', min: 0.01, max: 40, step: 0.1, default: 3 },
  { key: 'path', label: 'Path', type: 'string', default: DEFAULT_GRADIENT_PATH },
  { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 1 },
  { key: 'angle', label: 'Angle (°)', min: 0, max: 360, step: 1, default: 0 },
  { key: 'span', label: 'Span (units)', min: 0.25, max: 40, step: 0.25, default: 6, curve: 2 },
  { key: 'offset', label: 'Offset (units)', min: -20, max: 20, step: 0.1, default: 0 },
  {
    key: 'flip',
    label: 'Direction',
    type: 'select',
    options: [
      { value: 0, label: 'A → B' },
      { value: 1, label: 'B → A' },
    ],
    default: 0,
  },
  { key: 'colorA', label: 'Color A', type: 'color', default: '#4dd2ff' },
  { key: 'colorB', label: 'Color B', type: 'color', default: '#ff4d88' },
]

/** Below this chroma a color has no meaningful hue of its own (grey/black/
 *  white), so it adopts the other stop's hue instead of contributing an
 *  arbitrary one to the arc. */
/**
 * Where one copy sits on the ramp, 0..1 (0 = color A, 1 = color B).
 *
 * Position mode projects the copy's world XY onto the ANGLE axis and maps
 * [-SPAN/2, +SPAN/2] around OFFSET to the ramp; outside clamps to the ends,
 * the way a gradient fill pads past its stops. Index mode spreads the ramp
 * over the chain's copies; a single copy sits at the midpoint blend, which is
 * also what a one-copy field converges to in position mode as SPAN grows.
 */
export function gradientPosition(
  settings: GradientColorizerSettings,
  index: number,
  count: number,
  x: number,
  y: number,
  z = 0,
  path?: ReturnType<typeof buildGradientPath>,
): number {
  let t: number
  if (settings.mode === GRADIENT_MODE_INDEX) {
    t = count > 1 ? index / (count - 1) : 0.5
  } else if (settings.mode === GRADIENT_MODE_DEPTH) {
    const near = settings.near ?? 3
    const far = settings.far ?? -3
    t = Math.abs(far - near) < 1e-8 ? 0.5 : (z - near) / (far - near)
  } else if (settings.mode === GRADIENT_MODE_LINE || settings.mode === GRADIENT_MODE_CURVE) {
    t = sampleGradientPath(path ?? buildGradientPath(settings.path, settings.mode === GRADIENT_MODE_CURVE), x, y, z, settings.mapping === 1, settings.width ?? 3)
  } else {
    const radians = (settings.angle * Math.PI) / 180
    const projected = x * Math.cos(radians) + y * Math.sin(radians)
    t = 0.5 + (projected - settings.offset) / Math.max(0.001, settings.span)
  }
  if (settings.flip >= 0.5) t = 1 - t
  return clamp01(t)
}

/** Enough stops that neighbouring samples differ by under a hue degree or two -
 *  visually continuous - while resolve() stays a handful of microseconds. */
const LUT_SIZE = 65

export const gradientColorizer: MoverOrSplitterDefinition<GradientColorizerSettings> = {
  id: 'gradient',
  label: 'Gradient',
  kind: 'colorizer',
  identityColor: GRADIENT_COLORIZER_COLOR,
  params: GRADIENT_PARAMS,
  // Passive on purpose: no MIDI vocabulary at all. Declaring zero strict rows
  // keeps the piano roll from offering notes that would do nothing.
  midiRows: () => [],
  strictMidiRows: true,
  resolve({ settings }) {
    // The ramp is fixed per resolve (settings changes re-resolve), so the
    // per-frame work is an index into precomputed hex strings - no color math
    // and no string building while a 32x32 grid animates.
    const lut = gradientStops(settings.colorA, settings.colorB, LUT_SIZE)
    const path = buildGradientPath(settings.path, settings.mode === GRADIENT_MODE_CURVE)
    const amount = clamp01(settings.amount)
    const scratchPosition = new Vector3()
    return {
      apply(visualCopy, { index, count, placementTransform }) {
        // AMOUNT zero leaves upstream color state alone entirely - "no
        // gradient" must not clear a tint some other colorizer asked for.
        if (amount <= 0) {
          return [{
            transform: visualCopy.transform.clone(),
            opacity: visualCopy.opacity,
            colorShift: { ...visualCopy.colorShift },
          }]
        }
        // World position, the same way the Colorizer's rainbow reads it: the
        // chained transform's translation pushed through the track placement.
        scratchPosition.setFromMatrixPosition(visualCopy.transform)
        if (placementTransform) scratchPosition.applyMatrix4(placementTransform)
        const t = gradientPosition(settings, index, count, scratchPosition.x, scratchPosition.y, scratchPosition.z, path)
        return [{
          transform: visualCopy.transform.clone(),
          opacity: visualCopy.opacity,
          colorShift: {
            ...visualCopy.colorShift,
            // Tint REPLACES upstream (the chain rule): the gradient owns the
            // color; relative hue/sat/lightness continue to ride on top.
            tint: lut[Math.round(t * (LUT_SIZE - 1))],
            tintAmount: amount,
          },
        }]
      },
    }
  },
}
