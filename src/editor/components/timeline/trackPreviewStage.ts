import type { Track } from '../../types'
import type { ProjectSnapshot } from '../../core/visual/resolve'
import { trackPreviewTargets } from './trackPreviewTargets'

const prunedTracks = new WeakMap<Track, Map<string, Track>>()

/** The row's inclusive document prefix. Group/routed devices consume complete
 * member pipelines even when the target instruments are below the device.
 * Resolving this document (rather than slicing resolved chain entries) also
 * excludes later automation, splitter children and reordered time emitters. */
export function trackPreviewStage(rowId: string, project: ProjectSnapshot) {
  const targets = trackPreviewTargets(rowId, project.tracks)
  const included = new Set<string>()
  let found = false
  const visit = (id: string) => {
    if (found || included.has(id)) return
    const track = project.tracks[id]
    if (!track) return
    included.add(id)
    if (id === rowId) { found = true; return }
    for (const child of track.childIds) visit(child)
  }
  project.rootTrackIds.forEach(visit)
  // Group/global devices consume completed member pipelines even when the
  // member is below the preview row. Keep the row's own device suffix pruned,
  // but restore those later member subtrees (including nested group devices).
  const restored = new Set<string>()
  const includeSubtree = (id: string) => {
    if (restored.has(id)) return
    restored.add(id)
    const track = project.tracks[id]
    if (!track) return
    included.add(id)
    for (const child of track.childIds) includeSubtree(child)
  }
  for (const id of targets) {
    const seen = new Set<string>()
    for (let current: string | undefined = id; current && !seen.has(current); current = project.tracks[current]?.parentId) {
      seen.add(current)
      if (!included.has(current)) includeSubtree(current)
      included.add(current)
    }
  }
  const ancestors = new Set<string>()
  for (const id of targets) {
    for (let current: string | undefined = id; current && !ancestors.has(current); current = project.tracks[current]?.parentId) ancestors.add(current)
  }
  // Unrelated instrument trees are not part of this instrument's contribution.
  // Omitting them also keeps a foreign note edit from rebuilding every preview.
  const remove = (id: string) => {
    if (!included.delete(id)) return
    for (const child of project.tracks[id]?.childIds ?? []) remove(child)
  }
  for (const id of [...included]) {
    const track = project.tracks[id]
    if (track && (track.instrumentId || track.type === 'group') && !ancestors.has(id)) remove(id)
  }
  const tracks: Record<string, Track> = {}
  for (const id of included) {
    const track = project.tracks[id]
    if (!track) continue
    const children = track.childIds.filter(child => included.has(child))
    if (children.length === track.childIds.length) tracks[id] = track
    else {
      let cache = prunedTracks.get(track)
      if (!cache) { cache = new Map(); prunedTracks.set(track, cache) }
      const key = JSON.stringify(children)
      let pruned = cache.get(key)
      if (!pruned) { pruned = { ...track, childIds: children }; cache.set(key, pruned) }
      tracks[id] = pruned
    }
  }
  return { snapshot: { ...project, tracks, rootTrackIds: project.rootTrackIds.filter(id => included.has(id)) }, targets }
}
