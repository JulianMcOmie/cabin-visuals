// Impact Pulse: a note is a HIT, and the object's SIZE is its amplitude.
//
// ── Why the envelope is not an ADSR ──────────────────────────────────────────
//
// Every other note-driven entry in this module gates on the WRITTEN note: hold
// it and the effect holds (Visibility's sustain plateau, the Colorizer's wash,
// Conveyor's running belt). This one deliberately does not, because the thing
// it is modelling is a snare's amplitude envelope, and a snare does not sustain.
// You hit it, it is instantly at full, and it falls away - the length of the
// note that triggered it is not part of the sound. So the envelope here is two
// stages and no gate: PEAK ON THE ONSET FRAME, then DECAY to nothing over
// `decayBeats`. Holding a note changes nothing, which is the correct surprise:
// a 16th and a whole note produce the same hit, exactly like a drum.
//
// That is also what buys the parameter count. An attack knob on a percussive
// hit is a knob whose whole useful range is "zero"; a sustain knob is one that
// turns the hit into something that is no longer a hit. What is left is how BIG
// (HIT), how LONG (DECAY), and what the fall looks like (CURVE) - and none of
// those can be dropped.
//
// ── Size, in log space ───────────────────────────────────────────────────────
//
// The pulse is a signed scalar in -1..1 (swell row positive, squash row
// negative) and it reaches size as an EXPONENT, not as a summand:
//
//     base = (1 + HIT) ^ pulse
//
// so a full swell is (1+HIT)x and a full squash is its exact reciprocal. Adding
// the pulse instead would make squash and swell asymmetric - +0.5 grows by half
// but -0.5 shrinks by half, which is twice as violent - and a large enough
// squash would drive the scale through zero and invert the object's winding.
// In log space the two rows are mirror images and nothing can cross zero.
//
// STRETCH bends the same pulse into squash-and-stretch by splitting it into a
// uniform part and a volume-preserving part (see `impactPulseScale`). It rides
// the object's LOCAL up axis, so a splitter above this mover gives every copy
// its own "up" to stretch along.

