import type { Matrix4 } from 'three'
import { identityVisualCopy } from './identityVisualCopy'
import type { MoverOrSplitter, MoverOrSplitterContext, VisualCopy } from './types'
import { withCopyEvaluation } from './evaluationMemo'
import { particleLocalLayout, particlePlanEntryKind } from './particlePlan'

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
 * inherit both. An entry may OPT OUT of a prefix of those emitters via
 * `clockSkipEmitters` (types.ts) - the resolver's position routing, which
 * reorders emitters to the chain front and stamps each entry with how many of
 * them sit above it in the user's pipeline; such an entry runs on the
 * remaining suffix's clock (fully live at skip = all), while `birthBeat` is
 * handed over regardless.
 *
 * No MIDI, automation, envelope, project-track, React, or instrument logic
 * belongs here - definitions close over whatever resolved data they need.
 */
/** The per-copy TIME channel of one kernel evaluation, for callers that need
 *  it (VisualEngine's per-copy object states). Null arrays mean "0 / undefined
 *  for every copy" - the common case, at zero cost. */
export interface CopyClocks {
  beatOffsets: readonly number[] | null
  birthBeats: readonly (number | undefined)[] | null
  /** Per copy: the accumulated offset AFTER each emitter ran, in emitter order
   *  (so `beatOffsets[i] === checkpoints[i][last]` whenever both exist). This
   *  is what lets a consumer subtract a PREFIX of the emitters back out - the
   *  suffix arithmetic behind `clockSkipEmitters` (`copyClockShift` below). */
  checkpoints: readonly (readonly number[] | null)[] | null
}

/** The chain-clock shift an entry (or lane) with `clockSkipEmitters = skip`
 *  experiences on a copy whose total offset is `total` with the given emitter
 *  checkpoints: the offsets of the emitters it does NOT skip - a suffix, since
 *  skipped emitters are exactly the ones above it in the pipeline. skip 0 is
 *  the whole offset (the pattern case); skip ≥ the emitters seen is 0 (live). */
export function copyClockShift(
  total: number,
  checkpoints: readonly number[] | null | undefined,
  skip: number,
): number {
  if (skip <= 0) return total
  if (!checkpoints || checkpoints.length === 0) return 0
  if (skip >= checkpoints.length) return 0
  return total - checkpoints[skip - 1]
}

/** True when any entry declares it may emit the per-copy time channel - the
 *  STRUCTURAL question the engine sizes per-copy state against (see
 *  `MoverOrSplitter.emitsCopyClocks`). */
export function chainEmitsCopyClocks(moverAndSplitterChain: readonly MoverOrSplitter[]): boolean {
  return moverAndSplitterChain.some((entry) => entry.emitsCopyClocks)
}

export function resolveVisualCopies(
  moverAndSplitterChain: MoverOrSplitter[],
  beat: number,
  placementTransform?: Matrix4,
  /** Filled with the evaluation's per-copy clocks when provided. */
  clocksOut?: CopyClocks,
): VisualCopy[] {
  return withCopyEvaluation(() => resolveCopyChain(moverAndSplitterChain, beat, placementTransform, clocksOut))
}

