import { useCallback, useEffect, useRef, useState, type RefObject, type PointerEvent as ReactPointerEvent } from 'react'
import { useUIStore } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'
import { useTimeStore } from '../store/TimeStore'
import { lockCursor, unlockCursor } from '../utils/dragCursor'
import type { Note } from '../types'

// Track rows are h-12 (48px); used to convert vertical drag into a row delta.
const ROW_HEIGHT = 48

interface BlockOrigin {
  trackId: string
  trackIndex: number
  startBar: number
  durationBars: number
  notes: Note[]
}

const EDGE_PX = 8

// moving/resizing carry block origins; marquee carries the pre-drag selection
// to union against, and works in client coordinates (robust to scroll).
type DragState =
  | {
      type: 'moving' | 'resizing-left' | 'resizing-right'
      startX: number
      startY: number
      barWidthPx: number
      totalBars: number
      origins: Map<string, BlockOrigin>
    }
  | {
      type: 'marquee'
      startClientX: number
      startClientY: number
      base: Set<string>
    }
  | {
      type: 'drawing'
      trackId: string
      blockId: string
      startBar: number
      pixelsPerBeat: number
      beatsPerBar: number
    }

interface MarqueeRect {
  left: number
  top: number
  width: number
  height: number
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
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null)

  // Snap a bar position to the nearest beat (blocks snap to beats, not whole bars).
  const snapBar = (bar: number) => {
    const bpb = useTimeStore.getState().beatsPerBar
    return Math.round(bar * bpb) / bpb
  }

  const beginGestureTracking = useCallback(() => {
    const controller = new AbortController()
    abortRef.current = controller
    const t = dragRef.current?.type
    lockCursor(t === 'moving' ? 'grabbing' : t === 'resizing-left' || t === 'resizing-right' || t === 'drawing' ? 'ew-resize' : 'default')

    const handleMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return

      if (d.type === 'marquee') {
        const minX = Math.min(d.startClientX, e.clientX)
        const maxX = Math.max(d.startClientX, e.clientX)
        const minY = Math.min(d.startClientY, e.clientY)
        const maxY = Math.max(d.startClientY, e.clientY)
        // Hit-test block elements by their client rects (scroll-independent).
        const ids = new Set(d.base)
        document.querySelectorAll<HTMLElement>('[data-block-id]').forEach((el) => {
          const r = el.getBoundingClientRect()
          if (r.right >= minX && r.left <= maxX && r.bottom >= minY && r.top <= maxY) {
            if (el.dataset.blockId) ids.add(el.dataset.blockId)
          }
        })
        setSelectedBlockIds(ids)
        const laneR = laneRef.current?.getBoundingClientRect()
        if (laneR) {
          setMarqueeRect({ left: minX - laneR.left, top: minY - laneR.top, width: maxX - minX, height: maxY - minY })
        }
        return
      }

      if (d.type === 'drawing') {
        const laneR = laneRef.current?.getBoundingClientRect()
        if (!laneR) return
        const beat = (e.clientX - laneR.left) / d.pixelsPerBeat
        const oneBeat = 1 / d.beatsPerBar
        const endBar = snapBar(beat / d.beatsPerBar)
        const durationBars = Math.max(oneBeat, endBar - d.startBar)
        useProjectStore.getState().updateBlock(d.trackId, d.blockId, { durationBars })
        return
      }

      const deltaX = e.clientX - d.startX
      const deltaBars = d.barWidthPx > 0 ? deltaX / d.barWidthPx : 0
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
        const oneBeat = 1 / useTimeStore.getState().beatsPerBar
        for (const [blockId, o] of d.origins) {
          const maxDuration = d.totalBars - o.startBar
          const newDuration = Math.max(oneBeat, Math.min(maxDuration, snapBar(o.durationBars + deltaBars)))
          store.updateBlock(o.trackId, blockId, { durationBars: newDuration })
        }
      } else if (d.type === 'resizing-left') {
        const beatsPerBar = useTimeStore.getState().beatsPerBar
        const oneBeat = 1 / beatsPerBar
        for (const [blockId, o] of d.origins) {
          // Drag the start, keep the end planted; clamp to >= 0 and >= 1 beat long.
          const end = o.startBar + o.durationBars
          const newStartBar = Math.max(0, Math.min(end - oneBeat, snapBar(o.startBar + deltaBars)))
          // Counter-shift notes (block-relative) so they stay put in absolute time,
          // written atomically with the start so they don't move on resize.
          const offsetBeats = (o.startBar - newStartBar) * beatsPerBar
          const notes = o.notes.map((n) => ({ ...n, startBeat: n.startBeat + offsetBeats }))
          store.updateBlock(o.trackId, blockId, { startBar: newStartBar, durationBars: end - newStartBar, notes })
        }
      }
    }

    const handleUp = () => {
      dragRef.current = null
      setMarqueeRect(null)
      unlockCursor()
      controller.abort()
      abortRef.current = null
    }

    window.addEventListener('pointermove', handleMove, { signal: controller.signal })
    window.addEventListener('pointerup', handleUp, { signal: controller.signal })
  }, [setSelectedBlockIds, laneRef])

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
          origins.set(b.id, { trackId: tId, trackIndex: idx, startBar: b.startBar, durationBars: b.durationBars, notes: b.notes })
        }
      }
    })
    return origins
  }

  const handleBlockPointerDown = useCallback((e: ReactPointerEvent, _trackId: string, blockId: string) => {
    // Let right-click fall through to the lane (block drawing) instead of moving.
    if (e.button !== 0) return
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
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const localX = e.clientX - rect.left
    const w = rect.width
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
      barWidthPx: useTimeStore.getState().beatsPerBar * useUIStore.getState().tracksPixelsPerBeat,
      totalBars: useTimeStore.getState().totalBars,
      origins: captureOrigins(dragSet),
    }
    beginGestureTracking()
  }, [selectedBlockIds, setSelectedBlockIds, laneRef, beginGestureTracking])

  // Pointer down on a lane: right-click draws a new block on that track; left-click
  // begins a marquee (shift keeps the current selection as the base).
  const handleLanePointerDown = useCallback((e: ReactPointerEvent, trackId?: string) => {
    // Right-click on a track lane = draw a new block (snapped to beats).
    if (e.button === 2 && trackId) {
      const laneR = laneRef.current?.getBoundingClientRect()
      if (!laneR) return
      const pixelsPerBeat = useUIStore.getState().tracksPixelsPerBeat
      const beatsPerBar = useTimeStore.getState().beatsPerBar
      const oneBeat = 1 / beatsPerBar
      const startBeat = Math.max(0, Math.floor((e.clientX - laneR.left) / pixelsPerBeat))
      const startBar = startBeat / beatsPerBar
      const blockId = crypto.randomUUID()
      useProjectStore.getState().addBlock(trackId, { id: blockId, startBar, durationBars: oneBeat, loop: false, notes: [] })
      setSelectedBlockIds(new Set([blockId]))
      dragRef.current = { type: 'drawing', trackId, blockId, startBar, pixelsPerBeat, beatsPerBar }
      beginGestureTracking()
      return
    }

    if (e.button !== 0) return
    const base = e.shiftKey ? new Set(selectedBlockIds) : new Set<string>()
    if (!e.shiftKey) setSelectedBlockIds(new Set())
    dragRef.current = {
      type: 'marquee',
      startClientX: e.clientX,
      startClientY: e.clientY,
      base,
    }
    beginGestureTracking()
  }, [selectedBlockIds, setSelectedBlockIds, beginGestureTracking, laneRef])

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

  return { selectedBlockIds, marqueeRect, handleBlockPointerDown, handleLanePointerDown }
}
