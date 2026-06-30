import type { Track } from '../../types'
import type { FlatTrack } from './trackTree'

/** One indent level (px) — also the label's left-padding step (see Track). */
export const INDENT_PX = 16
/** The label's base left padding (matches `pl-3` ≈ 12px), where depth 0 sits. */
export const LABEL_BASE_PX = 12

/** Where a dragged/new track would land, plus the indicator to draw for it. Shared by
 *  the in-timeline nest-drag and the library drag so both behave identically. */
export interface DropTarget {
  parentId: string | null
  /** Index among the new siblings; undefined = append (used when nesting into). */
  index: number | undefined
  /** Sibling-drop insertion line (content-space px); null when nesting into a row. */
  line: { top: number; left: number } | null
  /** The row being nested into (highlighted); null for a sibling drop. */
  intoId: string | null
}

/**
 * Resolve a pointer Y over the flattened track list to a drop target. The row's
 * top/bottom quarter is a sibling drop (insertion line at that level); its middle is
 * a nest (the row highlights). Below the last row drops at the top level, last —
 * regardless of how deep the last visible row is nested. `excludeSubtree` is the set
 * of ids the drag can't land in (a track's own subtree); omit for a brand-new track.
 */
export function computeDropTarget(args: {
  tracks: Record<string, Track>
  rootTrackIds: string[]
  flat: FlatTrack[]
  listTop: number
  rowHeight: number
  clientY: number
  excludeSubtree?: Set<string>
}): DropTarget | null {
  const { tracks, rootTrackIds, flat, listTop, rowHeight, clientY, excludeSubtree } = args
  const n = flat.length
  const contentY = clientY - listTop
  const rawIndex = Math.floor(contentY / rowHeight)

  // Below every row → top level, last position (drag to the bottom = un-nest to root).
  if (rawIndex >= n) {
    const rootSiblings = rootTrackIds.filter((id) => !excludeSubtree?.has(id))
    return { parentId: null, index: rootSiblings.length, line: { top: n * rowHeight, left: 0 }, intoId: null }
  }

  const overIndex = Math.max(0, Math.min(n - 1, rawIndex))
  const over = flat[overIndex]
  const overTrack = tracks[over.id]
  if (!overTrack || excludeSubtree?.has(over.id)) return null

  const frac = (contentY - overIndex * rowHeight) / rowHeight

  // Middle band → nest into `over` (append as its last child).
  if (frac >= 0.25 && frac <= 0.75) {
    return { parentId: over.id, index: undefined, line: null, intoId: over.id }
  }

  // Top/bottom edge → sibling drop in `over`'s parent.
  const parentId = overTrack.parentId ?? null
  const siblings = (parentId == null ? rootTrackIds : tracks[parentId]?.childIds ?? []).filter(
    (id) => !excludeSubtree?.has(id),
  )
  const pos = siblings.indexOf(over.id)
  let index: number
  let top: number
  if (frac < 0.25) {
    // Before `over`.
    index = pos < 0 ? 0 : pos
    top = overIndex * rowHeight
  } else {
    // After `over` and its whole subtree (DFS-contiguous, depth > over.depth).
    index = pos < 0 ? siblings.length : pos + 1
    let j = overIndex + 1
    while (j < n && flat[j].depth > over.depth) j++
    top = j * rowHeight
  }
  return { parentId, index, line: { top, left: over.depth * INDENT_PX }, intoId: null }
}
