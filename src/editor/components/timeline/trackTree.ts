import type { Track } from '../../types'

export interface FlatTrack {
  id: string
  /** Nesting depth — 0 for a root track, +1 per level. */
  depth: number
}

/** Tracks in depth-first order (each root, then its descendants), tagged with depth —
 *  the visual row order for the timeline. A collapsed node is still listed, but its
 *  descendants are skipped (hidden). A visited set guards malformed data. */
export function flattenTracks(
  tracks: Record<string, Track>,
  rootTrackIds: string[],
  collapsed?: Set<string>,
): FlatTrack[] {
  const out: FlatTrack[] = []
  const seen = new Set<string>()
  const visit = (id: string, depth: number) => {
    if (seen.has(id)) return
    const t = tracks[id]
    if (!t) return
    seen.add(id)
    out.push({ id, depth })
    if (collapsed?.has(id)) return
    for (const childId of t.childIds ?? []) visit(childId, depth + 1)
  }
  for (const id of rootTrackIds) visit(id, 0)
  return out
}

/** A track plus all its descendants — you can't drop a track into its own subtree. */
export function subtreeIds(tracks: Record<string, Track>, id: string): Set<string> {
  const out = new Set<string>()
  const visit = (cur: string) => {
    if (out.has(cur)) return
    const t = tracks[cur]
    if (!t) return
    out.add(cur)
    for (const childId of t.childIds ?? []) visit(childId)
  }
  visit(id)
  return out
}
