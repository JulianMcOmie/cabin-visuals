// Hue Rotate: turn the colours the object already has, instead of replacing
// them.
//
// Every other colorizer here ANSWERS the question "what colour is this copy" -
// a gradient stop, a palette sample, an ink. This one refuses to: it adds a
// RELATIVE turn to `colorShift.hue` and leaves the object's own palette, its
// per-part colours and its shading intact. A Cube with three declared colours
// stays a Cube with three colours a quarter-turn along. That is the whole
// design: complexity the instrument authored survives the recolour, because
// nothing here ever learns what that complexity was.
//
// Three consequences worth knowing before reaching for it:
//
//  - It COMPOSES. Relative channels accumulate down the chain, so two of these
//    sum, and one riding under a Gradient/Cosine/Riso turns the colour that
//    colorizer just handed the copy (`tint` is mixed first, in
//    core/visual/instrumentColor.ts, and the HSL offsets ride on top). That is
//    what makes it the safe device to automate: nothing it does can clobber a
//    colour another entry owns.
//  - It is PERIODIC, so nothing is clamped anywhere: ROTATE is measured in
//    turns and a 0→1 automation lane comes back exactly where it started. The
//    Gradient clamps because a fill pads past its stops; a wheel has no ends.
//  - It CANNOT colour a grey object. There is no hue in an achromatic colour
//    to turn - a white Cube stays white however hard this is driven. Reach for
//    the Gradient or the Cosine Palette when the source has nothing to rotate.
//
// MODE picks the circle the turn happens on, and Perceptual is the default for
// a reason: HSL's hue circle is a construction on the RGB cube, so its yellows
// are far lighter than its blues and a full sweep PULSES in brightness twice a
// turn, flattening the object's lit form each time it passes yellow. OKLCH
// holds lightness and chroma and turns only the hue (`huePerceptual` on
// colorShift; the maths is `rotateHueOklabLinearRgb` in utils/oklch.ts). HSL
// stays available because it is what every older save was authored against.
//
// SPREAD is what makes it a colorizer rather than a global filter: the same MAP
// vocabulary the Cosine Palette and the Riso use turns each copy by a different
// amount, so a formation fans across the wheel instead of moving as one block.
// At SPREAD 0 every copy turns together, which is the honest "global filter"
// case and a legitimate setting.

import { Vector3 } from 'three'
import type { ParamDef } from '../../instruments/types'
import type { MoverOrSplitterDefinition } from './definitions'
import { HUE_ROTATE_COLOR } from './identityColors'
import type { VisualCopy } from './types'

/** Which scalar of the copy's placement scales SPREAD. The Cosine Palette's and
 *  the Riso's vocabulary, value for value - three colorizers now ask "where
 *  does this copy sit" and they must not answer it differently. A FOURTH should
 *  extract these into a shared module rather than copy them again. */
export const HUE_MAP_X = 0
export const HUE_MAP_Y = 1
export const HUE_MAP_RADIAL = 2
export const HUE_MAP_SPHERICAL = 3
export const HUE_MAP_DEPTH = 4
export const HUE_MAP_INDEX = 5

/** Which hue circle the turn happens on. */
export const HUE_MODE_PERCEPTUAL = 0
export const HUE_MODE_HSL = 1

export interface HueRotateSettings {
  /** Turns of hue every copy takes, 0..1. THE automation target: one full turn
   *  is the whole wheel, so a 0→1 lane loops seamlessly. */
  rotate: number
  /** Extra turns across the map - the difference between the copy at t=0 and
   *  the copy at t=1. Signed, and deliberately allowed past a full turn: a
   *  formation wrapping the wheel twice is a real look. */
  spread: number
  /** HUE_MAP_*: which scalar of the copy's position SPREAD scales. */
  mode: number
  /** Position modes: world units across one unit of SPREAD. */
  span: number
  /** Position modes: world units the mapping's zero slides along its axis (or
   *  outward, for the distance modes). */
  offset: number
  /** HUE_MODE_PERCEPTUAL or HUE_MODE_HSL. */
  hueMode: number
  /** Additive HSL offsets riding on top of the turn, three's own units. */
  saturation: number
  lightness: number
}

