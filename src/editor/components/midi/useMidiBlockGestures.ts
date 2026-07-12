import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useProjectStore } from '../../store/ProjectStore'
import { lockCursor, unlockCursor } from '../../utils/dragCursor'
import { loopLengthBeats } from '../../core/visual/noteFlatten'
import type { Block, Note } from '../../types'

interface UseMidiBlockGesturesOptions {
  trackId: string
  block: Block
  notes: Note[]
  pixelsPerBeat: number
  beatsPerBar: number
  /** Total beats the editor timeline spans (for clamping the block to the canvas). */
  maxBeats: number
  /** Seek the playhead when the block header is clicked without being dragged. */
  onHeaderClick: (clientX: number) => void
}

const EDGE_PX = 8
const DRAG_THRESHOLD_PX = 3

interface DragState {
  mode: 'moving' | 'resizing-left' | 'resizing-right'
  startClientX: number
  startClientY: number
  didDrag: boolean
  seekOnClick: boolean
  originStartBar: number
  originDurationBars: number
  originNotes: Note[]
  originLoop: boolean
  /** Pattern length at drag start (loop length if looping, else the duration) -
   *  right-resize past it engages looping, back inside clears it. */
  patternBars: number
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
export function useMidiBlockGestures({ trackId, block, notes, pixelsPerBeat, beatsPerBar, maxBeats, onHeaderClick }: UseMidiBlockGesturesOptions) {
  const dragRef = useRef<DragState | null>(null)

  // Mirrored for the window listener so it never reads a stale closure.
  const latest = useRef({ trackId, blockId: block.id, notes, pixelsPerBeat, beatsPerBar, maxBeats, onHeaderClick })
  latest.current = { trackId, blockId: block.id, notes, pixelsPerBeat, beatsPerBar, maxBeats, onHeaderClick }

  // Hover cursor: resize near the edges, normal arrow in the middle. Moving the
  // block keeps the arrow throughout the gesture.
  const handleHeaderPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const edge = Math.min(EDGE_PX, rect.width / 4)
    const onRightEdge = x > rect.width - edge
    e.currentTarget.style.cursor = x < edge || onRightEdge ? 'ew-resize' : 'default'
  }, [])

  // Begin a drag in an explicit mode. Shared by the ruler header (which picks the
  // mode from where you grabbed it) and the grid edge handles (fixed left/right).
  const beginDrag = useCallback((clientX: number, clientY: number, mode: DragState['mode'], seekOnClick = false) => {
    dragRef.current = {
      mode,
      startClientX: clientX,
      startClientY: clientY,
      didDrag: false,
      seekOnClick,
      originStartBar: block.startBar,
      originDurationBars: block.durationBars,
      originNotes: latest.current.notes,
      originLoop: block.loop,
      patternBars: block.loop
        ? loopLengthBeats({ loopLengthBars: block.loopLengthBars, notes: latest.current.notes }, latest.current.beatsPerBar) / latest.current.beatsPerBar
        : block.durationBars,
    }

    const controller = new AbortController()
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      if (!d.didDrag) {
        d.didDrag = Math.hypot(ev.clientX - d.startClientX, ev.clientY - d.startClientY) >= DRAG_THRESHOLD_PX
        if (!d.didDrag) return
        lockCursor(d.mode === 'moving' ? 'default' : 'ew-resize')
      }
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
        if (d.originLoop) {
          // Resizing an already-looping block keeps its loop as-is, except
          // shrinking to <= the pattern length still returns it to a plain block.
          const stillLoops = durationBars > d.patternBars + 1e-9
          update(l.trackId, l.blockId, stillLoops
            ? { durationBars, loop: true, loopLengthBars: d.patternBars }
            : { durationBars, loop: false, loopLengthBars: undefined })
        } else {
          // MIDI-editor edge drags resize plain blocks without engaging looping.
          update(l.trackId, l.blockId, { durationBars })
        }
      } else {
        const end = d.originStartBar + d.originDurationBars
        const startBar = Math.max(0, Math.min(end - oneBeat, d.originStartBar + deltaBars))
        // Counter-shift notes so they stay put in absolute time as the start moves,
        // written in the SAME updateBlock call so block + notes change atomically
        // (one store write → one render; no flicker, no re-sync clobber). A looping
        // block also gets its loop length pinned, since the shifted notes would
        // change an inferred length and break the phase.
        const offsetBeats = (d.originStartBar - startBar) * l.beatsPerBar
        const notes = d.originNotes.map((n) => ({ ...n, startBeat: n.startBeat + offsetBeats }))
        const updates = { startBar, durationBars: end - startBar, notes }
        update(l.trackId, l.blockId, d.originLoop ? { ...updates, loopLengthBars: d.patternBars } : updates)
      }
    }
    const onUp = () => {
      const d = dragRef.current
      if (d && !d.didDrag && d.seekOnClick) latest.current.onHeaderClick(d.startClientX)
      dragRef.current = null
      unlockCursor()
      controller.abort()
    }
    window.addEventListener('pointermove', onMove, { signal: controller.signal })
    window.addEventListener('pointerup', onUp, { signal: controller.signal })
  }, [block.startBar, block.durationBars, block.loop, block.loopLengthBars])

  // Ruler header: edges resize, body moves (mode chosen from the grab position).
  const handleHeaderPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const edge = Math.min(EDGE_PX, rect.width / 4)
    const mode: DragState['mode'] = x < edge ? 'resizing-left' : x > rect.width - edge ? 'resizing-right' : 'moving'
    beginDrag(e.clientX, e.clientY, mode, true)
  }, [beginDrag])

  // Grid edge handles always resize their fixed side in the MIDI editor.
  const handleResizePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>, side: 'left' | 'right') => {
    e.stopPropagation()
    beginDrag(e.clientX, e.clientY, side === 'left' ? 'resizing-left' : 'resizing-right')
  }, [beginDrag])

  return { handleHeaderPointerDown, handleHeaderPointerMove, handleResizePointerDown }
}
