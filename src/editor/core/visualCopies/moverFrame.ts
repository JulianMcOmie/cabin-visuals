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

import { entryMaxOutputCount } from './maxOutputCount'
import { resolveVisualCopies } from './resolveVisualCopies'
import { memoizeEvaluation } from './evaluationMemo'
import { Matrix4 } from 'three'
import { compileParticlePlan, particlePlanMatrix } from './particlePlan'
import type { MoverOrSplitter } from './types'

function ignoresPlacement(entry: MoverOrSplitter): boolean {
  if (entry.applyFramed || entry.emitsCopyClocks || entry.framedLocalTransformsAtBeat) return false
  const legacy = !!(entry.localTransforms || entry.localTransformsAtBeat)
  const shared = !!(entry.localLayout || entry.localLayoutAtBeat)
  const root = !!(entry.rootTransform || entry.rootTransformAtBeat)
  const gpu = !!entry.gpuOperationAtBeat
  const independentLayout = Number(legacy) + Number(shared) + Number(root) + Number(gpu) === 1
    && (!shared || !entry.localLayoutUsesPlacement)
    && (!gpu || !entry.gpuOperationUsesPlacement)
  return !!(entry.localSlotMotion || independentLayout)
    && (entry.structuralVariants?.every(ignoresPlacement) ?? true)
}

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
  if (ignoresPlacement(inner)) {
    // A frame can only replace placementTransform, which this entry proves it
    // never reads. Preserve its compact contract without evaluating the frame.
    // Do NOT return inner directly: this wrapper historically omits composition,
    // so a chain-root mover nested under a splitter is re-anchored as local.
    const unplaced: MoverOrSplitter = {
      ...inner,
      composition: undefined,
      apply(copy, context) { return inner.apply(copy, context) },
    }
    if (inner.localTransformsAtBeat) unplaced.localTransformsAtBeat = inner.localTransformsAtBeat.bind(inner)
    if (inner.localLayoutAtBeat) unplaced.localLayoutAtBeat = inner.localLayoutAtBeat.bind(inner)
    if (inner.rootTransformAtBeat) unplaced.rootTransformAtBeat = inner.rootTransformAtBeat.bind(inner)
    if (inner.gpuOperationAtBeat) unplaced.gpuOperationAtBeat = inner.gpuOperationAtBeat.bind(inner)
    if (inner.warpBeat) unplaced.warpBeat = beat => inner.warpBeat!(beat)
    if (inner.structuralVariants) {
      unplaced.structuralVariants = inner.structuralVariants.map(variant => framedMoverOrSplitter(variant, frame))
    }
    return unplaced
  }
  // The private frame starts from identity, not from the incoming copy. Equal
  // clocks and placement share it; matrix values are checked too because a
  // caller can reuse a world Matrix4 after editing it in place.
  const placementsAtBeat = memoizeEvaluation((_beat: number) => new Map<Matrix4 | undefined, {
    elements: number[] | undefined
    transformed: Matrix4 | undefined
  }>())
  const placementAt = (beat: number, input?: Matrix4) => {
    const placements = placementsAtBeat(beat)
    let cached = placements.get(input)
    if (!cached || (input && !input.elements.every((value, i) => Object.is(value, cached!.elements![i])))) {
      // A field uses only its frame's first slot. A compact frame must not be
      // expanded merely to read that one transform.
      const plan = compileParticlePlan(frame, 0, beat, input)
      const transform = plan ? (plan.count > 0 ? particlePlanMatrix(plan, 0, new Matrix4()) : undefined)
        : resolveVisualCopies(frame, beat, input)[0]?.transform
      const transformed = transform?.clone().invert()
      if (transformed && input) transformed.multiply(input)
      cached = { elements: input?.elements.slice(), transformed }
      placements.set(input, cached)
    }
    return cached.transformed
  }
  const framedEntry: MoverOrSplitter = {
    maxOutputCount: entryMaxOutputCount(inner),
    cachePolicy: inner.cachePolicy === 'static' && frame.every((entry) => entry.cachePolicy === 'static')
      ? 'static' : undefined,
    apply(visualCopy, context) {
      // Resolved from identity, so F is the frame's own accumulated motion. It
      // sees the object's placement too, so a world-placed mover can itself be
      // used as a frame.
      const placementTransform = placementAt(context.beat, context.placementTransform)
      if (!placementTransform) return inner.apply(visualCopy, context)
      return inner.apply(visualCopy, { ...context, placementTransform })
    },
  }
  if (inner.gpuAppearanceOnly && inner.gpuOperationAtBeat && !inner.applyFramed && !inner.emitsCopyClocks) {
    framedEntry.gpuOperationUsesPlacement = true
    framedEntry.gpuOperationPreservesDeterminant = true
    framedEntry.gpuOperationAtBeat = (beat, input) => {
      const placement = placementAt(beat, input) ?? input
      const operation = inner.gpuOperationAtBeat!(beat, placement)
      return { ...operation, appearancePlacement: operation.appearancePlacement ?? (placement ?? new Matrix4()).elements.slice() }
    }
    // This operation samples a private placement frame. Do not advertise the
    // simpler nested-slot appearance proof, which assumes ordinary placement.
  }
  // A frame reinterprets WHERE an entry acts, never when, so a time remap has to
  // pass straight through - dropping it here would silently un-freeze any Freeze
  // that happens to have a mover child.
  if (inner.warpBeat) framedEntry.warpBeat = (beat) => inner.warpBeat!(beat)
  return framedEntry
}
