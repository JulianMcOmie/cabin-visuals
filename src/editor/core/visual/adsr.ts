import type { AdsrEnvelope } from '../../types'

// Closed-form ADSR gain over gate notes - the envelope-track evaluator.
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
// same normalization as ballisticGain). Overlapping notes SUM and the total
// clamps to 0..1 - consistent with ballisticGain's stacking (the design doc's
// "max wins" predates that engine idiom).

/** New envelope tracks start here; resolve/UI also fall back to these per field. */
export const DEFAULT_ADSR: AdsrEnvelope = {
  attackBeats: 0.05,
  decayBeats: 0.25,
  sustainLevel: 0.7,
  releaseBeats: 0.5,
}

const EPS = 0.0001

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/** The minimal note shape the evaluator reads (pitch is deliberately ignored -
 *  an envelope lane is a trigger lane, not a pitched one). */
export interface AdsrGate {
  beat: number
  durationBeats: number
  velocity: number
}

/**
 * The summed, clamped 0..1 envelope gain at `beat` from the gate notes. Pure
 * function of (beat, notes, params) - safe to call per frame at any beat.
 */
export function evaluateAdsrGain(notes: readonly AdsrGate[], beat: number, p: AdsrEnvelope): number {
  const attack = Math.max(EPS, p.attackBeats)
  const decay = Math.max(EPS, p.decayBeats)
  const release = Math.max(EPS, p.releaseBeats)
  const sustain = clamp01(p.sustainLevel)

  // The attack/decay/sustain curve while the gate is held.
  const held = (t: number): number => {
    if (t < attack) return t / attack
    if (t < attack + decay) return 1 - (1 - sustain) * ((t - attack) / decay)
    return sustain
  }

  let gain = 0
  for (const n of notes) {
    const t = beat - n.beat
    if (t < 0) continue // future gate
    const hold = Math.max(n.durationBeats || 0, attack)
    if (t >= hold + release) continue // fully released
    const velocity = n.velocity <= 1 ? n.velocity : n.velocity / 127
    const e = t <= hold ? held(t) : held(hold) * (1 - (t - hold) / release)
    gain += velocity * e
  }
  return clamp01(gain)
}
