import { useCallback, useEffect, useRef, type RefObject, type PointerEvent as ReactPointerEvent } from 'react'
import { useUIStore } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'
import { useTimeStore } from '../store/TimeStore'

// Track rows are h-12 (48px); used to convert vertical drag into a row delta.
const ROW_HEIGHT = 48

interface BlockOrigin {
  trackId: string
  trackIndex: number
  startBar: number
  durationBars: number
}

const EDGE_PX = 8

interface DragState {
  type: 'moving' | 'resizing-left' | 'resizing-right'
  startX: number
  startY: number
  laneWidthPx: number
  totalBars: number
  origins: Map<string, BlockOrigin>
}

interface UseTrackGesturesOptions {
  /** The lane region element (excludes the label column) used to measure width. */
  laneRef: RefObject<HTMLDivElement | null>
}

/**
 * Gesture state machine for the tracks timeline. Mirrors useNoteGestures in
 * shape, but writes ProjectStore directly and continuously during a drag (no
 * local copy / debounce). Reads current positions from the store each frame,
 * so it never needs a stale-closure latest ref for data.
 */
export function useTrackGestures({ laneRef }: UseTrackGesturesOptions) {
  const selectedBlockIds = useUIStore((s) => s.selectedBlockIds)
  const setSelectedBlockIds = useUIStore((s) => s.setSelectedBlockIds)

  const dragRef = useRef<DragState | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Snap a bar position to whole bars (the timeline's grid).
  const snapBar = (bar: number) => Math.round(bar)

  const beginGestureTracking = useCallback(() => {
    const controller = new AbortController()
    abortRef.current = controller
    document.body.style.userSelect = 'none'

    const handleMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const deltaX = e.clientX - d.startX
      const deltaBars = d.laneWidthPx > 0 ? (deltaX / d.laneWidthPx) * d.totalBars : 0
      const rowDelta = Math.round((e.clientY - d.startY) / ROW_HEIGHT)
      const store = useProjectStore.getState()

      if (d.type === 'moving') {
        for (const [blockId, o] of d.origins) {
          const maxStart = Math.max(0, d.totalBars - o.durationBars)
          const newStartBar = Math.max(0, Math.min(maxStart, snapBar(o.startBar + deltaBars)))

          // Vertical: move to the track at origin index + rowDelta (clamped).
          const targetIndex = Math.max(0, Math.min(store.rootTrackIds.length - 1, o.trackIndex + rowDelta))
          const targetTrackId = store.rootTrackIds[targetIndex]

          // The block may have already moved tracks on a previous frame; find it.
          let currentTrackId = o.trackId
          for (const tId of store.rootTrackIds) {
            if (store.tracks[tId]?.blocks.some((b) => b.id === blockId)) {
              currentTrackId = tId
              break
            }
          }
          if (currentTrackId !== targetTrackId) {
            store.moveBlock(currentTrackId, blockId, targetTrackId)
          }
          store.updateBlock(targetTrackId, blockId, { startBar: newStartBar })
        }
      } else if (d.type === 'resizing-right') {
        for (const [blockId, o] of d.origins) {
          const maxDuration = d.totalBars - o.startBar
          const newDuration = Math.max(1, Math.min(maxDuration, snapBar(o.durationBars + deltaBars)))
          store.updateBlock(o.trackId, blockId, { durationBars: newDuration })
        }
      } else if (d.type === 'resizing-left') {
        for (const [blockId, o] of d.origins) {
          // Drag the start, keep the end planted; clamp to >= 0 and >= 1 bar long.
          const end = o.startBar + o.durationBars
          const newStartBar = Math.max(0, Math.min(end - 1, snapBar(o.startBar + deltaBars)))
          store.updateBlock(o.trackId, blockId, { startBar: newStartBar, durationBars: end - newStartBar })
        }
      }
    }

    const handleUp = () => {
      dragRef.current = null
      document.body.style.userSelect = ''
      controller.abort()
      abortRef.current = null
    }

    window.addEventListener('pointermove', handleMove, { signal: controller.signal })
    window.addEventListener('pointerup', handleUp, { signal: controller.signal })
  }, [])

  // Tear down a drag still in flight if the component unmounts.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      document.body.style.userSelect = ''
    }
  }, [])

  // Capture the drag-start positions of every block in `dragSet`.
  const captureOrigins = (dragSet: Set<string>) => {
    const { tracks, rootTrackIds } = useProjectStore.getState()
    const origins = new Map<string, BlockOrigin>()
    rootTrackIds.forEach((tId, idx) => {
      const t = tracks[tId]
      if (!t) return
      for (const b of t.blocks) {
        if (dragSet.has(b.id)) {
          origins.set(b.id, { trackId: tId, trackIndex: idx, startBar: b.startBar, durationBars: b.durationBars })
        }
      }
    })
    return origins
  }

  const handleBlockPointerDown = useCallback((e: ReactPointerEvent, _trackId: string, blockId: string) => {
    e.stopPropagation()

    // Shift toggles selection without starting a drag.
    if (e.shiftKey) {
      const next = new Set(selectedBlockIds)
      if (next.has(blockId)) next.delete(blockId)
      else next.add(blockId)
      setSelectedBlockIds(next)
      return
    }

    // Near an edge → resize that edge; otherwise move. Edge zones shrink on
    // narrow blocks so the middle stays a move target.
    const el = e.currentTarget as HTMLDivElement
    const localX = e.nativeEvent.offsetX
    const w = el.offsetWidth
    const edge = Math.min(EDGE_PX, w / 4)
    const type: DragState['type'] =
      localX < edge ? 'resizing-left' : localX > w - edge ? 'resizing-right' : 'moving'

    // Select this block (keep an existing multi-selection it belongs to), then
    // arm the drag for the whole selection.
    let dragSet = selectedBlockIds
    if (!selectedBlockIds.has(blockId)) {
      dragSet = new Set([blockId])
      setSelectedBlockIds(dragSet)
    }

    dragRef.current = {
      type,
      startX: e.clientX,
      startY: e.clientY,
      laneWidthPx: laneRef.current?.getBoundingClientRect().width ?? 0,
      totalBars: useTimeStore.getState().totalBars,
      origins: captureOrigins(dragSet),
    }
    beginGestureTracking()
  }, [selectedBlockIds, setSelectedBlockIds, laneRef, beginGestureTracking])

  // Pointer down on empty lane clears the selection (marquee added later).
  const handleLanePointerDown = useCallback((e: ReactPointerEvent) => {
    if (!e.shiftKey) setSelectedBlockIds(new Set())
  }, [setSelectedBlockIds])

  // Delete removes selected blocks; Escape clears the selection.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (selectedBlockIds.size === 0) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        const { tracks, deleteBlock } = useProjectStore.getState()
        for (const [trackId, track] of Object.entries(tracks)) {
          for (const block of track.blocks) {
            if (selectedBlockIds.has(block.id)) deleteBlock(trackId, block.id)
          }
        }
        setSelectedBlockIds(new Set())
      } else if (e.key === 'Escape') {
        setSelectedBlockIds(new Set())
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selectedBlockIds, setSelectedBlockIds])

  return { selectedBlockIds, handleBlockPointerDown, handleLanePointerDown }
}
