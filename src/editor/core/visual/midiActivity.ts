import type { Block } from '../../types'
import { loopLengthBeats, tileLoopNotes } from './noteFlatten'

export interface MidiActivityTrigger {
  beat: number
  velocity: number
  /** Matches one rendered timeline-preview note occurrence. */
  previewKey?: string
}

// A short, beat-relative flash: quick enough to read as a note onset, with a
// rounded tail that lets nearby notes overlap into one musical pulse.
export const MIDI_ACTIVITY_ATTACK_BEATS = 0.04
export const MIDI_ACTIVITY_DECAY_BEATS = 0.7
const MIDI_ACTIVITY_MAX_AGE_BEATS = 1.8
const MIDI_ACTIVITY_COMPRESSION = 0.72
const MIDI_ACTIVITY_TRIGGER_CAP = 4096

function normalizedVelocity(velocity: number): number {
  const normalized = velocity <= 1 ? velocity : velocity / 127
  return Math.max(0, Math.min(1, normalized))
}

function triggerEnvelope(ageBeats: number): number {
  if (ageBeats < 0 || ageBeats > MIDI_ACTIVITY_MAX_AGE_BEATS) return 0
  if (ageBeats < MIDI_ACTIVITY_ATTACK_BEATS) {
    const progress = ageBeats / MIDI_ACTIVITY_ATTACK_BEATS
    // Smoothstep avoids a hard-looking linear flash while retaining a fast attack.
    return progress * progress * (3 - 2 * progress)
  }
  // Reach roughly 5% at DECAY_BEATS. This holds the visible part of the tail
  // long enough to read while keeping the shape percussive.
  return Math.exp(-3 * (ageBeats - MIDI_ACTIVITY_ATTACK_BEATS) / MIDI_ACTIVITY_DECAY_BEATS)
}

/**
 * Evaluate the timeline-block glow at a project beat. Contributions add before
 * soft compression, so chords and dense passages visibly stack without clipping.
 * Triggers must be sorted by beat.
 */
export function evaluateMidiActivity(triggers: readonly MidiActivityTrigger[], beat: number): number {
  let low = 0
  let high = triggers.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (triggers[mid].beat <= beat) low = mid + 1
    else high = mid
  }

  let sum = 0
  for (let index = low - 1; index >= 0; index -= 1) {
    const trigger = triggers[index]
    const age = beat - trigger.beat
    if (age > MIDI_ACTIVITY_MAX_AGE_BEATS) break
    // Preserve a little presence at low velocities while still making dynamics
    // visible in the strength of the light.
    const strength = 0.3 + normalizedVelocity(trigger.velocity) * 0.7
    sum += triggerEnvelope(age) * strength
  }

  return 1 - Math.exp(-sum * MIDI_ACTIVITY_COMPRESSION)
}

/** Absolute project-beat note onsets for one timeline block, including loops. */
export function midiActivityTriggersForBlock(block: Block, beatsPerBar: number): MidiActivityTrigger[] {
  const blockStartBeat = block.startBar * beatsPerBar
  const blockBeats = block.durationBars * beatsPerBar
  if (blockBeats <= 0) return []

  const occurrences = block.loop
    ? tileLoopNotes(
        block.notes,
        loopLengthBeats(block, beatsPerBar),
        blockBeats,
        MIDI_ACTIVITY_TRIGGER_CAP,
      )
    : block.notes
        .filter((note) => note.startBeat >= 0 && note.startBeat < blockBeats)
        .map((note) => ({
          note,
          startBeat: note.startBeat,
          durationBeats: note.durationBeats,
          repeat: 0,
        }))

  return occurrences
    .map(({ note, startBeat, repeat }) => ({
      beat: blockStartBeat + startBeat,
      velocity: note.velocity,
      previewKey: `${note.id}:${repeat}`,
    }))
    .sort((a, b) => a.beat - b.beat)
}
