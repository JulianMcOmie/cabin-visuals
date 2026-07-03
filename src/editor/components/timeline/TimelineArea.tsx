'use client'

import { useRef, useState, useEffect, useLayoutEffect, type UIEvent as ReactScrollEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Plus } from 'lucide-react'
import { useProjectStore } from '../../store/ProjectStore'
import { useUIStore } from '../../store/UIStore'
import { Track } from './Track'
import { TrackContextMenu } from './TrackContextMenu'
import { TimelineRuler } from './TimelineRuler'
import { usePlayhead } from '../../hooks/usePlayhead'
import { useScrub } from '../../hooks/useScrub'
import { useTrackGestures } from './useTrackGestures'
import { useTrackCopyDrag } from './useTrackCopyDrag'
import { useTrackNestDrag } from './useTrackNestDrag'
import { flattenVisualRows } from './trackTree'
import { deselectTrack, selectNewTrack } from '../../utils/selection'
import { lockCursor, unlockCursor } from '../../utils/dragCursor'
import { PLAYHEAD_TRIANGLE_HALF, PLAYHEAD_SNAP_BEATS } from '../../constants'

export function TimelineArea() {
  const tracks = useProjectStore((s) => s.tracks)
  const rootTrackIds = useProjectStore((s) => s.rootTrackIds)
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)
  const totalBars = useProjectStore((s) => s.totalBars)
  const pixelsPerBeat = useUIStore((s) => s.tracksPixelsPerBeat)
  const labelWidth = useUIStore((s) => s.tracksLabelWidth)
  const maxBeat = totalBars * beatsPerBar
  const barWidthPx = beatsPerBar * pixelsPerBeat
  const timelineWidthPx = totalBars * barWidthPx

  // One RAF-driven playhead overlay spanning the ruler + track lanes, plus a
  // draggable scrub from the ruler. laneRef measures the lane region (excludes
  // the track-label column) so a clientX maps to a fraction of the timeline.
  const laneRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const playheadHeadRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const rulerContentRef = useRef<HTMLDivElement>(null)
  const clipRef = useRef<HTMLDivElement>(null)

  // Mirror the lane horizontal scroll onto the ruler via transform (no clamp, no
  // dependence on matching client widths → stays aligned to the far-right edge).
  const onTimelineScroll = (e: ReactScrollEvent<HTMLDivElement>) => {
    if (rulerContentRef.current) {
      rulerContentRef.current.style.transform = `translateX(${-e.currentTarget.scrollLeft}px)`
    }
    // Persist continuously so the position survives unmount (the ref may already be
    // detached by the time an unmount cleanup would run).
    useUIStore.getState().setTracksScroll(e.currentTarget.scrollLeft, e.currentTarget.scrollTop)
  }

  const { selectedBlockIds, marqueeRect, handleBlockPointerDown, handleLanePointerDown } = useTrackGestures({ laneRef })

  // Tracks render as a flattened tree (DFS order, indented by depth); collapsed
  // parents hide their descendant rows. Each object track's ability lanes are
  // interleaved as track-like sub-rows right after it (same row height).
  const collapsedTrackIds = useUIStore((s) => s.collapsedTrackIds)
  const visualRows = flattenVisualRows(tracks, rootTrackIds, collapsedTrackIds)

  // Right-click-a-track menu (add ability / automation), positioned at the cursor.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; trackId: string } | null>(null)

  // Two hand-rolled label gestures, distinguished in Track's pointer-down: a plain
  // drag re-nests/reorders (setTrackParent), Alt+drag duplicates.
  const { startNestDrag } = useTrackNestDrag(scrollRef)
  const { copyDrag, ghostRef, startTrackCopyDrag } = useTrackCopyDrag(scrollRef)

  // The shared drop indicator (nest-drag and library drag both write it): a row to
  // dim (the dragged source), a row to highlight (nest-into), or an insertion line.
  const trackDrop = useUIStore((s) => s.trackDrop)

  // Alt copy-drag still reflows rows to open a gap at its live insertion point. The
  // gap is a VISUAL row index (root tracks aren't at index*rowHeight once lanes exist);
  // it only opens when there's a real target (insertIndex != null).
  const dragActive = !!copyDrag
  const dragHasTarget = copyDrag?.insertIndex != null
  const dragGapRow = copyDrag?.gapRow ?? null
  const dragRowHeight = copyDrag?.rowHeight ?? 0

  const { startScrub } = useScrub({
    computeBeat: (clientX) => {
      if (!laneRef.current) return null
      const rect = laneRef.current.getBoundingClientRect()
      const raw = (clientX - rect.left) / pixelsPerBeat
      const beat = Math.round(raw / PLAYHEAD_SNAP_BEATS) * PLAYHEAD_SNAP_BEATS // snap to 1/4 beat
      return Math.max(0, Math.min(maxBeat, beat))
    },
  })

  // Restore the saved scroll on mount (before paint), and save it on unmount, so
  // returning from the MIDI editor lands you where you left off.
  useLayoutEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    const { tracksScrollLeft, tracksScrollTop } = useUIStore.getState()
    sc.scrollLeft = tracksScrollLeft
    sc.scrollTop = tracksScrollTop
    if (rulerContentRef.current) rulerContentRef.current.style.transform = `translateX(${-tracksScrollLeft}px)`
  }, [])

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
    // Snap to a pixel *center* (whole px + 0.5) so the 1px-wide lane line renders
    // crisp on a single column while the triangle apex sits exactly on that
    // column's center — otherwise the crisp line lands ~0.5px off the apex.
    const beatX = Math.round(beat * pixelsPerBeat) + 0.5
    const sc = scrollRef.current
    // Clip the playhead overlay to the scroll container's client area (excludes the
    // scrollbars) so the line never draws over them.
    if (sc && clipRef.current) {
      const lw = useUIStore.getState().tracksLabelWidth
      clipRef.current.style.width = `${Math.max(0, sc.clientWidth - lw - PLAYHEAD_TRIANGLE_HALF)}px`
      clipRef.current.style.height = `${sc.clientHeight}px`
    }
    // Ruler triangle is positioned in content space (its container mirrors the lane
    // scroll). The lane line lives in a viewport-space overlay, so offset by scroll.
    if (playheadHeadRef.current) playheadHeadRef.current.style.transform = `translateX(${beatX}px)`
    if (playheadRef.current) {
      const sl = sc?.scrollLeft ?? 0
      playheadRef.current.style.transform = `translateX(${beatX - sl}px)`
    }
  })

  function insertTrack() {
    const id = crypto.randomUUID()
    useProjectStore.getState().addTrack({
      id,
      name: 'Cube',
      type: 'base' as const,
      instrumentId: 'cube',
      color: '#6366f1',
      muted: false,
      solo: false,
      blocks: [],
      childIds: [],
    })
    // A new instrument becomes the selection; blocks deselect.
    selectNewTrack(id)
  }

  // Drag the label column's right edge to resize it (spans the ruler corner, every
  // track label, and the empty space below — one handle along the whole edge).
  function startLabelResize(e: ReactPointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = useUIStore.getState().tracksLabelWidth
    lockCursor('ew-resize')
    const controller = new AbortController()
    window.addEventListener('pointermove', (ev) => {
      useUIStore.getState().setTracksLabelWidth(startW + (ev.clientX - startX))
    }, { signal: controller.signal })
    window.addEventListener('pointerup', () => { controller.abort(); unlockCursor() }, { signal: controller.signal })
  }

  return (
    <div className="relative flex flex-col h-full border-t border-zinc-800 bg-zinc-900">
      {/* Ruler in its own row (not inside the lane scroll container) so the lanes
          own the only scrollbars: the vertical one then ends below the ruler. Its
          content is translated to mirror the lane scroll (onTimelineScroll); the
          gutter reserves the lanes' scrollbar width so the strip ends where the
          lanes' content does. The Tracks header lives in the ruler's frozen corner. */}
      <div className="flex-shrink-0">
        <TimelineRuler
          onScrubStart={startScrub}
          barWidthPx={barWidthPx}
          timelineWidthPx={timelineWidthPx}
          gutterPx={0}
          contentRef={rulerContentRef}
          playheadHeadRef={playheadHeadRef}
          corner={
            <div className="flex items-center gap-2 px-3 w-full">
              <span className="text-xs font-medium text-zinc-300">Tracks</span>
              <button
                className="flex items-center justify-center w-5 h-5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                onClick={insertTrack}
                title={`Add track`}
              >
                <Plus size={12} />
              </button>
            </div>
          }
        />
      </div>

      {/* Lanes: a relative wrapper holds the scroll container plus a viewport-space
          playhead overlay clipped to the lane region (so the playhead is never drawn
          over the frozen label column, its dividers, or the empty space — it slides
          under the label edge when scrolled). overflow-hidden clips the playhead
          overlay to the lane region, so a resize frame where its imperatively-set
          width lags can't spill out and spawn a stray (unstyled) scrollbar. */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        {rootTrackIds.length === 0 && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
            <p className="text-xs text-zinc-600 text-center px-4">
              No tracks yet. Click <span className="text-zinc-400 text-lg">+</span> to add a track, then right-click a lane to draw blocks.
            </p>
          </div>
        )}
        <div
          ref={scrollRef}
          data-tracks-scroll
          className="absolute inset-0 overflow-auto timeline-scrollbar"
          onScroll={onTimelineScroll}
        >
          <div
            className="relative flex flex-col"
            style={{ width: labelWidth + PLAYHEAD_TRIANGLE_HALF + timelineWidthPx, minHeight: '100%' }}
          >
            {visualRows.map((row, i) => {
              const isLast = i === visualRows.length - 1
              const track = tracks[row.id]
              return track ? (
                <Track
                  key={row.id}
                  track={track}
                  depth={row.depth}
                  isLast={isLast}
                  liftOffset={dragActive ? (dragHasTarget && dragGapRow != null && i >= dragGapRow ? dragRowHeight : 0) : undefined}
                  dimmed={trackDrop?.activeId === row.id}
                  dropInto={trackDrop?.intoId === row.id}
                  onCopyDragStart={startTrackCopyDrag}
                  onNestDragStart={startNestDrag}
                  onLabelContextMenu={(e, id) => setCtxMenu({ x: e.clientX, y: e.clientY, trackId: id })}
                  barWidthPx={barWidthPx}
                  timelineWidthPx={timelineWidthPx}
                  selectedBlockIds={selectedBlockIds}
                  onBlockPointerDown={handleBlockPointerDown}
                  onLanePointerDown={handleLanePointerDown}
                />
              ) : null
            })}

            {/* Shared drop insertion line (nest-drag + library drag). Content-space,
                full width so it stays visible through horizontal scroll; indented to
                the target depth. Nesting *into* a row shows that row's highlight. */}
            {trackDrop?.line && (
              <div
                className="absolute z-30 pointer-events-none"
                style={{ top: trackDrop.line.top - 1, left: 0, right: 0, height: 2 }}
              >
                <div className="h-full bg-indigo-400" style={{ marginLeft: trackDrop.line.left }} />
              </div>
            )}
            {/* Empty space below the tracks. The label-column portion belongs to the
                label section — it deselects but is otherwise inert (no marquee); only
                the lane portion behaves like the grid. */}
            <div className="flex-1 min-h-0 flex">
              <div
                className={`flex-shrink-0 sticky left-0 z-10 border-r border-r-zinc-800/60 bg-[#202024] ${
                  rootTrackIds.length > 0 ? 'border-t border-t-zinc-900' : ''
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

            {/* Marquee overlay (content space, so its coords match block rects). */}
            <div
              ref={laneRef}
              className="absolute bottom-0 top-0 z-10 pointer-events-none"
              style={{ left: labelWidth + PLAYHEAD_TRIANGLE_HALF, width: timelineWidthPx }}
            >
              {marqueeRect && (
                <div
                  className="absolute z-20 border border-indigo-400"
                  style={{
                    left: marqueeRect.left,
                    top: marqueeRect.top,
                    width: marqueeRect.width,
                    height: marqueeRect.height,
                    backgroundColor: 'rgba(99, 102, 241, 0.15)',
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
        <div ref={clipRef} className="absolute top-0 overflow-hidden pointer-events-none" style={{ left: labelWidth + PLAYHEAD_TRIANGLE_HALF }}>
          <div ref={playheadRef} className="absolute top-0 bottom-0" style={{ left: 0, width: 0 }}>
            <div className="absolute top-0 bottom-0" style={{ left: -0.5, width: 1, backgroundColor: '#ffffff' }} />
            <div
              className="absolute top-0 bottom-0 pointer-events-auto cursor-ew-resize"
              style={{ left: -5, width: 10 }}
              onPointerDown={startScrub}
            />
          </div>
        </div>
      </div>

      {/* Floating ghost of the row being Alt-copy-dragged — mirrors the label box so
          it reads like the lifted row of a normal drag (top set imperatively). */}
      {copyDrag && (
        <div
          ref={ghostRef}
          className="fixed z-50 pointer-events-none flex items-center gap-2 px-3 border-r border-r-zinc-800/60 shadow-lg shadow-black/40"
          style={{ left: copyDrag.labelLeft, width: labelWidth, height: copyDrag.rowHeight, backgroundColor: '#202024', opacity: 0.8 }}
        >
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate text-white">{copyDrag.name}</div>
          </div>
          <div className="flex gap-1 flex-shrink-0">
            <div className={`w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center ${copyDrag.muted ? 'bg-amber-500 text-black' : 'bg-zinc-800 text-zinc-500'}`}>M</div>
            <div className={`w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center ${copyDrag.solo ? 'bg-green-500 text-black' : 'bg-zinc-800 text-zinc-500'}`}>S</div>
          </div>
        </div>
      )}

      {/* Resize handle along the label column's right edge — spans the full height
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
