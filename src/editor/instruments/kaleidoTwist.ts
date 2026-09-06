import { midiVelocity } from '../utils/midiVelocity'
import type { ResolvedNote } from '../core/visual/types'

// Kaleido Solid's note response, kept in its own module with NO engine or React
// imports. Importing the component pulls in useInstrumentFrame -> instrumentColor
// -> the instrument registry, which imports the component back: a colocated test
// that reached for this through the component would die in that cycle
// ("Cannot access 'kaleidoSolidInstrument' before initialization"). Same reason
// laserSphereCore.ts exists.

/** How long a twist takes to settle, in beats. */
export const TWIST_SETTLE_BEATS = 0.35
/** Radians of barrel rotation a full-strength note is worth. */
export const TWIST_PER_NOTE = 0.9

/** The pitch range the instrument's declared MIDI rows span. */
const TWIST_PITCH_LOW = 44
const TWIST_PITCH_HIGH = 76

/**
 * Total barrel rotation at `beat` - a PURE function of the note stream, which is
 * what keeps scrub identical to playback and export frame-exact. Every note
 * already played contributes a permanent step that eases in over
 * TWIST_SETTLE_BEATS, so the pattern lurches on the hit and holds its new
 * arrangement between hits. Pitch sets the coarse size of the step, velocity
 * scales it.
 *
 * Deliberately NOT an accumulator advanced per frame: that would depend on how
 * many frames had been drawn, so scrubbing back would not restore the angle.
 */
export function barrelTwist(notes: readonly ResolvedNote[], beat: number): number {
  let twist = 0
  for (const note of notes) {
    if (note.beat > beat) continue
    const velocity = midiVelocity(note.velocity)
    const pitchSpan = Math.max(0, Math.min(1, (note.pitch - TWIST_PITCH_LOW) / (TWIST_PITCH_HIGH - TWIST_PITCH_LOW)))
    const step = TWIST_PER_NOTE * (0.3 + 0.7 * pitchSpan) * (0.45 + 0.55 * Math.min(1, velocity))
    twist += step * (1 - Math.exp(-(beat - note.beat) / TWIST_SETTLE_BEATS))
  }
  return twist
}
