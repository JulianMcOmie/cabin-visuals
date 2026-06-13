'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTimeStore } from '../../store/TimeStore'
import { useUIStore } from '../../store/UIStore'
import { lighten } from '../../utils/colors'
import type { Note } from '../../types'

export interface MidiRow {
  pitch: number
  label: string
  color: string
}

export interface RangeLabel {
  startPitch: number
  endPitch: number
  label: string
}

export interface MidiEditorProps {
  rows: MidiRow[]
  notes: Note[]
  onNotesChange: (notes: Note[]) => void
  totalBeats: number
  beatsPerBar: number
  quantize: number
  snapEnabled?: boolean
  pixelsPerBeat?: number
  rowHeight?: number
  rangeLabels?: RangeLabel[]
  /** Beat offset of this block in the project timeline (for playhead positioning) */
  blockStartBeat?: number
}

// All DragState coordinates are grid-local pixels (converted from viewport
// coordinates at pointerdown via clientToGrid), regardless of drag type.
interface DragState {
  type: 'none' | 'drawing' | 'moving' | 'resizing' | 'marquee'
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
const NOTE_EDGE_WIDTH = 8
const LABEL_WIDTH = 88
const RULER_HEIGHT = 24
const CANVAS_RIGHT_PADDING = 20

// Coordinate conversions between the three spaces the editor deals with:
// viewport pixels (clientX/Y) -> grid-local pixels -> musical units (beats, rows)
function clientToGrid(clientX: number, clientY: number, gridRect: DOMRect) {
  return { x: clientX - gridRect.left, y: clientY - gridRect.top }
}

function xToBeat(x: number, pixelsPerBeat: number) {
  return x / pixelsPerBeat
}

function yToRowIndex(y: number, rowHeight: number) {
  return Math.floor(y / rowHeight)
}

function beatToX(beat: number, pixelsPerBeat: number) {
  return beat * pixelsPerBeat
}

function rowIndexToY(rowIndex: number, rowHeight: number) {
  return rowIndex * rowHeight
}

export function MidiEditor({
  rows,
  notes,
  onNotesChange,
  totalBeats,
  beatsPerBar,
  quantize,
  snapEnabled = true,
  pixelsPerBeat = 40,
  rowHeight = 28,
  rangeLabels,
  blockStartBeat = 0,
}: MidiEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const rulerPlayheadRef = useRef<HTMLDivElement>(null)

  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set())
  const [drawingNote, setDrawingNote] = useState<Note | null>(null)
  const [dragState, setDragState] = useState<DragState>(DRAG_NONE)
  const dragStateRef = useRef(dragState)
  dragStateRef.current = dragState
  const drawingNoteRef = useRef(drawingNote)
  drawingNoteRef.current = drawingNote
  const didDragRef = useRef(false)

  // Direct DOM cursor updates (no re-renders)
  const setCursor = useCallback((cursor: string) => {
    if (containerRef.current) containerRef.current.style.cursor = cursor
  }, [])

  // Alt+scroll zoom (horizontal = pixelsPerBeat, vertical = rowScale)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      if (!e.altKey) return
      e.preventDefault()
      e.stopPropagation()

      if (Math.abs(e.deltaX) > 2) {
        const delta = -e.deltaX * 0.5
        const current = useUIStore.getState().midiPixelsPerBeat
        useUIStore.getState().setMidiPixelsPerBeat(current + delta)
      }

