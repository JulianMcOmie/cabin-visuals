'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type UIEvent as ReactScrollEvent } from 'react'
import { useUIStore } from '../../store/UIStore'
import { PLAYHEAD_TRIANGLE_HALF } from '../../constants'
import { computeRulerGrid } from '../rulerGrid'
import { midiEditorChrome, midiNoteColor, midiRowLabelColor } from '../../utils/midiEditorPalette'
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
import { useTimeStore } from '../../store/TimeStore'
import { scrollLeftAroundBeat } from '../../utils/zoomAroundBeat'

export interface MidiEditorProps {
  rows: MidiRow[]
  notes: Note[]
  /** Track that owns the block being edited (for block move/resize writes). */
  trackId: string
  /** The owning track's color - the editor chrome (ruler band, block region,
   *  loop dashes, marquee) is voiced from it. */
  trackColor: string
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
  trackColor,
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
  const prevZoomRef = useRef({ rowHeight, pixelsPerBeat, scrollLeft: 0 })
  // The label gutter's width - drag its right edge to resize (same gesture as
  // the tracks label column).
  const labelWidth = useUIStore((s) => s.midiLabelWidth)

  // Mirror the grid's horizontal scroll onto the ruler via transform (no clamp, no
  // dependence on matching client widths → stays aligned to the far-right edge).
  // The grid scroll container owns the only scrollbars (vertical ends below the
  // ruler; horizontal sits under the grid).
  const onScrollSync = (e: ReactScrollEvent<HTMLDivElement>) => {
    prevZoomRef.current.scrollLeft = e.currentTarget.scrollLeft
    if (rulerContentRef.current) {
      rulerContentRef.current.style.transform = `translateX(${-e.currentTarget.scrollLeft}px)`
    }
  }

  // One ruler mapping for every transport gesture. Keeping playhead scrubbing,
  // loop creation, loop movement, and edge resizing on this exact function
  // prevents their grids from diverging as the horizontal zoom changes.
  const computeSnappedRulerBeat = useCallback((clientX: number) => {
    if (!gridRef.current) return null
    const rect = gridRef.current.getBoundingClientRect()
    const rawBeat = xToBeat(clientX - rect.left, pixelsPerBeat)
    const snap = computeRulerGrid(
      pixelsPerBeat,
      beatsPerBar,
      Math.ceil(initialTotalBeats / beatsPerBar),
    ).playheadSnapBeats
    const snapped = Math.round(rawBeat / snap) * snap
    return Math.max(0, Math.min(initialTotalBeats, snapped))
  }, [beatsPerBar, initialTotalBeats, pixelsPerBeat])

  // Scrubbing: map a clientX to an absolute beat (snapped, clamped to the timeline)
  const { scrubbingRef, startScrub, scrubTo } = useScrub({
    computeBeat: computeSnappedRulerBeat,
    onStart: () => { if (containerRef.current) containerRef.current.style.cursor = 'ew-resize' },
    onEnd: () => { if (containerRef.current) containerRef.current.style.cursor = 'default' },
  })

  // The region is in absolute project beats because this ruler spans the whole
  // project, with the edited block positioned at blockStartBeat.
  const { startLoopDrag, startLoopMove, startLoopResize } = useLoopDrag({
    computeBeat: computeSnappedRulerBeat,
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
        // Multiplicative so a wheel notch feels like the same zoom ratio at
        // any row height; scroll up (negative deltaY) zooms in.
        const current = useUIStore.getState().midiRowHeight
        useUIStore.getState().setMidiRowHeight(current * Math.exp(-e.deltaY * 0.0015))
      }
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [])

  // When a zoom level changes, keep the vertically centered row at its exact y
  // and the playhead at its exact viewport x. Runs for any change - wheel zoom
  // and the toolbar's H/V sliders alike.
  // Layout effect so the scroll correction lands in the same frame as the
  // resize (no visible jump).
  useLayoutEffect(() => {
    const prev = prevZoomRef.current
    const sc = containerRef.current
    if (!sc) {
      prevZoomRef.current = { rowHeight, pixelsPerBeat, scrollLeft: prev.scrollLeft }
      return
    }
    if (prev.rowHeight !== rowHeight) {
      const centerRow = Math.floor((sc.scrollTop + sc.clientHeight / 2) / prev.rowHeight)
      const rowCenterViewportY = (centerRow + 0.5) * prev.rowHeight - sc.scrollTop
      sc.scrollTop = (centerRow + 0.5) * rowHeight - rowCenterViewportY
    }
    if (prev.pixelsPerBeat !== pixelsPerBeat) {
      sc.scrollLeft = scrollLeftAroundBeat(
        prev.scrollLeft,
        useTimeStore.getState().currentBeat,
        prev.pixelsPerBeat,
        pixelsPerBeat,
      )
    }
    prevZoomRef.current = { rowHeight, pixelsPerBeat, scrollLeft: sc.scrollLeft }
  }, [rowHeight, pixelsPerBeat])

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

  // Editor chrome voiced from the edited track's color (replaces the old
  // hardcoded indigo, so the editor visibly belongs to its block).
  const chrome = useMemo(() => midiEditorChrome(trackColor), [trackColor])

