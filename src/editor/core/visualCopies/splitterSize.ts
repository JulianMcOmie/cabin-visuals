// The shared SIZE knob for layout splitters (Radial, Grid, Line, Symmetry,
// Polyhedron, Parametric Pattern, Tunnel): a uniform scale on each copy that is
// INDEPENDENT of how the layout is spaced.
//
// Two rules make it independent, and both are load-bearing:
//
// 1. It composes AFTER the slot's own offset (slot · S, never S · slot), so it
//    scales the copy about its OWN center and leaves the position column
//    untouched. Pre-multiplying would scale each copy's POSITION too - spacing,
//    radius and depth would all ride the knob, which is the exact coupling the
//    knob exists to avoid (the same reason impactPulse composes LOCAL).
// 2. It is a MULTIPLIER on whatever size the object already draws itself at,
//    never an absolute size: 1 is neutral, so a definition that gains this knob
//    renders every existing save unchanged (an absent key merges to the default
//    1, so no persistence upgrade is needed).
//
// A ratio also can never cross zero - the scale-mover rule from impactPulse -
// which is why the minimum is a small positive number rather than 0.

import { Matrix4 } from 'three'
import type { NumberParamDef } from '../../instruments/types'

export const SPLITTER_SIZE_MIN = 0.05
export const SPLITTER_SIZE_MAX = 4
export const SPLITTER_SIZE_DEFAULT = 1

/** The param every layout splitter declares, so the knob reads and automates
 *  identically wherever it appears. Treated as read-only, like every ParamDef. */
export const SPLITTER_SIZE_PARAM: NumberParamDef = {
  key: 'size',
  label: 'Size',
  min: SPLITTER_SIZE_MIN,
  max: SPLITTER_SIZE_MAX,
  step: 0.05,
  default: SPLITTER_SIZE_DEFAULT,
}

/** The stored value clamped to a usable scale. Absent (an old save, or a
 *  definition resolved from partial settings) means neutral. */
export function splitterSize(size: number | undefined): number {
  return Math.max(SPLITTER_SIZE_MIN, size ?? SPLITTER_SIZE_DEFAULT)
}

/** Post-multiply the uniform scale onto a slot transform, in place. Neutral
 *  sizes skip the multiply so the untouched path stays matrix-identical to what
 *  the definition produced before it had the knob. */
export function applySplitterSize(slot: Matrix4, size: number): Matrix4 {
  if (size === 1) return slot
  return slot.multiply(new Matrix4().makeScale(size, size, size))
}
