import type { Track } from '../types'
import { SWITCHER_FIRST_PITCH } from './visualCopies/switcher'

/** The binding a fresh switcher starts with: its devices in child order, from
 *  SWITCHER_FIRST_PITCH up. One definition for every creation path (library
 *  drag, wrap-the-selection, add-device-under-a-switcher), so none of them can
 *  hand-roll a different map. */
export function seedSwitcherBindings(
  childIds: readonly string[],
): Array<{ childTrackId: string; pitch: number }> {
  return childIds.map((childTrackId, index) => ({ childTrackId, pitch: SWITCHER_FIRST_PITCH + index }))
}

/**
 * Preserve a switcher's explicit row order and stable pitches, then append any
 * devices added while its saved list went stale. Same self-healing walk as
 * `core/directors/sceneBindings.ts`, and for the same reason: **a row's pitch is
 * the saved value.** Deriving it from the child's index instead would re-time
 * every note on the lane the moment a device is reordered or deleted - the trap
 * this codebase has already written down for Strobe's rows, the Colorizer's
 * palette and the scene bindings.
 *
 * `childIds` is the switcher's chain-entry children in child order; the caller
 * filters, because this module has no business knowing what a device is.
 * Pitches never drop below SWITCHER_FIRST_PITCH, which is what keeps the
 * reserved None row's pitch free forever.
 */
export function orderedSwitcherBindings(
  track: Track,
  childIds: readonly string[],
): Array<{ childTrackId: string; pitch: number }> {
  const liveSet = new Set(childIds)
  const seenChildren = new Set<string>()
  const seenPitches = new Set<number>()
  const bindings: Array<{ childTrackId: string; pitch: number }> = []

  for (const binding of track.switcherBindings ?? []) {
    if (!liveSet.has(binding.childTrackId) || seenChildren.has(binding.childTrackId)) continue
    let pitch = Math.max(SWITCHER_FIRST_PITCH, Math.round(binding.pitch))
    while (seenPitches.has(pitch)) pitch++
    bindings.push({ childTrackId: binding.childTrackId, pitch })
    seenChildren.add(binding.childTrackId)
    seenPitches.add(pitch)
  }

  let nextPitch = SWITCHER_FIRST_PITCH
  for (const childTrackId of childIds) {
    if (seenChildren.has(childTrackId)) continue
    while (seenPitches.has(nextPitch)) nextPitch++
    bindings.push({ childTrackId, pitch: nextPitch })
    seenChildren.add(childTrackId)
    seenPitches.add(nextPitch)
  }
  return bindings
}