  // Rows holding a selected note light their gutter label up in the row color.
  // Computed from the live local notes so labels follow notes mid-drag.
  const selectedPitches = useMemo(() => {
    const pitches = new Set<number>()
    for (const n of allNotes) if (selectedNoteIds.has(n.id)) pitches.add(n.pitch)
    return pitches
  }, [allNotes, selectedNoteIds])

  // Loop ghosts: the pattern's repeats, dimmed and non-interactive, computed from
  // the live local notes so they track in-flight edits. repeat 0 is the authored
  // note itself and is skipped - except for split-shifted (negative-phase)
  // notes, whose folded position shows as a ghost because that is where they
  // play. Notes PAST the window don't loop at all (they play once, in place),
  // so they produce no ghosts.
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
      backgroundColor: chrome.marqueeFill,
      border: `1px solid ${chrome.marqueeEdge}`,
      pointerEvents: 'none' as const,
      zIndex: 10,
    }
  }, [dragState, chrome])

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
            backgroundColor: chrome.band,
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
          {rows.map((row, rowIndex) => (
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
                backgroundColor: rowIndex % 2 === 1 ? 'rgba(0,0,0,0.08)' : 'transparent',
                boxSizing: 'border-box',
                overflow: 'hidden',
              }}
            >
              <span
                style={{
                  fontSize: row.noteLabel ? 11 : 13,
                  // Selection feedback: rows holding a selected note light up
                  // in the row's color. Emphasized rows (octave anchors,
                  // flagship instrument rows) sit a step brighter than the
                  // rest, but stay neutral so color always means selection.
                  color: selectedPitches.has(row.pitch)
                    ? midiRowLabelColor(row.color)
                    : row.emphasized ? '#9a9aa3' : '#666666',
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
          {/* Full-height block resize handles stay below notes: where a note and
              block edge overlap, the note's move/resize gesture wins. Empty
              portions of the edge still resize the block. */}
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

          {/* Alternating row bands + dividers make neighboring MIDI lanes easy
              to track across the labels and time grid without adding visual weight. */}
          {rows.map((_, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                top: i * rowHeight,
                left: 0,
                right: 0,
                height: rowHeight,
                backgroundColor: i % 2 === 1 ? 'rgba(0,0,0,0.08)' : 'transparent',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                boxSizing: 'border-box',
                pointerEvents: 'none',
              }}
            />
          ))}

          {/* Midi block region: tint + edge lines. Painted ABOVE the row
              stripes so the track hue reads cleanly instead of being greyed
              by the stripe overlay (notes and ghosts still sit on top). */}
          <div
            style={{
              position: 'absolute',
              backgroundColor: chrome.regionTint,
              left: blockStartPx,
              width: blockWidthPx,
              top: 0,
              bottom: 0,
            }}
          />
          <div
            data-midi-block-region=""
            style={{
              position: 'absolute',
              borderLeft: `1px solid ${chrome.regionEdge}`,
              borderRight: `1px solid ${chrome.regionEdge}`,
              left: blockStartPx,
              width: blockWidthPx,
              top: 0,
              bottom: 0,
            }}
          />

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
                borderLeft: `1px dashed ${chrome.loopDash}`,
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
            const ghostLeft = Math.round(blockStartPx + beatToX(t.startBeat, pixelsPerBeat))
            const ghostRight = Math.round(blockStartPx + beatToX(t.startBeat + t.durationBeats, pixelsPerBeat))
            return (
              <div
                key={`${t.note.id}:${t.repeat}`}
                style={{
                  position: 'absolute',
                  left: ghostLeft,
                  top: rowIndexToY(rowIndex, rowHeight) + 2,
                  width: Math.max(ghostRight - ghostLeft, 8),
                  height: rowHeight - 4,
                  backgroundColor: midiNoteColor(row.color, t.note.velocity),
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
            // Pixel-snap the horizontal geometry: fractional lefts/widths
            // antialias the edges, and on the bright neon fills that soft
            // edge reads as blur. Snapping left and right independently
            // keeps rounding drift under half a pixel at any zoom. The 1px
            // trimmed off the right edge is the note separator - notes have
            // NO stroke (pure flat fills), so back-to-back notes on a row
            // read apart through the gap alone.
            const left = Math.round(blockStartPx + beatToX(note.startBeat, pixelsPerBeat))
            const right = Math.round(blockStartPx + beatToX(note.startBeat + note.durationBeats, pixelsPerBeat))
            const y = rowIndexToY(rowIndex, rowHeight) + 2
            const w = Math.max(right - left - 1, 8)
            const h = rowHeight - 4
            const isSelected = selectedNoteIds.has(note.id)
            // Selected notes (which includes every note mid-drag) and the
            // note being drawn read purely from the body: a lifted fill plus
            // the laser glow.
            const isLive = isSelected || note.id === drawingNote?.id
            const noteColor = midiNoteColor(row.color, note.velocity, isSelected)

            return (
              <div
                key={note.id}
                style={{
                  position: 'absolute',
                  left,
                  top: y,
                  width: w,
                  height: h,
                  backgroundColor: noteColor,
                  borderRadius: 3,
                  boxShadow: isLive
                    ? `0 0 14px ${noteColor}, 0 0 6px ${noteColor}`
                    : 'none',
                  cursor: 'inherit',
                  zIndex: isSelected ? 6 : 5,
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
