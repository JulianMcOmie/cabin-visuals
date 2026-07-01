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

/** A row in the timeline's vertical flow: either a track, or one of a track's ability
 *  lanes (a parallel sub-row — NOT a child track). Every row is the same height, so
 *  Y↔index math stays uniform. */
export type VisualRow =
  | { kind: 'track'; id: string; depth: number }
  | { kind: 'lane'; trackId: string; laneKey: string; label: string; color?: string; depth: number }

/** Like `flattenTracks`, but interleaves each object track's ability-lane sub-rows
 *  (from `lanesOf`) right after the track, indented one level. Lanes come before the
 *  track's child tracks; both sit at depth+1, so a track's subtree stays DFS-contiguous
 *  (every descendant row has depth > the track's). A collapsed track hides both its
 *  lanes and its children. With no abilities declared this equals `flattenTracks`. */
export function flattenVisualRows(
  tracks: Record<string, Track>,
  rootTrackIds: string[],
  collapsed: Set<string> | undefined,
  lanesOf: (track: Track) => { key: string; label: string; color?: string }[],
): VisualRow[] {
  const out: VisualRow[] = []
  const seen = new Set<string>()
  const visit = (id: string, depth: number) => {
    if (seen.has(id)) return
    const t = tracks[id]
    if (!t) return
    seen.add(id)
    out.push({ kind: 'track', id, depth })
    if (collapsed?.has(id)) return
    for (const lane of lanesOf(t)) {
      out.push({ kind: 'lane', trackId: id, laneKey: lane.key, label: lane.label, color: lane.color, depth: depth + 1 })
    }
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
