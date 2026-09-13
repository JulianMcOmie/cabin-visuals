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
import { warpChainBeat } from './resolveVisualCopies'
import { identityVisualCopy } from './identityVisualCopy'
import { memoByBeat } from './beatMemo'
import { withCopyEvaluation } from './evaluationMemo'
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

/** These are semantic guarantees, not single-beat probes. In particular a
 * count lane that happens to have one slot now is not a count-neutral child. */
function plainLocalLayout(entry: MoverOrSplitter): boolean {
  return !!(entry.localTransforms || entry.localTransformsAtBeat)
    && !entry.rootTransform && !entry.rootTransformAtBeat && !entry.framedLocalTransformsAtBeat
    && !entry.applyFramed && !entry.emitsCopyClocks
    && (entry.structuralVariants?.every(plainLocalLayout) ?? true)
}

function uniformCountOne(entry: MoverOrSplitter): boolean {
  if (entry.applyFramed || entry.emitsCopyClocks || entry.framedLocalTransformsAtBeat) return false
  const root = !!(entry.rootTransform || entry.rootTransformAtBeat)
  const local = !!(entry.localTransforms || entry.localTransformsAtBeat)
  const count = entry.localTransformsAtBeat ? entry.localTransformCount : entry.localTransforms?.length
  return root !== local && (root || count === 1)
    && (entry.structuralVariants?.every(uniformCountOne) ?? true)
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
  const hasLocalParent = plainLocalLayout(splitter)

  /** The shared evaluation: the splitter's slots, and per output the slot's
   *  transform in the splitter's frame with the child chain's deltas
   *  pre-composed and its opacity/colorShift folded on. `outputs` is null when
   *  the incoming frame is degenerate (a zero scale upstream has no inverse to
   *  express slots in) - callers fall back to the bare slots. `slotTimes`
   *  carries the splitter's own per-slot TIME channel (a Stagger wearing a tf
   *  lane or a nested child must not silently lose its offsets) - the child
   *  chain itself still runs at the incoming beat, since children are internal
   *  to the device rather than below it. */
  function evaluate(visualCopy: VisualCopy, context: MoverOrSplitterContext, framed = false): {
    slots: VisualCopy[]
    slotTimes: readonly FramedVisualCopy[] | null
    outputs: SlotLocalCopy[] | null
    slotInverses: (Matrix4 | null)[] | null
  } {
    const framedSlots = splitter.applyFramed?.call(splitter, visualCopy, context)
    // A raw definition's applyFramed never carries an internalTransform (only
    // this wrapper produces those, and it is never wrapped twice), so folding
    // is defensive completeness, not a live path.
    const slots = framedSlots
      ? framedSlots.map((framed) => framed.internalTransform
        ? {
          ...framed.visualCopy,
          transform: framed.visualCopy.transform.clone().multiply(framed.internalTransform),
        }
        : framed.visualCopy)
      : splitter.apply(visualCopy, context)
    const slotTimes = framedSlots ?? null
    if (slots.length === 0) return { slots, slotTimes, outputs: [], slotInverses: null }
    const previous = visualCopy.transform
    if (isDegenerate(previous)) return { slots, slotTimes, outputs: null, slotInverses: null }
    const declaredLocals = hasLocalParent
      ? splitter.localTransformsAtBeat?.(context.beat) ?? splitter.localTransforms : undefined
    const exactLocals = declaredLocals?.length === slots.length ? declaredLocals : undefined
    // A proven local layout already owns S_i. Reconstructing it as P^-1(P S_i)
    // introduces cancellation and can flip the singular-slot guard near 1e-12
    // as an unrelated upstream frame rotates. Use its exact declared matrix;
    // unproven parents keep the generic extraction and its existing semantics.
    const previousInverse = exactLocals ? null : previous.clone().invert()
    // The splitter's frame in the world: the object's placement composed with
    // everything above the splitter in the chain. World-placed children
    // conjugate their world deltas through it, so the motion they add lands
    // correctly however the formation itself is placed.
    const childPlacement = context.placementTransform
      ? context.placementTransform.clone().multiply(previous)
      : previous.clone()
    // Every descendant of a slot uses the same frame inverse. Keep it once
    // per slot, before the children fan out, rather than invert it per output.
    // The immediate-fold path does not need this separate frame at all.
    const slotInverses = framed ? new Array<Matrix4 | null>(slots.length) : null
    let locals: SlotLocalCopy[] = slots.map((slot, index) => {
      const transform = exactLocals ? exactLocals[index].clone() : previousInverse!.clone().multiply(slot.transform)
      if (slotInverses) slotInverses[index] = isDegenerate(transform) ? null : transform.clone().invert()
      return {
        copy: { transform, opacity: slot.opacity, colorShift: { ...slot.colorShift } },
        slot: index,
      }
    })
    for (const child of children) {
      const count = locals.length
      const formation = locals.map((local) => local.copy)
      const anchored = child.composition === 'chainRoot'
      const next: SlotLocalCopy[] = []
      const childContext: MoverOrSplitterContext = {
        beat: context.beat, index: 0, count, formation, placementTransform: childPlacement,
      }
      const incomingInverse = anchored ? null : new Matrix4()
      for (let index = 0; index < count; index++) {
        const { copy, slot } = locals[index]
        const incoming = copy.transform
        childContext.index = index
        const results = child.apply(copy, childContext)
        // A local child can emit many outputs from one input. Its anchoring
        // inverse and singularity are properties of that input, not each output.
        const reanchor = incomingInverse && results.length > 0 && !isDegenerate(incoming)
        if (reanchor) incomingInverse.copy(incoming).invert()
        for (const result of results) {
          // Chain-root deltas are already anchored on the splitter frame's
          // axes; LOCAL deltas are re-anchored about the splitter's origin
          // (t⁻¹·out·t) so e.g. a rotation orbits the formation. A
          // degenerate incoming transform (Approach's scale-zero slots) has
          // nothing to re-anchor against; the copy is invisible anyway.
          const transform = reanchor
            ? incomingInverse!.clone().multiply(result.transform).multiply(incoming)
            : result.transform
          next.push({ copy: { ...result, transform }, slot })
        }
      }
      locals = next
    }
    return { slots, slotTimes, outputs: locals, slotInverses }
  }

  const wrapper: MoverOrSplitter = {
    cachePolicy: splitter.cachePolicy === 'static' && !splitter.emitsCopyClocks
      && children.every((child) => child.cachePolicy === 'static' && !child.emitsCopyClocks)
      ? 'static' : undefined,
    apply(visualCopy, context) {
      // The immediate fold: time fields drop here exactly as the emitting
      // definition's own `apply` drops them - unobservable as a last entry.
      const { slots, outputs } = evaluate(visualCopy, context)
      if (!outputs) return slots
      return outputs.map(({ copy }) => ({
        transform: visualCopy.transform.clone().multiply(copy.transform),
        opacity: copy.opacity,
        colorShift: copy.colorShift,
      }))
    },
    applyFramed(visualCopy, context) {
      const { slots, slotTimes, outputs, slotInverses } = evaluate(visualCopy, context, true)
      // The parent slot's TIME channel rides every output derived from it - a
      // child splitter's fan-out inherits its slot's clock, as the kernel
      // would have it inherit down a chain.
      const timeOf = (slot: number): Pick<FramedVisualCopy, 'beatOffset' | 'birthBeat'> | null => {
        const time = slotTimes?.[slot]
        if (!time || (time.beatOffset === undefined && time.birthBeat === undefined)) return null
        return { beatOffset: time.beatOffset, birthBeat: time.birthBeat }
      }
      if (!outputs) return slots.map((copy, slot) => ({ visualCopy: copy, ...timeOf(slot) }))
      return outputs.map(({ copy, slot }): FramedVisualCopy => {
        const frame = slots[slot].transform
        const slotInverse = slotInverses![slot]
        // The frame is the splitter's own unmoved output; the child deltas
        // become internal motion, re-expressed inside the slot's frame:
        // frame · internal = prev · deltas · slot. A degenerate SLOT
        // (Approach grows copies from scale zero) has no inverse to split
        // against, so that copy folds immediately - invisible at scale zero.
        if (!slotInverse) {
          return {
            visualCopy: {
              transform: visualCopy.transform.clone().multiply(copy.transform),
              opacity: copy.opacity,
              colorShift: copy.colorShift,
            },
            ...timeOf(slot),
          }
        }
        return {
          visualCopy: {
            transform: frame.clone(),
            opacity: copy.opacity,
            colorShift: copy.colorShift,
          },
          internalTransform: slotInverse.clone().multiply(copy.transform),
          ...timeOf(slot),
        }
      })
    },
  }
  // A time remap is object-wide wherever it sits, so a Freeze child of a
  // splitter must still reach computeAtBeat; deltas sum, same as a chain.
  if (splitter.warpBeat || children.some((child) => child.warpBeat)) {
    wrapper.warpBeat = (beat) => warpChainBeat([splitter, ...children], beat)
  }
  // The wrapped splitter's clocks ride this wrapper's applyFramed (slotTimes),
  // so the structural declaration must ride with them.
  if (splitter.emitsCopyClocks) wrapper.emitsCopyClocks = true
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
  if (hasLocalParent && children.every(uniformCountOne)) {
    // Identity sampling is bounded by this splitter's own slots. It deliberately
    // uses the reference anchoring path: a child Orbit's root-transform proof
    // does not change its existing composition declaration or nested semantics.
    wrapper.framedLocalTransformsAtBeat = memoByBeat(beat => withCopyEvaluation(() => {
      const bareFrames = splitter.localTransformsAtBeat?.(beat) ?? splitter.localTransforms!
      const framed = wrapper.applyFramed!(identityVisualCopy(), { beat, index: 0, count: 1 })
      // Matrix4.invert can round the homogeneous identity to 1 +/- epsilon.
      // These declared layouts/motions are affine; canonicalize only that
      // inversion noise in the sampled metadata, leaving the reference path
      // and any genuinely non-affine matrix untouched.
      const affineSample = (matrix: Matrix4) => {
        const e = matrix.elements
        if (e[3] !== 0 || e[7] !== 0 || e[11] !== 0 || Math.abs(e[15] - 1) > 64 * Number.EPSILON) return matrix
        if (e[15] === 1) return matrix
        const result = matrix.clone()
        result.elements[15] = 1
        return result
      }
      return {
        frames: framed.map(copy => affineSample(copy.visualCopy.transform)),
        internals: framed.map(copy => copy.internalTransform ? affineSample(copy.internalTransform) : null),
        bareFrames,
      }
    }))
  }
  return wrapper
}