const HUE_PARAMS: ParamDef[] = [
  { key: 'rotate', label: 'Rotate', min: 0, max: 1, step: 0.005, default: 0 },
  { key: 'spread', label: 'Spread', min: -2, max: 2, step: 0.005, default: 0.25 },
  {
    key: 'mode',
    label: 'Map',
    type: 'select',
    options: [
      { value: HUE_MAP_X, label: 'X' },
      { value: HUE_MAP_Y, label: 'Y' },
      { value: HUE_MAP_RADIAL, label: 'Radial' },
      { value: HUE_MAP_SPHERICAL, label: 'Spherical' },
      { value: HUE_MAP_DEPTH, label: 'Depth' },
      { value: HUE_MAP_INDEX, label: 'Copy index' },
    ],
    // Copy index, where the Cosine Palette defaults to Radial: a ring's copies
    // all sit at the SAME radius, so a radial default would leave the commonest
    // formation in the library looking like the device does nothing.
    default: HUE_MAP_INDEX,
  },
  { key: 'span', label: 'Span (units)', min: 0.25, max: 40, step: 0.25, default: 6, curve: 2 },
  { key: 'offset', label: 'Offset (units)', min: -20, max: 20, step: 0.1, default: 0 },
  {
    key: 'hueMode',
    label: 'Circle',
    type: 'select',
    options: [
      { value: HUE_MODE_PERCEPTUAL, label: 'Perceptual' },
      { value: HUE_MODE_HSL, label: 'HSL' },
    ],
    default: HUE_MODE_PERCEPTUAL,
  },
  { key: 'saturation', label: 'Saturation', min: -1, max: 1, step: 0.01, default: 0 },
  { key: 'lightness', label: 'Lightness', min: -1, max: 1, step: 0.01, default: 0 },
]

/**
 * How far along SPREAD one copy sits - t, before SPREAD scales it into turns.
 *
 * No clamp anywhere: hue is periodic, so "past the end" is simply further round
 * the wheel (the Cosine Palette's rule, and the opposite of the Gradient's
 * fill-style padding). INDEX spreads one unit across the copy run, first copy
 * at 0 and last at 1, so SPREAD reads directly as "turns from end to end" of
 * whatever the splitter above produced; the distance modes measure from the
 * chain origin, so a Radial rings a formation concentrically and a Spherical
 * shells a lattice.
 */
export function hueRotatePosition(
  settings: HueRotateSettings,
  index: number,
  count: number,
  x: number,
  y: number,
  z: number,
): number {
  if (settings.mode === HUE_MAP_INDEX) return count > 1 ? index / (count - 1) : 0
  const span = Math.max(0.001, settings.span)
  switch (settings.mode) {
    case HUE_MAP_X: return (x - settings.offset) / span
    case HUE_MAP_Y: return (y - settings.offset) / span
    case HUE_MAP_DEPTH: return (z - settings.offset) / span
    case HUE_MAP_SPHERICAL: return (Math.hypot(x, y, z) - settings.offset) / span
    default: return (Math.hypot(x, y) - settings.offset) / span
  }
}

/** The turns one copy takes: the master rotation plus its share of SPREAD.
 *  Unwrapped on purpose - three's `setHSL` and the OKLCH rotation are both
 *  periodic, so wrapping here would only add a discontinuity for an automation
 *  lane to fall into. */
export function hueRotateTurns(settings: HueRotateSettings, t: number): number {
  return settings.rotate + settings.spread * t
}

export const hueRotateColorizer: MoverOrSplitterDefinition<HueRotateSettings> = {
  // Not to be confused with `calmHueRotate`, the note Colorizer's legacy id -
  // that one flashes copies toward an ABSOLUTE color it was given, which is the
  // opposite of what this does.
  id: 'hueRotate',
  label: 'Hue Rotate',
  kind: 'colorizer',
  identityColor: HUE_ROTATE_COLOR,
  params: HUE_PARAMS,
  // Passive, like the Gradient and the Riso: no notes. ROTATE is the automation
  // target, and a burst/cycle lane on it is how this hits on the beat.
  midiRows: () => [],
  strictMidiRows: true,
  resolve({ settings }) {
    const perceptual = settings.hueMode !== HUE_MODE_HSL
    const scratchPosition = new Vector3()
    return {
      apply(visualCopy, { index, count, placementTransform }) {
        // World position, the same read as the other colorizers: the chained
        // transform's translation pushed through the track placement.
        scratchPosition.setFromMatrixPosition(visualCopy.transform)
        if (placementTransform) scratchPosition.applyMatrix4(placementTransform)
        const t = hueRotatePosition(
          settings, index, count, scratchPosition.x, scratchPosition.y, scratchPosition.z,
        )
        const next: VisualCopy = {
          transform: visualCopy.transform.clone(),
          opacity: visualCopy.opacity,
          colorShift: {
            ...visualCopy.colorShift,
            // ACCUMULATES, where a tint replaces: these are relative channels,
            // so stacking two of these devices means two turns, and one under a
            // palette colorizer turns the colour that palette just chose. At
            // ROTATE 0 with SPREAD 0 this adds exactly nothing - the passthrough
            // every colorizer owes an upstream tint costs no special case here.
            hue: visualCopy.colorShift.hue + hueRotateTurns(settings, t),
            saturation: visualCopy.colorShift.saturation + settings.saturation,
            lightness: visualCopy.colorShift.lightness + settings.lightness,
            // The circle the SUM turns on. Last writer wins, like the tint's
            // own mix flag: two entries disagreeing about which circle their
            // shared hue channel means is not something an average can settle.
            huePerceptual: perceptual,
          },
        }
        return [next]
      },
    }
  },
}
