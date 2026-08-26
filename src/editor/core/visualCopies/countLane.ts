// Shared grammar for splitter COUNT lanes (Radial/Line's copies, Grid's rows,
// Symmetry's mirrors): a note's pitch names a whole-number count through the
// SAME integer row grid an automation lane on the param uses
// (automationIntegerGrid in core/trackTypes.ts - rows sit at the bottom of the
// 36-84 automation span, one per whole number counting up from the min), and
// the count JUMPS to that value at the note's onset and HOLDS until the next
// one - a step function, matching the 'step' interpolation integer automation
// lanes default to. Before the first onset (and with an empty lane) the count
// rests at the definition's own knob, or whatever automation put there. Note
// duration and velocity are ignored: a value is a destination (Waypoints'
// convention). Out-of-span pitches are dropped, so notes from a definition's
// retired vocabulary (mute maps at 96+, value rows above the count span)
// degrade to the knob instead of misreading.
//
// The copy-count invariant is kept the way an AUTOMATED count param keeps it:
// the resolved entry re-resolves the definition's layout at the sampled count
// (memoized per count - a cache, not playback state, so scrub == playback ==
// export), and publishes `structuralVariants` resolved at the largest and
// smallest counts the lane can reach, so the engine's structural probe mounts
// a pool that fits every beat and pads shrunken frames with hidden copies.
// resolveOwnMoverOrSplitter (core/visual/resolve.ts) reads these variants
// THROUGH its own automation wrapping, so the two mechanisms compose.

import type { MidiRowDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import { AUTOMATION_PITCH_MIN, automationIntegerGrid } from '../trackTypes'
import type { MoverOrSplitter } from './types'

export interface CountGate {
  beat: number
  value: number
}

/** The value the grid's k-th row names. The last row is pinned to the max, so
 *  a step that doesn't divide the span still tops out exactly on it - the same
 *  rule pitchToValueRanged applies to an integer automation lane. */
function rowValue(grid: ReturnType<typeof automationIntegerGrid>, k: number): number {
  return k === grid.rows - 1 ? grid.hi : grid.lo + k * grid.step
}

/** Rows top-down (top row = max, bottom row = exactly min), one per whole
 *  number, so the roll reads like an integer automation lane on the param. */
export function countLaneRows(min: number, max: number, singular: string, plural: string): MidiRowDef[] {
  const grid = automationIntegerGrid(min, max)
  const rows: MidiRowDef[] = []
  for (let k = grid.rows - 1; k >= 0; k--) {
    const value = rowValue(grid, k)
    rows.push({ pitch: AUTOMATION_PITCH_MIN + k, label: `${value} ${value === 1 ? singular : plural}` })
  }
  return rows
}

/** Sorted onsets with their named counts. Simultaneous onsets can't divide
 *  time, so chords collapse to one gate keeping the largest count (the sort
 *  puts it last in the beat group) - extractValueGates' rules. Out-of-span
 *  pitches are dropped, never clamped: a stray note from a retired vocabulary
 *  must no-op, not read as the max count. */
export function extractCountGates(notes: readonly ResolvedNote[], min: number, max: number): CountGate[] {
  const grid = automationIntegerGrid(min, max)
  return notes
    .filter((note) => note.pitch >= AUTOMATION_PITCH_MIN && note.pitch < AUTOMATION_PITCH_MIN + grid.rows)
    .map((note) => ({ beat: note.beat, value: rowValue(grid, note.pitch - AUTOMATION_PITCH_MIN) }))
    .sort((a, b) => a.beat - b.beat || a.value - b.value)
    .filter((gate, index, all) => index === all.length - 1 || all[index + 1].beat !== gate.beat)
}

/** The step latch: the most recent onset's count, resting before the first. */
export function countAt(gates: readonly CountGate[], beat: number, rest: number): number {
  if (gates.length === 0 || beat < gates[0].beat) return rest
  // Largest i with gates[i].beat <= beat (guaranteed 0 <= i by the guard).
  let lo = 0
  let hi = gates.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (gates[mid].beat <= beat) lo = mid
    else hi = mid - 1
  }
  return gates[lo].value
}

/**
 * Resolve a definition whose MIDI lane is a count lane on `key`. `resolveAt`
 * is the definition's whole layout as a pure function of settings - its old
 * resolve body, with no note reading of its own - and an empty lane returns
 * exactly `resolveAt(settings)`, so an untouched save stays bit-identical to
 * the pre-lane definition.
 */
export function resolveCountLane<S extends object>(args: {
  settings: S
  notes: readonly ResolvedNote[]
  /** The count param the lane drives. */
  key: keyof S & string
  min: number
  max: number
  resolveAt: (settings: S) => MoverOrSplitter
}): MoverOrSplitter {
  const { settings, notes, key, min, max, resolveAt } = args
  const gates = extractCountGates(notes, min, max)
  if (gates.length === 0) return resolveAt(settings)
  const grid = automationIntegerGrid(min, max)
  const stored = Number((settings as Record<string, unknown>)[key])
  const rest = Math.max(grid.lo, Math.min(grid.hi, Math.round(Number.isFinite(stored) ? stored : grid.lo)))
  // One resolved layout per distinct count, built on demand: the step latch
  // revisits the same few values, so this is a handful of layouts per resolve,
  // not one per frame.
  const byCount = new Map<number, MoverOrSplitter>()
  const atCount = (count: number): MoverOrSplitter => {
    let entry = byCount.get(count)
    if (!entry) {
      entry = resolveAt({ ...settings, [key]: count } as S)
      byCount.set(count, entry)
    }
    return entry
  }
  let maxCount = rest
  let minCount = rest
  for (const gate of gates) {
    if (gate.value > maxCount) maxCount = gate.value
    if (gate.value < minCount) minCount = gate.value
  }
  return {
    apply(visualCopy, context) {
      return atCount(countAt(gates, context.beat, rest)).apply(visualCopy, context)
    },
    composition: atCount(rest).composition,
    // Rank order matches resolveOwnMoverOrSplitter's automation variants:
    // maximum reach first, minimum second.
    structuralVariants: [atCount(maxCount), atCount(minCount)],
  }
}
