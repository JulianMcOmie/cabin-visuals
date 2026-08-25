// Order-aware canonical-transform automation (see resolve.ts's weave step).
//
// A tf* automation lane placed ABOVE a mover/splitter sibling means "animate the
// object, THEN let the chain below duplicate/move the animated object": a grid
// under a rotation lane shows every copy spinning in place. The engine expresses
// that by turning the lane into a chain entry that post-multiplies each copy's
// transform with the lane's DELTA from the panel value (LOCAL composition, the
// chain's default - the delta rides in each copy's own frame and never re-frames
// the entries above it). Lanes BELOW every chain child keep the historical
// placement path (computeAtBeat's params overlay): the sampled value replaces the
// param inside the world matrix, so the whole formation moves as one.
//
// The delta is RELATIVE to the panel value on purpose: placement keeps composing
// the panel pose exactly as before, so an inert lane (noise/burst between gates,
// or an empty lane) is a genuine no-op, and a keyframe lane still lands the object
// at its absolute pitch-value (panel + (value - panel) = value).

import { Matrix4 } from 'three'
import type { MoverOrSplitter } from '../visualCopies/types'
import { sampleAutomationLane } from './automation'
import type { ResolvedAutomation } from './types'
import { SPATIAL_TRANSFORM_PARAM_DEFS, TF_X, TF_Y, TF_Z, TF_ROT_X, TF_ROT_Y, TF_ROT_Z, TF_SIZE } from '../transform'

const DEG = Math.PI / 180

/** The tf params whose lane position among mover/splitter siblings matters: the
 *  spatial ones. tfOpacity stays a placement overlay wherever its lane sits -
 *  under a time emitter it staggers through the engine's PER-COPY object
 *  states like every other overlay value (see VisualEngine), so it needs no
 *  weave of its own. */
export const SPATIAL_TF_PARAMS: ReadonlySet<string> = new Set(
  SPATIAL_TRANSFORM_PARAM_DEFS.map((p) => p.key),
)

/** The single-param delta transform between the panel value and the lane's
 *  sampled value, matching transform.ts's conventions (degrees, uniform size). */
function composeDelta(param: string, value: number, base: number, out: Matrix4): void {
  switch (param) {
    case TF_X: out.makeTranslation(value - base, 0, 0); return
    case TF_Y: out.makeTranslation(0, value - base, 0); return
    case TF_Z: out.makeTranslation(0, 0, value - base); return
    case TF_ROT_X: out.makeRotationX((value - base) * DEG); return
    case TF_ROT_Y: out.makeRotationY((value - base) * DEG); return
    case TF_ROT_Z: out.makeRotationZ((value - base) * DEG); return
    case TF_SIZE: {
      // A ratio, not a difference: size composes multiplicatively (and the
      // guard keeps a zero-ish panel value from producing a degenerate matrix).
      const s = Math.max(0.000001, value) / Math.max(0.000001, base)
      out.makeScale(s, s, s)
      return
    }
    default: out.identity()
  }
}

/** A count-neutral chain entry animating one spatial tf param per copy. `base`
 *  is the panel value closed over at resolve time (a param edit re-resolves via
 *  the normal debounced structural pass, like any chain setting). Pure function
 *  of the beat, memoized per beat like resolveOwnMoverOrSplitter's overlay. */
export function tfAutomationChainEntry(lane: ResolvedAutomation, base: number): MoverOrSplitter {
  let cachedBeat = Number.NaN
  const delta = new Matrix4()
  return {
    apply(visualCopy, context) {
      if (context.beat !== cachedBeat) {
        cachedBeat = context.beat
        const sampled = sampleAutomationLane(lane, context.beat, base)
        // NaN = the lane is inert this frame - the delta collapses to identity.
        composeDelta(lane.param, Number.isNaN(sampled) ? base : sampled, base, delta)
      }
      return [{ ...visualCopy, transform: visualCopy.transform.clone().multiply(delta) }]
    },
  }
}

