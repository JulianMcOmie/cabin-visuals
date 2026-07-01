import type { Track } from '../../types'

/**
 * Ability lanes used to be a parallel sub-row structure on the object track. Abilities
 * are now real `ability` CHILD tracks (like automation), so they flow through the normal
 * track machinery and this returns nothing — kept as the `flattenVisualRows` lane hook so
 * every timeline consumer stays in sync. (The lane-row code path is now inert.)
 */
export function abilityLanesOf(_track: Track): { key: string; label: string; color?: string }[] {
  return []
}
