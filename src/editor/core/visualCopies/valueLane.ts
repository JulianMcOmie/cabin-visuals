// Shared grammar for splitter VALUE lanes (Radial's radius, Grid's spacing):
// a note's pitch names a value through the automation 36-84 encoding, and the
// value swells 0 -> value -> 0 between consecutive onsets on the cycle
// automation default's closed form, resting at the definition's own knob
// outside the gated span. One home so two lanes asking "what does this pitch
// mean" can never answer differently.

import type { MidiRowDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import { AUTOMATION_PITCH_MAX, AUTOMATION_PITCH_MIN, pitchToValue } from '../trackTypes'

export interface ValueGate {
  beat: number
  value: number
}

/** Rows spanning the automation pitch range top-down (top row = max, bottom
 *  row = exactly min) so the roll reads like an automation lane's value rows.
 *  `pitchStep` thins the rows out to detents - fewer rows to scan - while every
 *  in-span pitch still decodes as a value, so a note dragged between detents
 *  keeps meaning what the encoding says. Steps that divide the 48-pitch span
 *  keep both endpoints as rows, which is what guarantees min itself is
 *  reachable. */
export function valueLaneRows(prefix: string, min: number, max: number, pitchStep = 1): MidiRowDef[] {
  const rows: MidiRowDef[] = []
  for (let pitch = AUTOMATION_PITCH_MAX; pitch >= AUTOMATION_PITCH_MIN; pitch -= pitchStep) {
    rows.push({ pitch, label: `${prefix} ${pitchToValue(pitch, min, max).toFixed(1)}` })
  }
  return rows
}

/** Sorted onsets with pitch-mapped values. Simultaneous onsets can't divide
 *  time, so chords collapse to one boundary keeping the largest value (the
 *  sort puts it last in the beat group) - the same rules as extractCycleGates
 *  in core/visual/automation.ts. Out-of-span pitches (e.g. a retired mute
 *  map's 96-127) are dropped, so old saves degrade to the knob instead of
 *  misreading. */
export function extractValueGates(notes: readonly ResolvedNote[], min: number, max: number): ValueGate[] {
  return notes
    .filter((note) => note.pitch >= AUTOMATION_PITCH_MIN && note.pitch <= AUTOMATION_PITCH_MAX)
    .map((note) => ({ beat: note.beat, value: pitchToValue(note.pitch, min, max) }))
    .sort((a, b) => a.beat - b.beat || a.value - b.value)
    .filter((gate, index, all) => index === all.length - 1 || all[index + 1].beat !== gate.beat)
}

/** The cycle-automation default swell in closed form: with control points at
 *  (1/3, 4/3) and (2/3, 4/3) the bezier's x(t) = t exactly, and y reduces to
 *  4u(1-u) - symmetric, 0 at both onsets, peak `value` mid-cycle. Outside the
 *  gated span (or with fewer than two gates - a lone onset has nothing to
 *  stretch to) the lane rests at `rest`. */
export function cycleValueAt(gates: readonly ValueGate[], beat: number, rest: number): number {
  const n = gates.length
  if (n < 2 || beat < gates[0].beat || beat >= gates[n - 1].beat) return rest
  // Largest i with gates[i].beat <= beat (guaranteed 0 <= i < n-1 by the guards).
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (gates[mid].beat <= beat) lo = mid
    else hi = mid - 1
  }
  const a = gates[lo]
  const b = gates[lo + 1]
  const u = (beat - a.beat) / (b.beat - a.beat)
  return 4 * u * (1 - u) * a.value
}
