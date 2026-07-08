import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useProjectStore } from '../../store/ProjectStore'
import { lockCursor, unlockCursor } from '../../utils/dragCursor'
import type { Block, Note } from '../../types'

interface UseMidiBlockGesturesOptions {
  trackId: string
  block: Block
  notes: Note[]
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
  originNotes: Note[]
}

/**
 * Drag the MIDI block's ruler "clip header" to move it, or its left/right edges to
 * resize - the single-block, horizontal-only analogue of useTrackGestures. Writes
 * continuously to ProjectStore (the block prop flows back from the store, so the
 * header and grid outline follow the drag live). Snaps to whole bars.
 *
 * Notes are stored relative to the block start, so resizing the *left* edge would
 * otherwise drag the notes along with it. To keep notes anchored in absolute time,
 * a left-resize offsets every note's startBeat by the opposite of the start shift.
 * Moving the block intentionally carries its notes; right-resize leaves them be.
 */
export function useMidiBlockGestures({ trackId, block, notes, pixelsPerBeat, beatsPerBar, maxBeats }: UseMidiBlockGesturesOptions) {
  const dragRef = useRef<DragState | null>(null)

  // Mirrored for the window listener so it never reads a stale closure.
  const latest = useRef({ trackId, blockId: block.id, notes, pixelsPerBeat, beatsPerBar, maxBeats })
  latest.current = { trackId, blockId: block.id, notes, pixelsPerBeat, beatsPerBar, maxBeats }

  // Hover cursor: resize near the edges, grab in the middle (skipped mid-drag so
  // the locked cursor wins).
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
      originNotes: latest.current.notes,
    }

    lockCursor(mode === 'moving' ? 'grabbing' : 'ew-resize')

    const controller = new AbortController()
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const l = latest.current
      const maxBar = l.maxBeats / l.beatsPerBar
      const oneBeat = 1 / l.beatsPerBar
      // Snap to beats, not whole bars.
      const deltaBars = Math.round((ev.clientX - d.startClientX) / l.pixelsPerBeat) / l.beatsPerBar
      const update = useProjectStore.getState().updateBlock

      if (d.mode === 'moving') {
        const startBar = Math.max(0, Math.min(maxBar - d.originDurationBars, d.originStartBar + deltaBars))
        update(l.trackId, l.blockId, { startBar })
      } else if (d.mode === 'resizing-right') {
        const durationBars = Math.max(oneBeat, Math.min(maxBar - d.originStartBar, d.originDurationBars + deltaBars))
        update(l.trackId, l.blockId, { durationBars })
      } else {
        const end = d.originStartBar + d.originDurationBars
        const startBar = Math.max(0, Math.min(end - oneBeat, d.originStartBar + deltaBars))
        // Counter-shift notes so they stay put in absolute time as the start moves,
        // written in the SAME updateBlock call so block + notes change atomically
        // (one store write → one render; no flicker, no re-sync clobber).
        const offsetBeats = (d.originStartBar - startBar) * l.beatsPerBar
        const notes = d.originNotes.map((n) => ({ ...n, startBeat: n.startBeat + offsetBeats }))
        update(l.trackId, l.blockId, { startBar, durationBars: end - startBar, notes })
      }
    }
    const onUp = () => {
      dragRef.current = null
      unlockCursor()
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
