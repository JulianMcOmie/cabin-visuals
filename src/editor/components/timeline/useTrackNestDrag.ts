import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { useProjectStore } from '../../store/ProjectStore'
import { useUIStore } from '../../store/UIStore'
import { lockCursor, unlockCursor } from '../../utils/dragCursor'
import { flattenVisualRows, subtreeIds, type VisualRow } from './trackTree'
import { suppressTrackSelectBriefly } from '../../utils/selection'
import { automationTargetsForParent, laneWearsAutoName } from '../../utils/automationTargets'
import { computeDropTarget, isPinnedChildType } from './trackDrop'

interface Session {
  activeId: string
  /** Every track the drag moves, in visual order - the grabbed track alone, or
   *  the whole multi-selection when the grabbed track belongs to it. */
  activeIds: string[]
  rows: VisualRow[]
  subtree: Set<string>
  listTop: number
  listLeft: number
  rowHeight: number
  /** Resolved drop, applied on pointer-up. null = no valid target. */
  target: { parentId: string | null; index: number | undefined } | null
}

/**
 * Drag-to-nest for tracks. Grab a track's label and drag: the row under the cursor's
 * top/bottom edge gives a sibling drop (an insertion line whose nesting depth follows
 * the pointer's X - any valid level at that boundary, arbitrarily deep), its middle
 * gives a nest (the row highlights, the track becomes its last child). Committed via
 * setTracksParent on release. The drop indicator is shared with the library drag
 * through UIStore.trackDrop. `scrollRef` = lane scroll.
 */
export function useTrackNestDrag(scrollRef: RefObject<HTMLDivElement | null>) {
  const sessionRef = useRef<Session | null>(null)

  const startNestDrag = useCallback((e: ReactPointerEvent, trackId: string) => {
    const sc = scrollRef.current
    if (!sc) return
    const { tracks, rootTrackIds } = useProjectStore.getState()
    if (!tracks[trackId]) return
    // Ability lanes live only on their parent object - they can't be
    // re-parented (opt+drag copies them; a plain pointer-down still selects the
    // row). AUTOMATION lanes DO move between parents: the drop remaps their
    // target when the new parent can't take it (remapAutomationTarget), so they
    // ride the normal drag; only the root level stays off-limits (below).
    const grabbedType = tracks[trackId].type
    if (isPinnedChildType(grabbedType) && grabbedType !== 'automation') return
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
          .filter((id) => {
            const t = tracks[id]
            return !!t && t.type !== 'audio' && (!isPinnedChildType(t.type) || t.type === 'automation')
          })
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
      listLeft: scRect.left, // labels are sticky at the container's left edge
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
      let drop = computeDropTarget({
        tracks, rootTrackIds, rows: s.rows, listTop: s.listTop, listLeft: s.listLeft,
        rowHeight: s.rowHeight, clientX: ev.clientX, clientY: ev.clientY, excludeSubtree: s.subtree,
      })
      // An automation lane lives only ON a parent - a drag carrying one can't
      // land at the root level (any parent is fine; the commit remaps targets).
      if (drop && drop.parentId == null && s.activeIds.some((id) => tracks[id]?.type === 'automation')) drop = null
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
        const store = useProjectStore.getState()
        const mainActive = !!store.scenes[store.activeSceneId]?.isMain
        // Automation lanes changing parent get their target fixed after the
        // move; the auto-name flag must be read BEFORE it, while the old parent
        // still resolves the current target's label. Both writes land in the
        // same tick, so history collapses them into one undo step.
        const remaps = s.activeIds.flatMap((id) => {
          const lane = store.tracks[id]
          if (!lane || lane.type !== 'automation' || (lane.parentId ?? null) === s.target!.parentId) return []
          const oldParent = lane.parentId ? store.tracks[lane.parentId] : undefined
          return [{ id, rename: !!oldParent && laneWearsAutoName(lane, oldParent, mainActive) }]
        })
        store.setTracksParent(s.activeIds, s.target.parentId, s.target.index)
        const post = useProjectStore.getState()
        for (const { id, rename } of remaps) {
          const lane = post.tracks[id]
          const parent = lane?.parentId ? post.tracks[lane.parentId] : undefined
          if (lane && parent) post.remapAutomationTarget(id, automationTargetsForParent(parent, mainActive), rename)
        }
        // Reveal the drop: expand the parent if it was collapsed.
        if (s.target.parentId) useUIStore.getState().setTrackCollapsed(s.target.parentId, false)
      }
    }
    window.addEventListener('pointermove', onMove, { signal: controller.signal })
    window.addEventListener('pointerup', onUp, { signal: controller.signal })
    window.addEventListener('pointercancel', onUp, { signal: controller.signal })
  }, [scrollRef])

  return { startNestDrag }
}