import { Matrix4 } from 'three'
import type { MidiRowDef, ParamDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import { midiVelocity } from '../../utils/midiVelocity'
import { IMPACT_PULSE_COLOR } from './identityColors'
import { clamp } from '../../utils/math'

/** One row per direction, so the piano roll reads as the score for the hit. */
export const PULSE_SWELL_PITCH = 60
export const PULSE_SQUASH_PITCH = 61

/** How the size falls back after the onset - cliff, ramp, or hang. Three
 *  shapes for the same reason the Colorizer has three, but NOT its curves: its
 *  SWELL is a smoothstep, which crosses the diagonal at the halfway point and
 *  therefore reads as plain linear over the handful of frames a hit lasts.
 *  TAIL here is the exact mirror of SNAP, so the set spans the whole space. */
export const PULSE_SNAP = 0
export const PULSE_EVEN = 1
export const PULSE_TAIL = 2

export interface ImpactPulseSettings {
  /** Peak size change, 0..1. The object reaches (1 + hit)x on a full-velocity
   *  swell and 1/(1 + hit)x on a full-velocity squash. */
  hit: number
  /** Beats from the onset until the size is back to normal. */
  decayBeats: number
  /** 0 = uniform; 1 = volume-preserving squash-and-stretch on the local Y. */
  stretch: number
  /** Beats of delay added per upstream copy index, so one hit rolls across a
   *  split instead of landing on every copy at once. Negative rolls the other
   *  way. */
  rollBeats: number
  /** PULSE_SNAP | PULSE_EVEN | PULSE_TAIL. */
  falloff: number
}

const IMPACT_PULSE_PARAMS: ParamDef[] = [
  // Curved: "subtle" is the interesting half of this knob, and a linear 0..1
  // spends most of its travel on sizes big enough to read as a glitch.
  { key: 'hit', label: 'Hit', min: 0, max: 1, step: 0.01, default: 0.28, curve: 2 },
  { key: 'decayBeats', label: 'Decay (beats)', min: 0.02, max: 4, step: 0.01, default: 0.25, curve: 2 },
  { key: 'stretch', label: 'Stretch', min: 0, max: 1, step: 0.01, default: 0 },
  { key: 'rollBeats', label: 'Roll / copy (beats)', min: -0.25, max: 0.25, step: 0.005, default: 0 },
  {
    key: 'falloff',
    label: 'Curve',
    type: 'select',
    options: [
      { value: PULSE_SNAP, label: 'Snap' },
      { value: PULSE_EVEN, label: 'Even' },
      { value: PULSE_TAIL, label: 'Tail' },
    ],
    default: PULSE_SNAP,
  },
]

const IMPACT_PULSE_ROWS: MidiRowDef[] = [
  { pitch: PULSE_SWELL_PITCH, label: 'Swell (bigger)' },
  { pitch: PULSE_SQUASH_PITCH, label: 'Squash (smaller)' },
]

/**
 * The fall from peak, given how much of the decay is LEFT (1 at the onset,
 * 0 when it has run out).
 *
 * SNAP is the one that looks like the drum: the size drops off a cliff in the
 * first fifth of the decay and then rings out in a long thin tail, so the eye
 * reads a transient followed by a settle rather than a shrink. EVEN is the
 * honest ramp, for when the pulse is doing timekeeping rather than impact.
 * TAIL is SNAP reflected through the diagonal - it hangs near full and then
 * lets go, a hit with body, and the only one of the three that still reads at
 * very short decays (SNAP at 0.05 beats is over before it is seen).
 */
export function pulseFalloff(remaining: number, falloff: number): number {
  if (remaining <= 0) return 0
  if (remaining >= 1) return 1
  if (falloff === PULSE_EVEN) return remaining
  if (falloff === PULSE_TAIL) {
    const gone = 1 - remaining
    return 1 - gone * gone * gone
  }
  return remaining * remaining * remaining
}

/**
 * The signed pulse for one copy at one beat, in -1..1.
 *
 * Overlapping hits on the same row take the LOUDEST rather than summing: two
 * snares on the same beat are still one hit, and a sum would blow past the size
 * the user dialled in. The two rows then oppose each other, so holding both
 * cancels - a swell and a squash of equal weight leave the object alone, which
 * is the only reading of "grow and shrink at once" that isn't arbitrary.
 *
 * Velocity scales the pulse because dynamics are what a hit is FOR: a ghost
 * note should barely breathe, an accent should land the whole size.
 */
export function evaluateImpactPulse(
  notes: readonly ResolvedNote[],
  settings: ImpactPulseSettings,
  beat: number,
  index = 0,
): number {
  const decay = Math.max(0, settings.decayBeats)
  if (decay <= 0) return 0

  // ROLL is a per-copy time offset, so the copy simply looks at a slightly
  // earlier (or later) point in the same performance - the envelope and the
  // velocity roll with it for free.
  const localBeat = beat - settings.rollBeats * Math.max(0, Math.floor(index))

  let swell = 0
  let squash = 0
  for (const note of notes) {
    const swellRow = note.pitch === PULSE_SWELL_PITCH
    if (!swellRow && note.pitch !== PULSE_SQUASH_PITCH) continue
    const age = localBeat - note.beat
    // Note duration is deliberately absent: this is an onset, not a gate.
    if (age < 0 || age >= decay) continue
    const gain = pulseFalloff(1 - age / decay, settings.falloff)
      * clamp(midiVelocity(note.velocity), 0, 1)
    if (swellRow) swell = Math.max(swell, gain)
    else squash = Math.max(squash, gain)
  }
  return clamp(swell - squash, -1, 1)
}

/**
 * The per-axis scale for a signed pulse, as [x, y, z].
 *
 * STRETCH splits the pulse into two components that multiply together:
 *
 *   uniform        every axis by base^(1-s)
 *   stretch        local Y by base^(2s), X and Z each by base^(-s)
 *
 * The second is volume preserving by construction (2s - s - s = 0), so turning
 * STRETCH up trades size for SHAPE rather than adding more of both. At s = 0
 * the object simply grows; at s = 0.5 it grows only upward; at s = 1 it is
 * tall-and-narrow at constant volume. A squash note runs the same expression
 * with a base below 1 and comes out short-and-wide with no separate branch.
 */
export function impactPulseScale(
  pulse: number,
  hit: number,
  stretch: number,
): [number, number, number] {
  const amount = clamp(hit, 0, 1)
  if (amount <= 0 || pulse === 0) return [1, 1, 1]
  const s = clamp(stretch, 0, 1)
  const base = 1 + amount
  const up = Math.pow(base, pulse * (1 + s))
  const across = Math.pow(base, pulse * (1 - 2 * s))
  return [across, up, across]
}

export const impactPulseMover: MoverOrSplitterDefinition<ImpactPulseSettings> = {
  id: 'impactPulse',
  label: 'Impact Pulse',
  kind: 'mover',
  params: IMPACT_PULSE_PARAMS,
  identityColor: IMPACT_PULSE_COLOR,
  midiRows: () => IMPACT_PULSE_ROWS,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    return {
      apply(visualCopy, { beat, index }) {
        const pulse = evaluateImpactPulse(notes, settings, beat, index)
        const [x, y, z] = impactPulseScale(pulse, settings.hit, settings.stretch)
        // LOCAL composition (previous * delta), and here it is load-bearing
        // rather than just the default: post-multiplying scales the object
        // about its OWN origin in its OWN axes, so a splitter above this mover
        // makes every copy pulse in place along its own up. Pre-multiplying
        // would scale each copy's POSITION too, and the whole formation would
        // breathe toward and away from the world origin instead.
        return [{
          transform: visualCopy.transform.clone().multiply(new Matrix4().makeScale(x, y, z)),
          opacity: visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }]
      },
    }
  },
}