      if (Math.abs(e.deltaY) > 2) {
        const delta = -e.deltaY * 0.005
        const current = useUIStore.getState().midiRowScale
        useUIStore.getState().setMidiRowScale(current + delta)
      }
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [])

  // Snap resolution: use quantize grid when enabled, fine resolution when off
  const snapSize = snapEnabled ? quantize : 1 / 128
  const snapValue = useCallback((v: number) => Math.round(v / snapSize) * snapSize, [snapSize])

  // Canvas dimensions
  const canvasWidth = totalBeats * pixelsPerBeat + LABEL_WIDTH + CANVAS_RIGHT_PADDING
  const canvasHeight = rows.length * rowHeight

  // Grid line CSS background
  const barWidthPx = beatsPerBar * pixelsPerBeat
  const beatWidthPx = pixelsPerBeat
  const subdivWidthPx = quantize * pixelsPerBeat

  const gridBackground = useMemo(() => {
    const images: string[] = []
    const sizes: string[] = []

    images.push(`repeating-linear-gradient(to right, rgba(255,255,255,0.12) 0px 1px, transparent 1px ${barWidthPx}px)`)
    sizes.push(`${barWidthPx}px 100%`)

    // Skip beat lines when they coincide with bar lines (1 beat per bar),
    // otherwise the overlapping layers double the line opacity
    if (beatWidthPx !== barWidthPx) {
      images.push(`repeating-linear-gradient(to right, rgba(255,255,255,0.06) 0px 1px, transparent 1px ${beatWidthPx}px)`)
      sizes.push(`${beatWidthPx}px 100%`)
    }

    // Same for subdivision lines when quantize is a full beat
    if (subdivWidthPx !== beatWidthPx) {
      images.push(`repeating-linear-gradient(to right, rgba(255,255,255,0.025) 0px 1px, transparent 1px ${subdivWidthPx}px)`)
      sizes.push(`${subdivWidthPx}px 100%`)
    }

    return {
      backgroundImage: images.join(', '),
      backgroundSize: sizes.join(', '),
    }
  }, [barWidthPx, beatWidthPx, subdivWidthPx])

  // Compute range label positions (top/height in pixels) from rangeLabels + rows
  const rangeLabelPositions = useMemo(() => {
    if (!rangeLabels || rangeLabels.length === 0) return []

    const pitchToIdx = new Map<number, number>()
    rows.forEach((r, i) => pitchToIdx.set(r.pitch, i))

    return rangeLabels.map(rl => {
      // Rows are sorted high-to-low, so endPitch (higher) has a lower index
      const topIdx = pitchToIdx.get(rl.endPitch)
      const bottomIdx = pitchToIdx.get(rl.startPitch)
      if (topIdx === undefined || bottomIdx === undefined) return null
      const top = topIdx * rowHeight
      const height = (bottomIdx - topIdx + 1) * rowHeight
      return { label: rl.label, top, height }
    }).filter(Boolean) as { label: string; top: number; height: number }[]
  }, [rangeLabels, rows, rowHeight])

  const pitchToRowIndex = useCallback((pitch: number) => {
    return rows.findIndex(r => r.pitch === pitch)
  }, [rows])

  // Hover handler for dynamic cursor
  const handleHoverChange = useCallback((target: 'noteBody' | 'noteEdge' | null) => {
    if (dragStateRef.current.type !== 'none') return
    if (target === 'noteEdge') setCursor('ew-resize')
    else if (target === 'noteBody') setCursor('grab')
    else setCursor('crosshair')
  }, [setCursor])

  // Get notes within marquee bounds
  const getNotesInMarquee = useCallback((x1: number, y1: number, x2: number, y2: number): string[] => {
    const minX = Math.min(x1, x2)
    const maxX = Math.max(x1, x2)
    const minY = Math.min(y1, y2)
    const maxY = Math.max(y1, y2)

    const matchingIds: string[] = []

    for (const note of notes) {
      const rowIndex = pitchToRowIndex(note.pitch)
      if (rowIndex === -1) continue

      const noteTop = rowIndexToY(rowIndex, rowHeight)
      const noteBottom = noteTop + rowHeight
      const noteLeft = beatToX(note.startBeat, pixelsPerBeat)
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
  // All state is read from refs so closures never go stale.
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
      } else if (ds.type === 'marquee') {
        setDragState(prev => ({ ...prev, currentX: grid.x, currentY: grid.y }))
      }
    }

    const handleUp = () => {
      const ds = dragStateRef.current
      if (ds.type === 'drawing' && drawingNoteRef.current) {
        latest.current.onNotesChange([...latest.current.notes, drawingNoteRef.current])
        setDrawingNote(null)
      } else if (ds.type === 'marquee') {
        const ids = latest.current.getNotesInMarquee(ds.startX, ds.startY, ds.currentX, ds.currentY)
        if (ids.length > 0) {
          setSelectedNoteIds(prev => new Set([...prev, ...ids]))
        }
      }

      setDragState(DRAG_NONE)
      setCursor('crosshair')
      didDragRef.current = true
      document.body.style.userSelect = ''
      controller.abort()
      gestureAbortRef.current = null
    }

    window.addEventListener('pointermove', handleMove, { signal: controller.signal })
    window.addEventListener('pointerup', handleUp, { signal: controller.signal })
  }, [setCursor])

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

    // Check if near right edge (resize)
    const noteEl = e.currentTarget as HTMLDivElement
    const localX = e.nativeEvent.offsetX
    const noteW = noteEl.offsetWidth
    if (noteW > NOTE_EDGE_WIDTH * 2 && localX > noteW - NOTE_EDGE_WIDTH) {
      let newSelectedIds: Set<string>
      if (!selectedNoteIds.has(note.id)) {
        newSelectedIds = new Set([note.id])
        setSelectedNoteIds(newSelectedIds)
      } else {
        newSelectedIds = selectedNoteIds
      }

      const originalDurations = new Map<string, number>()
      for (const n of notes) {
        if (newSelectedIds.has(n.id)) {
          originalDurations.set(n.id, n.durationBeats)
        }
      }

      setDragState({
        type: 'resizing',
        startX: grid.x,
        startY: grid.y,
        currentX: grid.x,
        currentY: grid.y,
        noteId: note.id,
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
  }, [selectedNoteIds, notes, onNotesChange, setCursor, beginGestureTracking])

  // Handle note hover for cursor changes
  const handleNotePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragStateRef.current.type !== 'none') return
    const noteEl = e.currentTarget as HTMLDivElement
    const localX = e.nativeEvent.offsetX
    const noteW = noteEl.offsetWidth
    if (noteW > NOTE_EDGE_WIDTH * 2 && localX > noteW - NOTE_EDGE_WIDTH) {
      handleHoverChange('noteEdge')
    } else {
      handleHoverChange('noteBody')
    }
  }, [handleHoverChange])

  // Handle background pointer down (left-click = marquee selection, right-click = draw note)
  const handleBackgroundPointerDown = useCallback((e: React.PointerEvent) => {
    if (!gridRef.current) return
    const { x: gridX, y: gridY } = clientToGrid(e.clientX, e.clientY, gridRef.current.getBoundingClientRect())

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
            startBeat,
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

    // Left-click = marquee selection
    if (!e.shiftKey) setSelectedNoteIds(new Set())
    setDragState({
      type: 'marquee',
      startX: gridX,
      startY: gridY,
      currentX: gridX,
      currentY: gridY,
    })
    setCursor('crosshair')
    beginGestureTracking()
  }, [LABEL_WIDTH, rowHeight, rows, pixelsPerBeat, snapValue, snapEnabled, quantize, totalBeats, setCursor, beginGestureTracking])

  // Keyboard handler
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

  // Playhead position via RAF (no React re-renders)
  useEffect(() => {
    let rafId: number
    const tick = () => {
      const beat = useTimeStore.getState().currentBeat - blockStartBeat
      const visible = beat >= 0 && beat <= totalBeats
      const px = beatToX(beat, pixelsPerBeat)
      const el = playheadRef.current
      if (el) {
        el.style.transform = `translateX(${px}px)`
        el.style.display = visible ? '' : 'none'
      }
      const rel = rulerPlayheadRef.current
      if (rel) {
        rel.style.transform = `translateX(${px}px)`
        rel.style.display = visible ? '' : 'none'
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [pixelsPerBeat, blockStartBeat, totalBeats])

  // Scrub handler: click/drag on ruler to move playhead
  const scrubRef = useRef(false)

  const handleScrub = useCallback((clientX: number) => {
    if (!gridRef.current) return
    const rect = gridRef.current.getBoundingClientRect()
    const rawBeat = xToBeat(clientX - rect.left, pixelsPerBeat)
    const snapped = snapEnabled
      ? Math.round(rawBeat / quantize) * quantize
      : rawBeat
    const clamped = Math.max(0, Math.min(totalBeats, snapped))
    useTimeStore.getState().setCurrentBeat(clamped + blockStartBeat)
  }, [pixelsPerBeat, snapEnabled, quantize, totalBeats, blockStartBeat])

  const handlePlayheadPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation()
    scrubRef.current = true
    handleScrub(e.clientX)

    const onMove = (ev: PointerEvent) => {
      if (scrubRef.current) handleScrub(ev.clientX)
    }
    const onUp = () => {
      scrubRef.current = false
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [handleScrub])

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
  }, [])

  // All notes including the one being drawn
  const allNotes = drawingNote ? [...notes, drawingNote] : notes

  // Marquee overlay
  const marqueeStyle = useMemo(() => {
    if (dragState.type !== 'marquee') return null
    const x1 = Math.min(dragState.startX, dragState.currentX)
    const y1 = Math.min(dragState.startY, dragState.currentY)
    const w = Math.abs(dragState.currentX - dragState.startX)
    const h = Math.abs(dragState.currentY - dragState.startY)
    if (w < 2 || h < 2) return null
    return {
      position: 'absolute' as const,
      left: x1,
      top: y1,
      width: w,
      height: h,
      backgroundColor: 'rgba(99, 102, 241, 0.15)',
      border: '1px solid rgba(99, 102, 241, 0.6)',
      pointerEvents: 'none' as const,
      zIndex: 10,
    }
  }, [dragState])

  const barCount = Math.ceil(totalBeats / beatsPerBar)

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto no-scrollbar bg-zinc-950"
      style={{ cursor: 'crosshair' }}
      onClick={handleContainerClick}
    >
      {/* Sticky ruler row */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          display: 'flex',
          width: canvasWidth,
          height: RULER_HEIGHT,
          backgroundColor: '#111111',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div style={{ width: LABEL_WIDTH, flexShrink: 0, backgroundColor: '#141414' }} />
        <div
          style={{
            flex: 1,
            position: 'relative',
            cursor: 'col-resize',
            overflow: 'hidden',
          }}
          onPointerDown={handlePlayheadPointerDown}
        >
          {/* Bar numbers */}
          {Array.from({ length: barCount }).map((_, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: i * beatsPerBar * pixelsPerBeat,
                top: 0,
                height: RULER_HEIGHT,
                borderLeft: '1px solid rgba(255,255,255,0.15)',
                display: 'flex',
                alignItems: 'center',
                paddingLeft: 4,
                fontSize: 10,
                color: '#555555',
                fontFamily: 'monospace',
              }}
            >
              {i + 1}
            </div>
          ))}
          {/* Ruler playhead */}
          <div
            ref={rulerPlayheadRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: 1,
              height: RULER_HEIGHT,
              pointerEvents: 'none',
              zIndex: 21,
            }}
          >
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: 1.5,
              height: '100%',
              backgroundColor: '#818cf8',
            }} />
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: -4,
              width: 0,
              height: 0,
              borderLeft: '4.5px solid transparent',
              borderRight: '4.5px solid transparent',
              borderBottom: '6px solid #818cf8',
            }} />
          </div>
        </div>
      </div>

      <div style={{ width: canvasWidth, height: canvasHeight, position: 'relative', display: 'flex' }}>
        {/* Labels column */}
        <div
          style={{
            width: LABEL_WIDTH,
            height: canvasHeight,
            flexShrink: 0,
            backgroundColor: '#141414',
            position: 'relative',
            zIndex: 2,
            cursor: 'default',
          }}
          onPointerMove={() => {
            if (dragStateRef.current.type === 'none') setCursor('default')
          }}
        >
          {rows.map((row) => (
            <div
              key={row.pitch}
              style={{
                height: rowHeight,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                paddingRight: 8,
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                overflow: 'hidden',
              }}
            >
              <span
                title={row.label}
                style={{
                  fontSize: 13,
                  color: '#666666',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  minWidth: 0,
                }}
              >
                {row.label}
              </span>
            </div>
          ))}
          {/* Range label annotations */}
          {rangeLabelPositions.map((rl, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                top: rl.top,
                left: 0,
                width: LABEL_WIDTH,
                height: rl.height,
                pointerEvents: 'none',
                borderTop: '1px solid rgba(255,255,255,0.12)',
                borderBottom: i === rangeLabelPositions.length - 1 ? '1px solid rgba(255,255,255,0.12)' : undefined,
              }}
            >
              <span
                title={rl.label}
                style={{
                  position: 'absolute',
                  top: 4,
                  left: 6,
                  right: 4,
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'rgba(255,255,255,0.3)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {rl.label}
              </span>
            </div>
          ))}
        </div>

        {/* Grid area */}
        <div
          ref={gridRef}
          style={{
            flex: 1,
            height: canvasHeight,
            position: 'relative',
            backgroundColor: '#0e0e0e',
            ...gridBackground,
          }}
          onPointerDown={handleBackgroundPointerDown}
          onContextMenu={(e) => e.preventDefault()}
          onPointerMove={() => {
            if (dragStateRef.current.type === 'none') setCursor('crosshair')
          }}
        >
          {/* Range label background bands */}
          {rangeLabelPositions.map((rl, i) => (
            <div
              key={`range-${i}`}
              style={{
                position: 'absolute',
                top: rl.top,
                left: 0,
                right: 0,
                height: rl.height,
                backgroundColor: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                pointerEvents: 'none',
              }}
            />
          ))}

          {/* Row dividers */}
          {rows.map((_, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                top: i * rowHeight + rowHeight - 1,
                left: 0,
                right: 0,
                height: 1,
                backgroundColor: 'rgba(255,255,255,0.05)',
                pointerEvents: 'none',
              }}
            />
          ))}

          {/* Notes */}
          {allNotes.map((note) => {
            const rowIndex = pitchToRowIndex(note.pitch)
            if (rowIndex === -1) return null
            const row = rows[rowIndex]
            const x = beatToX(note.startBeat, pixelsPerBeat)
            const y = rowIndexToY(rowIndex, rowHeight) + 2
            const w = Math.max(beatToX(note.durationBeats, pixelsPerBeat), 8)
            const h = rowHeight - 4
            const isSelected = selectedNoteIds.has(note.id)
            const noteColor = isSelected ? lighten(row.color, 40) : row.color

            return (
              <div
                key={note.id}
                style={{
                  position: 'absolute',
                  left: x,
                  top: y,
                  width: w,
                  height: h,
                  backgroundColor: noteColor,
                  borderRadius: 3,
                  boxShadow: isSelected
                    ? `0 0 14px ${row.color}, 0 0 6px ${row.color}`
                    : '1px 1px 3px rgba(0,0,0,0.3)',
                  outline: isSelected ? '1px solid rgba(255,255,255,0.6)' : 'none',
                  cursor: 'inherit',
                  zIndex: isSelected ? 3 : 1,
                }}
                onPointerDown={(e) => handleNotePointerDown(e, note)}
                onPointerMove={handleNotePointerMove}
                onPointerOut={() => handleHoverChange(null)}
              />
            )
          })}

          {/* Marquee overlay */}
          {marqueeStyle && <div style={marqueeStyle} />}

          {/* Playhead */}
          <div
            ref={playheadRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: 1,
              height: '100%',
              zIndex: 15,
              pointerEvents: 'none',
            }}
          >
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: 1.5,
              height: '100%',
              backgroundColor: '#818cf8',
            }} />
            {/* Hit area for scrubbing */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: -8,
                width: 17,
                height: '100%',
                cursor: 'col-resize',
                pointerEvents: 'auto',
                zIndex: 16,
              }}
              onPointerDown={handlePlayheadPointerDown}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
