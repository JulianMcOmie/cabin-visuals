'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent as ReactScrollEvent } from 'react'
import { useUIStore } from '../../store/UIStore'
import { PLAYHEAD_TRIANGLE_HALF } from '../../constants'
import { computeRulerGrid } from '../rulerGrid'
import { midiEditorChrome, midiNoteColor, midiRowLabelColor } from '../../utils/midiEditorPalette'
import type { Block, LyricClip, Note } from '../../types'
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
  /** Text tracks: the track's lyric clips, drawn as a sections strip pinned
   *  under the ruler (absolute beats). Drag ↔ to move; double-click to edit
   *  the words in place. */
  lyricClips?: LyricClip[]
  onClipChange?: (clipId: string, updates: Partial<Omit<LyricClip, 'id'>>) => void
  /** Alt-drag: duplicate the clip in place, return the copy's id - the drag
   *  then moves the copy (same gesture the notes have). */
  onClipDuplicate?: (clipId: string) => string | null
  /** Click (without dragging) selects a clip - the host swaps its sidecar to
   *  the clip's editor. */
  onClipClick?: (clipId: string) => void
  activeClipId?: string | null
  /** Fires on any note press - the host follows the note's pitch back to its
   *  style lane, so touching a note anywhere re-focuses that row's editor. */
  onNoteSelect?: (note: Note) => void
  /** Marquee/group delete: remove these clips (Delete with clips selected). */
  onClipDelete?: (clipIds: string[]) => void
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
  lyricClips,
  onClipChange,
  onClipDuplicate,
  onClipClick,
  onClipDelete,
  activeClipId,
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
  // Lyric-clip strip: inline words editing + the horizontal move drag.
  const [clipEdit, setClipEdit] = useState<{ clipId: string; value: string } | null>(null)
  const clipDragRef = useRef<{ clipId: string; mode: 'move' | 'resize-l' | 'resize-r'; startX: number; startBeat: number; durationBeats: number; moved: boolean } | null>(null)
  // Clips selected by the notes' own marquee (they live on the same grid, so
  // one box selects both). Group note-drags carry them along; Delete removes
  // them together with the boxed notes.
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set())
  const clipGroupOriginsRef = useRef<Map<string, number> | null>(null)
  const prevDragTypeRef = useRef<string>('none')
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
  const vim = useMemo(() => ({
    active: vimOn,
    cursorBeat: vimApi.state.cursorBeat,
    cursorRow: vimApi.state.cursorRow,
    stepBeats: quantize,
    noteLengthBeats: vimApi.state.noteLengthBeats,
    staged: vimApi.state.staged,
    rowKeys: rowKeyLabels(rows, vimRegime, vimApi.state.anchorRow),
    ghosts: vimApi.draftGhosts,
    ghostKind: vimApi.state.draft?.kind ?? null,
    selection: vimApi.selectionSpanRows,
    pageStartBeat: Math.floor(vimApi.state.cursorBeat / (VIM_PAGE_BARS * beatsPerBar)) * VIM_PAGE_BARS * beatsPerBar,
    loopSlots: vimApi.state.loopSlots,
    accent: VIM_ACCENT,
    onCursorSet: vimApi.setCursorFromPointer,
  }), [vimOn, vimApi, quantize, rows, vimRegime, beatsPerBar])

  // One grid, one selection: while the notes' marquee runs, box the clip row
  // too; while a note GROUP drags, boxed clips ride the same beat delta.
  useEffect(() => {
    const prev = prevDragTypeRef.current
    prevDragTypeRef.current = dragState.type
    if (!lyricClips) return
    const clipRowIndex = rows.findIndex((r) => r.clipRow)
    if (dragState.type === 'marquee') {
      const x0 = Math.min(dragState.startX, dragState.currentX)
      const x1 = Math.max(dragState.startX, dragState.currentX)
      const y0 = Math.min(dragState.startY, dragState.currentY)
      const y1 = Math.max(dragState.startY, dragState.currentY)
      const rowTop = clipRowIndex >= 0 ? rowIndexToY(clipRowIndex, rowHeight) : -1
      const next = new Set<string>()
      if (clipRowIndex >= 0 && y1 >= rowTop && y0 <= rowTop + rowHeight) {
        for (const c of lyricClips) {
          const l = beatToX(c.startBeat, pixelsPerBeat)
          const r = beatToX(c.startBeat + c.durationBeats, pixelsPerBeat)
          if (r >= x0 && l <= x1) next.add(c.id)
        }
      }
      setSelectedClipIds((cur) => {
        if (cur.size === next.size && [...cur].every((id) => next.has(id))) return cur
        return next
      })
    } else if (dragState.type === 'moving' && onClipChange && selectedClipIds.size > 0) {
      if (prev !== 'moving' || !clipGroupOriginsRef.current) {
        clipGroupOriginsRef.current = new Map(
          lyricClips.filter((c) => selectedClipIds.has(c.id)).map((c) => [c.id, c.startBeat]),
        )
      }
      const delta = (dragState.currentX - dragState.startX) / pixelsPerBeat
      const snap = (b: number) => (quantize > 0 ? Math.round(b / quantize) * quantize : b)
      for (const [id, s0] of clipGroupOriginsRef.current) {
        onClipChange(id, { startBeat: Math.max(0, snap(s0 + delta)) })
      }
    } else if (dragState.type === 'none') {
      clipGroupOriginsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragState, lyricClips, rows, rowHeight, pixelsPerBeat, quantize])

  // Delete removes boxed clips together with the boxed notes (the notes' own
  // key handler runs independently on the same press).
  useEffect(() => {
    if (!onClipDelete) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (selectedClipIds.size === 0) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      onClipDelete([...selectedClipIds])
      setSelectedClipIds(new Set())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedClipIds, onClipDelete])


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
          {rows.map((row, rowIndex) => {
            const isLane = row.laneIndex !== undefined && !!onLaneRowClick
            const laneActive = isLane && row.laneIndex === activeLaneIndex
            // In vim the gutter teaches its own key map: each row shows the
            // letter that writes it. It takes the note-name slot, because while
            // you're typing that IS the more useful name for the row - and it's
            // the only way an arbitrary row vocabulary can explain itself.
            const vimKey = vimOn ? vim.rowKeys.get(rowIndex) : undefined
            const onCursorRow = vimOn && rowIndex === vim.cursorRow
            return (
            <div
              key={row.pitch}
              title={row.noteLabel ? `${row.label} (${row.noteLabel})` : isLane ? `${row.label} - click to edit this style lane` : row.label}
              onClick={isLane ? () => onLaneRowClick!(row.laneIndex!) : undefined}
              role={isLane ? 'button' : undefined}
              aria-pressed={isLane ? laneActive : undefined}
              style={{
                height: rowHeight,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 4,
                paddingLeft: 6,
                paddingRight: 8,
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                backgroundColor: onCursorRow
                  ? 'rgba(255,255,255,0.07)'
                  : laneActive
                  ? 'rgba(255,255,255,0.09)'
                  : rowIndex % 2 === 1 ? 'rgba(0,0,0,0.08)' : 'transparent',
                boxSizing: 'border-box',
                overflow: 'hidden',
                cursor: isLane ? 'pointer' : undefined,
              }}
            >
              <span
                style={{
                  // A style-lane row IS its style preview: the lane's own
                  // face, color and (clamped) size - what you read here is
                  // what a note at this height wears.
                  fontSize: row.sizeScale !== undefined
                    ? Math.min(rowHeight - 6, Math.max(9, 10 + row.sizeScale * 3.5))
                    : row.noteLabel ? 11 : 13,
                  fontFamily: row.fontFamily,
                  // Selection feedback: rows holding a selected note light up
                  // in the row's color. Emphasized rows (octave anchors,
                  // flagship instrument rows) sit a step brighter than the
                  // rest, but stay neutral so color always means selection.
                  color: row.laneIndex !== undefined
                    ? row.color
                    : selectedPitches.has(row.pitch)
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
              {vimKey ? (
                <span
                  style={{
                    fontSize: 9,
                    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                    lineHeight: '13px',
                    minWidth: 13,
                    textAlign: 'center',
                    borderRadius: 3,
                    padding: '0 3px',
                    flexShrink: 0,
                    color: onCursorRow ? '#0b0d12' : 'rgba(255,255,255,0.55)',
                    backgroundColor: onCursorRow ? vim.accent : 'rgba(255,255,255,0.09)',
                  }}
                >
                  {vimKey}
                </span>
              ) : row.noteLabel && (
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
            )
          })}
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

          {/* Lyric clips (text tracks): the clip row is a real row - standard
              height, striping and gutter - and the clips are note-style rects
              on it with the note gestures that make sense for them: drag to
              move, edges to resize, click to select, double-click to edit. */}
          {lyricClips && (() => {
            const clipRowIndex = rows.findIndex((r) => r.clipRow)
            if (clipRowIndex < 0) return null
            const y = rowIndexToY(clipRowIndex, rowHeight) + 2
            const h = rowHeight - 4
            const EDGE = 8
            return [...lyricClips].sort((a, b) => a.startBeat - b.startBeat).map((clip) => {
              const left = Math.round(beatToX(clip.startBeat, pixelsPerBeat))
              const right = Math.round(beatToX(clip.startBeat + clip.durationBeats, pixelsPerBeat))
              const w = Math.max(right - left - 1, 16)
              const editing = clipEdit?.clipId === clip.id
              const active = clip.id === activeClipId || selectedClipIds.has(clip.id)
              const snap = (b: number) => (quantize > 0 ? Math.round(b / quantize) * quantize : b)
              return (
                <div
                  key={clip.id}
                  title={editing ? undefined : `${clip.words.join(' ')} - drag to move, edges resize, double-click to edit`}
                  onPointerDown={onClipChange && !editing ? (e) => {
                    e.stopPropagation()
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    const inLeft = e.clientX - rect.left < EDGE
                    const inRight = rect.right - e.clientX < EDGE
                    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* synthetic */ }
                    // Alt-drag = duplicate in place and drag the COPY, same as
                    // the notes' alt-drag. The captured element stays the
                    // original; the copy renders beside it and follows the
                    // store updates the move streams out.
                    let dragClipId = clip.id
                    if (e.altKey && onClipDuplicate && !inLeft && !inRight) {
                      dragClipId = onClipDuplicate(clip.id) ?? clip.id
                    }
                    clipDragRef.current = {
                      clipId: dragClipId,
                      mode: inLeft ? 'resize-l' : inRight ? 'resize-r' : 'move',
                      startX: e.clientX,
                      startBeat: clip.startBeat,
                      durationBeats: clip.durationBeats,
                      moved: false,
                    }
                  } : undefined}
                  onPointerMove={onClipChange && !editing ? (e) => {
                    const d = clipDragRef.current
                    if (!d) {
                      // Hover affordance: the cursor says which gesture this x means.
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      const el = e.currentTarget as HTMLElement
                      el.style.cursor = e.clientX - rect.left < EDGE || rect.right - e.clientX < EDGE ? 'ew-resize' : 'grab'
                      return
                    }
                    // The drag record owns the gesture (it may be moving an
                    // alt-copy while THIS element keeps the pointer capture).
                    const dBeats = (e.clientX - d.startX) / pixelsPerBeat
                    if (d.mode === 'move') {
                      const next = Math.max(0, snap(d.startBeat + dBeats))
                      d.moved = d.moved || next !== d.startBeat
                      onClipChange(d.clipId, { startBeat: next })
                    } else if (d.mode === 'resize-l') {
                      const nextStart = Math.max(0, Math.min(snap(d.startBeat + dBeats), d.startBeat + d.durationBeats - Math.max(quantize, 0.25)))
                      d.moved = d.moved || nextStart !== d.startBeat
                      onClipChange(d.clipId, { startBeat: nextStart, durationBeats: d.startBeat + d.durationBeats - nextStart })
                    } else {
                      const nextDur = Math.max(Math.max(quantize, 0.25), snap(d.durationBeats + dBeats))
                      d.moved = d.moved || nextDur !== d.durationBeats
                      onClipChange(d.clipId, { durationBeats: nextDur })
                    }
                  } : undefined}
                  onPointerUp={() => {
                    const d = clipDragRef.current
                    clipDragRef.current = null
                    if (d && !d.moved && onClipClick) onClipClick(d.clipId)
                  }}
                  onDoubleClick={onClipChange ? (e) => { e.stopPropagation(); setClipEdit({ clipId: clip.id, value: clip.words.join(' ') }) } : undefined}
                  style={{
                    position: 'absolute',
                    left,
                    top: y,
                    width: w,
                    height: h,
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 6px',
                    borderRadius: 3,
                    backgroundColor: active ? `${trackColor}3d` : `${trackColor}1c`,
                    border: `1px solid ${active ? trackColor : `${trackColor}66`}`,
                    color: active ? '#ffffff' : `${trackColor}e6`,
                    fontSize: Math.min(11, h - 6),
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    zIndex: 6,
                  }}
                >
                  {editing ? (
                    <input
                      autoFocus
                      value={clipEdit.value}
                      onChange={(e) => setClipEdit({ clipId: clip.id, value: e.target.value })}
                      onBlur={() => { onClipChange?.(clip.id, { words: clipEdit.value.split(/\s+/).filter(Boolean) }); setClipEdit(null) }}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === 'Enter') { onClipChange?.(clip.id, { words: clipEdit.value.split(/\s+/).filter(Boolean) }); setClipEdit(null) }
                        if (e.key === 'Escape') setClipEdit(null)
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      aria-label="Clip words"
                      style={{ position: 'absolute', inset: 0, width: '100%', background: 'rgba(10,12,16,0.95)', color: '#fff', border: `1px solid ${trackColor}`, borderRadius: 3, fontSize: 11, padding: '0 5px', outline: 'none' }}
                    />
                  ) : clip.words.join(' ')}
                </div>
              )
            })
          })()}
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
                onPointerDown={(e) => { onNoteSelect?.(note); handleNotePointerDown(e, note) }}
                onPointerMove={handleNotePointerMove}
                onPointerOut={() => handleHoverChange(null)}
                onDoubleClick={onNoteWordEdit && noteWords ? (e) => { e.stopPropagation(); setWordEdit({ noteId: note.id, value: noteWords[note.id] === '∅' ? '' : (noteWords[note.id] ?? '') }) } : undefined}
              >
                {noteWords && wordEdit?.noteId !== note.id && (
                  <span
                    style={{
                      position: 'absolute',
                      inset: '0 3px',
                      display: 'flex',
                      alignItems: 'center',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      fontSize: Math.min(11, h - 4),
                      fontWeight: 700,
                      color: noteWords[note.id] === '∅' ? '#f0a0a0' : 'rgba(10,12,16,0.9)',
                      pointerEvents: 'none',
                    }}
                  >{noteWords[note.id] ?? ''}</span>
                )}
                {wordEdit?.noteId === note.id && (
                  <input
                    autoFocus
                    value={wordEdit.value}
                    onChange={(e) => setWordEdit({ noteId: note.id, value: e.target.value })}
                    onBlur={() => { onNoteWordEdit?.(note.id, wordEdit.value); setWordEdit(null) }}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') { onNoteWordEdit?.(note.id, wordEdit.value); setWordEdit(null) }
                      if (e.key === 'Escape') setWordEdit(null)
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    aria-label="Word"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      background: 'rgba(10,12,16,0.92)',
                      color: '#fff',
                      border: '1px solid rgba(255,255,255,0.6)',
                      borderRadius: 3,
                      fontSize: 11,
                      padding: '0 3px',
                      outline: 'none',
                    }}
                  />
                )}
              </div>
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
