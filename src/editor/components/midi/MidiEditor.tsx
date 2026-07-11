'use client'

import { useEffect, useMemo, useRef, type UIEvent as ReactScrollEvent } from 'react'
import { useUIStore } from '../../store/UIStore'
import { PLAYHEAD_TRIANGLE_HALF, PLAYHEAD_SNAP_BEATS } from '../../constants'
import { lighten } from '../../utils/colors'
import type { Block, Note } from '../../types'
import { useNoteGestures } from './useNoteGestures'
import { useMidiBlockGestures } from './useMidiBlockGestures'
import { usePlayhead } from '../../hooks/usePlayhead'
import { useScrub } from '../../hooks/useScrub'
import { xToBeat, beatToX, rowIndexToY } from './coords'
import { startEdgeResize } from '../../utils/edgeResize'
import type { MidiRow, RangeLabel } from './types'

export interface MidiEditorProps {
  rows: MidiRow[]
  notes: Note[]
  /** Track that owns the block being edited (for block move/resize writes). */
  trackId: string
  block: Block
  onNotesChange: (notes: Note[]) => void
  /** Persist a gesture's result to the store as one undo step. */
  onCommit: (notes: Note[]) => void
  beatsPerBar: number
  quantize: number
  snapEnabled?: boolean
  pixelsPerBeat?: number
  rowHeight?: number
  rangeLabels?: RangeLabel[]
  /** Text for the frozen top-left corner (left of the ruler) - e.g. an automation
   *  track's param name. */
  cornerLabel?: string
  /** Beat offset of this block in the project timeline (for playhead positioning) */
  blockStartBeat?: number
  blockDurationBeats?: number
  /** Total beats the editor timeline spans (canvas extent). */
  initialTotalBeats: number
}

// The label gutter width lives in UIStore (midiLabelWidth) - drag its right edge to resize.
const RULER_HEIGHT = 40
const CANVAS_RIGHT_PADDING = 20

