import type { Scene, Track } from '../../types'

/** Preserve a director's explicit scene order and stable pitches, then append
 * any visual scenes that were added while its saved binding list was stale.
 * This makes old/incomplete projects self-healing without reordering choices. */
export function orderedSceneBindings(track: Track, scenes: Record<string, Scene>, sceneOrder: string[]) {
  const visualIds = sceneOrder.filter((id) => scenes[id] && !scenes[id].isMain)
  const visualSet = new Set(visualIds)
  const seenScenes = new Set<string>()
  const seenPitches = new Set<number>()
  const bindings: Array<{ sceneId: string; pitch: number }> = []

  for (const binding of track.sceneBindings ?? []) {
    if (!visualSet.has(binding.sceneId) || seenScenes.has(binding.sceneId)) continue
    let pitch = binding.pitch
    while (seenPitches.has(pitch)) pitch++
    bindings.push({ sceneId: binding.sceneId, pitch })
    seenScenes.add(binding.sceneId)
    seenPitches.add(pitch)
  }

  let nextPitch = 60
  for (const sceneId of visualIds) {
    if (seenScenes.has(sceneId)) continue
    while (seenPitches.has(nextPitch)) nextPitch++
    bindings.push({ sceneId, pitch: nextPitch })
    seenScenes.add(sceneId)
    seenPitches.add(nextPitch)
  }
  return bindings
}
