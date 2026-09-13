import type { Matrix4 } from 'three'
import type { CompositionLayer } from '../directors/types'

export type ObjectTransitionMotion = NonNullable<CompositionLayer['objectMotion']>

/** Move the object, not the scene camera or framebuffer. Rotate/scale its
 * basis around its own origin, preserving shear and its authored position.
 * Translation is a world-space offset. Called after the hierarchy and mover
 * evaluation, so children receive the transition once, never per ancestor. */
export function applyObjectTransition(matrix: Matrix4, motion: ObjectTransitionMotion): Matrix4 {
  const e = matrix.elements, c = Math.cos(motion.rotation), s = Math.sin(motion.rotation)
  for (const column of [0, 4, 8]) {
    const x = e[column], y = e[column + 1]
    e[column] = (c * x - s * y) * motion.scale
    e[column + 1] = (s * x + c * y) * motion.scale
    e[column + 2] *= motion.scale
  }
  e[12] += motion.x; e[13] += motion.y
  return matrix
}
