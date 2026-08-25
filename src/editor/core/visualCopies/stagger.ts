// Stagger: the TIME emitter. It makes no shape of its own - it fans copies of
// whatever reaches it and gives each one its OWN CLOCK, so every chain entry
// BELOW it runs on each copy's clock: one authored pattern - a size ramp, a
// mover's phrase - replays per copy, staggered. The Stagger owns the only
// loop, so the pattern is authored ONCE and never needs a looped block.
//
// The mental model it was built for (nested shapes forever expanding to fill
// the frame): a single 0→DURATION expansion curve above it in the track order
// (the existing "lane above a splitter animates each copy" weave), the
// Stagger, and a Colorizer below in its "Born" sample mode with one note per
// copy birth - red, blue, green, yellow. Each shell replays the expansion at
// its own age and keeps the color its note said the moment it was born.
//
// DURATION is one copy's flight, in beats: its clock runs 0→DURATION from its
// birth. WHEN copies are born is PRESENCE-driven, the `scene` def's
// convention:
//
//  - EMPTY LANE (the default): a free-running cycle. COPIES phase-divides the
//    duration - copy i's age is `mod(beat - i·duration/copies, duration)`,
//    births every duration/copies beats, evenly phased from beat 0, every
//    copy always in flight. Copies before their first birth start mid-flight
//    with NEGATIVE births (one formula, no start-up special case).
//  - NOTES on the Spawn row: each onset BIRTHS a copy - EVERY onset, always.
//    The pool is sized at resolve by first-fit over the phrase's own flight
//    intervals (grow-on-demand lands exactly at the peak overlap, the classic
//    interval-coloring result), so a dense phrase mounts a bigger pool rather
//    than dropping notes or evicting flights - Duplicate Trail's precedent of
//    a count DERIVED from resolved data, still beat-independent. The COPIES
//    knob is the loop's phase divider and does nothing here. Note DURATION
//    and velocity are deliberately ignored (impactPulse's rule): a spawn is
//    an onset, the flight's length is the DURATION knob. Copies outside a
//    flight gate to opacity 0 - MIDI gates opacity, NEVER the slot count.
//    LIFE = Endless removes the flight's end: every spawn is PERMANENT (one
//    slot per note, age runs on, a keyframe pattern holds its endpoint) and
//    the picture stacks a copy per note played.
//
// Two clocks per copy, both closed-form pure functions of the beat (no state,
// so pause/scrub/export agree exactly):
//
//  - AGE: the copy's downstream `context.beat` - it ramps 0→DURATION from
//    each birth. Emitted as `beatOffset = beat - age` (the kernel subtracts;
//    nested Staggers sum, each measuring in the clock it was handed).
//  - BIRTH: `beat - age`, emitted as `birthBeat` - the latch clock sequenced
//    entries below may sample at (`MoverOrSplitterContext.birthBeat`). In
//    triggered mode this is the spawn note's onset, so a latching Colorizer
//    hands each spawned copy the color sounding at the note you played.
//
// The time channel rides `applyFramed` (types.ts): `apply` returns the same
// copies with the clocks dropped, which is unobservable - offsets only steer
// entries below, and direct callers / a chain's last entry have none. The
// copies themselves are untouched clones (identity transform contribution),
// so a Stagger with nothing below it renders as stacked twins: it is a time
// device, and space is other devices' job. No shared SIZE knob (it lays
// nothing out); no persistence upgrade (new id, absent keys merge to
// defaults).

import type { MidiRowDef } from '../../instruments/types'
import type { MoverOrSplitterDefinition } from './definitions'
import { STAGGER_COLOR } from './identityColors'
import type { FramedVisualCopy, VisualCopy } from './types'

export interface StaggerSettings {
  /** The loop's phase divider: how many copies share the free-running cycle.
   *  Inert while spawn notes drive the births (the pool sizes itself). */
  copies: number
  /** One copy's full flight, in beats: its clock runs 0→duration. */
  duration: number
  /** STAGGER_LIFE_TIMED or STAGGER_LIFE_ENDLESS - whether a spawned flight
   *  ever ends. Endless makes every spawn PERMANENT: one slot per note, the
   *  copy holds whatever pose its pattern reaches, and the picture STACKS.
   *  Spawn-mode only - the free-running loop needs a cycle to phase, so an
   *  empty lane always loops on DURATION whatever this says. */
  life: number
}

/** A spawned copy flies for DURATION beats, then goes dark. */
export const STAGGER_LIFE_TIMED = 0
/** A spawned copy never dies: age keeps running (a keyframe pattern holds its
 *  endpoint), the slot is never reused, every note adds one more copy. */
export const STAGGER_LIFE_ENDLESS = 1

export const STAGGER_MAX_COPIES = 24

/** The one MIDI row: an onset births a copy. */
export const STAGGER_SPAWN_PITCH = 60

