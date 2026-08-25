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
 * A framed entry may also emit the TIME channel (`beatOffset` / `birthBeat` on
 * FramedVisualCopy - see types.ts): the kernel carries both per copy the same
 * way and evaluates every LATER entry at `context.beat = beat - offset`, with
 * `context.birthBeat` alongside. That is how an emitter (Stagger) gives each
 * copy its own clock: entries below it replay their material at each copy's
 * age, and latching entries sample at its birth. Offsets from nested emitters
 * sum; a later emitter's births overwrite an ancestor's; descendants of a copy
 * inherit both.
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
  // Two more lazy parallels, for the TIME channel a framed entry may emit
  // (types.ts): each copy's accumulated chain-clock lag (entries below run at
  // `beat - offset`; nested emitters SUM) and its latched birth beat (a later
  // emitter OVERWRITES an ancestor's). Null means "0 / undefined for every
  // copy", so ordinary chains pay nothing.
  let beatOffsets: number[] | null = null
  let birthBeats: (number | undefined)[] | null = null

  for (const moverOrSplitter of moverAndSplitterChain) {
    const previousVisualCopies = visualCopies
    const previousInternals = internals
    const previousOffsets = beatOffsets
    const previousBirths = birthBeats
    const count = previousVisualCopies.length
    const nextVisualCopies: VisualCopy[] = []
    let nextInternals: (Matrix4 | null)[] | null = null
    let nextOffsets: number[] | null = null
    let nextBirths: (number | undefined)[] | null = null
    const framed = moverOrSplitter.applyFramed
    // ONE context per step, re-pointed at each copy: `index`, `beat` and
    // `birthBeat` are the only fields that vary per copy, and the contract
    // (types.ts) makes the context read-only for the entry, so nothing
    // observes it mutating between calls. `formation` is the same reference
    // for the whole step, which is what makes measuring it once per frame safe
    // (see the contract in types.ts).
    const context: MoverOrSplitterContext = placementTransform
      ? { beat, index: 0, count, formation: previousVisualCopies, placementTransform }
      : { beat, index: 0, count, formation: previousVisualCopies }

    for (let index = 0; index < count; index++) {
      const visualCopy = previousVisualCopies[index]
      context.index = index
      const inheritedOffset = previousOffsets ? previousOffsets[index] : 0
      const inheritedBirth = previousBirths ? previousBirths[index] : undefined
      context.beat = beat - inheritedOffset
      context.birthBeat = inheritedBirth
      const inherited = previousInternals ? previousInternals[index] : null
      if (framed) {
        for (const { visualCopy: next, internalTransform, beatOffset, birthBeat } of framed.call(moverOrSplitter, visualCopy, context)) {
          const internal = inherited && internalTransform
            ? inherited.clone().multiply(internalTransform)
            : internalTransform ?? inherited
          if (internal && !nextInternals) {
            // First internal transform of the step: back-fill nulls for the
            // copies already emitted, then track per copy from here on.
            nextInternals = new Array<Matrix4 | null>(nextVisualCopies.length).fill(null)
          }
          const offset = inheritedOffset + (beatOffset ?? 0)
          if (offset !== 0 && !nextOffsets) {
            nextOffsets = new Array<number>(nextVisualCopies.length).fill(0)
          }
          const birth = birthBeat ?? inheritedBirth
          if (birth !== undefined && !nextBirths) {
            nextBirths = new Array<number | undefined>(nextVisualCopies.length).fill(undefined)
          }
          nextVisualCopies.push(next)
          if (nextInternals) nextInternals.push(internal)
          if (nextOffsets) nextOffsets.push(offset)
          if (nextBirths) nextBirths.push(birth)
        }
      } else {
        for (const next of moverOrSplitter.apply(visualCopy, context)) {
          if (inherited && !nextInternals) {
            nextInternals = new Array<Matrix4 | null>(nextVisualCopies.length).fill(null)
          }
          if (inheritedOffset !== 0 && !nextOffsets) {
            nextOffsets = new Array<number>(nextVisualCopies.length).fill(0)
          }
          if (inheritedBirth !== undefined && !nextBirths) {
            nextBirths = new Array<number | undefined>(nextVisualCopies.length).fill(undefined)
          }
          nextVisualCopies.push(next)
          if (nextInternals) nextInternals.push(inherited)
          if (nextOffsets) nextOffsets.push(inheritedOffset)
          if (nextBirths) nextBirths.push(inheritedBirth)
        }
      }
    }

    visualCopies = nextVisualCopies
    internals = nextInternals
    beatOffsets = nextOffsets
    birthBeats = nextBirths
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
