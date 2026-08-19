import type { Matrix4 } from 'three'
import { identityVisualCopy } from './identityVisualCopy'
import type { MoverOrSplitter, MoverOrSplitterContext, VisualCopy } from './types'

/**
 * Evaluates an ordered mover-and-splitter chain at one beat.
 *
 * Ordering rules (all deterministic):
 *  1. Chain entries execute strictly top to bottom.
 *  2. A step processes input copies in their existing order.
 *  3. A splitter emits slots in its own declared slot order.
 *  4. Nested output order is input-major, then splitter-slot order.
 *  5. The next step receives `index`/`count` for the complete result of the
 *     previous step.
 *
 * Every copy's `transform` is its REFERENCE FRAME as far as the steps are
 * concerned. A step that also produces motion INTERNAL to a copy (a mover
 * nested under a splitter - see `FramedVisualCopy`) hands it over separately
 * via `applyFramed`; the kernel carries it per copy through the remaining
 * steps - descendants of a copy inherit its internal motion, later internal
 * contributions compose inside inherited ones - and folds it into the final
 * transforms (`frame · internal`) only on the copies it returns. That split is
 * what keeps a nested mover's animation out of the frame downstream entries
 * build in: a second grid duplicates a spinning sub-grid rather than laying
 * its cells out in a spinning frame.
 *
 * No MIDI, automation, envelope, project-track, React, or instrument logic
 * belongs here - definitions close over whatever resolved data they need.
 */
export function resolveVisualCopies(
  moverAndSplitterChain: MoverOrSplitter[],
  beat: number,
  placementTransform?: Matrix4,
): VisualCopy[] {
  let visualCopies = [identityVisualCopy()]
  // Parallel to visualCopies: each copy's accumulated internal motion, or null.
  // Materialized lazily - a chain with no `applyFramed` entry never has an
  // internal transform to carry, and most chains are exactly that, so the
  // parallel arrays (one per step, one push per copy) are only built once a
  // framed entry actually hands one over. Until then `internals` is null and
  // means "null for every copy".
  let internals: (Matrix4 | null)[] | null = null

  for (const moverOrSplitter of moverAndSplitterChain) {
    const previousVisualCopies = visualCopies
    const previousInternals = internals
    const count = previousVisualCopies.length
    const nextVisualCopies: VisualCopy[] = []
    let nextInternals: (Matrix4 | null)[] | null = null
    const framed = moverOrSplitter.applyFramed
    // ONE context per step, re-pointed at each copy: `index` is the only field
    // that varies per copy, and the contract (types.ts) makes the context
    // read-only for the entry, so nothing observes it mutating between calls.
    // `formation` is the same reference for the whole step, which is what makes
    // measuring it once per frame safe (see the contract in types.ts).
    const context: MoverOrSplitterContext = placementTransform
      ? { beat, index: 0, count, formation: previousVisualCopies, placementTransform }
      : { beat, index: 0, count, formation: previousVisualCopies }

    for (let index = 0; index < count; index++) {
      const visualCopy = previousVisualCopies[index]
      context.index = index
      const inherited = previousInternals ? previousInternals[index] : null
      if (framed) {
        for (const { visualCopy: next, internalTransform } of framed.call(moverOrSplitter, visualCopy, context)) {
          const internal = inherited && internalTransform
            ? inherited.clone().multiply(internalTransform)
            : internalTransform ?? inherited
          if (internal && !nextInternals) {
            // First internal transform of the step: back-fill nulls for the
            // copies already emitted, then track per copy from here on.
            nextInternals = new Array<Matrix4 | null>(nextVisualCopies.length).fill(null)
          }
          nextVisualCopies.push(next)
          if (nextInternals) nextInternals.push(internal)
        }
      } else {
        for (const next of moverOrSplitter.apply(visualCopy, context)) {
          if (inherited && !nextInternals) {
            nextInternals = new Array<Matrix4 | null>(nextVisualCopies.length).fill(null)
          }
          nextVisualCopies.push(next)
          if (nextInternals) nextInternals.push(inherited)
        }
      }
    }

    visualCopies = nextVisualCopies
    internals = nextInternals
  }

  if (!internals) return visualCopies
  const folded = internals
  return visualCopies.map((visualCopy, index) => {
    const internal = folded[index]
    if (!internal) return visualCopy
    return { ...visualCopy, transform: visualCopy.transform.clone().multiply(internal) }
  })
}

/**
 * The STRUCTURAL copy count of a chain: an upper bound on how many copies it
 * can produce at any beat, which is what the renderer mounts. Copy count is
 * beat-independent by contract, so one evaluation at an arbitrary beat answers
 * for a plain chain; entries whose settings vary with the beat carry
 * `structuralVariants` (min/max-reach resolutions), and the count is the max
 * over the chain evaluated with each variant rank swapped in. Per-entry counts
 * multiply independently down the chain, so the all-max chain IS the maximum -
 * no cross-entry combinations are needed.
 */
export function structuralCopyCount(moverAndSplitterChain: MoverOrSplitter[]): number {
  let count = resolveVisualCopies(moverAndSplitterChain, 0).length
  const variantRanks = Math.max(
    0,
    ...moverAndSplitterChain.map((entry) => entry.structuralVariants?.length ?? 0),
  )
  for (let rank = 0; rank < variantRanks; rank++) {
    const probeChain = moverAndSplitterChain.map(
      (entry) => entry.structuralVariants?.[rank] ?? entry,
    )
    count = Math.max(count, resolveVisualCopies(probeChain, 0).length)
  }
  return count
}

/**
 * The beat an object should actually be evaluated at, given the real playhead
 * beat and the object's chain (see `MoverOrSplitter.warpBeat`).
 *
 * Entries compose by SUMMING their deltas against the real beat rather than by
 * feeding each one the previous one's output: every entry closed over notes
 * sitting at true timeline positions, so handing a second one an
 * already-remapped beat would have it read its own notes at the wrong times.
 */
export function warpChainBeat(moverAndSplitterChain: MoverOrSplitter[], beat: number): number {
  let delta = 0
  for (const moverOrSplitter of moverAndSplitterChain) {
    if (!moverOrSplitter.warpBeat) continue
    delta += moverOrSplitter.warpBeat(beat) - beat
  }
  return delta === 0 ? beat : beat + delta
}
