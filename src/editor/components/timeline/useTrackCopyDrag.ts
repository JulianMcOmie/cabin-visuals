import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { useProjectStore } from '../../store/ProjectStore'
import { useUIStore } from '../../store/UIStore'
import { lockCursor, unlockCursor } from '../../utils/dragCursor'
import { flattenVisualRows } from './trackTree'
import { selectNewTrack, suppressTrackSelectBriefly } from '../../utils/selection'

interface CopyDragState {
  srcIndex: number
  /** Where the copy would land in its sibling/root list, or null over original. */
  insertIndex: number | null
  /** The VISUAL row index the reflow gap opens at (root tracks aren't at
   *  `index * rowHeight` once lanes/nested rows exist). null = no gap. */
  gapRow: number | null
  name: string
  color: string
  muted: boolean
  solo: boolean
  /** Screen-x of the frozen label column, for positioning the floating ghost. */
  labelLeft: number
  /** Track row height (px) captured at drag start — for the gap + ghost sizing. */
  rowHeight: number
}

/**
 * Alt-drag-to-duplicate for tracks. The original stays in the list, a ghost of the
 * row floats with the cursor, and the other rows reflow to open a gap at the live
 * insertion point. Committed on pointer-up (a copy is inserted at the gap); a no-op
 * if released over the original's own slot. `scrollRef` is the lane scroll container.
 */
export function useTrackCopyDrag(scrollRef: RefObject<HTMLDivElement | null>) {
  const [copyDrag, setCopyDrag] = useState<CopyDragState | null>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<{ srcId: string; srcIndex: number; grabOffsetY: number; listTop: number; insertIndex: number | null; gapRow: number | null; rowHeight: number; itemTops: number[]; containerEnd: number; parentId: string | null } | null>(null)

  const startTrackCopyDrag = useCallback((e: ReactPointerEvent, trackId: string) => {
    const sc = scrollRef.current
    if (!sc) return
    const { tracks, rootTrackIds } = useProjectStore.getState()
    const track = tracks[trackId]
    if (!track) return
    const parentId = track.parentId ?? null
    const siblingIds = parentId ? tracks[parentId]?.childIds ?? [] : rootTrackIds
    const srcIndex = siblingIds.indexOf(trackId)
    if (srcIndex < 0) return
    const rowHeight = useUIStore.getState().tracksRowHeight

    // Visual row of each sibling (roots and child dimensions both spread apart by
    // descendants), so the ghost maps to the real layout, not `index * rowHeight`.
    const rows = flattenVisualRows(tracks, rootTrackIds, useUIStore.getState().collapsedTrackIds)
    const rowIndexById = new Map<string, number>()
    rows.forEach((r, i) => { if (r.kind === 'track') rowIndexById.set(r.id, i) })
    const itemTops = siblingIds
      .map((id) => rowIndexById.get(id))
      .filter((i): i is number => i != null)
    const srcVisualIndex = rowIndexById.get(trackId)
    if (srcVisualIndex == null || itemTops.length === 0) return
    const parentVisualIndex = parentId ? rowIndexById.get(parentId) : undefined
    const parentDepth = parentVisualIndex == null ? -1 : rows[parentVisualIndex].depth
    const containerEnd = parentVisualIndex == null
      ? rows.length
      : rows.findIndex((r, i) => i > parentVisualIndex && r.depth <= parentDepth)
    const endRow = containerEnd === -1 ? rows.length : containerEnd

    const scRect = sc.getBoundingClientRect()
    const listTop = scRect.top - sc.scrollTop // screen-y of row 0's top
    const grabOffsetY = e.clientY - (listTop + srcVisualIndex * rowHeight)

    sessionRef.current = { srcId: trackId, srcIndex, grabOffsetY, listTop, insertIndex: null, gapRow: null, rowHeight, itemTops, containerEnd: endRow, parentId }
    setCopyDrag({ srcIndex, insertIndex: null, gapRow: null, name: track.name, color: track.color, muted: track.muted, solo: track.solo, labelLeft: scRect.left, rowHeight })
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
      // The drag ends with a click on the source label — it must not steal the
      // selection from the new copy (selectNewTrack at drop).
      suppressTrackSelectBriefly()
      moveGhost(ev.clientY)
      const k = s.itemTops.length
      const bottomOf = (j: number) => (j + 1 < k ? s.itemTops[j + 1] : s.containerEnd)
      // Ghost center in visual-row units, against the static (un-shifted) layout.
      const gcRow = (ev.clientY - s.listTop - s.grabOffsetY + s.rowHeight / 2) / s.rowHeight

      let insertIndex: number | null
      let gapRow: number | null
      // Hovering anywhere over the original's block (its row + its lanes) is the no-op.
      if (gcRow >= s.itemTops[s.srcIndex] && gcRow < bottomOf(s.srcIndex)) {
        insertIndex = null
        gapRow = null
      } else {
        // Insert after every sibling block whose midpoint is above the cursor.
        let idx = 0
        for (let j = 0; j < k; j++) {
          if ((s.itemTops[j] + bottomOf(j)) / 2 < gcRow) idx = j + 1
        }
        // The audio track is pinned at root index 0 — nothing lands above it.
        const { tracks, rootTrackIds } = useProjectStore.getState()
        if (s.parentId == null && idx === 0 && tracks[rootTrackIds[0]]?.type === 'audio') idx = 1
        insertIndex = idx
        gapRow = idx < k ? s.itemTops[idx] : s.containerEnd
      }
      if (s.insertIndex !== insertIndex || s.gapRow !== gapRow) {
        s.insertIndex = insertIndex
        s.gapRow = gapRow
        setCopyDrag((prev) => (prev ? { ...prev, insertIndex, gapRow } : prev))
      }
    }
    const onUp = () => {
      const s = sessionRef.current
      controller.abort()
      sessionRef.current = null
      unlockCursor()
      if (s && s.insertIndex != null) {
        const copyId = useProjectStore.getState().insertTrackCopy(s.srcId, s.insertIndex)
        if (copyId) selectNewTrack(copyId)
      }
      setCopyDrag(null)
    }
    window.addEventListener('pointermove', onMove, { signal: controller.signal })
    window.addEventListener('pointerup', onUp, { signal: controller.signal })
  }, [scrollRef])

  return { copyDrag, ghostRef, startTrackCopyDrag }
}
