import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useProjectStore } from '../store/ProjectStore'
import { useUIStore } from '../store/UIStore'
import { firstMoverMidiInput, getMover } from '../core/visual/movers/registry'
import { hasMoverOrSplitterDefinition } from '../core/visualCopies/registry'
import { flattenVisualRows } from './timeline/trackTree'
import { selectNewTrack } from '../utils/selection'
import { computeDropTarget } from './timeline/trackDrop'
import { lockCursor, unlockCursor } from '../utils/dragCursor'
import { OBJECT_TRACK_COLOR, MOVER_TRACK_COLOR } from '../utils/modifierColors'
import { PLAYHEAD_TRIANGLE_HALF } from '../constants'
import type { Track, TrackType } from '../types'

type LibraryItem = { id: string; name: string; kind: 'object' | 'modulator' | 'modifier' | 'mover' | 'splitter' }

function makeTrack(item: LibraryItem, parentId: string | null): Track {
  // A modifier is a no-instrument child track whose type IS the modifier (its id);
  // objects/modulators carry an instrumentId and the default 'base' type.
  const isModifier = item.kind === 'modifier'
  const isMover = item.kind === 'mover'
  const isSplitter = item.kind === 'splitter'
  // A new-registry (VisualCopy) mover shares the 'mover' track type but none of
  // the legacy runtime fields - its definition owns its own MIDI grammar.
  // Splitters exist only in the new registry.
  const isLegacyMover = isMover && !hasMoverOrSplitterDefinition(item.id)
  const def = isLegacyMover ? getMover(item.id) : undefined
  return {
    id: crypto.randomUUID(),
    name: item.name,
    type: isModifier ? (item.id as TrackType) : isSplitter ? 'splitter' : isMover ? 'mover' : 'base',
    instrumentId: isModifier || isMover || isSplitter ? '' : item.id,
    moverId: isMover ? item.id : undefined,
    splitterId: isSplitter ? item.id : undefined,
    depth: isLegacyMover ? 1 : undefined,
    inputValues: isMover || isSplitter ? {} : undefined,
    envelope: isLegacyMover ? { attack: 0.05, decay: 0.4 } : undefined,
    midiMode: isLegacyMover ? 'none' : undefined,
    midiTargetInput: def ? firstMoverMidiInput(def) : undefined,
    weight: isLegacyMover ? { mode: 'all' } : undefined,
    opMode: isLegacyMover ? 'transform' : undefined,
    color: item.kind === 'object' ? OBJECT_TRACK_COLOR : MOVER_TRACK_COLOR,
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
    parentId: parentId ?? undefined,
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
