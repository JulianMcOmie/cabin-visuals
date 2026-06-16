import { RefObject, useCallback, useEffect, useRef, useState } from 'react'
import type { Block, Note } from '../types'
import type { MidiRow } from '../components/midi/types'
import { clientToGrid, xToBeat, yToRowIndex, beatToX, rowIndexToY } from '../components/midi/coords'

const NOTE_EDGE_WIDTH = 8

// All DragState coordinates are grid-local pixels (converted from viewport
// coordinates at pointerdown via clientToGrid), regardless of drag type.
export interface DragState {
  type: 'none' | 'drawing' | 'moving' | 'resizing' | 'resizing-left' | 'marquee'
  startX: number
  startY: number
  currentX: number
  currentY: number
  noteId?: string
  originalStartBeats?: Map<string, number>
  originalPitches?: Map<string, number>
  originalDurations?: Map<string, number>
}

const DRAG_NONE: DragState = { type: 'none', startX: 0, startY: 0, currentX: 0, currentY: 0 }

interface UseNoteGesturesOptions {
  containerRef: RefObject<HTMLDivElement | null>
  gridRef: RefObject<HTMLDivElement | null>
  block: Block
  notes: Note[]
  onNotesChange: (notes: Note[]) => void
  rows: MidiRow[]
  rowHeight: number
  pixelsPerBeat: number
  beatsPerBar: number
  totalBeats: number
  quantize: number
  snapEnabled: boolean
}

/**
 * The midi editor's gesture state machine. dragState.type is the current mode;
 * pointerdown classifiers set it, then beginGestureTracking installs window
 * listeners that interpret movement per mode and commit on pointerup. All
 * values the long-lived listeners need are read through a single latest ref
 * so their closures never go stale.
 */
