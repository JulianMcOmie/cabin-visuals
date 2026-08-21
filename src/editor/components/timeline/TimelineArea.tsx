'use client'

import { useCallback, useMemo, useRef, useState, useEffect, useLayoutEffect, type UIEvent as ReactScrollEvent, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { Plus } from 'lucide-react'
import { MAX_TOTAL_BARS, MIN_TOTAL_BARS, resolveNextTrackColor, useProjectStore } from '../../store/ProjectStore'
import { seedSceneBindings } from '../../core/directors/sceneBindings'
import { useUIStore } from '../../store/UIStore'
import { useTimeStore } from '../../store/TimeStore'
import { Track } from './Track'
import { TrackContextMenu } from './TrackContextMenu'
import { TimelineRuler } from './TimelineRuler'
import { EmptySceneActions } from './EmptySceneActions'
import { LoadingCabin } from '../../../components/LoadingScreen'
import { usePlayhead } from '../../hooks/usePlayhead'
import { useScrub } from '../../hooks/useScrub'
import { useLoopDrag, type LoopDragGuide } from '../../hooks/useLoopDrag'
import { useTrackGestures } from './useTrackGestures'
import { useTrackCopyDrag } from './useTrackCopyDrag'
import { useTrackNestDrag } from './useTrackNestDrag'
import { flattenVisualRows, rowGuidesOf } from './trackTree'
import { rowIndentPx } from './trackDrop'
import { deselectTrack, selectNewTrack } from '../../utils/selection'
import { startEdgeResize } from '../../utils/edgeResize'
import {
  LOOP_REGION_DISABLED_COLOR,
  LOOP_REGION_ENABLED_COLOR,
  PLAYHEAD_TRIANGLE_HALF,
} from '../../constants'
import { computeRulerGrid } from '../rulerGrid'
import { updateMidiActivityAtBeat } from './midiActivityRegistry'
import { scrollLeftAroundBeat } from '../../utils/zoomAroundBeat'
import { audioPickupBars } from '../../utils/audioPickup'
import { isSceneTrackId } from '../../core/sceneTrack'

const MIN_OUTSIDE_PROJECT_BARS = 8
const OUTSIDE_PROJECT_OVERSCAN_BARS = 2

/** Keep a useful amount of timeline visible beyond the playback/export range.
 *  The dimmed area spans at least one complete lane viewport plus a small
 *  overscan, so it still fills the screen when the project edge is at the left. */
function timelineDisplayBars(totalBars: number, barWidthPx: number, viewportWidthPx: number) {
  if (barWidthPx <= 0) return totalBars
  const viewportBars = Math.max(1, Math.ceil(viewportWidthPx / barWidthPx))
  const outsideBars = Math.max(MIN_OUTSIDE_PROJECT_BARS, viewportBars + OUTSIDE_PROJECT_OVERSCAN_BARS)
  return Math.ceil(totalBars) + outsideBars
}

export function TimelineArea() {
  const tracks = useProjectStore((s) => s.tracks)
  const rootTrackIds = useProjectStore((s) => s.rootTrackIds)
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)
  const totalBars = useProjectStore((s) => s.totalBars)
  // Primitive, never the scenes record - this is a whole-timeline subscriber
  // and the record's identity changes on every edit (see components/CLAUDE.md).
  // Only the empty scene's first action reads it, to name what it will add.
  const activeSceneIsMain = useProjectStore((s) => !!s.scenes[s.activeSceneId]?.isMain)
  const activeSceneId = useProjectStore((s) => s.activeSceneId)
  const pixelsPerBeat = useUIStore((s) => s.tracksPixelsPerBeat)
  const labelWidth = useUIStore((s) => s.tracksLabelWidth)
  const rowHeight = useUIStore((s) => s.tracksRowHeight)
  const loopDragging = useUIStore((s) => !!s.loopDrag)
  const documentLoading = useUIStore((s) => s.documentLoading)
  const maxBeat = totalBars * beatsPerBar
  const barWidthPx = beatsPerBar * pixelsPerBeat
  const projectWidthPx = totalBars * barWidthPx
  // The pickup: audio dragged before bar 0 extends the timeline LEFT. Musical
  // beat 0 sits pickupPx into the content; every beat-positioned layer below
  // offsets by it (the lanes and ruler each shift through one wrapper).
  const pickupBars = useProjectStore((s) => audioPickupBars(s.tracks))
  const pickupBeats = pickupBars * beatsPerBar
  const pickupPx = pickupBars * barWidthPx
  // The audible audio-block drag (sync mode): highlight its loop + explain it.
  const audioSyncDrag = useUIStore((s) => s.audioSyncDrag)
  const [laneViewportWidthPx, setLaneViewportWidthPx] = useState(0)
  const displayBars = timelineDisplayBars(totalBars, barWidthPx, laneViewportWidthPx)
  const timelineWidthPx = displayBars * barWidthPx + pickupPx

  // One RAF-driven playhead overlay spanning the ruler + track lanes, plus a
  // draggable scrub from the ruler. laneRef measures the lane region (excludes
  // the track-label column) so a clientX maps to a fraction of the timeline.
  const laneRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const playheadHeadRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scClientSizeRef = useRef<{ width: number; height: number } | null>(null)
  const rulerContentRef = useRef<HTMLDivElement>(null)
  const clipRef = useRef<HTMLDivElement>(null)
  const blockDragGuideRef = useRef<HTMLDivElement>(null)
  const loopStartGuideRef = useRef<HTMLDivElement>(null)
  const loopEndGuideRef = useRef<HTMLDivElement>(null)
  const projectLengthEdgeRef = useRef<HTMLDivElement>(null)
  const horizontalZoomRef = useRef({ pixelsPerBeat, scrollLeft: 0 })

  // Mirror the lane horizontal scroll onto the ruler via transform (no clamp, no
  // dependence on matching client widths → stays aligned to the far-right edge).
  const onTimelineScroll = (e: ReactScrollEvent<HTMLDivElement>) => {
    horizontalZoomRef.current.scrollLeft = e.currentTarget.scrollLeft
    if (rulerContentRef.current) {
      rulerContentRef.current.style.transform = `translateX(${-e.currentTarget.scrollLeft}px)`
    }
    if (projectLengthEdgeRef.current) {
      projectLengthEdgeRef.current.style.transform = `translateX(${pickupPx + projectWidthPx - e.currentTarget.scrollLeft}px)`
    }
    // Persist continuously so the position survives unmount (the ref may already be
    // detached by the time an unmount cleanup would run).
    useUIStore.getState().setTracksScroll(e.currentTarget.scrollLeft, e.currentTarget.scrollTop)
  }

  const { selectedBlockIds, marqueeRect, handleBlockPointerDown, handleLanePointerDown } = useTrackGestures({
    laneRef,
    dragGuideRef: blockDragGuideRef,
  })

  // Tracks render as a flattened tree (DFS order, indented by depth); collapsed
  // parents hide their descendant rows. Each object track's ability lanes are
  // interleaved as track-like sub-rows right after it (same row height).
  const collapsedTrackIds = useUIStore((s) => s.collapsedTrackIds)
  const visualRows = flattenVisualRows(tracks, rootTrackIds, collapsedTrackIds)
  // The guide arrays must keep their identities while the row STRUCTURE is
  // unchanged - they are props of the memoized Track rows, and this component
  // re-renders on every store write (any note edit). Keyed on the flattened
  // id:depth sequence rather than `tracks`, whose identity changes per edit.
  const rowsKey = visualRows.map((r) => `${r.id}:${r.depth}`).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rowGuides = useMemo(() => rowGuidesOf(visualRows), [rowsKey])

  // Vertical lane grid (DAW-style): only the numbered major bar lines - 1/4 of
  // the ruler's marks, the minor/16th ticks stay ruler-only. Colour and 1px
  // thickness match the ruler's near-full-height major lines above (same
  // computeRulerGrid interval, so they line up exactly at every zoom).
  const laneGrid = (() => {
    const { majorBars } = computeRulerGrid(pixelsPerBeat, beatsPerBar, displayBars)
    const majorPx = majorBars * beatsPerBar * pixelsPerBeat
    return {
      backgroundImage: `repeating-linear-gradient(to right, var(--timeline-grid-line, var(--border-strong)) 0px 1px, transparent 1px ${majorPx}px)`,
      backgroundSize: `${majorPx}px 100%`,
      // Phase the repeat so a line still lands exactly on musical bar 0 when
      // the pickup shifts the content (the pattern extends back through it).
      backgroundPosition: `${pickupPx}px 0`,
    }
  })()

  // Right-click-a-track menu (add ability / automation), positioned at the cursor.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; trackId: string } | null>(null)
  // Stable handler: an inline closure here would defeat every Track row's memo.
  const handleLabelContextMenu = useCallback((e: ReactMouseEvent, trackId: string) => {
    setCtxMenu({ x: e.clientX, y: e.clientY, trackId })
  }, [])

  // Two hand-rolled label gestures, distinguished in Track's pointer-down: a plain
  // drag re-nests/reorders (setTrackParent), Alt+drag duplicates.
  const { startNestDrag } = useTrackNestDrag(scrollRef)
  const { copyDrag, ghostRef, startTrackCopyDrag } = useTrackCopyDrag(scrollRef)

  // The shared drop indicator (nest-drag and library drag both write it): a row to
  // dim (the dragged source), a row to highlight (nest-into), or an insertion line.
  const trackDrop = useUIStore((s) => s.trackDrop)

  // While a library instrument is being dragged, the label column lights up as
  // the drop zone; once the cursor is over it the insertion line / nest
  // highlight takes over, so the hint text stands down (the border stays).
  const libraryDragging = useUIStore((s) => s.libraryDragging)
  const libraryDropReady = useUIStore((s) => s.libraryDragging && !!s.trackDrop)

  // Alt copy-drag still reflows rows to open a gap at its live insertion point. The
  // gap is a VISUAL row index (root tracks aren't at index*rowHeight once lanes exist);
  // it only opens on a sibling drop (a nest-into drop highlights the row instead).
  const dragActive = !!copyDrag
  const dragHasTarget = !!copyDrag?.hasTarget
  const dragGapRow = copyDrag?.gapRow ?? null
  const dragRowHeight = copyDrag?.rowHeight ?? 0

  // The playhead and loop region share one zoom-aware ruler quantization so
  // their boundaries always land on the same musical subdivision.
  const computeSnappedTimelineBeat = useCallback((clientX: number) => {
    if (!laneRef.current) return null
    // laneRef starts at MUSICAL beat 0 (it sits after the pickup), so scrubbing
    // into the pickup yields the negative beats the transport can now play.
    const rect = laneRef.current.getBoundingClientRect()
    const raw = (clientX - rect.left) / pixelsPerBeat
    const snap = computeRulerGrid(pixelsPerBeat, beatsPerBar, displayBars).playheadSnapBeats
    const beat = Math.round(raw / snap) * snap
    return Math.max(-pickupBeats, Math.min(maxBeat, beat))
  }, [beatsPerBar, displayBars, maxBeat, pixelsPerBeat, pickupBeats])

  const { startScrub } = useScrub({
    computeBeat: computeSnappedTimelineBeat,
  })

  const placeLoopGuide = useCallback((element: HTMLDivElement | null, beat: number | null, color: string) => {
    if (!element) return
    if (beat == null) {
      element.style.visibility = 'hidden'
      return
    }
    const laneR = laneRef.current?.getBoundingClientRect()
    if (!laneR) return
    const hostLeft = element.parentElement?.getBoundingClientRect().left ?? 0
    element.style.transform = `translateX(${laneR.left + beat * pixelsPerBeat - hostLeft}px)`
    element.style.backgroundColor = color
    element.style.visibility = 'visible'
  }, [pixelsPerBeat])

  const updateLoopDragGuides = useCallback((guide: LoopDragGuide | null) => {
    const color = guide?.enabled ? LOOP_REGION_ENABLED_COLOR : LOOP_REGION_DISABLED_COLOR
    placeLoopGuide(loopStartGuideRef.current, guide?.startBeat ?? null, color)
    placeLoopGuide(loopEndGuideRef.current, guide?.endBeat ?? null, color)
  }, [placeLoopGuide])

  // Loop-region drag on the ruler's top half uses the exact same quantization
  // as playhead scrubbing at the current zoom.
  const { startLoopDrag, startLoopMove, startLoopResize } = useLoopDrag({
    computeBeat: computeSnappedTimelineBeat,
    maxBeat,
    onGuideChange: updateLoopDragGuides,
  })

  // Restore the saved scroll on mount (before paint), and save it on unmount, so
  // returning from the MIDI editor lands you where you left off.
  useLayoutEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    const { tracksScrollLeft, tracksScrollTop } = useUIStore.getState()
    sc.scrollLeft = tracksScrollLeft
    sc.scrollTop = tracksScrollTop
    horizontalZoomRef.current.scrollLeft = sc.scrollLeft
    if (rulerContentRef.current) rulerContentRef.current.style.transform = `translateX(${-tracksScrollLeft}px)`
  }, [])

  // Horizontal zoom is centered on the playhead for both the H slider and
  // Alt+horizontal-scroll. Preserve the playhead's viewport x rather than the
  // content's left edge, then synchronously realign the detached ruler and
  // project-end overlay so there is no one-frame jump.
  useLayoutEffect(() => {
    const previous = horizontalZoomRef.current
    if (previous.pixelsPerBeat === pixelsPerBeat) return

    const sc = scrollRef.current
    if (!sc) {
      horizontalZoomRef.current.pixelsPerBeat = pixelsPerBeat
      return
    }

    const currentBeat = useTimeStore.getState().currentBeat
    sc.scrollLeft = scrollLeftAroundBeat(
      previous.scrollLeft,
      // Content x is (beat + pickup) · ppb - anchor the DISPLAY beat.
      currentBeat + pickupBeats,
      previous.pixelsPerBeat,
      pixelsPerBeat,
    )
    const appliedScrollLeft = sc.scrollLeft
    horizontalZoomRef.current = { pixelsPerBeat, scrollLeft: appliedScrollLeft }
    if (rulerContentRef.current) {
      rulerContentRef.current.style.transform = `translateX(${-appliedScrollLeft}px)`
    }
    if (projectLengthEdgeRef.current) {
      projectLengthEdgeRef.current.style.transform = `translateX(${pickupPx + projectWidthPx - appliedScrollLeft}px)`
    }
    useUIStore.getState().setTracksScroll(appliedScrollLeft, sc.scrollTop)
  }, [pixelsPerBeat, projectWidthPx, pickupPx, pickupBeats])

  // The project-end separator lives in viewport space so one continuous handle
  // spans the ruler and every lane, but follows the content during scrolling.
  useLayoutEffect(() => {
    if (!projectLengthEdgeRef.current) return
    // Mirrored scrollLeft (kept by the scroll handler) - reading the DOM
    // property inside a layout effect forced a layout on every render.
    projectLengthEdgeRef.current.style.transform =
      `translateX(${pickupPx + projectWidthPx - horizontalZoomRef.current.scrollLeft}px)`
  }, [projectWidthPx, pickupPx])

  // The render extent is responsive: short projects still show grid/ruler
  // across the full viewport, plus a useful horizontally scrollable overrun.
  useLayoutEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    const measure = () => {
      // Cached for the playhead RAF below, which used to read clientWidth /
      // clientHeight every frame - a forced layout whenever any style was
      // dirty that frame.
      scClientSizeRef.current = { width: sc.clientWidth, height: sc.clientHeight }
      setLaneViewportWidthPx(Math.max(0, sc.clientWidth - labelWidth - PLAYHEAD_TRIANGLE_HALF))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(sc)
    return () => observer.disconnect()
  }, [labelWidth])

  // Alt+scroll over the lanes zooms: deltaY → row height (vertical zoom), deltaX →
  // pixels-per-beat (horizontal zoom). Mirrors the MIDI editor's alt-scroll.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey) return
      e.preventDefault()
      e.stopPropagation()
      if (Math.abs(e.deltaY) > 2) {
        const cur = useUIStore.getState().tracksRowHeight
        useUIStore.getState().setTracksRowHeight(cur - e.deltaY * 0.15)
      }
      if (Math.abs(e.deltaX) > 2) {
        const cur = useUIStore.getState().tracksPixelsPerBeat
        useUIStore.getState().setTracksPixelsPerBeat(cur - e.deltaX * 0.5)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  usePlayhead((beat) => {
    updateMidiActivityAtBeat(beat, useTimeStore.getState().isPlaying)
    // Snap to a pixel *center* (whole px + 0.5) so the 1px-wide lane line renders
    // crisp on a single column while the triangle apex sits exactly on that
    // column's center - otherwise the crisp line lands ~0.5px off the apex.
    const beatX = Math.round(beat * pixelsPerBeat) + 0.5
    const sc = scrollRef.current
    // Clip the playhead overlay to the scroll container's client area (excludes the
    // scrollbars) so the line never draws over them.
    if (sc && clipRef.current) {
      const lw = useUIStore.getState().tracksLabelWidth
      const size = scClientSizeRef.current
      const cw = size ? size.width : sc.clientWidth
      const ch = size ? size.height : sc.clientHeight
      const nextW = `${Math.max(0, cw - lw - PLAYHEAD_TRIANGLE_HALF)}px`
      const nextH = `${ch}px`
      // Style writes only when the value moved (a write per frame dirties layout).
      if (clipRef.current.style.width !== nextW) clipRef.current.style.width = nextW
      if (clipRef.current.style.height !== nextH) clipRef.current.style.height = nextH
    }
    // Ruler triangle is positioned in content space INSIDE the ruler's pickup-
    // shifted wrapper (so beatX stays musical). The lane line lives in a
    // viewport-space overlay, so offset by the pickup and the scroll itself.
    if (playheadHeadRef.current) playheadHeadRef.current.style.transform = `translateX(${beatX}px)`
    if (playheadRef.current) {
      // The scroll handler mirrors scrollLeft into horizontalZoomRef; reading
      // the DOM property here forced a synchronous layout EVERY FRAME while
      // the note-glow sweep had just dirtied thousands of style vars - on a
      // dense project that was ~40% of playback's main-thread time.
      const sl = horizontalZoomRef.current.scrollLeft
      playheadRef.current.style.transform = `translateX(${beatX + pickupPx - sl}px)`
    }
  })

  // useCallback: this is a prop of the memoized ruler corner and the empty-scene
  // list; it only reads live state, so it never needs to re-bind.
  const insertTrack = useCallback((opts?: { withStarterBlock?: boolean }) => {
    const state = useProjectStore.getState()
    const isMain = !!state.scenes[state.activeSceneId]?.isMain
    const id = crypto.randomUUID()
    // Main's default composer is Scene, not Scene Switcher: it shows its scene
    // for the whole timeline with no notes drawn, so a freshly added track is
    // never a blank frame waiting to be played. (The switcher is still one drag
    // away in the library.)
    //
    // The empty-scene "Add a track" row asks for a starter block: an empty
    // 4-bar MIDI block at bar 1, so the very first track arrives with somewhere
    // to put notes instead of a bare lane whose draw gesture hasn't been taught
    // yet. Seeded in the same addTrack call so track + block are one undo step.
    // Not on Main - its Scene composer runs without notes, so an empty block
    // would just be inert chrome.
    const starterBlock =
      opts?.withStarterBlock && !isMain
        ? [{ id: crypto.randomUUID(), startBar: 0, durationBars: 4, loop: false, notes: [] }]
        : []
    state.addTrack({
      id,
      name: isMain ? 'Scene' : 'Cube',
      type: 'base' as const,
      instrumentId: isMain ? 'scene' : 'cube',
      sceneBindings: isMain ? seedSceneBindings(state.scenes, state.sceneOrder) : undefined,
      color: resolveNextTrackColor(state),
      muted: false,
      solo: false,
      blocks: starterBlock,
      childIds: [],
    })
    // A new instrument becomes the selection; blocks deselect.
    selectNewTrack(id)
  }, [])

  // OS-file drops moved to the editor-wide MediaFileDropLayer (App root) -
  // files can land anywhere in the editor, not just this section. Only the
  // MIDI import button's plumbing stays here.

  // Drag the label column's right edge to resize it (spans the ruler corner, every
  // track label, and the empty space below - one handle along the whole edge).
  function startLabelResize(e: ReactPointerEvent) {
    const { tracksLabelWidth, setTracksLabelWidth } = useUIStore.getState()
    startEdgeResize(e, tracksLabelWidth, setTracksLabelWidth)
  }

  function startProjectLengthResize(e: ReactPointerEvent) {
    startEdgeResize(e, projectWidthPx, (widthPx) => {
      useProjectStore.getState().setTotalBars(widthPx / barWidthPx)
    })
  }

  const handleAddTrackWithBlock = useCallback(() => insertTrack({ withStarterBlock: true }), [insertTrack])
  const handleAddTrack = useCallback(() => insertTrack(), [insertTrack])
  // A stable element: an inline JSX corner prop re-rendered the memoized ruler
  // (and its whole tick strip) on every store write TimelineArea absorbs.
  const rulerCorner = useMemo(() => (
    <div className="flex items-center gap-2 px-3 w-full">
      <button
        className="flex items-center justify-center w-4 h-4 rounded-[3px] bg-[var(--bg-elevated)] text-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--border)] transition-colors cursor-pointer"
        onClick={handleAddTrack}
        title={`Add track`}
      >
        <Plus size={11} />
      </button>
    </div>
  ), [handleAddTrack])

  return (
    <div className="timeline-neon relative flex flex-col h-full border-t border-[var(--border)] bg-[#08090d]">
      {/* Ruler in its own row (not inside the lane scroll container) so the lanes
          own the only scrollbars: the vertical one then ends below the ruler. Its
          content is translated to mirror the lane scroll (onTimelineScroll); the
          gutter reserves the lanes' scrollbar width so the strip ends where the
          lanes' content does. The add-track button lives in the ruler's frozen corner. */}
      <div className="flex-shrink-0">
        <TimelineRuler
          onScrubStart={startScrub}
          onLoopDragStart={startLoopDrag}
          onLoopMoveStart={startLoopMove}
          onLoopResizeStart={startLoopResize}
          barWidthPx={barWidthPx}
          timelineWidthPx={timelineWidthPx}
          displayBars={displayBars}
          pickupPx={pickupPx}
          gutterPx={0}
          contentRef={rulerContentRef}
          playheadHeadRef={playheadHeadRef}
          corner={rulerCorner}
        />
      </div>

      {/* Lanes: a relative wrapper holds the scroll container plus a viewport-space
          playhead overlay clipped to the lane region (so the playhead is never drawn
          over the frozen label column, its dividers, or the empty space - it slides
          under the label edge when scrolled). overflow-CLIP clips the playhead
          overlay to the lane region, so a resize frame where its imperatively-set
          width lags can't spill out and spawn a stray (unstyled) scrollbar -
          and unlike `hidden` it never becomes a scroll container of its own
          (the real scroller is the overflow-auto child below). */}
      <div className="relative flex-1 min-h-0 overflow-clip">
        {/* The label column's surface and its divider against the lanes, in
            VIEWPORT space (behind the scroll container, which is transparent).
            Content space would be wrong: the column is frozen (each row's label
            is `sticky left-0`), so a content-space fill slides away under
            horizontal scroll and the strip below the last track - the only place
            nothing else paints over it - visibly scrolls out from under the
            frozen labels. Full height also carries the divider past the last
            row, so the label/lane seam runs the whole pane. */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 border-r border-r-[var(--timeline-row-line,var(--border))] bg-[var(--bg-track-row)]"
          style={{ width: labelWidth }}
        />
        {/* A loop drag lights the LANES as its drop zone - the mirror of the
            label-column glow an instrument drag gets. */}
        {loopDragging && (
          <div
            className="pointer-events-none absolute inset-y-1 right-1 z-30 rounded border border-dashed border-[rgba(53,167,230,0.5)] bg-[var(--accent)]/5"
            style={{ left: labelWidth + PLAYHEAD_TRIANGLE_HALF }}
          />
        )}
        {libraryDragging && (
          <div
            className={`pointer-events-none absolute top-0 bottom-0 left-0 z-30 flex items-center justify-center border border-dashed transition-colors ${
              libraryDropReady
                ? 'border-[var(--accent)] bg-[var(--accent)]/15'
                : 'border-[var(--border-strong)] bg-[var(--accent)]/5'
            }`}
            style={{ width: labelWidth }}
          >
            {!libraryDropReady && (
              <span className="flex items-center gap-1.5 rounded bg-[var(--bg-panel)]/85 px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-3)]">
                <Plus size={12} /> drop here
              </span>
            )}
          </div>
        )}
        {/* Sync-drag explainer: what the loop band is and how to steer it.
            Viewport space, centered over the lanes, out of the pointer's way. */}
        {audioSyncDrag && (
          <div
            data-audio-sync-hint=""
            className="pointer-events-none absolute top-2 z-40 flex justify-center"
            style={{ left: labelWidth + PLAYHEAD_TRIANGLE_HALF, right: 8 }}
          >
            <div className="max-w-[440px] rounded-md border border-[rgba(53,167,230,0.45)] bg-[var(--bg-panel)]/92 px-3 py-2 shadow-lg shadow-black/40 backdrop-blur-sm">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                Sync mode · looping bar{' '}
                {(() => {
                  const a = Math.floor(audioSyncDrag.loop.startBeat / beatsPerBar) + 1
                  const b = Math.ceil(audioSyncDrag.loop.endBeat / beatsPerBar)
                  return a >= b ? `${a}` : `${a}–${b}`
                })()}
              </div>
              <div className="mt-1 text-[11px] leading-snug text-[var(--text-2)]">
                The highlighted section keeps playing while you drag - line the waveform&apos;s
                transients up with your MIDI by ear and eye. Audio re-syncs each pass and
                whenever you pause the drag.
              </div>
              <div className="mt-0.5 text-[10px] leading-snug text-[var(--text-muted)]">
                Park the playhead (or set a loop region) over the section you care about
                before dragging. Drag past bar 1 to give the audio a pickup.
              </div>
            </div>
          </div>
        )}
        {/* Mounted unconditionally: it has an exit animation, so it needs to
            SEE `empty` go false rather than be unmounted by it (it renders
            null once the fade is done). Keyed on the scene so switching to a
            different empty scene replays the entrance - the view genuinely
            appeared again - instead of silently reusing the settled one. */}
        {/* `empty` ignores the scene instrument's own row: it is a root track
            when it's showing (core/sceneTrack.ts), but a scene wearing nothing
            else is still empty and needs the add-a-track list.
            While the project document is still LOADING the stores are blanked
            on purpose, and that is not emptiness - the list stays away (and
            the shared smoking-cabin loading mark sits in its spot) until the
            hydrate lands and the scene is verified empty. */}
        {documentLoading && (
          <div
            className="pointer-events-none absolute inset-y-0 right-0 z-20 flex items-start justify-start pt-5"
            style={{ left: labelWidth + PLAYHEAD_TRIANGLE_HALF }}
          >
            <div className="pl-4"><LoadingCabin /></div>
          </div>
        )}
        <EmptySceneActions
          key={activeSceneId}
          empty={!documentLoading && rootTrackIds.every(isSceneTrackId)}
          labelWidth={labelWidth}
          isMain={activeSceneIsMain}
          onAddTrack={handleAddTrackWithBlock}
        />
        <div
          ref={scrollRef}
          data-tracks-scroll
          className="absolute inset-0 overflow-auto timeline-scrollbar select-none"
          onScroll={onTimelineScroll}
        >
          <div
            className="relative flex flex-col"
            style={{ width: labelWidth + PLAYHEAD_TRIANGLE_HALF + timelineWidthPx, minHeight: '100%' }}
          >
            {/* The lane surface lives only behind the actual track stack; the
                area below it keeps the root's darker void. The label column,
                though, wears its normal color all the way down - painted in
                viewport space by the frozen strip above this scroll container. */}
            <div
              className="pointer-events-none absolute inset-x-0 top-0 bg-[var(--bg-timeline)]"
              style={{ height: visualRows.length * rowHeight }}
            />
            {/* Vertical grid lines aligned to the ruler's divisions (DAW-style).
                Their height is the visible track stack, rather than the scroll
                viewport, so they stop at the bottom of the lowest track. First
                child + no z-index lets the relative-positioned rows paint over
                them (their lanes are transparent, so the grid shows through). */}
            <div
              className="pointer-events-none absolute top-0"
              style={{
                left: labelWidth + PLAYHEAD_TRIANGLE_HALF,
                width: timelineWidthPx,
                height: visualRows.length * rowHeight,
                ...laneGrid,
              }}
            />
            {visualRows.map((row, i) => {
              const isLast = i === visualRows.length - 1
              const track = tracks[row.id]
              // The label divider below this row starts at the bracket line of the
              // NEXT row's depth; a deeper next row is a first child, whose curve
              // draws that divider itself (so this row draws none).
              const nextDepth = visualRows[i + 1]?.depth
              const dividerInset = isLast || nextDepth === undefined || nextDepth > row.depth
                ? null
                : rowIndentPx(nextDepth)
              // Visible rows in this track's subtree - its background strip beside
              // the children spans exactly these rows.
              let descendantRows = 0
              while (visualRows[i + 1 + descendantRows] && visualRows[i + 1 + descendantRows].depth > row.depth) descendantRows++
              return track ? (
                <Track
                  key={row.id}
                  track={track}
                  depth={row.depth}
                  guides={rowGuides[i]}
                  dividerInset={dividerInset}
                  descendantRows={descendantRows}
                  isLast={isLast}
                  liftOffset={dragActive ? (dragHasTarget && dragGapRow != null && i >= dragGapRow ? dragRowHeight : 0) : undefined}
                  dimmed={trackDrop?.activeId === row.id}
                  dropInto={trackDrop?.intoId === row.id}
                  replacePreview={trackDrop?.replace?.trackId === row.id ? trackDrop.replace : undefined}
                  onCopyDragStart={startTrackCopyDrag}
                  onNestDragStart={startNestDrag}
                  onLabelContextMenu={handleLabelContextMenu}
                  barWidthPx={barWidthPx}
                  pickupPx={pickupPx}
                  selectedBlockIds={selectedBlockIds}
                  onBlockPointerDown={handleBlockPointerDown}
                  onLanePointerDown={handleLanePointerDown}
                />
              ) : null
            })}

            {/* The project boundary controls playback/export, not how much ruler
                and grid we render. This overlay desaturates and darkens every
                lane surface and every portion of a MIDI/audio region beyond it,
                while leaving the underlying grid visible. */}
            <div
              data-outside-project-lanes=""
              className="pointer-events-none absolute top-0 bottom-0 z-[5]"
              style={{
                left: labelWidth + PLAYHEAD_TRIANGLE_HALF + pickupPx + projectWidthPx,
                width: Math.max(0, timelineWidthPx - pickupPx - projectWidthPx),
                // A flat fill, not backdrop-filter: the filter re-composited
                // everything beneath the (viewport-sized) region on every
                // scroll/paint, and what's beneath is almost always the empty
                // grid - which a translucent black dims just the same. Content
                // poking past the boundary keeps its hue, merely darkened;
                // that read ("this part is outside the song") survives.
                backgroundColor: 'rgba(9, 9, 9, 0.62)',
              }}
            />

            {/* The pickup's lane-side shading - same hatch as its ruler band, so
                the lead-in reads as one region from ruler to lanes. */}
            {pickupPx > 0 && (
              <div
                data-pickup-lanes=""
                className="pointer-events-none absolute top-0 bottom-0 z-[5]"
                style={{
                  left: labelWidth + PLAYHEAD_TRIANGLE_HALF,
                  width: pickupPx,
                  backgroundImage: 'repeating-linear-gradient(-45deg, rgba(53,167,230,0.07) 0 5px, transparent 5px 10px)',
                  borderRight: '1px solid rgba(53,167,230,0.35)',
                }}
              />
            )}

            {/* Sync-drag loop highlight: the span the transport is looping while
                an audio block is dragged, full-height so it reads against every
                lane and the visualizer's beat at once. */}
            {audioSyncDrag && (
              <div
                data-audio-sync-loop=""
                className="pointer-events-none absolute top-0 bottom-0 z-[6]"
                style={{
                  left: labelWidth + PLAYHEAD_TRIANGLE_HALF + pickupPx + audioSyncDrag.loop.startBeat * pixelsPerBeat,
                  width: (audioSyncDrag.loop.endBeat - audioSyncDrag.loop.startBeat) * pixelsPerBeat,
                  backgroundColor: 'rgba(53, 167, 230, 0.10)',
                  borderLeft: '1px solid rgba(53, 167, 230, 0.75)',
                  borderRight: '1px solid rgba(53, 167, 230, 0.75)',
                  boxShadow: 'inset 0 0 18px rgba(53, 167, 230, 0.12)',
                }}
              />
            )}

            {/* Shared drop insertion line (nest-drag + library drag). Content-space,
                full width so it stays visible through horizontal scroll; it starts at
                the landing depth's bracket, exactly where the real row divider will.
                Straight even when the drop becomes a first child - the divider there
                is the parent's bracket corner, but an indicator that drew the corner
                read as a hook hanging off the row above. Nesting *into* a row shows
                that row's highlight instead. */}
            {trackDrop?.line && (
              <div
                className="absolute z-30 pointer-events-none"
                style={{ top: trackDrop.line.top - 1, left: 0, right: 0, height: 2 }}
              >
                <div
                  className="border-t-2 border-[var(--accent)]"
                  style={{ marginLeft: trackDrop.line.left, height: 2 }}
                />
              </div>
            )}
            {/* Empty space below the tracks. The label-column portion belongs to the
                label section - it deselects but is otherwise inert (no marquee); only
                the lane portion behaves like the grid. Its min-height (not a
                paddingBottom on the content) is what gives the stack three rows of
                scroll room past the last track, so this row - and its sticky label
                strip's border - actually covers that space instead of leaving a
                padding gap that only a background could reach. */}
            <div className="flex-1 flex" style={{ minHeight: rowHeight * 3 }}>
              <div
                className={`flex-shrink-0 sticky left-0 z-10 border-r border-r-[var(--timeline-row-line,var(--border))] bg-[var(--bg-track-row)] ${
                  rootTrackIds.length > 0 ? 'border-t border-t-[var(--border-subtle)]' : ''
                }`}
                style={{ width: labelWidth }}
                onPointerDown={() => deselectTrack()}
              />
              <div
                className="flex-1"
                onContextMenu={(e) => e.preventDefault()}
                onPointerDown={(e) => handleLanePointerDown(e)}
              />
            </div>

            {/* Marquee overlay (content space, so its coords match block rects).
                Starts at MUSICAL beat 0 - after the pickup - so every clientX →
                beat mapping derived from this rect stays in musical beats. */}
            <div
              ref={laneRef}
              className="absolute bottom-0 top-0 z-10 pointer-events-none"
              style={{ left: labelWidth + PLAYHEAD_TRIANGLE_HALF + pickupPx, width: timelineWidthPx - pickupPx }}
            >
              {marqueeRect && (
                <div
                  className="absolute z-20 border border-[var(--accent)]"
                  style={{
                    left: marqueeRect.left,
                    top: marqueeRect.top,
                    width: marqueeRect.width,
                    height: marqueeRect.height,
                    backgroundColor: 'rgba(53, 167, 230, 0.15)',
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {/* Playhead line over the lane region only (clipped). The thin visible line
            plus a wider transparent grab handle to scrub anywhere along its height.
            RAF offsets it by the scroll and sizes this clip box to the scroll
            container's client area, so the line tracks horizontal scroll, hides
            under the label edge, and never draws over the scrollbars. */}
        <div ref={clipRef} className="absolute top-0 overflow-clip pointer-events-none" style={{ left: labelWidth + PLAYHEAD_TRIANGLE_HALF }}>
          <div ref={playheadRef} className="absolute top-0 bottom-0" style={{ left: 0, width: 0 }}>
            <div className="absolute top-0 bottom-0" style={{ left: -0.5, width: 1, backgroundColor: '#ecedef' }} />
            <div
              className="absolute top-0 bottom-0 pointer-events-auto cursor-ew-resize"
              style={{ left: -5, width: 10 }}
              onPointerDown={startScrub}
            />
          </div>
        </div>
      </div>

      {/* One draggable project-end edge across the ruler and every lane. The
          clipping host keeps it out of the frozen label column and hides it when
          horizontal scrolling moves the boundary outside the lane viewport.
          overflow-CLIP: the edge inside is translated to the project's end, so
          under `hidden` this host carried real scroll range (787px on a fresh
          project) that a stray swipe could bank - see src/editor/CLAUDE.md. */}
      <div
        className="pointer-events-none absolute top-0 right-0 bottom-0 z-[44] overflow-clip"
        style={{ left: labelWidth + PLAYHEAD_TRIANGLE_HALF }}
      >
        <div
          ref={projectLengthEdgeRef}
          className="absolute top-0 bottom-0 left-0 w-0 will-change-transform"
          style={{ transform: `translateX(${projectWidthPx}px)` }}
        >
          <div
            data-project-length-edge=""
            role="separator"
            aria-label="Project end"
            aria-orientation="vertical"
            aria-valuemin={MIN_TOTAL_BARS}
            aria-valuemax={MAX_TOTAL_BARS}
            aria-valuenow={totalBars}
            tabIndex={0}
            onPointerDown={startProjectLengthResize}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
              e.preventDefault()
              useProjectStore.getState().setTotalBars(totalBars + (e.key === 'ArrowRight' ? 1 : -1))
            }}
            className="group pointer-events-auto absolute top-0 bottom-0 -left-[5px] w-[10px] cursor-ew-resize touch-none outline-none"
          >
            <span className="absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2 bg-white/[0.12] transition-[width,background-color,box-shadow] group-hover:w-0.5 group-hover:bg-[var(--accent)] group-hover:shadow-[0_0_6px_var(--accent)] group-focus-visible:w-0.5 group-focus-visible:bg-[var(--accent)] group-focus-visible:shadow-[0_0_6px_var(--accent)]" />
          </div>
        </div>
      </div>

      {/* MIDI drag alignment guide. Positioned imperatively from the dragged
          block's snapped left edge; this root begins at the ruler and ends at
          the bottom of the editor, so the hairline spans the full workspace. */}
      <div
        ref={blockDragGuideRef}
        data-midi-drag-guide=""
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 bottom-0 z-[45]"
        style={{ visibility: 'hidden', width: 0, willChange: 'transform' }}
      >
        <div className="absolute top-0 bottom-0 w-px bg-white/60" style={{ left: -0.5 }} />
      </div>

      {([
        ['start', loopStartGuideRef],
        ['end', loopEndGuideRef],
      ] as const).map(([edge, ref]) => (
        <div
          key={edge}
          ref={ref}
          data-loop-drag-guide={edge}
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 bottom-0 z-[45]"
          style={{ visibility: 'hidden', width: 0, willChange: 'transform' }}
        >
          <div className="absolute top-0 bottom-0 w-px" style={{ left: -0.5, backgroundColor: 'inherit' }} />
        </div>
      ))}

      {/* Floating ghost of the row being Alt-copy-dragged - mirrors the label box so
          it reads like the lifted row of a normal drag (top set imperatively). */}
      {copyDrag && (
        <div
          ref={ghostRef}
          className="fixed z-50 pointer-events-none flex items-center gap-2 px-3 border border-[var(--border)] shadow-lg shadow-black/40"
          style={{ left: copyDrag.labelLeft, width: labelWidth, height: copyDrag.rowHeight, backgroundColor: 'var(--bg-elevated)', opacity: 0.8 }}
        >
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-medium truncate text-[var(--text)]">{copyDrag.name}</div>
          </div>
          <div className="flex gap-1 flex-shrink-0">
            <div className={`w-4 h-4 rounded-[3px] text-[9px] font-bold flex items-center justify-center ${copyDrag.muted ? 'bg-[var(--warn)] text-[var(--on-accent)]' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'}`}>M</div>
            <div className={`w-4 h-4 rounded-[3px] text-[9px] font-bold flex items-center justify-center ${copyDrag.solo ? 'bg-[var(--accent)] text-[var(--on-accent)]' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'}`}>S</div>
          </div>
        </div>
      )}

      {/* Resize handle along the label column's right edge - spans the full height
          (ruler corner, every track label, the empty space below). Invisible; the
          cursor is the only affordance. */}
      <div
        onPointerDown={startLabelResize}
        className="absolute top-0 bottom-0 z-40 cursor-ew-resize"
        style={{ left: labelWidth - 3, width: 6 }}
      />

      {ctxMenu && (
        <TrackContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          trackId={ctxMenu.trackId}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  )
}
