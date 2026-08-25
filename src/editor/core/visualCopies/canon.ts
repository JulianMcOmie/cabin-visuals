// Canon: the TIME emitter. It makes no shape of its own - it fans N copies of
// whatever reaches it and gives each one its OWN CLOCK, phase-spread through a
// looping cycle. Every chain entry BELOW it then runs on each copy's clock,
// so one authored pattern - a size ramp, a mover's phrase - replays per copy,
// staggered; the Canon owns the only loop, so the pattern is authored ONCE and
// never needs a looped block of its own.
//
// The mental model it was built for (nested shapes forever expanding to fill
// the frame): a single 0→PERIOD expansion curve above it in the track order
// (the existing "lane above a splitter animates each copy" weave), the Canon,
// and a Colorizer below in its "At birth" sample mode with one note per copy
// birth - red, blue, green, yellow. Each shell replays the expansion at its
// own age and keeps the color its note said the moment it was born.
//
// Two clocks per copy, both closed-form pure functions of the beat (no state,
// so pause/scrub/export agree exactly):
//
//  - AGE: `mod(beat - i·interval, period)`, where interval = period/copies.
//    Copy i's downstream `context.beat` IS its age - it ramps 0→PERIOD from
//    each birth and wraps. Emitted as `beatOffset = beat - age` (the kernel
//    subtracts; nested Canons sum, each measuring in the clock it was handed).
//  - BIRTH: `beat - age`, the absolute beat of the copy's last wrap. Emitted
//    as `birthBeat`, the latch clock sequenced entries below may sample at
//    (`MoverOrSplitterContext.birthBeat`). Births occur in copy order - copy 0
//    wraps first each cycle - every `interval` beats.
//
// Copies before their first birth (early beats) carry a NEGATIVE birth: they
// start mid-flight, evenly phased from beat 0, and a latching entry finds
// nothing sounding before the timeline and stays silent - predictable, and
// what keeps the math one formula with no start-up special case.
//
// The time channel rides `applyFramed` (types.ts): `apply` returns the same
// copies with the clocks dropped, which is unobservable - offsets only steer
// entries below, and direct callers / a chain's last entry have none. The
// copies themselves are untouched clones (identity transform contribution),
// so a Canon with nothing below it renders as N stacked twins: it is a time
// device, and space is other devices' job. No MIDI vocabulary, no shared SIZE
// knob (it lays nothing out), no persistence upgrade (new id, absent keys
// merge to defaults).

import type { MoverOrSplitterDefinition } from './definitions'
import { CANON_COLOR } from './identityColors'
import type { VisualCopy } from './types'

export interface CanonSettings {
  /** How many copies exist at once - the cycle is phase-divided among them. */
  copies: number
  /** One copy's full cycle, in beats: its clock runs 0→period, then wraps. */
  period: number
}

export const CANON_MAX_COPIES = 24

const cloneCopy = (visualCopy: VisualCopy): VisualCopy => ({
  transform: visualCopy.transform.clone(),
  opacity: visualCopy.opacity,
  colorShift: { ...visualCopy.colorShift },
})

/** True mathematical mod - the phase must stay in [0, period) at beats before
 *  a copy's first birth, where the JS remainder goes negative. */
const positiveMod = (value: number, period: number): number => {
  const remainder = value % period
  return remainder < 0 ? remainder + period : remainder
}

export const canonSplitter: MoverOrSplitterDefinition<CanonSettings> = {
  id: 'canon',
  label: 'Canon',
  kind: 'splitter',
  identityColor: CANON_COLOR,
  params: [
    { key: 'copies', label: 'Copies', min: 1, max: CANON_MAX_COPIES, step: 1, default: 4 },
    { key: 'period', label: 'Period (beats)', min: 0.25, max: 32, step: 0.25, default: 4 },
  ],
  midiRows: () => [],
  strictMidiRows: true,
  resolve({ settings }) {
    const count = Math.max(1, Math.min(CANON_MAX_COPIES, Math.round(settings.copies)))
    const period = Math.max(0.25, settings.period ?? 4)
    const interval = period / count
    return {
      apply(visualCopy) {
        return Array.from({ length: count }, () => cloneCopy(visualCopy))
      },
      applyFramed(visualCopy, { beat }) {
        return Array.from({ length: count }, (_, index) => {
          const age = positiveMod(beat - index * interval, period)
          const birth = beat - age
          return { visualCopy: cloneCopy(visualCopy), beatOffset: birth, birthBeat: birth }
        })
      },
    }
  },
}
