import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { MAX_TOTAL_BARS, useProjectStore } from '../store/ProjectStore'
import { useUIStore } from '../store/UIStore'
import { useTimeStore } from '../store/TimeStore'
import { flattenVisualRows } from './timeline/trackTree'
import { selectNewTrack } from '../utils/selection'
import { lockCursor, unlockCursor } from '../utils/dragCursor'
import { PLAYHEAD_TRIANGLE_HALF } from '../constants'
import { audioPickupBars } from '../utils/audioPickup'
import type { VisualLoop } from './loops'

/** Complete loops always add their own root instrument; dropping on a lane
 * chooses a time and insertion point without changing that lane's instrument. */
export function addVisualLoop(loop: VisualLoop, bar?: number, index?: number) {
  const state = useProjectStore.getState()
  if (state.scenes[state.activeSceneId]?.isMain) return
  const startBar = Math.max(0, Math.min(MAX_TOTAL_BARS - loop.bars,
    Math.floor(bar ?? useTimeStore.getState().currentBeat / state.beatsPerBar)))
  const tree = loop.createTracks(startBar, state.beatsPerBar)
  state.addTrackTree(tree, index)
  selectNewTrack(tree[0].id)
  useUIStore.getState().setTrackCollapsed(tree[0].id, false)
}

export function useLoopBlockDrag() {
  const ghostRef = useRef<HTMLDivElement>(null)
  const cancelDrag = useRef<(() => void) | null>(null)
  const [ghostName, setGhostName] = useState<string | null>(null)
  useEffect(() => () => cancelDrag.current?.(), [])
  const startLoopBlockDrag = useCallback((e: ReactPointerEvent, loop: VisualLoop) => {
    if (e.button !== 0) return
    cancelDrag.current?.()
    e.preventDefault()
    const startX = e.clientX, startY = e.clientY
    const sceneId = useProjectStore.getState().activeSceneId
    let started = false
    const controller = new AbortController()
    const moveGhost = (x: number, y: number) => {
      if (ghostRef.current) {
        ghostRef.current.style.left = `${x}px`
        ghostRef.current.style.top = `${y}px`
      }
    }
    const dropTarget = (x: number, y: number) => {
      const sc = document.querySelector<HTMLElement>('[data-tracks-scroll]')
      const state = useProjectStore.getState()
      if (!sc || state.activeSceneId !== sceneId || state.scenes[sceneId]?.isMain) return null
      const r = sc.getBoundingClientRect()
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null
      const ui = useUIStore.getState()
      const rows = flattenVisualRows(state.tracks, state.rootTrackIds, ui.collapsedTrackIds)
      const rowIndex = Math.floor((y - r.top + sc.scrollTop) / ui.tracksRowHeight)
      let rootId: string | undefined = rows[rowIndex]?.id
      while (rootId && state.tracks[rootId]?.parentId) rootId = state.tracks[rootId].parentId
      const index = rootId ? state.rootTrackIds.indexOf(rootId) + 1 : state.rootTrackIds.length
      const lastRow = rootId ? rows.findLastIndex(row => {
        let id: string | undefined = row.id
        while (id && state.tracks[id]?.parentId) id = state.tracks[id].parentId
        return id === rootId
      }) + 1 : rows.length
      const laneLeft = r.left + ui.tracksLabelWidth + PLAYHEAD_TRIANGLE_HALF
      const beat = x < laneLeft ? 0 : (x - laneLeft + sc.scrollLeft) / ui.tracksPixelsPerBeat
        - audioPickupBars(state.tracks) * state.beatsPerBar
      return { index, bar: Math.max(0, Math.floor(beat / state.beatsPerBar)), top: lastRow * ui.tracksRowHeight }
    }
    const onMove = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3) return
        started = true
        lockCursor('default')
        setGhostName(loop.name)
        useUIStore.getState().setLibraryDragging(true)
        requestAnimationFrame(() => moveGhost(ev.clientX, ev.clientY))
      }
      moveGhost(ev.clientX, ev.clientY)
      const target = dropTarget(ev.clientX, ev.clientY)
      useUIStore.getState().setTrackDrop(target ? { line: { top: target.top, left: 0 }, intoId: null } : null)
    }
    const cleanup = () => {
      controller.abort()
      cancelDrag.current = null
      if (!started) return
      unlockCursor()
      setGhostName(null)
      useUIStore.getState().setLibraryDragging(false)
      useUIStore.getState().setTrackDrop(null)
    }
    const onUp = (ev: PointerEvent) => {
      const target = started ? dropTarget(ev.clientX, ev.clientY) : null
      cleanup()
      if (target) addVisualLoop(loop, target.bar, target.index)
    }
    cancelDrag.current = cleanup
    window.addEventListener('pointermove', onMove, { signal: controller.signal })
    window.addEventListener('pointerup', onUp, { signal: controller.signal })
    window.addEventListener('pointercancel', cleanup, { signal: controller.signal })
    window.addEventListener('blur', cleanup, { signal: controller.signal })
  }, [])
  return { startLoopBlockDrag, ghostRef, ghostName }
}
