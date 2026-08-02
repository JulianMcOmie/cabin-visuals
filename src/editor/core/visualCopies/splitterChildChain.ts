// A mover nested UNDER a splitter acts on the splitter's copies IN THE
// SPLITTER'S REFERENCE FRAME: its motion treats the splitter's own origin as
// the origin the movement happens about. A rotation child turns the whole
// formation about the splitter's center (where the same rotation placed BELOW
// the splitter in the chain spins each copy in place); an oscillator child
// sways the arrangement together; a scale child breathes the formation toward
// the splitter's origin. This is the splitter-parent counterpart of
// moverFrame.ts, which keeps its meaning for mover parents only - a mover's
// children move its FIELD, a splitter's children move its COPIES.
//
// The algebra: the splitter hands each incoming copy `prev` back as
// `prev · slot_i`. A child's delta D in the splitter's frame belongs BETWEEN
// those factors - `prev · D · slot_i` - which no chain position can express
// (above the splitter D would also see the entries below it; below it D lands
// in each copy's OWN frame). D is extracted by evaluating the child chain from
// an IDENTITY copy, exactly as frames do, but PER SLOT with the splitter's
// output multiplicity as `index`/`count`, so note- and index-phased children
// (Burst's per-copy directions, a phased oscillator) treat each copy
// individually while still measuring from the splitter's origin.
//
// Two consequences of the identity-copy evaluation, both deliberate:
//  - a world-placed child (Impact Scatter, Force Field) measures its field at
//    the splitter's ORIGIN rather than at each copy's own position - the
//    formation responds rigidly, like moverFrame's "a field has one position";
//  - a formation-measuring child (Conveyor) sees a degenerate point formation
//    and falls back to its own no-lattice behavior.
//
// The child chain composes opacity and colorShift as usual - the seed copy
// carries each slot's values, so a Visibility child gates the splitter's
// copies and a Colorizer child flashes them. A SPLITTER child fans the whole
// formation out about the parent's origin (n·m copies, input-major order).

import { Matrix4 } from 'three'
import { MAX_VISUAL_COPIES, warpChainBeat } from './resolveVisualCopies'
import type { MoverOrSplitter, VisualCopy } from './types'

/** A child result still tied to the parent slot whose frame it moves. */
interface SlotLocalCopy {
  copy: VisualCopy
  slot: number
}

/**
 * Wraps `splitter` so the mover/splitter `children` transform its copies in
 * its reference frame. Empty children return `splitter` untouched, so an
 * ordinary splitter pays nothing for this.
 */
export function splitterWithChildChain(
  splitter: MoverOrSplitter,
  children: MoverOrSplitter[],
): MoverOrSplitter {
  if (children.length === 0) return splitter
  const wrapper: MoverOrSplitter = {
    apply(visualCopy, context) {
      const slots = splitter.apply(visualCopy, context)
      if (slots.length === 0) return slots
      const previous = visualCopy.transform
      // A degenerate incoming frame (a zero scale upstream) has no inverse to
      // measure slots against; hand the splitter's own output through untouched
      // rather than filling it with NaNs.
      if (!Number.isFinite(previous.determinant()) || Math.abs(previous.determinant()) < 1e-12) {
        return slots
      }
      const previousInverse = previous.clone().invert()
      // The splitter's frame in the world: the object's placement composed with
      // everything above the splitter in the chain. World-placed children
      // conjugate their world deltas through it, so the motion they add lands
      // correctly however the formation itself is placed.
      const childPlacement = context.placementTransform
        ? context.placementTransform.clone().multiply(previous)
        : previous.clone()
      // Seed one identity-transform copy per slot: the child chain's
      // accumulated transform is then a pure delta in the splitter's frame,
      // while opacity/colorShift start from the slot's own values so the
      // children compose them exactly as chain entries would.
      let locals: SlotLocalCopy[] = slots.map((slot, index) => ({
        copy: {
          transform: new Matrix4(),
          opacity: slot.opacity,
          colorShift: { ...slot.colorShift },
        },
        slot: index,
      }))
      for (const child of children) {
        const count = locals.length
        const formation = locals.map((local) => local.copy)
        locals = locals.flatMap(({ copy, slot }, index) =>
          child
            .apply(copy, {
              beat: context.beat,
              index,
              count,
              formation,
              placementTransform: childPlacement,
            })
            .map((result) => ({ copy: result, slot })),
        )
        if (locals.length > MAX_VISUAL_COPIES) locals = locals.slice(0, MAX_VISUAL_COPIES)
      }
      // prev · D · slot, with slot recovered as prev⁻¹ · (prev · slot): the
      // child's delta lands between the splitter's frame and its slot offsets.
      return locals.map(({ copy, slot }) => ({
        transform: previous
          .clone()
          .multiply(copy.transform)
          .multiply(previousInverse)
          .multiply(slots[slot].transform),
        opacity: copy.opacity,
        colorShift: copy.colorShift,
      }))
    },
  }
  // A time remap is object-wide wherever it sits, so a Freeze child of a
  // splitter must still reach computeAtBeat; deltas sum, same as a chain.
  if (splitter.warpBeat || children.some((child) => child.warpBeat)) {
    wrapper.warpBeat = (beat) => warpChainBeat([splitter, ...children], beat)
  }
  // A child splitter (or an automated child) changes the copy count, so the
  // structural probe needs the composed entry at every variant rank - unlike
  // frames, which never change counts and skip their wrapper.
  const variantRanks = Math.max(
    splitter.structuralVariants?.length ?? 0,
    ...children.map((child) => child.structuralVariants?.length ?? 0),
  )
  if (variantRanks > 0) {
    wrapper.structuralVariants = Array.from({ length: variantRanks }, (_, rank) =>
      splitterWithChildChain(
        splitter.structuralVariants?.[rank] ?? splitter,
        children.map((child) => child.structuralVariants?.[rank] ?? child),
      ),
    )
  }
  return wrapper
}