export function useNoteGestures({
  containerRef,
  gridRef,
  block,
  notes,
  onNotesChange,
  rows,
  rowHeight,
  pixelsPerBeat,
  beatsPerBar,
  totalBeats,
  quantize,
  snapEnabled,
}: UseNoteGesturesOptions) {
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set())
  const [drawingNote, setDrawingNote] = useState<Note | null>(null)
  const [dragState, setDragState] = useState<DragState>(DRAG_NONE)
  const dragStateRef = useRef(dragState)
  dragStateRef.current = dragState
  const drawingNoteRef = useRef(drawingNote)
  drawingNoteRef.current = drawingNote
  const didDragRef = useRef(false)
  // Selection that existed when a marquee began (shift-add base); the live
  // marquee selection is this set unioned with the notes currently boxed.
  const marqueeBaseRef = useRef<Set<string>>(new Set())

  // Direct DOM cursor updates (no re-renders)
  const setCursor = useCallback((cursor: string) => {
    if (containerRef.current) containerRef.current.style.cursor = cursor
  }, [containerRef])

  // Snap resolution: use quantize grid when enabled, fine resolution when off
  const snapSize = snapEnabled ? quantize : 1 / 128
  const snapValue = useCallback((v: number) => Math.round((v - snapSize / 2) / snapSize) * snapSize, [snapSize])

  const pitchToRowIndex = useCallback((pitch: number) => {
    return rows.findIndex(r => r.pitch === pitch)
  }, [rows])

  // Hover handler for dynamic cursor
  const handleHoverChange = useCallback((target: 'noteBody' | 'noteEdge' | null) => {
    if (dragStateRef.current.type !== 'none') return
    if (target === 'noteEdge') setCursor('ew-resize')
    else if (target === 'noteBody') setCursor('grab')
    else setCursor('default')
  }, [setCursor])

  // Get notes within marquee bounds (grid-local pixel rect)
  const getNotesInMarquee = useCallback((x1: number, y1: number, x2: number, y2: number): string[] => {
    const minX = Math.min(x1, x2)
    const maxX = Math.max(x1, x2)
    const minY = Math.min(y1, y2)
    const maxY = Math.max(y1, y2)

    const matchingIds: string[] = []

    for (const note of notes) {
      const rowIndex = pitchToRowIndex(note.pitch)
      if (rowIndex === -1) continue

      const blockStart = beatToX(block.startBar * beatsPerBar, pixelsPerBeat)


      const noteTop = rowIndexToY(rowIndex, rowHeight)
      const noteBottom = noteTop + rowHeight
      const noteLeft = blockStart + beatToX(note.startBeat, pixelsPerBeat)
      const noteRight = noteLeft + beatToX(note.durationBeats, pixelsPerBeat)

      if (maxX >= noteLeft && minX <= noteRight && maxY >= noteTop && minY <= noteBottom) {
        matchingIds.push(note.id)
      }
    }

    return matchingIds
  }, [notes, pitchToRowIndex, rowHeight, pixelsPerBeat])

  // Single ref holding the latest render's values, refreshed every render.
  // The window drag listeners live across many renders, so they read
  // everything through latest.current instead of their (stale) closures.
  const latestValues = { notes, onNotesChange, snapValue, snapSize, snapEnabled, pixelsPerBeat, totalBeats, rowHeight, rows, quantize, getNotesInMarquee }
  const latest = useRef(latestValues)
  latest.current = latestValues

  // Install the tracking + completion machinery for the gesture that just
  // started: window-level move/up listeners tied to an AbortController so
  // they can be removed in one abort() call (on pointerup or unmount).
  const gestureAbortRef = useRef<AbortController | null>(null)

  const beginGestureTracking = useCallback(() => {
    const controller = new AbortController()
    gestureAbortRef.current = controller
    document.body.style.userSelect = 'none'
    const handleMove = (e: PointerEvent) => {
      const ds = dragStateRef.current
      if (!gridRef.current) return
      const grid = clientToGrid(e.clientX, e.clientY, gridRef.current.getBoundingClientRect())
      if (ds.type === 'drawing') {
        const dn = drawingNoteRef.current
        if (!dn) return
        const deltaX = grid.x - ds.startX
        const deltaDuration = xToBeat(deltaX, latest.current.pixelsPerBeat)
        const baseDuration = latest.current.snapEnabled ? latest.current.quantize : 0.25
        let newDuration = latest.current.snapValue(baseDuration + deltaDuration)
        newDuration = Math.max(latest.current.snapSize, Math.min(latest.current.totalBeats - dn.startBeat, newDuration))

        if (newDuration !== dn.durationBeats) {
          setDrawingNote(prev => prev ? { ...prev, durationBeats: newDuration } : null)
        }
      } else if (ds.type === 'moving' && ds.originalStartBeats && ds.originalPitches) {
        const deltaX = grid.x - ds.startX
        const deltaBeats = xToBeat(deltaX, latest.current.pixelsPerBeat)
        const snappedDelta = latest.current.snapValue(deltaBeats)

        const deltaY = grid.y - ds.startY
        const rowDelta = Math.round(deltaY / latest.current.rowHeight)
        const curRows = latest.current.rows
        const curTotalBeats = latest.current.totalBeats

        latest.current.onNotesChange(latest.current.notes.map(n => {
          const originalStartBeat = ds.originalStartBeats!.get(n.id)
          const originalPitch = ds.originalPitches!.get(n.id)
          if (originalStartBeat !== undefined && originalPitch !== undefined) {
            const origRowIndex = curRows.findIndex(r => r.pitch === originalPitch)
            const newRowIndex = Math.max(0, Math.min(curRows.length - 1, origRowIndex + rowDelta))
            const newPitch = curRows[newRowIndex].pitch
            const newStartBeat = Math.max(0, Math.min(curTotalBeats - n.durationBeats, originalStartBeat + snappedDelta))
            return { ...n, startBeat: newStartBeat, pitch: newPitch }
          }
          return n
        }))
      } else if (ds.type === 'resizing' && ds.originalDurations) {
        const deltaX = grid.x - ds.startX
        const deltaBeats = xToBeat(deltaX, latest.current.pixelsPerBeat)
        const snappedDelta = latest.current.snapValue(deltaBeats)

        latest.current.onNotesChange(latest.current.notes.map(n => {
          const originalDuration = ds.originalDurations!.get(n.id)
          if (originalDuration !== undefined) {
            const newDuration = Math.max(latest.current.snapSize, originalDuration + snappedDelta)
            return { ...n, durationBeats: newDuration }
          }
          return n
        }))
      } else if (ds.type === 'resizing-left' && ds.originalStartBeats && ds.originalDurations) {
        const deltaX = grid.x - ds.startX
        const deltaBeats = xToBeat(deltaX, latest.current.pixelsPerBeat)
        const snappedDelta = latest.current.snapValue(deltaBeats)

        // Drag the start; keep the end planted. Clamp so start stays >= 0 and
        // the note never shrinks below one snap step.
        latest.current.onNotesChange(latest.current.notes.map(n => {
          const originalStartBeat = ds.originalStartBeats!.get(n.id)
          const originalDuration = ds.originalDurations!.get(n.id)
          if (originalStartBeat !== undefined && originalDuration !== undefined) {
            const end = originalStartBeat + originalDuration
            const newStartBeat = Math.max(0, Math.min(end - latest.current.snapSize, originalStartBeat + snappedDelta))
            return { ...n, startBeat: newStartBeat, durationBeats: end - newStartBeat }
          }
          return n
        }))
      } else if (ds.type === 'marquee') {
        setDragState(prev => ({ ...prev, currentX: grid.x, currentY: grid.y }))
        const ids = latest.current.getNotesInMarquee(ds.startX, ds.startY, grid.x, grid.y)
        setSelectedNoteIds(new Set([...marqueeBaseRef.current, ...ids]))
      }
    }

    const handleUp = () => {
      const ds = dragStateRef.current
      if (ds.type === 'drawing' && drawingNoteRef.current) {
        latest.current.onNotesChange([...latest.current.notes, drawingNoteRef.current])
        setDrawingNote(null)
      }

      setDragState(DRAG_NONE)
      setCursor('default')
      didDragRef.current = true
      document.body.style.userSelect = ''
      controller.abort()
      gestureAbortRef.current = null
    }

    window.addEventListener('pointermove', handleMove, { signal: controller.signal })
    window.addEventListener('pointerup', handleUp, { signal: controller.signal })
  }, [setCursor, gridRef])

  // If the component unmounts mid-drag, tear the window listeners down
  useEffect(() => {
    return () => {
      gestureAbortRef.current?.abort()
      document.body.style.userSelect = ''
    }
  }, [])

  // Handle note body pointer down -> start moving or resizing
  const handleNotePointerDown = useCallback((e: React.PointerEvent, note: Note) => {
    e.stopPropagation()
    if (!gridRef.current) return
    const grid = clientToGrid(e.clientX, e.clientY, gridRef.current.getBoundingClientRect())

    // Check if near an edge (resize). Edge zones are capped at NOTE_EDGE_WIDTH
    // but shrink to a quarter of the note on thin notes, so the middle half is
    // always grabbable for moving.
    const noteEl = e.currentTarget as HTMLDivElement
    const localX = e.nativeEvent.offsetX
    const noteW = noteEl.offsetWidth
    const edge = Math.min(NOTE_EDGE_WIDTH, noteW / 4)
    const nearLeft = localX < edge
    const nearRight = localX > noteW - edge

    if (nearLeft || nearRight) {
      let newSelectedIds: Set<string>
      if (!selectedNoteIds.has(note.id)) {
        newSelectedIds = new Set([note.id])
        setSelectedNoteIds(newSelectedIds)
      } else {
        newSelectedIds = selectedNoteIds
      }

      const originalStartBeats = new Map<string, number>()
      const originalDurations = new Map<string, number>()
      for (const n of notes) {
        if (newSelectedIds.has(n.id)) {
          originalStartBeats.set(n.id, n.startBeat)
          originalDurations.set(n.id, n.durationBeats)
        }
      }

      setDragState({
        type: nearLeft ? 'resizing-left' : 'resizing',
        startX: grid.x,
        startY: grid.y,
        currentX: grid.x,
        currentY: grid.y,
        noteId: note.id,
        originalStartBeats,
        originalDurations,
      })
      setCursor('ew-resize')
      beginGestureTracking()
      return
    }

    // Move mode
    let newSelectedIds: Set<string>
    if (e.shiftKey) {
      newSelectedIds = new Set(selectedNoteIds)
      if (newSelectedIds.has(note.id)) newSelectedIds.delete(note.id)
      else newSelectedIds.add(note.id)
      setSelectedNoteIds(newSelectedIds)
    } else if (!selectedNoteIds.has(note.id)) {
      newSelectedIds = new Set([note.id])
      setSelectedNoteIds(newSelectedIds)
    } else {
      newSelectedIds = selectedNoteIds
    }

    // Alt+drag = copy selected notes, then drag the copies
    if (e.altKey && newSelectedIds.size > 0) {
      const oldToNew = new Map<string, string>()
      const duplicates: Note[] = []
      for (const n of notes) {
        if (newSelectedIds.has(n.id)) {
          const newId = crypto.randomUUID()
          oldToNew.set(n.id, newId)
          duplicates.push({ ...n, id: newId })
        }
      }

      // Add duplicates to notes (originals stay, copies will be dragged)
      const updatedNotes = [...notes, ...duplicates]
      onNotesChange(updatedNotes)

      const copyIds = new Set(oldToNew.values())
      setSelectedNoteIds(copyIds)

      const originalStartBeats = new Map<string, number>()
      const originalPitches = new Map<string, number>()
      for (const dup of duplicates) {
        originalStartBeats.set(dup.id, dup.startBeat)
        originalPitches.set(dup.id, dup.pitch)
      }

      setDragState({
        type: 'moving',
        startX: grid.x,
        startY: grid.y,
        currentX: grid.x,
        currentY: grid.y,
        noteId: oldToNew.get(note.id) || note.id,
        originalStartBeats,
        originalPitches,
      })
      setCursor('copy')
      beginGestureTracking()
      return
    }

    const originalStartBeats = new Map<string, number>()
    const originalPitches = new Map<string, number>()
    for (const n of notes) {
      if (newSelectedIds.has(n.id)) {
        originalStartBeats.set(n.id, n.startBeat)
        originalPitches.set(n.id, n.pitch)
      }
    }

    setDragState({
      type: 'moving',
      startX: grid.x,
      startY: grid.y,
      currentX: grid.x,
      currentY: grid.y,
      noteId: note.id,
      originalStartBeats,
      originalPitches,
    })
    setCursor('grabbing')
    beginGestureTracking()
  }, [selectedNoteIds, notes, onNotesChange, setCursor, beginGestureTracking, gridRef])

  // Handle note hover for cursor changes. stopPropagation keeps the grid's
  // own pointermove handler from firing afterward and resetting the cursor
  // back to default.
  const handleNotePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragStateRef.current.type !== 'none') return
    e.stopPropagation()
    const noteEl = e.currentTarget as HTMLDivElement
    const localX = e.nativeEvent.offsetX
    const noteW = noteEl.offsetWidth
    const edge = Math.min(NOTE_EDGE_WIDTH, noteW / 4)
    const nearEdge = localX < edge || localX > noteW - edge
    if (nearEdge) {
      handleHoverChange('noteEdge')
    } else {
      handleHoverChange('noteBody')
    }
  }, [handleHoverChange])

  // Handle background pointer down (left-click = marquee selection, right-click = draw note)
  const handleBackgroundPointerDown = useCallback((e: React.PointerEvent) => {
    if (!gridRef.current) return
    const { x: gridX, y: gridY } = clientToGrid(e.clientX, e.clientY, gridRef.current.getBoundingClientRect())
    const blockStart = block.startBar * beatsPerBar
   
    // Right-click = draw new note
    if (e.button === 2) {
      const rowIndex = yToRowIndex(gridY, rowHeight)

      if (rowIndex >= 0 && rowIndex < rows.length) {
        const pitch = rows[rowIndex].pitch
        const rawBeat = xToBeat(gridX, pixelsPerBeat)
        const startBeat = snapValue(rawBeat)

        if (startBeat >= 0 && startBeat < totalBeats) {
          const newNote: Note = {
            id: crypto.randomUUID(),
            pitch,
            startBeat: startBeat,// - blockStart,
            durationBeats: snapEnabled ? quantize : 0.25,
            velocity: 100,
          }

          setDrawingNote(newNote)
          if (!e.shiftKey) {
            setSelectedNoteIds(new Set([newNote.id]))
          } else {
            setSelectedNoteIds(prev => new Set([...prev, newNote.id]))
          }

          setDragState({
            type: 'drawing',
            startX: gridX,
            startY: gridY,
            currentX: gridX,
            currentY: gridY,
          })
          beginGestureTracking()
        }
      }
      return
    }

    // Left-click = marquee selection. Capture the base selection (kept on
    // shift, cleared otherwise) so live updates union against it.
    const base = e.shiftKey ? new Set(selectedNoteIds) : new Set<string>()
    marqueeBaseRef.current = base
    setSelectedNoteIds(base)
    setDragState({
      type: 'marquee',
      startX: gridX,
      startY: gridY,
      currentX: gridX,
      currentY: gridY,
    })
    setCursor('default')
    beginGestureTracking()
  }, [selectedNoteIds, rowHeight, rows, pixelsPerBeat, snapValue, snapEnabled, quantize, totalBeats, setCursor, beginGestureTracking, gridRef])

  // Keyboard handler (capture phase so editor consumes Delete/Esc before the panel)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      if (selectedNoteIds.size > 0 && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        e.stopImmediatePropagation()
        onNotesChange(notes.filter(n => !selectedNoteIds.has(n.id)))
        setSelectedNoteIds(new Set())
      } else if (e.key === 'Escape' && selectedNoteIds.size > 0) {
        // Consume Esc to deselect; only when nothing selected does Esc close the panel
        e.stopImmediatePropagation()
        setSelectedNoteIds(new Set())
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [selectedNoteIds, notes, onNotesChange])

  // Click on background deselects (if not dragging)
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    // Skip deselect if a drag (marquee, move, etc.) just finished — the click is a side-effect of the drag
    if (didDragRef.current) {
      didDragRef.current = false
      return
    }
    if (e.target === gridRef.current && !e.shiftKey && dragStateRef.current.type === 'none') {
      setSelectedNoteIds(new Set())
    }
  }, [gridRef])

  return {
    selectedNoteIds,
    drawingNote,
    dragState,
    dragStateRef,
    pitchToRowIndex,
    setCursor,
    handleNotePointerDown,
    handleNotePointerMove,
    handleHoverChange,
    handleBackgroundPointerDown,
    handleContainerClick,
  }
}
