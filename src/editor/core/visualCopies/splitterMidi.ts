// Shared MIDI grammar for slot-gating splitters (Radial, Grid, Polyhedron):
// rows count DOWN from pitch 127, one row per slot (or per slot range when the
// slot count exceeds 128 pitches), and a held note drives its slots' opacity to
// zero. Notes never add or remove slots - the count stays structural so
// downstream indices are stable.

import type { MidiRowDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'

const SPLITTER_TOP_PITCH = 127
const MIDI_PITCH_COUNT = 128

export function splitterMidiRows(count: number, singular: string, plural: string): MidiRowDef[] {
  const rowCount = Math.min(MIDI_PITCH_COUNT, count)
  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const first = Math.floor((rowIndex * count) / rowCount) + 1
    const last = Math.floor(((rowIndex + 1) * count) / rowCount)
    const label = first === last ? `Disable ${singular} ${first}` : `Disable ${plural} ${first}–${last}`
    return { pitch: SPLITTER_TOP_PITCH - rowIndex, label }
  })
}

export function noteDisablesSplitterSlot(
  notes: readonly ResolvedNote[],
  beat: number,
  slot: number,
  slotCount: number,
): boolean {
  const rowCount = Math.min(MIDI_PITCH_COUNT, slotCount)
  const rowIndex = Math.min(rowCount - 1, Math.floor((slot * rowCount) / slotCount))
  const pitch = SPLITTER_TOP_PITCH - rowIndex
  return notes.some((note) =>
    note.pitch === pitch && beat >= note.beat && beat < note.beat + (note.durationBeats || 0.05),
  )
}
