import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { useProjectStore } from '../../store/ProjectStore'
import { useUIStore } from '../../store/UIStore'
import { lockCursor, unlockCursor } from '../../utils/dragCursor'
import { flattenVisualRows } from './trackTree'
import { selectNewTrack, suppressTrackSelectBriefly } from '../../utils/selection'

interface CopyDragState {
  srcIndex: number
  /** Where the copy would land (root index), or null while over the original (no-op). */
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
  const sessionRef = useRef<{ srcId: string; srcIndex: number; grabOffsetY: number; listTop: number; insertIndex: number | null; gapRow: number | null; rowHeight: number; rootTops: number[]; n: number } | null>(null)

  const startTrackCopyDrag = useCallback((e: ReactPointerEvent, trackId: string) => {
    const sc = scrollRef.current
    if (!sc) return
    const { tracks, rootTrackIds } = useProjectStore.getState()
    const srcIndex = rootTrackIds.indexOf(trackId)
    const track = tracks[trackId]
    if (srcIndex < 0 || !track) return
    const rowHeight = useUIStore.getState().tracksRowHeight

    // Visual row of each root track (they're spread apart by their lanes + nested
    // descendants), so the ghost maps to the real layout, not `index * rowHeight`.
    const rows = flattenVisualRows(tracks, rootTrackIds, useUIStore.getState().collapsedTrackIds)
    const rootTops: number[] = []
    rows.forEach((r, i) => { if (r.kind === 'track' && r.depth === 0) rootTops.push(i) })
    const n = rows.length
    const srcVisualIndex = rootTops[srcIndex] ?? srcIndex

    const scRect = sc.getBoundingClientRect()
    const listTop = scRect.top - sc.scrollTop // screen-y of row 0's top
    const grabOffsetY = e.clientY - (listTop + srcVisualIndex * rowHeight)

    sessionRef.current = { srcId: trackId, srcIndex, grabOffsetY, listTop, insertIndex: null, gapRow: null, rowHeight, rootTops, n }
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
      const k = s.rootTops.length
      const bottomOf = (j: number) => (j + 1 < k ? s.rootTops[j + 1] : s.n)
      // Ghost center in visual-row units, against the static (un-shifted) layout.
      const gcRow = (ev.clientY - s.listTop - s.grabOffsetY + s.rowHeight / 2) / s.rowHeight

      let insertIndex: number | null
      let gapRow: number | null
      // Hovering anywhere over the original's block (its row + its lanes) is the no-op.
      if (gcRow >= s.rootTops[s.srcIndex] && gcRow < bottomOf(s.srcIndex)) {
        insertIndex = null
        gapRow = null
      } else {
        // Insert after every root block whose midpoint is above the cursor.
        let idx = 0
        for (let j = 0; j < k; j++) {
          if ((s.rootTops[j] + bottomOf(j)) / 2 < gcRow) idx = j + 1
        }
        insertIndex = idx
        gapRow = idx < k ? s.rootTops[idx] : s.n
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
