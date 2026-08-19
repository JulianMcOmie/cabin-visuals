'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent as ReactScrollEvent } from 'react'
import { useUIStore } from '../../store/UIStore'
import { PLAYHEAD_TRIANGLE_HALF } from '../../constants'
import { computeRulerGrid } from '../rulerGrid'
import { midiEditorChrome, midiNoteColor } from '../../utils/midiEditorPalette'
import type { Block, Note } from '../../types'
import { LoopGhosts, NoteRect, RowLabels, RowStripes } from './rollParts'
import { useNoteGestures } from './useNoteGestures'
import { useMidiBlockGestures } from './useMidiBlockGestures'
import { loopLengthBeats, tileLoopNotes } from '../../core/visual/noteFlatten'
import { usePlayhead } from '../../hooks/usePlayhead'
import { useScrub } from '../../hooks/useScrub'
import { useLoopDrag } from '../../hooks/useLoopDrag'
import { Ruler } from '../Ruler'
import { xToBeat, beatToX, rowIndexToY } from './coords'
import { startEdgeResize } from '../../utils/edgeResize'
import { useMidiVim } from './vim/useMidiVim'
import { rowKeyLabels } from './vim/keyMap'
import { VIM_ACCENT, VIM_PAGE_BARS, type VimKeyRegime } from './vim/types'
import { VimKeySheet, VimStatusLine } from './vim/VimStatusLine'
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
  /** Text tracks: the word each note sings (noteId → word). Painted on the
   *  note body; '∅' marks an orphan (no clip word under the note). */
  noteWords?: Record<string, string>
  /** Text tracks: rewrite ONE note's word in place (double-click a note).
   *  Writes through to the lyric clip that owns the slot. */
  onNoteWordEdit?: (noteId: string, word: string) => void
  /** Style-lane rows only (row.laneIndex set): clicking the row's gutter label
   *  opens the lane's style editor (the host renders the sidecar). */
  onLaneRowClick?: (laneIndex: number) => void
  /** The lane whose sidecar is open - its gutter row reads as pressed. */
  activeLaneIndex?: number | null
  /** Fires on any note press - the host follows the note's pitch back to its
   *  style lane, so touching a note anywhere re-focuses that row's editor. */
  onNoteSelect?: (note: Note) => void
  /** midi vim: the roll's modal keyboard editor. Off, the grid behaves exactly
   *  as it did before the mode existed. See ./vim. */
  vimEnabled?: boolean
  onVimEnabledChange?: (on: boolean) => void
  /** How the note keys land on these rows — see VimKeyRegime. */
  vimRegime?: VimKeyRegime
  /** vim's `[` / `]` drive the roll's OWN grid rather than shadowing it. */
  onQuantizeChange?: (beats: number) => void
}

// The label gutter width lives in UIStore (midiLabelWidth) - drag its right edge to resize.
const RULER_HEIGHT = 40
const CANVAS_RIGHT_PADDING = 20
// Scroll room under the last row, so the bottom note isn't pinned to the bottom
// edge of the pane. A spacer BELOW the canvas rather than height on it: the grid
// element is the coordinate space every gesture measures against, so padding it
// would put pointer-reachable pixels past the last row.
const CANVAS_BOTTOM_PADDING = 96

