import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { resolveNextTrackColor, useProjectStore } from '../store/ProjectStore'
import { useUIStore } from '../store/UIStore'
import { hasMoverOrSplitterDefinition } from '../core/visualCopies/registry'
import { getInstrument } from '../instruments'
import { flattenVisualRows } from './timeline/trackTree'
import { selectNewTrack } from '../utils/selection'
import { computeDropTarget } from './timeline/trackDrop'
import { lockCursor, unlockCursor } from '../utils/dragCursor'
import { PLAYHEAD_TRIANGLE_HALF } from '../constants'
import { seedSceneBindings } from '../core/directors/sceneBindings'
import type { Track } from '../types'

type LibraryItem = { id: string; name: string; kind: 'object' | 'modulator' | 'mover' | 'splitter' | 'colorizer' | 'director' | 'wordFormation' }

/** A Word Formation card may only land on a track whose instrument seats words
 *  (Text Display). Anywhere else the lane would resolve and then do nothing, so
 *  the drop is refused outright rather than leaving a dead row behind. */
function seatsWords(trackId: string | null | undefined): boolean {
  if (!trackId) return false
  const t = useProjectStore.getState().tracks[trackId]
  return !!t && !!getInstrument(t.instrumentId)?.seatsWords
}

function makeTrack(item: LibraryItem, parentId: string | null): Track {
  // Movers and splitters resolve through the MoverOrSplitter registry; ignore
  // ids the registry doesn't know.
  const isMover = (item.kind === 'mover' || item.kind === 'colorizer') && hasMoverOrSplitterDefinition(item.id)
  const isSplitter = item.kind === 'splitter' && hasMoverOrSplitterDefinition(item.id)
  // Composition instruments (the Main library's cards) are ordinary base
  // tracks whose instrumentId names a composition def - they just start with
  // seeded scene bindings and always land at the root.
  const isComposition = item.kind === 'director'
  // A Word Formation card makes a `wordFormation` child lane, not an object.
  // It is named for its position among its siblings, the way the context menu
  // names them, because what tells two formations apart is which one you play.
  const isFormation = item.kind === 'wordFormation'
  const state = useProjectStore.getState()
  const formationCount = isFormation && parentId
    ? (state.tracks[parentId]?.childIds ?? []).filter((cid) => state.tracks[cid]?.type === 'wordFormation').length
    : 0
  return {
    id: crypto.randomUUID(),
    name: isFormation ? `Formation ${String.fromCharCode(65 + Math.min(formationCount, 25))}` : item.name,
    type: isFormation ? 'wordFormation' : isSplitter ? 'splitter' : isMover ? 'mover' : 'base',
    instrumentId: isMover || isSplitter || isFormation ? '' : item.id,
    moverId: isMover ? item.id : undefined,
    splitterId: isSplitter ? item.id : undefined,
    sceneBindings: isComposition ? seedSceneBindings(state.scenes, state.sceneOrder) : undefined,
    inputValues: isMover || isSplitter || isFormation ? {} : undefined,
    color: resolveNextTrackColor(state, parentId),
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
    parentId: isComposition ? undefined : parentId ?? undefined,
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
            listLeft: r.left,
            rowHeight: useUIStore.getState().tracksRowHeight,
            clientX: ev.clientX,
            clientY: ev.clientY,
          })
        }
      }
      if (drop && item.kind === 'director') drop = { ...drop, parentId: null, intoId: null }
      // A formation lane belongs to a text track and nowhere else: refuse any
      // drop whose parent can't seat words, so the indicator never promises a
      // landing that would leave an inert row on some other instrument.
      if (drop && item.kind === 'wordFormation' && !seatsWords(drop.parentId)) drop = null
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
