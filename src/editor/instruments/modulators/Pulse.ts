import type { ResolvedNote } from '../../core/engine/types'
import type { ModulatorInstrumentDef } from '../types'

// The library def: a Pulse modulator targets the (internal) `energy` port of
// whatever object track it's routed to. Its own notes are the triggers.
export const pulseModulator: ModulatorInstrumentDef = {
  id: 'pulse',
  name: 'Pulse',
  kind: 'modulator',
  signal: 'pulse',
  port: 'energy',
}

// Pulse modulator: a decaying envelope from the most recent trigger note at or
// before the current beat (intensity scaled by pitch). This is the Cube's old
// inline pulse, generalized to drive a port from any trigger stream.
const DECAY_BEATS = 0.45
const LOWEST_MIDI_PITCH = 24
const PULSE_DAMPENER = 20

export function evaluatePulse(triggers: ResolvedNote[], beat: number): number {
  let closest = Infinity
  let intensity = 1
  for (const n of triggers) {
    if (beat < n.blockStartBeat || beat > n.blockEndBeat) continue
    if (n.beat <= beat) {
      const since = beat - n.beat
      if (since < closest) {
        intensity = n.pitch - LOWEST_MIDI_PITCH + 1
        closest = since
      }
    }
  }
  if (closest === Infinity) return 0
  return Math.max(0, (intensity / PULSE_DAMPENER) * (1 - closest / DECAY_BEATS))
}
