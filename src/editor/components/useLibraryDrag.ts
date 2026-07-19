import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useProjectStore } from '../store/ProjectStore'
import { useUIStore } from '../store/UIStore'
import { hasMoverOrSplitterDefinition } from '../core/visualCopies/registry'
import { flattenVisualRows } from './timeline/trackTree'
import { selectNewTrack } from '../utils/selection'
import { computeDropTarget } from './timeline/trackDrop'
import { lockCursor, unlockCursor } from '../utils/dragCursor'
import { OBJECT_TRACK_COLOR, MOVER_TRACK_COLOR, COLORIZER_TRACK_COLOR } from '../utils/trackColors'
import { PLAYHEAD_TRIANGLE_HALF } from '../constants'
import type { Track } from '../types'

type LibraryItem = { id: string; name: string; kind: 'object' | 'modulator' | 'mover' | 'splitter' | 'colorizer' | 'director' }

function makeTrack(item: LibraryItem, parentId: string | null): Track {
  // Movers and splitters resolve through the MoverOrSplitter registry; ignore
  // ids the registry doesn't know.
  const isMover = (item.kind === 'mover' || item.kind === 'colorizer') && hasMoverOrSplitterDefinition(item.id)
  const isSplitter = item.kind === 'splitter' && hasMoverOrSplitterDefinition(item.id)
  const isDirector = item.kind === 'director'
  const state = useProjectStore.getState()
  const visualIds = state.sceneOrder.filter((id) => state.scenes[id] && !state.scenes[id].isMain)
  return {
    id: crypto.randomUUID(),
    name: item.name,
    type: isDirector ? 'director' : isSplitter ? 'splitter' : isMover ? 'mover' : 'base',
    instrumentId: isMover || isSplitter || isDirector ? '' : item.id,
    moverId: isMover ? item.id : undefined,
    splitterId: isSplitter ? item.id : undefined,
    directorId: isDirector ? item.id : undefined,
    sceneBindings: isDirector ? visualIds.map((sceneId, i) => ({ sceneId, pitch: 60 + i })) : undefined,
    inputValues: isMover || isSplitter ? {} : undefined,
    color: item.kind === 'object'
      ? OBJECT_TRACK_COLOR
      : item.kind === 'colorizer'
        ? COLORIZER_TRACK_COLOR
        : MOVER_TRACK_COLOR,
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
    parentId: isDirector ? undefined : parentId ?? undefined,
  }
}

/**
 * Drag a library instrument into the track label column to add a track there. Uses
 * the exact same drop logic as the in-timeline nest-drag (computeDropTarget) so you
 * can drop a new instrument as a sibling, nested into a track, or at the top level -
 * the shared drop indicator (UIStore.trackDrop) shows where it'll land. A floating
 * ghost follows the cursor; a pure click does nothing (a movement threshold gates it).
 */
export function useLibraryDrag() {
  const ghostRef = useRef<HTMLDivElement>(null)
  const [ghostName, setGhostName] = useState<string | null>(null)

  const startLibraryDrag = useCallback((e: ReactPointerEvent, item: LibraryItem) => {
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    let started = false
    let target: { parentId: string | null; index: number | undefined } | null = null

    // The ghost is centered on the cursor (translate(-50%,-50%) in the markup), so
    // left/top track the cursor directly rather than trailing it.
    const moveGhost = (x: number, y: number) => {
      if (ghostRef.current) {
        ghostRef.current.style.left = `${x}px`
        ghostRef.current.style.top = `${y}px`
      }
    }

    const controller = new AbortController()

    const onMove = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3) return
        started = true
        // Keep the default arrow throughout and suppress hover/interactions elsewhere.
        lockCursor('default')
        setGhostName(item.name)
        // The timeline lights up the label column as the drop zone.
        useUIStore.getState().setLibraryDragging(true)
        // Ghost mounts on this render; position it once it exists (next frame).
        const px = ev.clientX
        const py = ev.clientY
        requestAnimationFrame(() => moveGhost(px, py))
      }
      moveGhost(ev.clientX, ev.clientY)

      const sc = document.querySelector('[data-tracks-scroll]') as HTMLElement | null
      let drop: ReturnType<typeof computeDropTarget> = null
      if (sc) {
        const r = sc.getBoundingClientRect()
        const overLabels =
          ev.clientX >= r.left &&
          ev.clientX <= r.left + useUIStore.getState().tracksLabelWidth + PLAYHEAD_TRIANGLE_HALF &&
          ev.clientY >= r.top &&
          ev.clientY <= r.bottom
        if (overLabels) {
          const { tracks, rootTrackIds } = useProjectStore.getState()
          drop = computeDropTarget({
            tracks, rootTrackIds,
            rows: flattenVisualRows(tracks, rootTrackIds, useUIStore.getState().collapsedTrackIds),
            listTop: r.top - sc.scrollTop,
            rowHeight: useUIStore.getState().tracksRowHeight,
            clientY: ev.clientY,
          })
        }
      }
      if (drop && item.kind === 'director') drop = { ...drop, parentId: null, intoId: null }
      target = drop ? { parentId: drop.parentId, index: drop.index } : null
      useUIStore.getState().setTrackDrop(drop ? { line: drop.line, intoId: drop.intoId } : null)
    }

    const onUp = () => {
      controller.abort()
      if (!started) return
      unlockCursor()
      useUIStore.getState().setTrackDrop(null)
      useUIStore.getState().setLibraryDragging(false)
      setGhostName(null)
      if (target) {
        const track = makeTrack(item, target.parentId)
        useProjectStore.getState().addTrack(track, target.index)
        selectNewTrack(track.id)
        // Reveal the drop: expand the parent if it was collapsed.
        if (target.parentId) useUIStore.getState().setTrackCollapsed(target.parentId, false)
      }
    }

    window.addEventListener('pointermove', onMove, { signal: controller.signal })
    window.addEventListener('pointerup', onUp, { signal: controller.signal })
  }, [])

  return { startLibraryDrag, ghostRef, ghostName }
}
