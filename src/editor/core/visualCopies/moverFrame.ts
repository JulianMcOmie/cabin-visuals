// A mover nested UNDER another MOVER does not become a second chain entry - it
// MOVES that mover. Its own chain resolves to one transform F, the frame, and
// the parent is evaluated as though its whole field sat inside it: Impact
// Scatter's blast center drifts, Meteor Impact's impact point orbits, Force
// Field Push's source travels. (A mover nested under a SPLITTER means
// something else - it moves the splitter's copies in the splitter's reference
// frame; see splitterChildChain.ts.)
//
// The mechanism is one line of algebra rather than a new contract. Every mover
// with a PLACE in the world already keys its field off `placementTransform` and
// conjugates its world delta back through it (impactScatter, meteorImpact,
// forceFieldPush, waveTerrain all share the idiom verbatim). So handing the
// parent a placement pre-multiplied by F's INVERSE is sufficient:
//
//   the parent measures the object at F⁻¹·placement, i.e. it behaves exactly as
//   if its own center had moved to F·center - falloff, propagation delay and
//   geometry all together, because they are all read off that one placement;
//
//   and the transform it returns needs no fixing up, because it conjugates by
//   the placement it was GIVEN: the renderer's placement·result works out to
//   F·delta·F⁻¹·placement, the delta moved into the frame.
//
// So nothing downstream changes and the VisualCopy contract is untouched.
//
// A mover with no place in the world (Burst, Motion, the rotations) ignores
// placementTransform, so a frame under one of those is a no-op - a pure relative
// displacement has no location to move.

import { resolveVisualCopies } from './resolveVisualCopies'
import type { MoverOrSplitter } from './types'

/**
 * Wraps `inner` so the resolved `frame` chain moves it. An empty frame returns
 * `inner` untouched, so an ordinary mover pays nothing for this.
 *
 * The frame contributes its TRANSFORM only - its opacity and colorShift are
 * dropped, since a frame answers where the parent's field is, not how it looks.
 * A splitter in the frame chain contributes its first slot: a field has one
 * position.
 */
export function framedMoverOrSplitter(
  inner: MoverOrSplitter,
  frame: MoverOrSplitter[],
): MoverOrSplitter {
  if (frame.length === 0) return inner
  const framedEntry: MoverOrSplitter = {
    apply(visualCopy, context) {
      // Resolved from identity, so F is the frame's own accumulated motion. It
      // sees the object's placement too, so a world-placed mover can itself be
      // used as a frame.
      const [framed] = resolveVisualCopies(frame, context.beat, context.placementTransform)
      if (!framed) return inner.apply(visualCopy, context)
      const placementTransform = framed.transform.clone().invert()
      if (context.placementTransform) placementTransform.multiply(context.placementTransform)
      return inner.apply(visualCopy, { ...context, placementTransform })
    },
  }
  // A frame reinterprets WHERE an entry acts, never when, so a time remap has to
  // pass straight through - dropping it here would silently un-freeze any Freeze
  // that happens to have a mover child.
  if (inner.warpBeat) framedEntry.warpBeat = (beat) => inner.warpBeat!(beat)
  return framedEntry
}
