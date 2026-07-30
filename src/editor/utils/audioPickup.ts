import type { Track } from '../types'

// Pickup: audio is allowed to start BEFORE musical bar 0 (startBar < 0), the way
// a song's audio often leads its first downbeat. Rather than storing a project
// field, the pickup is DERIVED as exactly how far the earliest audio block
// reaches left of bar 0 - so the timeline's left edge always sits flush against
// that block, the region exists only while some audio actually needs it, and
// undo/redo of the drag restores it for free. MIDI blocks stay clamped at
// bar >= 0; only audio can live in the pickup.

/** How many bars of pickup the timeline needs (0 when no audio starts early). */
export function audioPickupBars(tracks: Record<string, Track>): number {
  let minStart = 0
  for (const t of Object.values(tracks)) {
    if (t.type !== 'audio') continue
    for (const b of t.audioBlocks ?? []) {
      if (b.startBar < minStart) minStart = b.startBar
    }
  }
  return -minStart
}