function resolveCopyChain(
  moverAndSplitterChain: MoverOrSplitter[],
  beat: number,
  placementTransform?: Matrix4,
  clocksOut?: CopyClocks,
  initialCopies?: VisualCopy[],
): VisualCopy[] {
  let visualCopies = initialCopies ?? [identityVisualCopy()]
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
  // Per copy: accumulated offset after each emitter, in emitter order. What the
  // suffix arithmetic behind `clockSkipEmitters` subtracts against - see
  // `copyClockShift`. Lazy like the others; appended to only on emitter steps.
  let clockCheckpoints: (readonly number[] | null)[] | null = null

  for (const moverOrSplitter of moverAndSplitterChain) {
    const previousVisualCopies = visualCopies
    const previousInternals = internals
    const previousOffsets = beatOffsets
    const previousBirths = birthBeats
    const previousCheckpoints = clockCheckpoints
    const count = previousVisualCopies.length
    const nextVisualCopies: VisualCopy[] = []
    let nextInternals: (Matrix4 | null)[] | null = null
    let nextOffsets: number[] | null = null
    let nextBirths: (number | undefined)[] | null = null
    let nextCheckpoints: (readonly number[] | null)[] | null = null
    const skipEmitters = moverOrSplitter.clockSkipEmitters ?? 0
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
      const inheritedCheckpoints = previousCheckpoints ? previousCheckpoints[index] : null
      // The entry's clock: the inherited offset minus the emitters it skips
      // (those above it in the pipeline - see `clockSkipEmitters` in types.ts).
      // birthBeat is handed over regardless, so a live entry still latches.
      context.beat = beat - (skipEmitters > 0
        ? copyClockShift(inheritedOffset, inheritedCheckpoints, skipEmitters)
        : inheritedOffset)
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
          if (inheritedCheckpoints && !nextCheckpoints) {
            nextCheckpoints = new Array<readonly number[] | null>(nextVisualCopies.length).fill(null)
          }
          nextVisualCopies.push(next)
          if (nextInternals) nextInternals.push(internal)
          if (nextOffsets) nextOffsets.push(offset)
          if (nextBirths) nextBirths.push(birth)
          if (nextCheckpoints) nextCheckpoints.push(inheritedCheckpoints)
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
          if (inheritedCheckpoints && !nextCheckpoints) {
            nextCheckpoints = new Array<readonly number[] | null>(nextVisualCopies.length).fill(null)
          }
          nextVisualCopies.push(next)
          if (nextInternals) nextInternals.push(inherited)
          if (nextOffsets) nextOffsets.push(inheritedOffset)
          if (nextBirths) nextBirths.push(inheritedBirth)
          if (nextCheckpoints) nextCheckpoints.push(inheritedCheckpoints)
        }
      }
    }

    // An emitter step closes a checkpoint: every output copy records its
    // accumulated offset so far, in emitter order - the prefix sums that let a
    // later entry's `clockSkipEmitters` subtract this emitter back out. The
    // arrays are per copy (cloned on append, shared on inheritance), so a
    // targeted emitter's pass-through copies checkpoint their unchanged total.
    if (moverOrSplitter.emitsCopyClocks) {
      const appended: (readonly number[] | null)[] = new Array(nextVisualCopies.length)
      for (let i = 0; i < nextVisualCopies.length; i++) {
        const inheritedCp = nextCheckpoints ? nextCheckpoints[i] : null
        const total = nextOffsets ? nextOffsets[i] : 0
        appended[i] = inheritedCp ? [...inheritedCp, total] : [total]
      }
      nextCheckpoints = appended
    }

    visualCopies = nextVisualCopies
    internals = nextInternals
    beatOffsets = nextOffsets
    birthBeats = nextBirths
    clockCheckpoints = nextCheckpoints
  }

  if (clocksOut) {
    clocksOut.beatOffsets = beatOffsets
    clocksOut.birthBeats = birthBeats
    clocksOut.checkpoints = clockCheckpoints
  }

  if (!internals) return visualCopies
  const folded = internals
  return visualCopies.map((visualCopy, index) => {
    const internal = folded[index]
    if (!internal) return visualCopy
    return { ...visualCopy, transform: visualCopy.transform.clone().multiply(internal) }
  })
}

/** Retained evaluator owned by one render track. Returned copies/clocks are
 * immutable views: a consumer that pads/truncates must copy the array first.
 * Static ordinary prefixes can be reused ahead of animated suffixes. Framed
 * prefixes are never folded early, since their internal motion must remain
 * separate until all downstream entries have run. */
