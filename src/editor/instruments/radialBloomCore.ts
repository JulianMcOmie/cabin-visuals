import type { ResolvedNote } from '../core/visual/types'

// Same bottom-up count vocabulary as Radial's count lane.
export const BLOOM_PITCH_MIN = 36
export const BLOOM_MAX_COPIES = 12

export interface BloomEnvelope {
  attackBeats: number
  decayBeats: number
  sustainLevel: number
  releaseBeats: number
}

export function bloomOpacity(note: ResolvedNote, beat: number, envelope: BloomEnvelope): number {
  const age = beat - note.beat
  if (age < 0) return 0
  const attack = Math.max(0, envelope.attackBeats)
  const decay = Math.max(0, envelope.decayBeats)
  const sustain = Math.max(0, Math.min(1, envelope.sustainLevel))
  const held = (t: number) => {
    if (attack > 0 && t < attack) return t / attack
    if (decay > 0 && t < attack + decay) return 1 - (1 - sustain) * (t - attack) / decay
    return sustain
  }
  const duration = Math.max(0, note.durationBeats)
  if (age < duration) return held(age)
  const release = Math.max(0, envelope.releaseBeats)
  return release > 0 ? held(duration) * Math.max(0, 1 - (age - duration) / release) : 0
}

/** One played radial formation. Latest held note wins; chords choose the
 * largest count. Released notes retain their formation through the tail.
 * No playback history: direct seeks and backward scrubs give the same hit. */
export function resolveBloom(notes: readonly ResolvedNote[], beat: number, envelope: BloomEnvelope) {
  let selected: ResolvedNote | undefined
  let selectedHeld = false
  for (const note of notes) {
    if (!Number.isInteger(note.pitch) || note.pitch < BLOOM_PITCH_MIN || note.pitch >= BLOOM_PITCH_MIN + BLOOM_MAX_COPIES) continue
    if (note.beat > beat || beat >= note.beat + Math.max(0, note.durationBeats) + Math.max(0, envelope.releaseBeats)) continue
    const held = beat < note.beat + note.durationBeats
    if (!selected || (held && !selectedHeld) || (held === selectedHeld &&
      (note.beat > selected.beat || (note.beat === selected.beat && note.pitch > selected.pitch)))) {
      selected = note
      selectedHeld = held
    }
  }
  return selected
    ? { copies: selected.pitch - BLOOM_PITCH_MIN + 1, opacity: bloomOpacity(selected, beat, envelope) }
    : { copies: 0, opacity: 0 }
}
