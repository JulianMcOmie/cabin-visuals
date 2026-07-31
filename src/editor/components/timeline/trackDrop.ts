import type { Track } from '../../types'
import type { VisualRow } from './trackTree'
import { audioPinnedCount } from '../../store/ProjectStore'

/** One indent level (px) - also the label's left-padding step (see Track). */
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

/** Track types that can hold children. Automation/ability/envelope lanes live only
 *  on their parent object, and nothing nests under the audio track. */
function canNestInto(track: Track | undefined): boolean {
  return (
    !!track &&
    track.type !== 'automation' &&
    track.type !== 'ability' &&
    track.type !== 'envelope' &&
    track.type !== 'audio'
  )
}

interface DropArgs {
  tracks: Record<string, Track>
  rootTrackIds: string[]
  rows: VisualRow[]
  listTop: number
  /** Screen-x of the label column's left edge - the indent origin for depth picking. */
  listLeft: number
  rowHeight: number
  clientX: number
  clientY: number
  excludeSubtree?: Set<string>
}

/**
 * Resolve a pointer over the flattened track list to a drop target. The row's
 * top/bottom quarter is a sibling drop on the nearest row boundary; its middle is a
 * nest (the row highlights, appending as its last child). At a boundary several
 * nesting depths can be valid - after a grandchild the new track could be its
 * sibling, an uncle, or a root track, all on the same line - so the pointer's X
 * picks the depth: each INDENT_PX step right of the label edge is one level deeper,
 * clamped to the valid range (so any level is reachable, arbitrarily deep). Below
 * the last row is the same X-picked boundary drop. `excludeSubtree` is the set of
 * ids the drag can't land in (a track's own subtree); omit for a brand-new track.
 */
export function computeDropTarget(args: DropArgs): DropTarget | null {
  const { tracks, rows, listTop, rowHeight, clientY, excludeSubtree } = args
  const n = rows.length
  const contentY = clientY - listTop
  const rawIndex = Math.floor(contentY / rowHeight)

  // Below every row → the boundary after the last row.
  if (n === 0 || rawIndex >= n) return resolveBoundaryDrop(args, n)

  const overIndex = Math.max(0, Math.min(n - 1, rawIndex))
  const over = rows[overIndex]
  const overTrack = tracks[over.id]
  if (!overTrack || excludeSubtree?.has(over.id)) return null

  const frac = (contentY - overIndex * rowHeight) / rowHeight

  // Middle band of a row → nest into it (append as its last child).
  if (canNestInto(overTrack) && frac >= 0.25 && frac <= 0.75) {
    return { parentId: over.id, index: undefined, line: null, intoId: over.id }
  }

  // Edge → a boundary drop: the row's top edge is the boundary above it, its bottom
  // edge the boundary after its whole subtree (DFS-contiguous: descendants all have
  // depth > the row's).
  let boundary: number
  if (frac < 0.25) {
    boundary = overIndex
  } else {
    let j = overIndex + 1
    while (j < n && rows[j].depth > over.depth) j++
    boundary = j
  }
  return resolveBoundaryDrop(args, boundary)
}

/**
 * A sibling drop on the line between two rows (or past the last row). Valid depths
 * run from the next row's depth (any shallower would put the line below that row's
 * subtree, not here) up to one deeper than the previous row (becoming its first
 * child). The X-picked depth falls back one level shallower at a time when its
 * would-be parent can't take children or is itself being dragged.
 */
function resolveBoundaryDrop(args: DropArgs, boundary: number): DropTarget | null {
  const { tracks, rootTrackIds, rows, listLeft, rowHeight, clientX } = args
  const prev = boundary > 0 ? rows[boundary - 1] : null
  const minDepth = rows[boundary]?.depth ?? 0
  const maxDepth = (prev?.depth ?? -1) + 1
  const wanted = Math.round((clientX - listLeft - LABEL_BASE_PX) / INDENT_PX)

  for (let depth = Math.max(minDepth, Math.min(maxDepth, wanted)); depth >= minDepth; depth--) {
    const at = resolveAtDepth(args, prev, depth)
    if (!at) continue
    let { index } = at
    let top = boundary * rowHeight
    // Audio tracks are pinned as a block at the top: nothing may drop above (or
    // between) them. A drop aimed there lands right below the block instead.
    // Audio tracks have no child rows, so the block spans exactly pin rows.
    if (at.parentId == null) {
      const pin = audioPinnedCount(tracks, rootTrackIds)
      if (index < pin) {
        index = pin
        top = Math.max(top, pin * rowHeight)
      }
    }
    return { parentId: at.parentId, index, line: { top, left: depth * INDENT_PX }, intoId: null }
  }
  return null
}

/** The (parent, index) a boundary drop at `depth` means, given the row above the
 *  line; null when that depth isn't usable (parent can't nest / is being dragged). */
function resolveAtDepth(
  args: DropArgs,
  prev: VisualRow | null,
  depth: number,
): { parentId: string | null; index: number } | null {
  const { tracks, rootTrackIds, excludeSubtree } = args
  // Nothing above the line: only a first root drop.
  if (!prev) return { parentId: null, index: 0 }

  // One deeper than the row above → become its first child.
  if (depth === prev.depth + 1) {
    if (excludeSubtree?.has(prev.id) || !canNestInto(tracks[prev.id])) return null
    return { parentId: prev.id, index: 0 }
  }

  // Sibling drop after the previous row's ancestor at this depth.
  let anchor = prev.id
  for (let d = prev.depth; d > depth; d--) {
    const p = tracks[anchor]?.parentId
    if (p == null) return null
    anchor = p
  }
  const parentId = tracks[anchor]?.parentId ?? null
  if (parentId != null && excludeSubtree?.has(parentId)) return null
  const siblings = parentId == null ? rootTrackIds : tracks[parentId]?.childIds ?? []
  const pos = siblings.indexOf(anchor)
  // Index among the remaining (non-dragged) siblings, right after the anchor. An
  // anchor that is itself being dragged resolves to the slot it currently occupies.
  const index = siblings.slice(0, pos + 1).filter((id) => !excludeSubtree?.has(id)).length
  return { parentId, index }
}
