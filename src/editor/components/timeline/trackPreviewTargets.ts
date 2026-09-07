import type { Track } from '../../types'
import { isSceneTrackId } from '../../core/sceneTrack'

/** Device lanes show their affected objects; containers show their subtree. */
export function trackPreviewTargets(id: string, tracks: Record<string, Track>): Set<string> {
  const result = new Set<string>()
  const visited = new Set<string>()
  const visit = (key: string) => {
    if (visited.has(key)) return
    visited.add(key)
    const track = tracks[key]
    if (!track) return
    if (track.instrumentId) result.add(key)
    for (const child of track.childIds ?? []) visit(child)
  }
  const track = tracks[id]
  if (isSceneTrackId(id)) {
    Object.keys(tracks).forEach(visit)
  } else if (track?.instrumentId) {
    result.add(id)
  } else if (track?.type === 'group' || track?.type === 'switcher') {
    visit(id)
  } else if (track) {
    if (isSceneTrackId(track.parentId)) Object.keys(tracks).forEach(visit)
    else if (track.parentId) {
      const parent = tracks[track.parentId]
      if (parent?.type === 'group' && (track.type === 'mover' || track.type === 'splitter')) {
        // Group devices affect only members ABOVE them in the pipeline.
        for (const child of parent.childIds) {
          if (child === id) break
          visit(child)
        }
      } else {
        // A device nested in a splitter/mover still belongs to the containing
        // instrument, not to a subtree with no renderable object of its own.
        const seen = new Set<string>()
        let current = parent
        while (current && !current.instrumentId && current.type !== 'group' && !seen.has(current.id)) {
          seen.add(current.id)
          current = tracks[current.parentId ?? '']
        }
        if (current?.instrumentId) result.add(current.id)
        else if (current) visit(current.id)
      }
    }
    for (const { scope } of track.targets ?? []) {
      if (scope.kind === 'tag') {
        Object.values(tracks).filter(t => t.instrumentId && t.tags?.includes(scope.tag)).forEach(t => result.add(t.id))
      } else if (scope.kind === 'subtree') visit(scope.id)
      else result.add(scope.id)
    }
  }
  return result
}
