'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTimeStore } from '../../store/TimeStore'
import { useUIStore } from '../../store/UIStore'
import { lighten } from '../../utils/colors'
import type { Note } from '../../types'
import { useNoteGestures } from '../../hooks/useNoteGestures'
import { xToBeat, beatToX, rowIndexToY } from './coords'
import type { MidiRow, RangeLabel } from './types'

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
  blockDurationBeats?: number
}

const LABEL_WIDTH = 88
const RULER_HEIGHT = 24
const CANVAS_RIGHT_PADDING = 20

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
  blockDurationBeats = 0,
}: MidiEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const rulerPlayheadRef = useRef<HTMLDivElement>(null)

  const {
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
  } = useNoteGestures({
    containerRef,
    gridRef,
    notes,
    onNotesChange,
    rows,
    rowHeight,
    pixelsPerBeat,
    totalBeats,
    quantize,
    snapEnabled,
  })

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

  const handlePlayheadPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    document.body.style.userSelect = 'none'
    scrubRef.current = true
    handleScrub(e.clientX)

    const controller = new AbortController()
    const onMove = (ev: PointerEvent) => {
      if (scrubRef.current) handleScrub(ev.clientX)
    }
    const onUp = () => {
      scrubRef.current = false
      document.body.style.userSelect = ''
      controller.abort()
    }
    window.addEventListener('pointermove', onMove, { signal: controller.signal })
    window.addEventListener('pointerup', onUp, { signal: controller.signal })
  }

  // All notes including the one being drawn
  const allNotes = drawingNote ? [...notes, drawingNote] : notes

  // Marquee overlay (grid-local pixels)
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
      style={{ cursor: 'default' }}
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
            if (dragStateRef.current.type === 'none') setCursor('default')
          }}
        >
          {/* Midi block outline */}
          <div
            style={{
              position: 'absolute',
              backgroundColor: 'green',
              opacity: '10%',
              left: blockStartBeat * pixelsPerBeat,
              width: blockDurationBeats * pixelsPerBeat,
              top: 0,
              bottom: 0
            }}
          />

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
            {/* Hit area for scrubbing (kept narrow so it barely overlaps notes) */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: -3,
                width: 7,
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
