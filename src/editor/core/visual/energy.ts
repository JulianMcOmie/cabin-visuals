import type { ResolvedNote } from './types'

// The per-object energy signal: a decaying envelope from the most recent of
// the object's OWN notes at or before the current beat (intensity scaled by
// pitch). This was the Cube's original inline pulse, then the implicit
// `energy` port every object carried through the modulation matrix; with
// modulators and ports gone it is computed directly per frame. A pure
// function of (notes, beat) — scrub == playback.
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