export function MidiEditor({
  rows,
  notes,
  trackId,
  block,
  onNotesChange,
  onCommit,
  beatsPerBar,
  quantize,
  snapEnabled = true,
  pixelsPerBeat = 40,
  rowHeight = 28,
  rangeLabels,
  cornerLabel,
  blockStartBeat = 0,
  blockDurationBeats = 0,
  initialTotalBeats,
}: MidiEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const rulerPlayheadRef = useRef<HTMLDivElement>(null)
  const rulerContentRef = useRef<HTMLDivElement>(null)
  // The label gutter's width - drag its right edge to resize (same gesture as
  // the tracks label column).
  const labelWidth = useUIStore((s) => s.midiLabelWidth)

  // Mirror the grid's horizontal scroll onto the ruler via transform (no clamp, no
  // dependence on matching client widths → stays aligned to the far-right edge).
  // The grid scroll container owns the only scrollbars (vertical ends below the
  // ruler; horizontal sits under the grid).
  const onScrollSync = (e: ReactScrollEvent<HTMLDivElement>) => {
    if (rulerContentRef.current) {
      rulerContentRef.current.style.transform = `translateX(${-e.currentTarget.scrollLeft}px)`
    }
  }

  // Scrubbing: map a clientX to an absolute beat (snapped, clamped to the timeline)
  const { scrubbingRef, startScrub } = useScrub({
    computeBeat: (clientX) => {
      if (!gridRef.current) return null
      const rect = gridRef.current.getBoundingClientRect()
      const rawBeat = xToBeat(clientX - rect.left, pixelsPerBeat)
      // Playhead always snaps to 1/4 beat, independent of the note-snap toggle.
      const snapped = Math.round(rawBeat / PLAYHEAD_SNAP_BEATS) * PLAYHEAD_SNAP_BEATS
      return Math.max(0, Math.min(initialTotalBeats, snapped))
    },
    onStart: () => { if (containerRef.current) containerRef.current.style.cursor = 'ew-resize' },
    onEnd: () => { if (containerRef.current) containerRef.current.style.cursor = 'default' },
  })

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
    scrubbingRef,
    block,
    notes,
    onNotesChange,
    onCommit,
    rows,
    rowHeight,
    pixelsPerBeat,
    beatsPerBar,
    blockStartBeat,
    blockDurationBeats,
    initialTotalBeats,
    quantize,
    snapEnabled,
  })

  // Block move/resize via the ruler clip header (separate from note gestures).
  const { handleHeaderPointerDown, handleHeaderPointerMove, handleResizePointerDown } = useMidiBlockGestures({
    trackId,
      block,
    notes,
    pixelsPerBeat,
    beatsPerBar,
    maxBeats: initialTotalBeats,
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

  // Canvas dimensions (the timeline spans initialTotalBeats, not just the block)
  const canvasWidth = initialTotalBeats * pixelsPerBeat + labelWidth + PLAYHEAD_TRIANGLE_HALF + CANVAS_RIGHT_PADDING
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

  // Playhead position via RAF (no React re-renders). The canvas is an absolute
  // timeline, so the playhead sits at the absolute currentBeat and is visible
  // anywhere within the timeline (not just over the block).
  usePlayhead((beat) => {
    const visible = beat >= 0 && beat <= initialTotalBeats
    const px = beatToX(beat, pixelsPerBeat)
    for (const el of [playheadRef.current, rulerPlayheadRef.current]) {
      if (!el) continue
      el.style.transform = `translateX(${px}px)`
      el.style.display = visible ? '' : 'none'
    }
  })

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

  const barCount = Math.ceil(initialTotalBeats / beatsPerBar)
  // Only every `barInterval`th bar is numbered (matches the track ruler's thinning).
  const barInterval = barCount <= 16 ? 1 : barCount <= 64 ? 2 : 4
  const blockStartPx = beatToX(blockStartBeat, pixelsPerBeat)
  const blockWidthPx = beatToX(blockDurationBeats, pixelsPerBeat)

  return (
    <div className="relative flex-1 flex flex-col min-h-0 bg-[#1e1e21]">
      {/* Resize handle along the label gutter's right edge - spans the full height
          (ruler corner + every row label). Invisible; the cursor is the affordance -
          mirrors the tracks label column exactly. */}
      <div
        onPointerDown={(e) => {
          const { midiLabelWidth, setMidiLabelWidth } = useUIStore.getState()
          startEdgeResize(e, midiLabelWidth, setMidiLabelWidth)
        }}
        className="absolute top-0 bottom-0 z-40 cursor-ew-resize"
        style={{ left: labelWidth - 3, width: 6 }}
      />
      {/* Ruler in its own row (outside the grid scroll container) so the grid owns
          the only scrollbars: the vertical one then ends below the ruler. Horizontal
          scroll is synced via onScrollSync; the ruler's own bar is hidden.
          Two-tone Logic-style: lighter top half with bar numbers, darker bottom half
          with tick lines and the playhead triangle. The playhead line lives in the grid. */}
      <div className="flex-shrink-0" style={{ display: 'flex', height: RULER_HEIGHT, borderBottom: '1px solid #27272a' }}>
        {/* Frozen corner - stays put on horizontal scroll, aligned with the sticky labels.
            Distinct box colour (matching the track ruler + the label column below). */}
        <div style={{ width: labelWidth, flexShrink: 0, backgroundColor: '#202024', borderRight: '1px solid #27272a', zIndex: 2, display: 'flex', alignItems: 'center', padding: '0 8px' }}>
          {cornerLabel && (
            <span style={{ fontSize: 10.5, fontWeight: 600, color: '#a1a1aa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cornerLabel}</span>
          )}
        </div>
        {/* Strip viewport clips the translated inner content (mirrors the grid scroll). */}
        <div
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
            backgroundColor: '#18181b',
          }}
          onPointerDown={(e) => {
            // Whole ruler scrubs here - the toolbar above (part of the editor) owns
            // the panel-resize edge, so the ruler top doesn't double as a resizer.
            startScrub(e)
          }}
          onPointerMove={(e) => {
            e.currentTarget.style.cursor = 'ew-resize'
          }}
        >
          {/* Subtle divider separating the top (numbers) and bottom (ticks) halves -
              matches the track ruler (zinc-700 @ 40%). */}
          <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 1, backgroundColor: 'rgba(63,63,70,0.4)', pointerEvents: 'none' }} />

          <div ref={rulerContentRef} style={{ position: 'absolute', top: 0, bottom: 0, left: PLAYHEAD_TRIANGLE_HALF, width: canvasWidth - labelWidth, willChange: 'transform' }}>

          {/* Faint, short beat ticks (every beat that isn't a bar line) */}
          {Array.from({ length: Math.ceil(initialTotalBeats) }, (_, i) => i)
            .filter((i) => i % beatsPerBar !== 0)
            .map((i) => (
              <div key={`beat${i}`} style={{ position: 'absolute', left: i * pixelsPerBeat, top: '72%', bottom: 0, width: 1, backgroundColor: 'rgba(63,63,70,0.6)' }} />
            ))}

          {Array.from({ length: barCount }).map((_, i) => {
            const numbered = i % barInterval === 0
            return (
              <div key={i} style={{ position: 'absolute', left: i * beatsPerBar * pixelsPerBeat, top: 0, bottom: 0 }}>
                {numbered ? (
                  <>
                    {/* Top half: bar number + full-height tick line */}
                    <span style={{ position: 'absolute', top: 0, left: 4, paddingTop: 4, fontSize: 10, lineHeight: 1, color: '#a1a1aa' }}>
                      {i + 1}
                    </span>
                    <div style={{ position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#52525b' }} />
                  </>
                ) : (
                  /* Blank bar: short faint tick, same as the beat ticks */
                  <div style={{ position: 'absolute', top: '72%', bottom: 0, width: 1, backgroundColor: 'rgba(63,63,70,0.6)' }} />
                )}
              </div>
            )
          })}

          {/* Block clip header: drag the body to move the block, the edges to resize.
              Sits in the bottom half below the triangle (zIndex 10 < 21). */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              bottom: 0,
              left: blockStartPx,
              width: blockWidthPx,
              backgroundColor: 'rgba(129, 140, 248, 0.6)',
              zIndex: 10,
              pointerEvents: 'auto',
            }}
            onPointerDown={(e) => {
              // Clicking on/near the playhead triangle scrubs instead of grabbing
              // the block (gives the playhead priority without a moving hit target).
              const ph = rulerPlayheadRef.current?.getBoundingClientRect().left
              if (ph != null && Math.abs(e.clientX - ph) <= 10) { startScrub(e); return }
              handleHeaderPointerDown(e)
            }}
            onPointerMove={(e) => {
              // Show the scrub cursor where a click would scrub (near the playhead).
              const ph = rulerPlayheadRef.current?.getBoundingClientRect().left
              if (ph != null && Math.abs(e.clientX - ph) <= 10) { e.currentTarget.style.cursor = 'ew-resize'; return }
              handleHeaderPointerMove(e)
            }}
          />

          {/* Playhead head: downward triangle filling the bottom half (RAF-positioned).
              Clipped to the strip so it sits flush at the lane edge at beat 0. */}
          <div
            ref={rulerPlayheadRef}
            style={{ position: 'absolute', top: '50%', bottom: 0, left: 0, width: 0, pointerEvents: 'none', zIndex: 21 }}
          >
            <div style={{
              position: 'absolute',
              top: 0,
              left: -PLAYHEAD_TRIANGLE_HALF,
              width: 0,
              height: 0,
              borderLeft: `${PLAYHEAD_TRIANGLE_HALF}px solid transparent`,
              borderRight: `${PLAYHEAD_TRIANGLE_HALF}px solid transparent`,
              borderTop: '20px solid #ffffff',
            }} />
          </div>
        </div>
      </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-auto timeline-scrollbar min-h-0"
        style={{ cursor: 'default' }}
        onClick={handleContainerClick}
        onScroll={onScrollSync}
      >
      <div style={{ width: canvasWidth, height: canvasHeight, position: 'relative', display: 'flex' }}>
        {/* Labels column - frozen on horizontal scroll (sticky left), like the ruler
            is frozen on vertical scroll. zIndex above notes + playhead so grid content
            slides under it instead of showing through. */}
        <div
          style={{
            width: labelWidth,
            height: canvasHeight,
            flexShrink: 0,
            backgroundColor: '#202024',
            position: 'sticky',
            left: 0,
            zIndex: 20,
            cursor: 'default',
          }}
          onPointerMove={() => {
            if (dragStateRef.current.type === 'none') setCursor('default')
          }}
        >
          {rows.map((row) => (
            <div
              key={row.pitch}
              title={row.noteLabel ? `${row.label} (${row.noteLabel})` : row.label}
              style={{
                height: rowHeight,
                display: 'flex',
                alignItems: 'center',
                justifyContent: row.noteLabel ? 'space-between' : 'flex-end',
                gap: 4,
                paddingLeft: row.noteLabel ? 6 : 0,
                paddingRight: 8,
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                boxSizing: 'border-box',
                overflow: 'hidden',
              }}
            >
              <span
                style={{
                  fontSize: row.noteLabel ? 11 : 13,
                  color: '#666666',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  minWidth: 0,
                }}
              >
                {row.label}
              </span>
              {row.noteLabel && (
                <span
                  style={{
                    fontSize: 10,
                    color: 'rgba(255,255,255,0.35)',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {row.noteLabel}
                </span>
              )}
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
                width: labelWidth,
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

        {/* Gutter (half a triangle wide) between the labels and the grid so the
            ruler playhead triangle has room to show its left half at beat 0. */}
        <div style={{ width: PLAYHEAD_TRIANGLE_HALF, flexShrink: 0, backgroundColor: '#18181b' }} />

        {/* Grid area */}
        <div
          ref={gridRef}
          style={{
            flex: 1,
            height: canvasHeight,
            position: 'relative',
            backgroundColor: '#18181b',
            ...gridBackground,
          }}
          onPointerDown={handleBackgroundPointerDown}
          onContextMenu={(e) => e.preventDefault()}
          onPointerMove={() => {
            if (dragStateRef.current.type === 'none') setCursor('default')
          }}
        >
          {/* Midi block outline */}
          {/* Background */}
          <div
            style={{
              position: 'absolute',
              backgroundColor: 'rgba(129, 140, 248, 0.08)',
              left: blockStartPx,
              width: blockWidthPx,
              top: 0,
              bottom: 0,
            }}
          />
          {/* Sides */}
          <div
            data-midi-block-region=""
            style={{
              position: 'absolute',
              borderLeft: '1px solid rgba(129, 140, 248, 0.6)',
              borderRight: '1px solid rgba(129, 140, 248, 0.6)',
              left: blockStartPx,
              width: blockWidthPx,
              top: 0,
              bottom: 0,
            }}
          />
          {/* Resize handles over the left/right borders (above notes so they grab). */}
          <div
            style={{ position: 'absolute', top: 0, bottom: 0, left: blockStartPx - 4, width: 8, cursor: 'ew-resize', zIndex: 4 }}
            onPointerDown={(e) => handleResizePointerDown(e, 'left')}
          />
          <div
            style={{ position: 'absolute', top: 0, bottom: 0, left: blockStartPx + blockWidthPx - 4, width: 8, cursor: 'ew-resize', zIndex: 4 }}
            onPointerDown={(e) => handleResizePointerDown(e, 'right')}
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
                  left: blockStartPx + x,
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
              width: 0.5,
              height: '100%',
              backgroundColor: '#ffffff',
            }} />
            {/* Hit area for scrubbing (kept narrow so it barely overlaps notes) */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: -3,
                width: 7,
                height: '100%',
                cursor: 'ew-resize',
                pointerEvents: 'auto',
                zIndex: 16,
              }}
              onPointerDown={startScrub}
            />
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
