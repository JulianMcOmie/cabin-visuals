'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, type UIEvent as ReactScrollEvent } from 'react'
import { useUIStore } from '../../store/UIStore'
import { PLAYHEAD_TRIANGLE_HALF, PLAYHEAD_SNAP_BEATS } from '../../constants'
import { lighten } from '../../utils/colors'
import type { Block, Note } from '../../types'
import { useNoteGestures } from './useNoteGestures'
import { useMidiBlockGestures } from './useMidiBlockGestures'
import { loopLengthBeats, tileLoopNotes } from '../../core/visual/noteFlatten'
import { usePlayhead } from '../../hooks/usePlayhead'
import { useScrub } from '../../hooks/useScrub'
import { useLoopDrag } from '../../hooks/useLoopDrag'
import { Ruler } from '../Ruler'
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
  const { scrubbingRef, startScrub, scrubTo } = useScrub({
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

  // Loop-region drag on the ruler's top half - same grid beat math as the
  // scrub, but snapped to whole beats. The region is absolute project beats
  // (this ruler spans the whole project, with the block at blockStartBeat).
  const { startLoopDrag, startLoopMove, startLoopResize } = useLoopDrag({
    computeBeat: (clientX) => {
      if (!gridRef.current) return null
      const rect = gridRef.current.getBoundingClientRect()
      const beat = Math.round(xToBeat(clientX - rect.left, pixelsPerBeat))
      return Math.max(0, Math.min(initialTotalBeats, beat))
    },
    maxBeat: initialTotalBeats,
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
    onHeaderClick: scrubTo,
  })

  // Alt+scroll zoom (horizontal = pixelsPerBeat, vertical = row height).
  // Vertical is a step function over the MIDI_ROW_HEIGHTS ladder (like Logic):
  // wheel travel accumulates and each ROW_ZOOM_WHEEL_STEP px of it moves one
  // rung, rather than scaling continuously.
  const ROW_ZOOM_WHEEL_STEP = 60
  const rowZoomAccumRef = useRef(0)
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
        // A direction flip discards leftover travel from the old direction.
        const acc = rowZoomAccumRef.current
        rowZoomAccumRef.current = (Math.sign(e.deltaY) !== Math.sign(acc) ? 0 : acc) + e.deltaY
        while (Math.abs(rowZoomAccumRef.current) >= ROW_ZOOM_WHEEL_STEP) {
          // Scroll up (negative deltaY) zooms in, matching the old behavior.
          useUIStore.getState().stepMidiRowHeight(rowZoomAccumRef.current < 0 ? 1 : -1)
          rowZoomAccumRef.current -= Math.sign(rowZoomAccumRef.current) * ROW_ZOOM_WHEEL_STEP
        }
      }
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [])

  // When a zoom level changes, keep what's at the viewport's center anchored
  // (Logic's behavior): the view grows/shrinks around what you're looking at
  // instead of drifting. Vertically the row at center keeps its exact y;
  // horizontally the beat at the center of the visible grid keeps its exact x.
  // Runs for any change - wheel zoom and the toolbar's H/V sliders alike.
  // Layout effect so the scroll correction lands in the same frame as the
  // resize (no visible jump).
  const prevZoomRef = useRef({ rowHeight, pixelsPerBeat })
  useLayoutEffect(() => {
    const prev = prevZoomRef.current
    prevZoomRef.current = { rowHeight, pixelsPerBeat }
    const sc = containerRef.current
    if (!sc) return
    if (prev.rowHeight !== rowHeight) {
      const centerRow = Math.floor((sc.scrollTop + sc.clientHeight / 2) / prev.rowHeight)
      const rowCenterViewportY = (centerRow + 0.5) * prev.rowHeight - sc.scrollTop
      sc.scrollTop = (centerRow + 0.5) * rowHeight - rowCenterViewportY
    }
    if (prev.pixelsPerBeat !== pixelsPerBeat) {
      // Beat x in content space = gridLeft + beat * pixelsPerBeat; the default
      // anchor is the center of the grid actually visible right of the sticky
      // label column. But when notes are on screen, anchor the one most
      // horizontally centered instead - zooming homes in on that note, not on
      // empty grid. The anchored point is the note's span clamped to the
      // center, so a note straddling the center pins exactly under it and the
      // runner-up pins by its nearest edge. Runs after the vertical branch, so
      // visibility checks use the corrected scrollTop and current rowHeight.
      const gridLeft = labelWidth + PLAYHEAD_TRIANGLE_HALF
      const viewportCenterX = labelWidth + (sc.clientWidth - labelWidth) / 2
      const contentCenterX = sc.scrollLeft + viewportCenterX
      let anchorContentX = contentCenterX
      let anchorBeat = (contentCenterX - gridLeft) / prev.pixelsPerBeat

      const viewLeft = sc.scrollLeft + labelWidth
      const viewRight = sc.scrollLeft + sc.clientWidth
      let bestDist = Infinity
      for (const note of notes) {
        const rowIndex = pitchToRowIndex(note.pitch)
        if (rowIndex === -1) continue
        const yTop = rowIndex * rowHeight
        if (yTop + rowHeight < sc.scrollTop || yTop > sc.scrollTop + sc.clientHeight) continue
        const xs = gridLeft + (blockStartBeat + note.startBeat) * prev.pixelsPerBeat
        const xe = xs + note.durationBeats * prev.pixelsPerBeat
        if (xe < viewLeft || xs > viewRight) continue
        const dist = Math.max(xs - contentCenterX, contentCenterX - xe, 0)
        if (dist < bestDist) {
          bestDist = dist
          anchorContentX = Math.max(xs, Math.min(xe, contentCenterX))
          anchorBeat = (anchorContentX - gridLeft) / prev.pixelsPerBeat
        }
      }

      const anchorViewportX = anchorContentX - sc.scrollLeft
      sc.scrollLeft = gridLeft + anchorBeat * pixelsPerBeat - anchorViewportX
    }
  }, [rowHeight, pixelsPerBeat, labelWidth, notes, blockStartBeat, pitchToRowIndex])

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

  // Loop ghosts: the pattern's repeats, dimmed and non-interactive, computed from
  // the live local notes so they track in-flight edits. repeat 0 is the authored
  // note itself and is skipped - except when a note sits outside the pattern
  // window (its phase folds modulo the loop length); then the folded position
  // shows as a ghost too, because that is where it plays.
  const loopBeats = block.loop
    ? loopLengthBeats({ loopLengthBars: block.loopLengthBars, notes: allNotes }, beatsPerBar)
    : null
  const loopGhosts = loopBeats != null && loopBeats > 0 && loopBeats < blockDurationBeats
    ? tileLoopNotes(allNotes, loopBeats, blockDurationBeats, 2000)
        .filter((t) => t.repeat > 0 || t.startBeat !== t.note.startBeat)
    : []
  const loopBoundaries: number[] = []
  if (loopBeats != null && loopBeats > 0) {
    for (let b = loopBeats; b < blockDurationBeats; b += loopBeats) loopBoundaries.push(b)
  }

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
    <div className="relative flex-1 flex flex-col min-h-0 bg-[#1e1e21] select-none">
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
          scroll is synced via onScrollSync; the ruler's own bar is hidden. The shared
          Ruler renders the loop lane, bar numbers, ticks, and playhead triangle -
          identical to the main timeline's. The playhead line lives in the grid. */}
      <Ruler
        height={RULER_HEIGHT}
        labelWidth={labelWidth}
        corner={cornerLabel && (
          <span className="px-2 text-[10.5px] font-semibold text-[var(--text-3)] whitespace-nowrap overflow-hidden text-ellipsis">{cornerLabel}</span>
        )}
        contentWidthPx={canvasWidth - labelWidth}
        pixelsPerBeat={pixelsPerBeat}
        beatsPerBar={beatsPerBar}
        totalBars={barCount}
        totalBeats={initialTotalBeats}
        contentRef={rulerContentRef}
        playheadHeadRef={rulerPlayheadRef}
        onScrubStart={startScrub}
        onLoopDragStart={startLoopDrag}
        onLoopMoveStart={startLoopMove}
        onLoopResizeStart={startLoopResize}
      >
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
      </Ruler>

      <div
        ref={containerRef}
        className="flex-1 overflow-auto timeline-scrollbar min-h-0"
        style={{ cursor: 'default' }}
        onClick={handleContainerClick}
        onScroll={onScrollSync}
        onPointerDown={(e) => {
          // The empty space below the last row (short row lists leave plenty) is
          // still "the grid" for selection: start the marquee there too. Only
          // presses landing on the scroll container itself qualify (the grid,
          // labels, and notes handle their own), and the label column's x-range
          // stays inert - it isn't part of the grid.
          if (e.target !== e.currentTarget) return
          const rect = e.currentTarget.getBoundingClientRect()
          if (e.clientX - rect.left < labelWidth + PLAYHEAD_TRIANGLE_HALF) return
          handleBackgroundPointerDown(e)
        }}
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
                justifyContent: 'space-between',
                gap: 4,
                paddingLeft: 6,
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

          {/* Loop boundaries: dashed line at each pattern repeat inside the block. */}
          {loopBoundaries.map((b) => (
            <div
              key={`loop:${b}`}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: blockStartPx + beatToX(b, pixelsPerBeat),
                width: 0,
                borderLeft: '1px dashed rgba(129, 140, 248, 0.45)',
                pointerEvents: 'none',
              }}
            />
          ))}

          {/* Ghost repeats: where the pattern plays again, read-only (edit the
              pattern; every repeat follows). Rendered before the notes so real
              notes always sit on top. */}
          {loopGhosts.map((t) => {
            const rowIndex = pitchToRowIndex(t.note.pitch)
            if (rowIndex === -1) return null
            const row = rows[rowIndex]
            return (
              <div
                key={`${t.note.id}:${t.repeat}`}
                style={{
                  position: 'absolute',
                  left: blockStartPx + beatToX(t.startBeat, pixelsPerBeat),
                  top: rowIndexToY(rowIndex, rowHeight) + 2,
                  width: Math.max(beatToX(t.durationBeats, pixelsPerBeat), 8),
                  height: rowHeight - 4,
                  backgroundColor: row.color,
                  opacity: 0.3,
                  borderRadius: 3,
                  pointerEvents: 'none',
                }}
              />
            )
          })}

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