const STAGGER_ROWS: MidiRowDef[] = [{ pitch: STAGGER_SPAWN_PITCH, label: 'Spawn' }]

const cloneCopy = (visualCopy: VisualCopy): VisualCopy => ({
  transform: visualCopy.transform.clone(),
  opacity: visualCopy.opacity,
  colorShift: { ...visualCopy.colorShift },
})

const hiddenCopy = (visualCopy: VisualCopy): VisualCopy => ({
  transform: visualCopy.transform.clone(),
  opacity: 0,
  colorShift: { ...visualCopy.colorShift },
})

/** True mathematical mod - the phase must stay in [0, duration) at beats
 *  before a copy's first birth, where the JS remainder goes negative. */
const positiveMod = (value: number, duration: number): number => {
  const remainder = value % duration
  return remainder < 0 ? remainder + duration : remainder
}

/** Latest birth ≤ beat in one slot's sorted birth list, or -Infinity. */
function lastBirthAt(births: readonly number[], beat: number): number {
  let low = 0
  let high = births.length - 1
  let found = -Infinity
  while (low <= high) {
    const mid = (low + high) >> 1
    if (births[mid] <= beat) {
      found = births[mid]
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}

export const staggerSplitter: MoverOrSplitterDefinition<StaggerSettings> = {
  id: 'stagger',
  label: 'Stagger',
  kind: 'splitter',
  identityColor: STAGGER_COLOR,
  params: [
    { key: 'copies', label: 'Copies', min: 1, max: STAGGER_MAX_COPIES, step: 1, default: 4 },
    { key: 'duration', label: 'Duration (beats)', min: 0.25, max: 32, step: 0.25, default: 4 },
    {
      key: 'life',
      label: 'Life',
      type: 'select',
      options: [
        { value: STAGGER_LIFE_TIMED, label: 'Timed' },
        { value: STAGGER_LIFE_ENDLESS, label: 'Endless' },
      ],
      default: STAGGER_LIFE_TIMED,
    },
  ],
  midiRows: () => STAGGER_ROWS,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const loopCopies = Math.max(1, Math.min(STAGGER_MAX_COPIES, Math.round(settings.copies)))
    const duration = Math.max(0.25, settings.duration ?? 4)
    const interval = duration / loopCopies
    // How long a spawned flight lives. ENDLESS is just Infinity fed through
    // the same allocator and flight check: a slot is never free again, so
    // every onset grows the pool by one, and `beat - birth < Infinity` keeps
    // the copy flying forever. DURATION goes inert with it, deliberately.
    const flightLife = settings.life === STAGGER_LIFE_ENDLESS ? Infinity : duration

    // Triggered births, allocated once at resolve: beat-independent, so the
    // per-frame work is a binary search per slot. First-fit, growing the pool
    // when every slot is mid-flight - every onset spawns, nothing is dropped.
    const onsets = notes
      .filter((note) => note.pitch === STAGGER_SPAWN_PITCH)
      .map((note) => note.beat)
      .sort((a, b) => a - b)
    let births: number[][] | null = null
    if (onsets.length > 0) {
      births = []
      const freeAt: number[] = []
      for (const onset of onsets) {
        let slot = freeAt.findIndex((t) => t <= onset)
        if (slot < 0) {
          slot = freeAt.length
          freeAt.push(-Infinity)
          births.push([])
        }
        births[slot].push(onset)
        freeAt[slot] = onset + flightLife
      }
    }
    const count = births ? births.length : loopCopies

    /** One slot's copy at one beat: its clone, clocks, and whether it flies. */
    const slotAt = (visualCopy: VisualCopy, index: number, beat: number): FramedVisualCopy => {
      if (!births) {
        const age = positiveMod(beat - index * interval, duration)
        const birth = beat - age
        return { visualCopy: cloneCopy(visualCopy), beatOffset: birth, birthBeat: birth }
      }
      const birth = lastBirthAt(births[index], beat)
      if (beat - birth < flightLife) {
        return { visualCopy: cloneCopy(visualCopy), beatOffset: birth, birthBeat: birth }
      }
      // Between flights: dark, still riding its finished flight's clock (age
      // just runs past DURATION; with no flight yet, the pattern's start).
      // Unobservable at opacity 0 - keeping the clock total beats clamping it.
      const parkedBirth = Number.isFinite(birth) ? birth : beat
      return { visualCopy: hiddenCopy(visualCopy), beatOffset: parkedBirth, birthBeat: Number.isFinite(birth) ? birth : undefined }
    }

    return {
      apply(visualCopy, { beat }) {
        return Array.from({ length: count }, (_, index) => slotAt(visualCopy, index, beat).visualCopy)
      },
      applyFramed(visualCopy, { beat }) {
        return Array.from({ length: count }, (_, index) => slotAt(visualCopy, index, beat))
      },
    }
  },
}
