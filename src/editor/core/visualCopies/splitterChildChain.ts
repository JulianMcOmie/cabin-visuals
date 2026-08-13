// A mover nested UNDER a splitter acts on the splitter's copies IN THE
// SPLITTER'S REFERENCE FRAME: its motion treats the splitter's own origin as
// the origin the movement happens about. A rotation child turns the whole
// formation about the splitter's center (where the same rotation placed BELOW
// the splitter in the chain spins each copy in place); a Symmetric Motion
// child blooms the formation outward from that center; a scale child breathes
// it toward the origin. This is the splitter-parent counterpart of
// moverFrame.ts, which keeps its meaning for mover parents only - a mover's
// children move its FIELD, a splitter's children move its COPIES.
//
// The motion is INTERNAL to the copies: it never becomes part of the reference
// frame that entries further down the chain compose against. Each output keeps
// the splitter's own unmoved transform as its frame and hands the child's
// contribution over separately (`applyFramed` / FramedVisualCopy in types.ts),
// so a second grid below duplicates a SPINNING sub-grid - the spin repeats
// inside every duplicate - instead of laying its cells out in a spinning
// frame, which would read as the whole compound rotating about one origin.
// When the wrapped splitter is the chain's LAST entry the two are the same
// picture, and `apply` (the immediate fold) returns exactly that.
//
// HOW THE CHILD CHAIN RUNS: on the splitter's own slots, expressed in the
// splitter's frame (`slot_i = prev⁻¹ · output_i`), with the splitter's output
// multiplicity as `index`/`count` and the slot set as `formation`. Children
// therefore see each copy's REAL position - a position-reading mover
// (Symmetric Motion's out/in, a world-placed field) aims per copy - while a
// note/index-phased child (Burst's directions, a phased oscillator) still
// treats each copy individually. What a child's transform CONTRIBUTES is
// anchored by its declared composition (`MoverOrSplitter.composition`):
//  - 'chainRoot' entries (Symmetric Motion) pre-multiplied a delta measured on
//    the frame's fixed axes; it is taken as-is.
//  - 'local' entries (the default) post-multiplied a delta in the copy's own
//    frame; it is re-anchored about the SPLITTER's origin (`t⁻¹ · out · t`),
//    which is what makes a rotation child orbit the formation rather than
//    spin each copy in place. An undeclared chain-root definition also lands
//    here - harmless under translation splitters (grids), where the two
//    anchorings coincide.
// Every child's delta ends up PRE-composed against the slot - the rendered
// copy is `prev · deltas · slot_i` - which no chain position can express
// (above the splitter the delta would re-frame the entries below it; below it
// it lands in each copy's own frame).
//
// The child chain composes opacity and colorShift as usual and those apply
// immediately - a Visibility child gates the splitter's copies, a Colorizer
// child flashes them; only the TRANSFORM is split into frame + internal
// motion. A SPLITTER child fans the whole formation out about the parent's
// origin (n·m copies, input-major).

import { Matrix4 } from 'three'
import { MAX_VISUAL_COPIES, warpChainBeat } from './resolveVisualCopies'
import type { FramedVisualCopy, MoverOrSplitter, MoverOrSplitterContext, VisualCopy } from './types'

/** A child result still tied to the parent slot whose frame it moves: `copy`'s
 *  transform is the slot's transform in the splitter's frame with every child
 *  delta pre-composed onto it. */
interface SlotLocalCopy {
  copy: VisualCopy
  slot: number
}

const DEGENERATE_DETERMINANT = 1e-12

function isDegenerate(transform: Matrix4): boolean {
  const determinant = transform.determinant()
  return !Number.isFinite(determinant) || Math.abs(determinant) < DEGENERATE_DETERMINANT
}

/**
 * Wraps `splitter` so the mover/splitter `children` move its copies in its
 * reference frame, as INTERNAL motion (see the header). Empty children return
 * `splitter` untouched, so an ordinary splitter pays nothing for this.
 */
