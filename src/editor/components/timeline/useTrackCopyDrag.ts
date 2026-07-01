import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { useProjectStore } from '../../store/ProjectStore'
import { useUIStore } from '../../store/UIStore'
import { lockCursor, unlockCursor } from '../../utils/dragCursor'

interface CopyDragState {
  srcIndex: number
  /** Where the copy would land (root index), or null while over the original (no-op). */
  insertIndex: number | null
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
  const sessionRef = useRef<{ srcId: string; srcIndex: number; grabOffsetY: number; listTop: number; insertIndex: number | null; rowHeight: number } | null>(null)

  const startTrackCopyDrag = useCallback((e: ReactPointerEvent, trackId: string) => {
    const sc = scrollRef.current
    if (!sc) return
    const { tracks, rootTrackIds } = useProjectStore.getState()
    const srcIndex = rootTrackIds.indexOf(trackId)
    const track = tracks[trackId]
    if (srcIndex < 0 || !track) return
    const rowHeight = useUIStore.getState().tracksRowHeight

    const scRect = sc.getBoundingClientRect()
    const listTop = scRect.top - sc.scrollTop // screen-y of row 0's top
    const grabOffsetY = e.clientY - (listTop + srcIndex * rowHeight)

    sessionRef.current = { srcId: trackId, srcIndex, grabOffsetY, listTop, insertIndex: null, rowHeight }
    setCopyDrag({ srcIndex, insertIndex: null, name: track.name, color: track.color, muted: track.muted, solo: track.solo, labelLeft: scRect.left, rowHeight })
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
      moveGhost(ev.clientY)
      const n = useProjectStore.getState().rootTrackIds.length
      // The row the dragged ghost sits majority-over (by its center) gets displaced
      // down, along with everything below it; hovering the original's row is the
      // no-op zone. Measured against the static (un-shifted) row positions.
      const ghostCenter = ev.clientY - s.listTop - s.grabOffsetY + s.rowHeight / 2
      const row = Math.max(0, Math.min(n, Math.floor(ghostCenter / s.rowHeight)))
      const insertIndex = row === s.srcIndex ? null : row
      if (s.insertIndex !== insertIndex) {
        s.insertIndex = insertIndex
        setCopyDrag((prev) => (prev ? { ...prev, insertIndex } : prev))
      }
    }
    const onUp = () => {
      const s = sessionRef.current
      controller.abort()
      sessionRef.current = null
      unlockCursor()
      if (s && s.insertIndex != null) {
        useProjectStore.getState().insertTrackCopy(s.srcId, s.insertIndex)
      }
      setCopyDrag(null)
    }
    window.addEventListener('pointermove', onMove, { signal: controller.signal })
    window.addEventListener('pointerup', onUp, { signal: controller.signal })
  }, [scrollRef])

  return { copyDrag, ghostRef, startTrackCopyDrag }
}
