import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { useProjectStore } from '../../store/ProjectStore'
import { useUIStore } from '../../store/UIStore'
import { lockCursor, unlockCursor } from '../../utils/dragCursor'
import { flattenVisualRows, subtreeIds, type VisualRow } from './trackTree'
import { selectNewTrack, suppressTrackSelectBriefly } from '../../utils/selection'
import { computeDropTarget } from './trackDrop'

interface CopyDragState {
  /** The VISUAL row index the reflow gap opens at (root tracks aren't at
   *  `index * rowHeight` once nested rows exist). null = no gap (no target,
   *  or a nest-into drop, which highlights the row instead). */
  gapRow: number | null
  /** Whether releasing now would commit a copy somewhere. */
  hasTarget: boolean
  name: string
  color: string
  muted: boolean
  solo: boolean
  /** Screen-x of the frozen label column, for positioning the floating ghost. */
  labelLeft: number
  /** Track row height (px) captured at drag start - for the gap + ghost sizing. */
  rowHeight: number
}

interface Session {
  srcId: string
  srcParentId: string | null
  subtree: Set<string>
  rows: VisualRow[]
  grabOffsetY: number
  listTop: number
  rowHeight: number
  /** Resolved drop, applied on pointer-up. null = no valid target. */
  target: { parentId: string | null; index: number | undefined } | null
  gapRow: number | null
  hasTarget: boolean
}

/**
 * Alt-drag-to-duplicate for tracks. The original stays in the list, a ghost of the
 * row floats with the cursor, and the drop targeting mirrors the plain nest-drag
 * (computeDropTarget): a row's top/bottom edge inserts a copy as a sibling at that
 * level - in any parent, not just the original's - and its middle band nests the
 * copy into that row. Sibling drops open a reflow gap; nest drops highlight the
 * target row. Committed on pointer-up; a no-op if released over the original's own
 * subtree. `scrollRef` is the lane scroll container.
 */
export function useTrackCopyDrag(scrollRef: RefObject<HTMLDivElement | null>) {
  const [copyDrag, setCopyDrag] = useState<CopyDragState | null>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<Session | null>(null)

  const startTrackCopyDrag = useCallback((e: ReactPointerEvent, trackId: string) => {
    const sc = scrollRef.current
    if (!sc) return
    const { tracks, rootTrackIds } = useProjectStore.getState()
    const track = tracks[trackId]
    if (!track) return
    const rowHeight = useUIStore.getState().tracksRowHeight
    const rows = flattenVisualRows(tracks, rootTrackIds, useUIStore.getState().collapsedTrackIds)
    const srcVisualIndex = rows.findIndex((r) => r.id === trackId)
    if (srcVisualIndex < 0) return

    const scRect = sc.getBoundingClientRect()
    const listTop = scRect.top - sc.scrollTop // screen-y of row 0's top
    const grabOffsetY = e.clientY - (listTop + srcVisualIndex * rowHeight)

    sessionRef.current = {
      srcId: trackId,
      srcParentId: track.parentId ?? null,
      subtree: subtreeIds(tracks, trackId),
      rows,
      grabOffsetY,
      listTop,
      rowHeight,
      target: null,
      gapRow: null,
      hasTarget: false,
    }
    setCopyDrag({ gapRow: null, hasTarget: false, name: track.name, color: track.color, muted: track.muted, solo: track.solo, labelLeft: scRect.left, rowHeight })
    lockCursor('grabbing')

    const moveGhost = (clientY: number) => {
      if (ghostRef.current) ghostRef.current.style.top = `${clientY - grabOffsetY}px`
    }
    // Position once the ghost has mounted (next frame); top is driven purely
    // imperatively so re-renders (gap changes) never reset it.
    const startY = e.clientY
    requestAnimationFrame(() => moveGhost(startY))

    const controller = new AbortController()
    const onMove = (ev: PointerEvent) => {
      const s = sessionRef.current
      if (!s) return
      // The drag ends with a click on the source label - it must not steal the
      // selection from the new copy (selectNewTrack at drop).
      suppressTrackSelectBriefly()
      moveGhost(ev.clientY)

      const { tracks, rootTrackIds } = useProjectStore.getState()
      const overIndex = Math.floor((ev.clientY - s.listTop) / s.rowHeight)
      // Hovering the original's own subtree is the cancel/no-op zone.
      const overOriginal = overIndex >= 0 && overIndex < s.rows.length && s.subtree.has(s.rows[overIndex].id)
      // No excludeSubtree: the original stays in place, so sibling indexes must be
      // computed against the full (unfiltered) lists - they map 1:1 onto the
      // insertion index insertTrackCopy uses.
      let drop = overOriginal ? null : computeDropTarget({
        tracks, rootTrackIds, rows: s.rows, listTop: s.listTop, rowHeight: s.rowHeight,
        clientY: ev.clientY,
      })
      // Automation + envelope + ability tracks live only on their parent object -
      // a copy can't land under a different parent (or nest into anything).
      const srcType = tracks[s.srcId]?.type
      if (drop && (srcType === 'automation' || srcType === 'ability' || srcType === 'envelope')) {
        if (drop.intoId != null || drop.parentId !== s.srcParentId) drop = null
      }

      s.target = drop ? { parentId: drop.parentId, index: drop.index } : null
      const gapRow = drop?.line ? Math.round(drop.line.top / s.rowHeight) : null
      const hasTarget = drop != null
      // Nest-into highlight (and the indented insertion line inside the gap) reuse
      // the shared drop indicator; no activeId - the original isn't dimmed.
      useUIStore.getState().setTrackDrop(drop ? { line: drop.line, intoId: drop.intoId } : null)
      if (s.gapRow !== gapRow || s.hasTarget !== hasTarget) {
        s.gapRow = gapRow
        s.hasTarget = hasTarget
        setCopyDrag((prev) => (prev ? { ...prev, gapRow, hasTarget } : prev))
      }
    }
    const onUp = () => {
      const s = sessionRef.current
      controller.abort()
      sessionRef.current = null
      unlockCursor()
      useUIStore.getState().setTrackDrop(null)
      if (s?.target) {
        const copyId = useProjectStore.getState().insertTrackCopy(s.srcId, s.target.parentId, s.target.index)
        if (copyId) {
          selectNewTrack(copyId)
          // Reveal the drop: expand the parent if it was collapsed.
          if (s.target.parentId) useUIStore.getState().setTrackCollapsed(s.target.parentId, false)
        }
      }
      setCopyDrag(null)
    }
    window.addEventListener('pointermove', onMove, { signal: controller.signal })
    window.addEventListener('pointerup', onUp, { signal: controller.signal })
  }, [scrollRef])

  return { copyDrag, ghostRef, startTrackCopyDrag }
}