export function MidiEditor({
  rows,
  notes,
  trackId,
  trackColor,
  block,
  noteWords,
  onNoteWordEdit,
  onLaneRowClick,
  activeLaneIndex,
  onNoteSelect,
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
  vimEnabled = false,
  onVimEnabledChange,
  vimRegime = 'chromatic',
  onQuantizeChange,
}: MidiEditorProps) {
  // Inline word editing (text tracks): which note is being retyped.
  const [wordEdit, setWordEdit] = useState<{ noteId: string; value: string } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const dragGuideRef = useRef<HTMLDivElement>(null)
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
    setSelectedNoteIds,
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
    dragGuideRef,
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

  // midi vim rides on top of all of it: it owns a cursor and a region, and
  // writes through the very same `onCommit` the mouse gestures use, so an
  // op is one store write and therefore one undo step.
  const vimApi = useMidiVim({
    enabled: vimEnabled,
    setEnabled: (on) => onVimEnabledChange?.(on),
    rows,
    regime: vimRegime,
    notes,
    trackId,
    block,
    blockStartBeat,
    blockDurationBeats,
    beatsPerBar,
    stepBeats: quantize,
    totalBeats: initialTotalBeats,
    commit: onCommit,
    setQuantize: (beats) => onQuantizeChange?.(beats),
    setSelectedNoteIds,
  })
  const vimOn = vimEnabled && rows.length > 0
  // The gutter's key map, memoized on its own so the (memoized) label column
  // keeps its identity across the per-render `vim` object below - null while
  // the mode is off, which is also what tells RowLabels to draw note names.
  const vimAnchorRow = vimApi.state.anchorRow
  const vimRowKeys = useMemo(
    () => (vimOn ? rowKeyLabels(rows, vimRegime, vimAnchorRow) : null),
    [vimOn, rows, vimRegime, vimAnchorRow],
  )
  const vim = useMemo(() => ({
    active: vimOn,
    cursorBeat: vimApi.state.cursorBeat,
    cursorRow: vimApi.state.cursorRow,
    stepBeats: quantize,
    noteLengthBeats: vimApi.state.noteLengthBeats,
    staged: vimApi.state.staged,
    ghosts: vimApi.draftGhosts,
    ghostKind: vimApi.state.draft?.kind ?? null,
    selection: vimApi.selectionSpanRows,
    pageStartBeat: Math.floor(vimApi.state.cursorBeat / (VIM_PAGE_BARS * beatsPerBar)) * VIM_PAGE_BARS * beatsPerBar,
    loopSlots: vimApi.state.loopSlots,
    accent: VIM_ACCENT,
    onCursorSet: vimApi.setCursorFromPointer,
  }), [vimOn, vimApi, quantize, beatsPerBar])

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

  // All notes including the one being drawn (memoized so it keeps identity
  // while nothing changed - the loop-ghost memo below keys on it).
  const allNotes = useMemo(() => (drawingNote ? [...notes, drawingNote] : notes), [notes, drawingNote])

  // Editor chrome voiced from the edited track's color (replaces the old
  // hardcoded indigo, so the editor visibly belongs to its block).
  const chrome = useMemo(() => midiEditorChrome(trackColor), [trackColor])

  // Rows holding a selected note light their gutter label up in the row color.
  // Computed from the live local notes so labels follow notes mid-drag - as a
  // sorted STRING, so the memoized label column only re-renders when the set of
  // lit rows actually changes, not on every drag frame that recomputes it.
  const selectedPitchKey = useMemo(() => {
    const pitches = new Set<number>()
    for (const n of allNotes) if (selectedNoteIds.has(n.id)) pitches.add(n.pitch)
    return Array.from(pitches).sort((a, b) => a - b).join(',')
  }, [allNotes, selectedNoteIds])

  // Per-note and per-row callbacks handed to the memoized NoteRect / RowLabels.
  // They must be referentially stable across drag frames (or the memo is moot),
  // so each reads whatever it needs from this ref, refreshed every render, and
  // notes are looked up by id rather than closed over.
  const notesById = useMemo(() => new Map(allNotes.map((n) => [n.id, n])), [allNotes])
  const partsLatest = useRef({ notesById, onNoteSelect, handleNotePointerDown, handleHoverChange, onNoteWordEdit, onLaneRowClick })
  partsLatest.current = { notesById, onNoteSelect, handleNotePointerDown, handleHoverChange, onNoteWordEdit, onLaneRowClick }
  const onNoteRectPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, noteId: string) => {
    const l = partsLatest.current
    const note = l.notesById.get(noteId)
    if (!note) return
    l.onNoteSelect?.(note)
    l.handleNotePointerDown(e, note)
  }, [])
  const onNoteRectPointerOut = useCallback(() => { partsLatest.current.handleHoverChange(null) }, [])
  const onWordEditStart = useCallback((noteId: string, value: string) => { setWordEdit({ noteId, value }) }, [])
  const onWordEditChange = useCallback((noteId: string, value: string) => { setWordEdit({ noteId, value }) }, [])
  const onWordEditCommit = useCallback((noteId: string, value: string) => {
    partsLatest.current.onNoteWordEdit?.(noteId, value)
    setWordEdit(null)
  }, [])
  const onWordEditCancel = useCallback(() => { setWordEdit(null) }, [])
  const onLaneRowClickStable = useCallback((laneIndex: number) => { partsLatest.current.onLaneRowClick?.(laneIndex) }, [])

  // Loop ghosts: the pattern's repeats, dimmed and non-interactive, computed from
  // the live local notes so they track in-flight edits. repeat 0 is the authored
  // note itself and is skipped - except for split-shifted (negative-phase)
  // notes, whose folded position shows as a ghost because that is where they
  // play. Notes PAST the window don't loop at all (they play once, in place),
  // so they produce no ghosts.
  const loopBeats = useMemo(
    () => (block.loop ? loopLengthBeats({ loopLengthBars: block.loopLengthBars, notes: allNotes }, beatsPerBar) : null),
    [block.loop, block.loopLengthBars, allNotes, beatsPerBar],
  )
  // Memoized: up to 2000 ghost objects, and this component re-renders on
  // every note-drag pointermove (allNotes changes then, so it recomputes
  // exactly when the ghosts can actually move - and not for selection,
  // hover, scroll or playhead re-renders).
  const loopGhosts = useMemo(
    () => (loopBeats != null && loopBeats > 0 && loopBeats < blockDurationBeats
      ? tileLoopNotes(allNotes, loopBeats, blockDurationBeats, 2000)
          .filter((t) => t.repeat > 0 || t.startBeat !== t.note.startBeat)
      : []),
    [allNotes, loopBeats, blockDurationBeats],
  )
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
        loopFill={chrome.loopBand}
        loopEdge={chrome.loopBandEdge}
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
          <RowLabels
            rows={rows}
            rowHeight={rowHeight}
            selectedPitchKey={selectedPitchKey}
            laneRowsClickable={!!onLaneRowClick}
            activeLaneIndex={activeLaneIndex}
            onLaneRowClick={onLaneRowClickStable}
            vimRowKeys={vimRowKeys}
            vimCursorRow={vimOn ? vim.cursorRow : -1}
            vimAccent={vim.accent}
          />
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
          onPointerDown={(e) => {
            // In vim a left click on the grid also parks the cursor there, so
            // the mouse and the keyboard address the same place. The marquee
            // still runs underneath it.
            if (vimOn && e.button === 0 && gridRef.current) {
              const rect = gridRef.current.getBoundingClientRect()
              const beat = xToBeat(e.clientX - rect.left, pixelsPerBeat)
              const rowIndex = Math.floor((e.clientY - rect.top) / rowHeight)
              const step = vim.stepBeats
              vim.onCursorSet(Math.max(0, Math.round(beat / step) * step), rowIndex)
            }
            handleBackgroundPointerDown(e)
          }}
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
          <RowStripes count={rows.length} rowHeight={rowHeight} />

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
          <LoopGhosts
            ghosts={loopGhosts}
            rows={rows}
            pitchToRowIndex={pitchToRowIndex}
            blockStartPx={blockStartPx}
            pixelsPerBeat={pixelsPerBeat}
            rowHeight={rowHeight}
          />

          {/* Drag ghosts: the footprint each dragged note LEFT. Read from the
              gesture's captured origins, which are frozen for the whole drag,
              so the ghost stays put while the live notes move and the
              displacement stays readable. The note's own fill, just
              transparent, so it reads as the same note left behind. Drawn
              before the notes so the real ones always sit on top. */}
          {(dragState.type === 'moving' || dragState.type === 'resizing' || dragState.type === 'resizing-left') &&
            dragState.originalStartBeats && [...dragState.originalStartBeats].map(([noteId, startBeat]) => {
              // A move captures pitches, a resize captures durations; whichever
              // the gesture leaves untouched is invariant, so the live note is
              // the honest source for it.
              const live = allNotes.find((n) => n.id === noteId)
              const pitch = dragState.originalPitches?.get(noteId) ?? live?.pitch
              const durationBeats = dragState.originalDurations?.get(noteId) ?? live?.durationBeats
              if (pitch === undefined || durationBeats === undefined) return null
              const rowIndex = pitchToRowIndex(pitch)
              if (rowIndex === -1) return null
              const ghostColor = midiNoteColor(rows[rowIndex].color, live?.velocity ?? 100)
              const left = Math.round(blockStartPx + beatToX(startBeat, pixelsPerBeat))
              const right = Math.round(blockStartPx + beatToX(startBeat + durationBeats, pixelsPerBeat))
              return (
                <div
                  key={`drag-ghost-${noteId}`}
                  style={{
                    position: 'absolute',
                    left,
                    top: rowIndexToY(rowIndex, rowHeight) + 2,
                    width: Math.max(right - left - 1, 8),
                    height: rowHeight - 4,
                    borderRadius: 3,
                    backgroundColor: ghostColor,
                    opacity: 0.55,
                    pointerEvents: 'none',
                    zIndex: 4,
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
              <NoteRect
                key={note.id}
                noteId={note.id}
                left={left}
                top={y}
                width={w}
                height={h}
                color={noteColor}
                isSelected={isSelected}
                isLive={isLive}
                word={noteWords ? (noteWords[note.id] ?? '') : undefined}
                wordEditable={!!(onNoteWordEdit && noteWords)}
                editValue={wordEdit?.noteId === note.id ? wordEdit.value : null}
                onPointerDown={onNoteRectPointerDown}
                onPointerMove={handleNotePointerMove}
                onPointerOut={onNoteRectPointerOut}
                onWordEditStart={onWordEditStart}
                onWordEditChange={onWordEditChange}
                onWordEditCommit={onWordEditCommit}
                onWordEditCancel={onWordEditCancel}
              />
            )
          })}

          {/* Marquee overlay */}
          {marqueeStyle && <div style={marqueeStyle} />}

          {/* --- midi vim ------------------------------------------------
              Drawn above the notes because every one of these is about where
              you are ABOUT to write, which has to stay readable over whatever
              is already there. */}
          {vimOn && vim.selection && vim.selection.rows.flatMap((rowIndex) =>
            vim.selection!.spans.map((span, spanIndex) => {
              const left = Math.round(beatToX(span.startBeat, pixelsPerBeat))
              const right = Math.round(beatToX(span.endBeat, pixelsPerBeat))
              return (
                <div
                  key={`vim-sel-${rowIndex}-${spanIndex}`}
                  style={{
                    position: 'absolute',
                    left,
                    top: rowIndexToY(rowIndex, rowHeight),
                    width: Math.max(right - left, 2),
                    height: rowHeight,
                    backgroundColor: `${vim.accent}22`,
                    borderTop: `1px solid ${vim.accent}55`,
                    borderBottom: `1px solid ${vim.accent}55`,
                    pointerEvents: 'none',
                    zIndex: 9,
                  }}
                />
              )
            }),
          )}

          {/* A move/copy in flight: where the notes WOULD land. */}
          {vimOn && vim.ghosts.map((ghost) => {
            const rowIndex = pitchToRowIndex(ghost.pitch)
            if (rowIndex === -1) return null
            const left = Math.round(blockStartPx + beatToX(ghost.startBeat, pixelsPerBeat))
            const right = Math.round(blockStartPx + beatToX(ghost.startBeat + ghost.durationBeats, pixelsPerBeat))
            return (
              <div
                key={`vim-ghost-${ghost.id}`}
                style={{
                  position: 'absolute',
                  left,
                  top: rowIndexToY(rowIndex, rowHeight) + 2,
                  width: Math.max(right - left - 1, 8),
                  height: rowHeight - 4,
                  borderRadius: 3,
                  border: `1px dashed ${vim.accent}`,
                  backgroundColor: `${vim.accent}${vim.ghostKind === 'copy' ? '33' : '55'}`,
                  pointerEvents: 'none',
                  zIndex: 11,
                }}
              />
            )
          })}

          {/* Staged chord notes: outlined, because they are not notes yet. */}
          {vimOn && vim.staged.map((rowIndex) => {
            const left = Math.round(beatToX(vim.cursorBeat, pixelsPerBeat))
            const right = Math.round(beatToX(vim.cursorBeat + vim.noteLengthBeats, pixelsPerBeat))
            return (
              <div
                key={`vim-staged-${rowIndex}`}
                style={{
                  position: 'absolute',
                  left,
                  top: rowIndexToY(rowIndex, rowHeight) + 2,
                  width: Math.max(right - left - 1, 8),
                  height: rowHeight - 4,
                  borderRadius: 3,
                  border: `1px dashed ${vim.accent}`,
                  backgroundColor: `${vim.accent}22`,
                  pointerEvents: 'none',
                  zIndex: 12,
                }}
              />
            )
          })}

          {/* The page strip: the four bars the 1-4 keys address, numbered, with
              the looped ones (Shift+1-4) lit. Without it the digits are an
              invisible coordinate system - this is what makes them findable. */}
          {vimOn && Array.from({ length: VIM_PAGE_BARS }, (_, i) => {
            const slot = i + 1
            const startBeat = vim.pageStartBeat + i * beatsPerBar
            const left = Math.round(beatToX(startBeat, pixelsPerBeat))
            const right = Math.round(beatToX(startBeat + beatsPerBar, pixelsPerBeat))
            const looped = vim.loopSlots.includes(slot)
            const onCursor = vim.cursorBeat >= startBeat && vim.cursorBeat < startBeat + beatsPerBar
            return (
              <div
                key={`vim-page-${slot}`}
                style={{
                  position: 'absolute',
                  left,
                  top: 0,
                  width: Math.max(right - left - 1, 8),
                  height: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 8,
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                  lineHeight: '12px',
                  color: looped ? '#0b0d12' : onCursor ? vim.accent : `${vim.accent}88`,
                  backgroundColor: looped ? vim.accent : onCursor ? `${vim.accent}2e` : `${vim.accent}12`,
                  borderRight: `1px solid ${vim.accent}33`,
                  pointerEvents: 'none',
                  zIndex: 13,
                }}
              >
                {slot}
              </div>
            )
          })}

          {/* The cursor: a cell one grid-step wide, plus a full-height column
              line so its beat stays findable when the row is off screen. */}
          {vimOn && (() => {
            const left = Math.round(beatToX(vim.cursorBeat, pixelsPerBeat))
            const stepPx = Math.max(2, Math.round(vim.stepBeats * pixelsPerBeat))
            const lenPx = Math.max(2, Math.round(vim.noteLengthBeats * pixelsPerBeat))
            return (
              <>
                <div
                  style={{
                    position: 'absolute',
                    left,
                    top: 0,
                    bottom: 0,
                    width: stepPx,
                    backgroundColor: `${vim.accent}12`,
                    borderLeft: `1px solid ${vim.accent}66`,
                    pointerEvents: 'none',
                    zIndex: 13,
                  }}
                />
                {/* The note that would land here: the step is where the cursor
                    goes next, the length is what it would write - two different
                    sizes, so the cursor shows both. */}
                <div
                  style={{
                    position: 'absolute',
                    left,
                    top: rowIndexToY(vim.cursorRow, rowHeight) + 1,
                    width: lenPx,
                    height: rowHeight - 2,
                    borderRadius: 3,
                    border: `1.5px solid ${vim.accent}`,
                    backgroundColor: `${vim.accent}26`,
                    boxShadow: `0 0 10px ${vim.accent}66`,
                    pointerEvents: 'none',
                    zIndex: 14,
                  }}
                />
              </>
            )
          })()}

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
      {/* Transparent, and inert to the pointer so a press here still reaches the
          scroll container's marquee handler like the empty space below a short
          row list does. */}
      <div style={{ height: CANVAS_BOTTOM_PADDING, pointerEvents: 'none' }} />
      </div>

      {/* Note drag alignment guide - the timeline's block-drag hairline,
          mirrored for note gestures. Positioned imperatively from the grabbed
          note's snapped edge; this root begins at the ruler and ends at the
          bottom of the pane, so the hairline spans the whole editor. */}
      <div
        ref={dragGuideRef}
        data-midi-note-drag-guide=""
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 bottom-0 z-[45]"
        style={{ visibility: 'hidden', width: 0, willChange: 'transform' }}
      >
        <div className="absolute top-0 bottom-0 w-px bg-white/60" style={{ left: -0.5 }} />
      </div>

      {/* The readout sits under the grid, flush with it - it belongs to the
          cursor, not to the panel's toolbar. */}
      {vimOn && (
        <VimStatusLine
          state={vimApi.state}
          rows={rows}
          beatsPerBar={beatsPerBar}
          stepBeats={quantize}
          selectedCount={vimApi.selectedCount}
          accent={VIM_ACCENT}
          onExit={() => onVimEnabledChange?.(false)}
        />
      )}
      {vimOn && vimApi.state.showSheet && (
        <VimKeySheet accent={VIM_ACCENT} onClose={() => vimApi.closeSheet()} />
      )}
    </div>
  )
}
