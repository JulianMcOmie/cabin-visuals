import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { useProjectStore } from '../../store/ProjectStore'
import { useUIStore } from '../../store/UIStore'
import { lockCursor, unlockCursor } from '../../utils/dragCursor'
import { flattenVisualRows, subtreeIds, type VisualRow } from './trackTree'
import { suppressTrackSelectBriefly } from '../../utils/selection'
import { computeDropTarget } from './trackDrop'

interface Session {
  activeId: string
  /** Every track the drag moves, in visual order - the grabbed track alone, or
   *  the whole multi-selection when the grabbed track belongs to it. */
  activeIds: string[]
  rows: VisualRow[]
  subtree: Set<string>
  listTop: number
  rowHeight: number
  /** Resolved drop, applied on pointer-up. null = no valid target. */
  target: { parentId: string | null; index: number | undefined } | null
}

/** Track types that live only on their parent object - never re-parented. */
function isPinnedChildType(type: string | undefined): boolean {
  return type === 'automation' || type === 'ability' || type === 'envelope'
}

/**
 * Drag-to-nest for tracks. Grab a track's label and drag: the row under the cursor's
 * top/bottom edge gives a sibling drop (an insertion line), its middle gives a nest
 * (the row highlights, the track becomes its child), and below everything drops at the
 * top level last. Committed via setTrackParent on release. The drop indicator is shared
 * with the library drag through UIStore.trackDrop. `scrollRef` = lane scroll.
 */
export function useTrackNestDrag(scrollRef: RefObject<HTMLDivElement | null>) {
  const sessionRef = useRef<Session | null>(null)

  const startNestDrag = useCallback((e: ReactPointerEvent, trackId: string) => {
    const sc = scrollRef.current
    if (!sc) return
    const { tracks, rootTrackIds } = useProjectStore.getState()
    if (!tracks[trackId]) return
    // Automation + envelope + ability tracks live only on their parent object - they
    // can't be re-parented or moved to the root. (A plain pointer-down still selects
    // the row.)
    if (isPinnedChildType(tracks[trackId].type)) return
    const ui = useUIStore.getState()
    const rowHeight = ui.tracksRowHeight
    const rows = flattenVisualRows(tracks, rootTrackIds, ui.collapsedTrackIds)
    if (rows.findIndex((r) => r.kind === 'track' && r.id === trackId) < 0) return

    // Grabbing a row that belongs to the multi-selection drags the whole
    // selection (in visual order); an unselected row always drags alone.
    const selection = new Set(ui.selectedTrackIds)
    if (ui.selectedTrackId) selection.add(ui.selectedTrackId)
    const groupIds = selection.has(trackId)
      ? rows
          .filter((r) => r.kind === 'track' && selection.has(r.id))
          .map((r) => r.id)
          .filter((id) => tracks[id] && tracks[id].type !== 'audio' && !isPinnedChildType(tracks[id].type))
      : [trackId]
    // A member whose ancestor is also dragged rides along inside that subtree.
    const groupSet = new Set(groupIds)
    const activeIds = groupIds.filter((id) => {
      for (let cur = tracks[id]?.parentId; cur != null; cur = tracks[cur]?.parentId) {
        if (groupSet.has(cur)) return false
      }
      return true
    })
    if (activeIds.length === 0) return

    const scRect = sc.getBoundingClientRect()
    const subtree = new Set<string>()
    for (const id of activeIds) for (const sid of subtreeIds(tracks, id)) subtree.add(sid)
    const session: Session = {
      activeId: trackId,
      activeIds,
      rows,
      subtree,
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
      const drop = computeDropTarget({
        tracks, rootTrackIds, rows: s.rows, listTop: s.listTop, rowHeight: s.rowHeight,
        clientY: ev.clientY, excludeSubtree: s.subtree,
      })
      s.target = drop ? { parentId: drop.parentId, index: drop.index } : null
      useUIStore.getState().setTrackDrop({ activeId: s.activeId, line: drop?.line ?? null, intoId: drop?.intoId ?? null })
    }

    const controller = new AbortController()
    const onMove = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return
        started = true
        // The drag ends with a click on the label - it must not re-select.
        suppressTrackSelectBriefly()
        // Suppress text selection (and lock the cursor) for the duration of the drag;
        // the plain pointer-down path doesn't preventDefault so a click can still select.
        lockCursor('grabbing')
        useUIStore.getState().setTrackDrop({ activeId: trackId, line: null, intoId: null })
      }
      computeTarget(ev)
    }
    const onUp = () => {
      const s = sessionRef.current
      controller.abort()
      sessionRef.current = null
      if (started) {
        unlockCursor()
        useUIStore.getState().setTrackDrop(null)
      }
      if (started && s?.target) {
        useProjectStore.getState().setTracksParent(s.activeIds, s.target.parentId, s.target.index)
        // Reveal the drop: expand the parent if it was collapsed.
        if (s.target.parentId) useUIStore.getState().setTrackCollapsed(s.target.parentId, false)
      }
    }
    window.addEventListener('pointermove', onMove, { signal: controller.signal })
    window.addEventListener('pointerup', onUp, { signal: controller.signal })
  }, [scrollRef])

  return { startNestDrag }
}
