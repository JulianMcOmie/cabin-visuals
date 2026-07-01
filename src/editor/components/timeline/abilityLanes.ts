import { getInstrument } from '../../instruments'
import type { Track } from '../../types'

/**
 * The ability lanes ACTIVE on a track: the instrument's declared abilities, filtered
 * to the ones the user has actually added (present as a key in `track.lanes`). Abilities
 * are opt-in — a declared ability doesn't show a sub-row until it's added via the track's
 * right-click menu. Shared by every timeline consumer so the visual rows and all the drag
 * math agree on which lanes exist.
 */
export function abilityLanesOf(track: Track): { key: string; label: string; color?: string }[] {
  const declared = getInstrument(track.instrumentId)?.abilities
  const lanes = track.lanes
  if (!declared || !lanes) return []
  return declared
    .filter((a) => a.key in lanes)
    .map((a) => ({ key: a.key, label: a.label, color: a.color }))
}
