import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { useProjectStore } from '../../store/ProjectStore'
import { useUIStore } from '../../store/UIStore'
import { lockCursor, unlockCursor } from '../../utils/dragCursor'
import { flattenTracks, subtreeIds, type FlatTrack } from './trackTree'

/** One indent level (px) — also the label's left-padding step (see Track). */
export const INDENT_PX = 16
/** The label's base left padding (matches `pl-3` ≈ 12px), where depth 0 sits. */
export const LABEL_BASE_PX = 12

export interface NestDragState {
  activeId: string
  /** Insertion line (content-space px) for a sibling drop; null when nesting into. */
  line: { top: number; left: number } | null
  /** The row being nested *into* (highlighted); null for a sibling drop. */
  intoId: string | null
}

interface Session {
  activeId: string
  flat: FlatTrack[]
  subtree: Set<string>
  listTop: number
  rowHeight: number
  /** Resolved drop, applied on pointer-up. null = no valid target. */
  target: { parentId: string | null; index: number | undefined } | null
}

/**
 * Drag-to-nest for tracks. Grab a track's label and drag: the row under the cursor's
 * top/bottom edge gives a sibling drop (an insertion line), its middle gives a nest
 * (the row highlights, the track becomes its child). Committed via setTrackParent on
 * release. You can't drop a track inside its own subtree. `scrollRef` = lane scroll.
 */
export function useTrackNestDrag(scrollRef: RefObject<HTMLDivElement | null>) {
  const [nestDrag, setNestDrag] = useState<NestDragState | null>(null)
  const sessionRef = useRef<Session | null>(null)

  const startNestDrag = useCallback((e: ReactPointerEvent, trackId: string) => {
    const sc = scrollRef.current
    if (!sc) return
    const { tracks, rootTrackIds } = useProjectStore.getState()
    if (!tracks[trackId]) return
    const rowHeight = useUIStore.getState().tracksRowHeight
    const flat = flattenTracks(tracks, rootTrackIds)
    if (flat.findIndex((f) => f.id === trackId) < 0) return

    const scRect = sc.getBoundingClientRect()
    const session: Session = {
      activeId: trackId,
      flat,
      subtree: subtreeIds(tracks, trackId),
      listTop: scRect.top - sc.scrollTop, // screen-y of content row 0's top
      rowHeight,
      target: null,
    }
    sessionRef.current = session

    let started = false
    const startX = e.clientX
    const startY = e.clientY

    const computeTarget = (ev: PointerEvent) => {
      const s = sessionRef.current
      if (!s) return
      const { tracks, rootTrackIds } = useProjectStore.getState()
      const contentY = ev.clientY - s.listTop
      const n = s.flat.length
      const overIndex = Math.max(0, Math.min(n - 1, Math.floor(contentY / s.rowHeight)))
      const over = s.flat[overIndex]
      const overTrack = tracks[over.id]

      // Can't drop into the active track's own subtree.
      if (!overTrack || s.subtree.has(over.id)) {
        s.target = null
        setNestDrag((p) => (p ? { ...p, line: null, intoId: null } : p))
        return
      }

      const frac = (contentY - overIndex * s.rowHeight) / s.rowHeight

      if (frac >= 0.25 && frac <= 0.75) {
        // Middle band → nest into `over` (append as its last child).
        s.target = { parentId: over.id, index: undefined }
        setNestDrag((p) => (p ? { ...p, line: null, intoId: over.id } : p))
        return
      }

      // Top/bottom edge → sibling drop in `over`'s parent.
      const parentId = overTrack.parentId ?? null
      const siblings = (parentId == null ? rootTrackIds : tracks[parentId]?.childIds ?? []).filter(
        (id) => id !== s.activeId,
      )
      const pos = siblings.indexOf(over.id)
      let index: number
      let top: number
      if (frac < 0.25) {
        // Before `over`.
        index = pos < 0 ? 0 : pos
        top = overIndex * s.rowHeight
      } else {
        // After `over` and its whole subtree (DFS-contiguous, depth > over.depth).
        index = pos < 0 ? siblings.length : pos + 1
        let j = overIndex + 1
        while (j < s.flat.length && s.flat[j].depth > over.depth) j++
        top = j * s.rowHeight
      }
      s.target = { parentId, index }
      setNestDrag((p) => (p ? { ...p, line: { top, left: LABEL_BASE_PX + over.depth * INDENT_PX }, intoId: null } : p))
    }

    const controller = new AbortController()
    const onMove = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return
        started = true
        // Suppress text selection (and lock the cursor) for the duration of the drag;
        // the plain pointer-down path doesn't preventDefault so a click can still select.
        lockCursor('grabbing')
        setNestDrag({ activeId: trackId, line: null, intoId: null })
      }
      computeTarget(ev)
    }
    const onUp = () => {
      const s = sessionRef.current
      controller.abort()
      sessionRef.current = null
      if (started) unlockCursor()
      if (started && s?.target) {
        useProjectStore.getState().setTrackParent(s.activeId, s.target.parentId, s.target.index)
      }
      setNestDrag(null)
    }
    window.addEventListener('pointermove', onMove, { signal: controller.signal })
    window.addEventListener('pointerup', onUp, { signal: controller.signal })
  }, [scrollRef])

  return { nestDrag, startNestDrag }
}
