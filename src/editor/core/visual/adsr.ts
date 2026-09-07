import { midiVelocity } from '../../utils/midiVelocity'
import type { AdsrEnvelope } from '../../types'
import { clamp01 } from '../../utils/math'

// Closed-form ADSR gain for Burst automation.
//
// The same closed-form-over-notes discipline as ballisticGain (VisualEngine): the
// gain at any beat is computed from the note list alone - no integrator state, no
// wall clock - so scrubbing, pausing and export reproduce playback exactly (the
// pause invariant). All segment lengths are in BEATS.
//
// Per gate note (t = beat - note.beat):
//   attack   t in [0, A)          → ramp 0 → 1
//   decay    t in [A, A+D)        → 1 → sustainLevel
//   sustain  while the note holds → the held curve above, floored at sustainLevel
//   release  t in [hold, hold+R)  → held(hold) → 0
// where hold = max(durationBeats, A): a zero-length hit still reaches its peak
// before releasing (mirrors ballisticGain's decayStart = max(attack, duration)).
// Release starts from the envelope's value AT note end - a gate shorter than A+D
// releases from wherever the attack/decay curve had reached, so short notes never
// pop. Velocity scales each note's contribution (0..1, or 0..127 MIDI-style,
// same normalization as ballisticGain). Burst automation combines the gains.

const EPS = 0.0001

/** Timing and intensity for a single Burst automation gate. */
export interface AdsrGate {
  beat: number
  durationBeats: number
  velocity: number
}

/**
 * ONE gate's velocity-scaled contribution at `beat` - 0 before it opens and once
 * it has fully released. Burst automation (automation.ts) evaluates gates separately:
 * each note aims at its own target value, weighted by this gain.
 */
export function adsrGateGain(note: AdsrGate, beat: number, p: AdsrEnvelope): number {
  const t = beat - note.beat
  if (t < 0) return 0 // future gate
  const attack = Math.max(EPS, p.attackBeats)
  const release = Math.max(EPS, p.releaseBeats)
  const hold = Math.max(note.durationBeats || 0, attack)
  if (t >= hold + release) return 0 // fully released
  const decay = Math.max(EPS, p.decayBeats)
  const sustain = clamp01(p.sustainLevel)
  // The attack/decay/sustain curve while the gate is held.
  const held = (u: number): number => {
    if (u < attack) return u / attack
    if (u < attack + decay) return 1 - (1 - sustain) * ((u - attack) / decay)
    return sustain
  }
  const velocity = midiVelocity(note.velocity)
  return velocity * (t <= hold ? held(t) : held(hold) * (1 - (t - hold) / release))
}
