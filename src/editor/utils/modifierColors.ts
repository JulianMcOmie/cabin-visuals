import { isModifierType } from '../core/trackTypes'
import type { Track } from '../types'

// Track-type identity colours: object tracks read as the accent blue, mover
// lanes (movers, and modulators while they last) read as indigo, audio tracks
// read as red - assigned at creation, never inherited, so the track list
// colour-codes by ROLE. (Audio is also enforced at render so tracks saved
// under the old blue turn red without a migration.)
export const OBJECT_TRACK_COLOR = '#35a7e6'
export const MOVER_TRACK_COLOR = '#6366f1'
export const AUDIO_TRACK_COLOR = '#ef4444'

// Event-modifier rows/blocks are colour-coded by what they do, so they read as
// control tracks (not visual objects) across the timeline and the MIDI editor.
export const MODIFIER_COLORS: Record<string, string> = {
  suppress: '#dc2626', // removes
  mute: '#71717a',     // hides
  add: '#16a34a',      // layers
  override: '#d97706', // replaces
}

/** A modifier track's colour by type, or null if the track isn't an event modifier
 *  (a no-instrument track whose type is a modifier). */
export function modifierColor(track: Track): string | null {
  if (track.instrumentId || !isModifierType(track.type)) return null
  return MODIFIER_COLORS[track.type] ?? '#71717a'
}