export function createVisualCopyEvaluator(): typeof resolveVisualCopies {
  let entries: MoverOrSplitter[] | undefined
  let signatures: MoverOrSplitter[] = []
  let placement: number[] | undefined
  let prefixLength = 0
  let prefix: MoverOrSplitter[] = []
  let suffix: MoverOrSplitter[] = []
  let prefixCopies: VisualCopy[] | undefined
  let lastCopies: VisualCopy[] | undefined
  let lastBeat = Number.NaN
  let reusable = false
  let staticChain = false
  const clocks: CopyClocks = { beatOffsets: null, birthBeats: null, checkpoints: null }
  return (chain, beat, placementTransform, clocksOut) => {
    const sameChain = entries?.length === chain.length && chain.every((entry, i) => {
      const previous = signatures[i]
      return entries![i] === entry && previous.apply === entry.apply
        && previous.applyFramed === entry.applyFramed && previous.cachePolicy === entry.cachePolicy
        && previous.clockSkipEmitters === entry.clockSkipEmitters && previous.emitsCopyClocks === entry.emitsCopyClocks
    })
    if (!sameChain) {
      entries = chain.slice()
      signatures = chain.map((entry) => ({ ...entry }))
      reusable = chain.every((entry) => entry.cachePolicy !== undefined)
      staticChain = chain.every((entry) => entry.cachePolicy === 'static' && !entry.emitsCopyClocks)
      prefixLength = 0
      while (prefixLength < chain.length && chain[prefixLength].cachePolicy === 'static'
        && !chain[prefixLength].applyFramed && !chain[prefixLength].emitsCopyClocks) prefixLength++
      prefix = chain.slice(0, prefixLength)
      suffix = chain.slice(prefixLength)
      prefixCopies = undefined
      lastCopies = undefined
    }
    const elements = placementTransform?.elements
    const samePlacement = elements
      ? !!placement && elements.every((value, i) => Object.is(value, placement![i]))
      : placement === undefined
    if (!samePlacement) {
      placement = elements?.slice()
      prefixCopies = undefined
      lastCopies = undefined
    }
    if (!lastCopies || !(staticChain || Object.is(lastBeat, beat))) {
      const copies = withCopyEvaluation(() => {
        if (prefixLength && !prefixCopies) prefixCopies = resolveCopyChain(prefix, beat, placementTransform)
        return resolveCopyChain(suffix, beat, placementTransform, clocks, prefixCopies)
      })
      lastBeat = beat
      if (clocksOut) Object.assign(clocksOut, clocks)
      if (reusable) lastCopies = copies
      return copies
    }
    if (clocksOut) Object.assign(clocksOut, clocks)
    return lastCopies
  }
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
 *
 * A caller that has just evaluated the plain chain at beat 0 passes its count
 * as `plainCount`, so the probe does not evaluate it a second time - that
 * evaluation allocates a matrix per copy, and on a 50k-copy chain it is most
 * of the cost of an edit.
 */
export function structuralCopyCount(
  moverAndSplitterChain: MoverOrSplitter[],
  plainCount?: number,
): number {
  // Structural UI queries must not expand a factored million-copy layout.
  const factoredCount = (chain: MoverOrSplitter[]) => chain.every(entry => particlePlanEntryKind(entry) !== undefined)
    ? chain.reduce((count, entry) => count * (entry.rootTransform || entry.rootTransformAtBeat
      ? 1 : entry.framedLocalTransformsAtBeat ? entry.framedLocalTransformsAtBeat(0).frames.length
        : particleLocalLayout(entry, 0)!.transforms.length), 1) : undefined
  let count = plainCount ?? factoredCount(moverAndSplitterChain) ?? resolveVisualCopies(moverAndSplitterChain, 0).length
  const variantRanks = Math.max(
    0,
    ...moverAndSplitterChain.map((entry) => entry.structuralVariants?.length ?? 0),
  )
  for (let rank = 0; rank < variantRanks; rank++) {
    const probeChain = moverAndSplitterChain.map(
      (entry) => entry.structuralVariants?.[rank] ?? entry,
    )
    count = Math.max(count, factoredCount(probeChain) ?? resolveVisualCopies(probeChain, 0).length)
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
