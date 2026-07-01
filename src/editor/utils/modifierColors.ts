import { isModifierType } from '../core/engine/trackTypes'
import type { Track } from '../types'

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
