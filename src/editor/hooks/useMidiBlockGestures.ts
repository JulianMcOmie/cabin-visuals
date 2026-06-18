import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useProjectStore } from '../store/ProjectStore'
import type { Block } from '../types'

interface UseMidiBlockGesturesOptions {
  trackId: string
  block: Block
  pixelsPerBeat: number
  beatsPerBar: number
  /** Total beats the editor timeline spans (for clamping the block to the canvas). */
  maxBeats: number
}

const EDGE_PX = 8

interface DragState {
  mode: 'moving' | 'resizing-left' | 'resizing-right'
  startClientX: number
  originStartBar: number
  originDurationBars: number
}

/**
 * Drag the MIDI block's ruler "clip header" to move it, or its left/right edges to
 * resize — the single-block, horizontal-only analogue of useTrackGestures. Writes
 * continuously to ProjectStore (the block prop flows back from the store, so the
 * header, grid outline, and notes follow the drag live). Snaps to whole bars.
 */
export function useMidiBlockGestures({ trackId, block, pixelsPerBeat, beatsPerBar, maxBeats }: UseMidiBlockGesturesOptions) {
  const dragRef = useRef<DragState | null>(null)

  // Mirrored for the window listener so it never reads a stale closure.
  const latest = useRef({ trackId, blockId: block.id, pixelsPerBeat, beatsPerBar, maxBeats })
  latest.current = { trackId, blockId: block.id, pixelsPerBeat, beatsPerBar, maxBeats }

  // Hover cursor: resize near the edges, grab in the middle (skipped mid-drag so
  // the forced body-class cursor wins).
  const handleHeaderPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const edge = Math.min(EDGE_PX, rect.width / 4)
    e.currentTarget.style.cursor = x < edge || x > rect.width - edge ? 'ew-resize' : 'grab'
  }, [])

  // Begin a drag in an explicit mode. Shared by the ruler header (which picks the
  // mode from where you grabbed it) and the grid edge handles (fixed left/right).
  const beginDrag = useCallback((clientX: number, mode: DragState['mode']) => {
    dragRef.current = {
      mode,
      startClientX: clientX,
      originStartBar: block.startBar,
      originDurationBars: block.durationBars,
    }

    document.body.classList.add(mode === 'moving' ? 'block-moving' : 'block-resizing')
    document.body.style.userSelect = 'none'

    const controller = new AbortController()
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const l = latest.current
      const maxBar = l.maxBeats / l.beatsPerBar
      const deltaBars = Math.round((ev.clientX - d.startClientX) / l.pixelsPerBeat / l.beatsPerBar)
      const update = useProjectStore.getState().updateBlock

      if (d.mode === 'moving') {
        const startBar = Math.max(0, Math.min(maxBar - d.originDurationBars, d.originStartBar + deltaBars))
        update(l.trackId, l.blockId, { startBar })
      } else if (d.mode === 'resizing-right') {
        const durationBars = Math.max(1, Math.min(maxBar - d.originStartBar, d.originDurationBars + deltaBars))
        update(l.trackId, l.blockId, { durationBars })
      } else {
        const end = d.originStartBar + d.originDurationBars
        const startBar = Math.max(0, Math.min(end - 1, d.originStartBar + deltaBars))
        update(l.trackId, l.blockId, { startBar, durationBars: end - startBar })
      }
    }
    const onUp = () => {
      dragRef.current = null
      document.body.classList.remove('block-moving', 'block-resizing')
      document.body.style.userSelect = ''
      controller.abort()
    }
    window.addEventListener('pointermove', onMove, { signal: controller.signal })
    window.addEventListener('pointerup', onUp, { signal: controller.signal })
  }, [block.startBar, block.durationBars])

  // Ruler header: edges resize, body moves (mode chosen from the grab position).
  const handleHeaderPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const edge = Math.min(EDGE_PX, rect.width / 4)
    const mode: DragState['mode'] = x < edge ? 'resizing-left' : x > rect.width - edge ? 'resizing-right' : 'moving'
    beginDrag(e.clientX, mode)
  }, [beginDrag])

  // Grid edge handles: fixed-side resize.
  const handleResizePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>, side: 'left' | 'right') => {
    e.stopPropagation()
    beginDrag(e.clientX, side === 'left' ? 'resizing-left' : 'resizing-right')
  }, [beginDrag])

  return { handleHeaderPointerDown, handleHeaderPointerMove, handleResizePointerDown }
}