export function splitterWithChildChain(
  splitter: MoverOrSplitter,
  children: MoverOrSplitter[],
): MoverOrSplitter {
  if (children.length === 0) return splitter

  /** The shared evaluation: the splitter's slots, and per output the slot's
   *  transform in the splitter's frame with the child chain's deltas
   *  pre-composed and its opacity/colorShift folded on. `outputs` is null when
   *  the incoming frame is degenerate (a zero scale upstream has no inverse to
   *  express slots in) - callers fall back to the bare slots. */
  function evaluate(visualCopy: VisualCopy, context: MoverOrSplitterContext): {
    slots: VisualCopy[]
    outputs: SlotLocalCopy[] | null
  } {
    const slots = splitter.apply(visualCopy, context)
    if (slots.length === 0) return { slots, outputs: [] }
    const previous = visualCopy.transform
    if (isDegenerate(previous)) return { slots, outputs: null }
    const previousInverse = previous.clone().invert()
    // The splitter's frame in the world: the object's placement composed with
    // everything above the splitter in the chain. World-placed children
    // conjugate their world deltas through it, so the motion they add lands
    // correctly however the formation itself is placed.
    const childPlacement = context.placementTransform
      ? context.placementTransform.clone().multiply(previous)
      : previous.clone()
    let locals: SlotLocalCopy[] = slots.map((slot, index) => ({
      copy: {
        transform: previousInverse.clone().multiply(slot.transform),
        opacity: slot.opacity,
        colorShift: { ...slot.colorShift },
      },
      slot: index,
    }))
    for (const child of children) {
      const count = locals.length
      const formation = locals.map((local) => local.copy)
      const anchored = child.composition === 'chainRoot'
      locals = locals.flatMap(({ copy, slot }, index) => {
        const incoming = copy.transform
        return child
          .apply(copy, {
            beat: context.beat,
            index,
            count,
            formation,
            placementTransform: childPlacement,
          })
          .map((result) => {
            // Chain-root deltas are already anchored on the splitter frame's
            // axes; LOCAL deltas are re-anchored about the splitter's origin
            // (t⁻¹·out·t) so e.g. a rotation orbits the formation. A
            // degenerate incoming transform (Approach's scale-zero slots) has
            // nothing to re-anchor against; the copy is invisible anyway.
            const transform = anchored || isDegenerate(incoming)
              ? result.transform
              : incoming.clone().invert().multiply(result.transform).multiply(incoming)
            return { copy: { ...result, transform }, slot }
          })
      })
      if (locals.length > MAX_VISUAL_COPIES) locals = locals.slice(0, MAX_VISUAL_COPIES)
    }
    return { slots, outputs: locals }
  }

  const wrapper: MoverOrSplitter = {
    apply(visualCopy, context) {
      const { slots, outputs } = evaluate(visualCopy, context)
      if (!outputs) return slots
      return outputs.map(({ copy }) => ({
        transform: visualCopy.transform.clone().multiply(copy.transform),
        opacity: copy.opacity,
        colorShift: copy.colorShift,
      }))
    },
    applyFramed(visualCopy, context) {
      const { slots, outputs } = evaluate(visualCopy, context)
      if (!outputs) return slots.map((copy) => ({ visualCopy: copy }))
      const previousInverse = visualCopy.transform.clone().invert()
      return outputs.map(({ copy, slot }): FramedVisualCopy => {
        const frame = slots[slot].transform
        const slotLocal = previousInverse.clone().multiply(frame)
        // The frame is the splitter's own unmoved output; the child deltas
        // become internal motion, re-expressed inside the slot's frame:
        // frame · internal = prev · deltas · slot. A degenerate SLOT
        // (Approach grows copies from scale zero) has no inverse to split
        // against, so that copy folds immediately - invisible at scale zero.
        if (isDegenerate(slotLocal)) {
          return {
            visualCopy: {
              transform: visualCopy.transform.clone().multiply(copy.transform),
              opacity: copy.opacity,
              colorShift: copy.colorShift,
            },
          }
        }
        return {
          visualCopy: {
            transform: frame.clone(),
            opacity: copy.opacity,
            colorShift: copy.colorShift,
          },
          internalTransform: slotLocal.clone().invert().multiply(copy.transform),
        }
      })
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
