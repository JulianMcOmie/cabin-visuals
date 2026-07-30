// The Gradient: a PASSIVE colorizer. Drop it on any instrument and the copies
// wear a two-stop gradient - no notes, no envelope, no performance. It is the
// "fill" of this library: where the note Colorizer answers "what does this HIT
// look like", the Gradient answers "what does this FIELD look like".
//
// Two ways to spread the ramp across the copies, one select:
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
import type { ParamDef } from '../../instruments/types'
import { colorToOklch, oklchToHex } from '../../utils/oklch'
import type { MoverOrSplitterDefinition } from './definitions'

export const GRADIENT_MODE_POSITION = 0
export const GRADIENT_MODE_INDEX = 1

export interface GradientColorizerSettings {
  /** GRADIENT_MODE_POSITION or GRADIENT_MODE_INDEX. */
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
      { value: GRADIENT_MODE_INDEX, label: 'Copy index' },
    ],
    default: GRADIENT_MODE_POSITION,
  },
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

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

/** Below this chroma a color has no meaningful hue of its own (grey/black/
 *  white), so it adopts the other stop's hue instead of contributing an
 *  arbitrary one to the arc. */
const ACHROMATIC = 0.005

/**
 * The gradient as `count` evenly spaced '#rrggbb' stops, OKLCH-interpolated.
 * The literal endpoint strings are preserved (no roundtrip through the color
 * math), so t=0 and t=1 are exactly the picked colors. Unparseable input
 * degrades to a hard A|B split at the midpoint rather than throwing.
 *
 * Exported for the settings panel: the preview strip renders these same stops,
 * so the picture cannot drift from what the stage samples.
 */
export function gradientStops(colorA: string, colorB: string, count: number): string[] {
  const steps = Math.max(2, Math.round(count))
  const a = colorToOklch(colorA)
  const b = colorToOklch(colorB)
  const stops: string[] = new Array(steps)
  stops[0] = colorA
  stops[steps - 1] = colorB
  if (!a || !b) {
    for (let i = 1; i < steps - 1; i++) stops[i] = i / (steps - 1) < 0.5 ? colorA : colorB
    return stops
  }
  const hueA = a.c < ACHROMATIC ? (b.c < ACHROMATIC ? 0 : b.h) : a.h
  const hueB = b.c < ACHROMATIC ? hueA : b.h
  // Shortest arc around the wheel, in -180..180.
  const hueDelta = ((hueB - hueA + 540) % 360) - 180
  for (let i = 1; i < steps - 1; i++) {
    const t = i / (steps - 1)
    stops[i] = oklchToHex(
      a.l + (b.l - a.l) * t,
      a.c + (b.c - a.c) * t,
      hueA + hueDelta * t,
    )
  }
  return stops
}

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
): number {
  let t: number
  if (settings.mode === GRADIENT_MODE_INDEX) {
    t = count > 1 ? index / (count - 1) : 0.5
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
        const t = gradientPosition(settings, index, count, scratchPosition.x, scratchPosition.y)
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
