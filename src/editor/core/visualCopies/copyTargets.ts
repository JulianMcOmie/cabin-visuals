// Copy targeting: which of the copies handed to a chain entry it actually acts
// on. Absent targeting means all of them, which is what every entry did before
// this module existed and what nearly every entry still does.
//
// The whole vocabulary is a SLICE COUNT plus which slices are on. Two rules cut
// the slices, both reading only the copy's place in the chain's emission order
// (`index` of `count`, both fixed at resolve):
//
//   every — interleaved, `index % slices`. "Every other copy", "every 3rd".
//   runs  — contiguous, `floor(index / count * slices)`. Stretches of the order.
//
// Reading only index/count is what makes this beat-independent for free: the
// copy-count contract (types.ts) says a splitter's slot count may not depend on
// the beat, and a gate that measured POSITIONS instead would break it the moment
// a mover above animated one copy across a boundary.
//
// This module keeps the visualCopies isolation rule: no instruments, stores,
// React, or project-track types. `CopyTargetSelection` is mirrored structurally
// by `CopyTargets` in editor/types.ts (the document schema owns its own copy so
// the document never depends on the engine); resolve.ts passes one to the other,
// so the two cannot drift without a type error there.

import type { MoverOrSplitter } from './types'

export type CopyTargetRule = 'every' | 'runs'

export interface CopyTargetSelection {
  rule: CopyTargetRule
  /** How many slices the incoming copies are cut into. */
  slices: number
  /** Which of those slices this entry acts on, as 0-based slice indices.
   *  Never mutated here - it is mutable only so a normalized selection is
   *  assignable straight back to the document's `CopyTargets`. */
  on: number[]
}

export const COPY_TARGET_MIN_SLICES = 2
export const COPY_TARGET_MAX_SLICES = 12

/** The slice count actually in force. Clamped to the range the panel offers and
 *  never above the copy count - cutting 12 slices out of 4 copies would leave
 *  eight of them permanently empty, and the stepper would keep moving with no
 *  effect on the picture. */
export function copyTargetSlices(selection: CopyTargetSelection, count: number): number {
  const asked = Math.round(selection.slices)
  const ceiling = Math.max(COPY_TARGET_MIN_SLICES, Math.min(COPY_TARGET_MAX_SLICES, Math.max(1, count)))
  if (!Number.isFinite(asked)) return COPY_TARGET_MIN_SLICES
  return Math.max(COPY_TARGET_MIN_SLICES, Math.min(asked, ceiling))
}

/** Which slice one copy falls in. */
export function copyTargetSliceOf(index: number, count: number, selection: CopyTargetSelection): number {
  const slices = copyTargetSlices(selection, count)
  if (selection.rule === 'every') return ((index % slices) + slices) % slices
  const total = Math.max(1, count)
  return Math.max(0, Math.min(slices - 1, Math.floor((index / total) * slices)))
}

/** The gate itself. No selection at all = every copy, which is the default. */
export function copyIsTargeted(
  index: number,
  count: number,
  selection: CopyTargetSelection | undefined,
): boolean {
  if (!selection) return true
  return selection.on.includes(copyTargetSliceOf(index, count, selection))
}

/** The full slice map for a formation - what the settings panel's window draws,
 *  and the one place the panel and the engine agree on which copy is which. */
export function copyTargetMask(count: number, selection: CopyTargetSelection | undefined): boolean[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => copyIsTargeted(i, count, selection))
}

/** Neutral targeting is stored as ABSENCE, so an untouched device never grows a
 *  field and every save written before this feature keeps resolving identically.
 *  Every slice on is the same thing as no targeting at all - both mean "all
 *  copies" - so it normalizes away too, and the panel's ALL segment is simply
 *  this returning undefined. */
export function normalizeCopyTargets(
  selection: CopyTargetSelection | undefined,
  count: number,
): CopyTargetSelection | undefined {
  if (!selection) return undefined
  const slices = copyTargetSlices(selection, count)
  const on = [...new Set(selection.on.filter((i) => Number.isInteger(i) && i >= 0 && i < slices))].sort((a, b) => a - b)
  if (on.length >= slices) return undefined
  return { rule: selection.rule, slices, on }
}

/**
 * Wraps one resolved chain entry so it only touches the copies it targets.
 * A copy outside the selection is RETURNED UNCHANGED - not hidden, not dropped -
 * so a splitter fans out only the copies it owns and everything else passes
 * through 1:1. Copy count therefore stays a pure function of settings, which is
 * what `structuralCopyCount` needs (it probes this same gated chain, so the
 * mounted pool is sized against what the gate actually produces).
 *
 * `warpBeat` is deliberately NOT gated. A time remap reaches the whole object by
 * contract (see types.ts) - it cannot be partitioned across copies of that
 * object - so a Freeze with copy targeting still freezes everything, and the
 * panel says so rather than offering a control that quietly does nothing.
 */
export function gatedMoverOrSplitter(
  entry: MoverOrSplitter,
  selection: CopyTargetSelection,
): MoverOrSplitter {
  const gated: MoverOrSplitter = {
    apply(visualCopy, context) {
      if (!copyIsTargeted(context.index, context.count, selection)) return [visualCopy]
      return entry.apply(visualCopy, context)
    },
  }
  if (entry.composition) gated.composition = entry.composition
  if (entry.emitsCopyClocks) gated.emitsCopyClocks = true
  if (entry.applyFramed) {
    const applyFramed = entry.applyFramed.bind(entry)
    gated.applyFramed = (visualCopy, context) =>
      copyIsTargeted(context.index, context.count, selection)
        ? applyFramed(visualCopy, context)
        // An untargeted copy keeps whatever internal motion it inherited: the
        // kernel carries `internals` itself and reads `undefined` here as "this
        // entry contributed none", which is exactly right.
        : [{ visualCopy }]
  }
  if (entry.warpBeat) {
    const warpBeat = entry.warpBeat.bind(entry)
    gated.warpBeat = (beat) => warpBeat(beat)
  }
  // The structural probe must see the GATED counts, or the mounted pool is sized
  // for a splitter that fans out every copy when it only fans out a third.
  if (entry.structuralVariants) {
    gated.structuralVariants = entry.structuralVariants.map((variant) => gatedMoverOrSplitter(variant, selection))
  }
  return gated
}
