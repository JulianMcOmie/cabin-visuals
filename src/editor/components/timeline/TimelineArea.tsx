'use client'

import { useRef, useEffect, useLayoutEffect, type UIEvent as ReactScrollEvent } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import { useProjectStore } from '../../store/ProjectStore'
import { useUIStore } from '../../store/UIStore'
import { Track } from './Track'
import { TimelineRuler } from './TimelineRuler'
import { usePlayhead } from '../../hooks/usePlayhead'
import { useScrub } from '../../hooks/useScrub'
import { useTrackGestures } from './useTrackGestures'
import { useTrackCopyDrag } from './useTrackCopyDrag'
import { TRACK_LABEL_WIDTH, PLAYHEAD_TRIANGLE_HALF, PLAYHEAD_SNAP_BEATS } from '../../constants'

export function TimelineArea() {
  const tracks = useProjectStore((s) => s.tracks)
  const rootTrackIds = useProjectStore((s) => s.rootTrackIds)
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)
  const totalBars = useProjectStore((s) => s.totalBars)
  const setSelectedTrackId = useUIStore((s) => s.setSelectedTrackId)
  const pixelsPerBeat = useUIStore((s) => s.tracksPixelsPerBeat)
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

  // Track reordering via dnd-kit (drag the track label). A 5px activation
  // distance keeps clicks (select / mute / solo) from starting a drag.
  const reorderRootTracks = useProjectStore((s) => s.reorderRootTracks)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  // Alt copy-drag is a hand-rolled gesture intercepted before dnd-kit ever sees
  // the pointerdown (Track's onPointerDownCapture), so dnd-kit only handles plain
  // reordering here.
  const { copyDrag, ghostRef, startTrackCopyDrag } = useTrackCopyDrag(scrollRef)

  // Reflow rows for either drag: alt-copy of an existing track, or dragging a new
  // instrument in from the library. Both open a gap at their live insertion index.
  const libraryDrag = useUIStore((s) => s.libraryDrag)
  const dragActive = !!copyDrag || !!libraryDrag
  const dragInsertIndex = copyDrag ? copyDrag.insertIndex : libraryDrag?.insertIndex ?? null
  const dragRowHeight = copyDrag ? copyDrag.rowHeight : libraryDrag?.rowHeight ?? 0
  const handleTrackDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = useProjectStore.getState().rootTrackIds
    const oldIndex = ids.indexOf(active.id as string)
    const newIndex = ids.indexOf(over.id as string)
    if (oldIndex < 0 || newIndex < 0) return
    reorderRootTracks(arrayMove(ids, oldIndex, newIndex))
  }

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
      clipRef.current.style.width = `${Math.max(0, sc.clientWidth - TRACK_LABEL_WIDTH - PLAYHEAD_TRIANGLE_HALF)}px`
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
    useProjectStore.getState().addTrack({
      id: crypto.randomUUID(),
      name: 'Cube',
      type: 'base' as const,
      instrumentId: 'cube',
      color: '#6366f1',
      muted: false,
      solo: false,
      blocks: [],
      childIds: [],
    })
  }

  return (
    <div className="flex flex-col h-full border-t border-zinc-800 bg-zinc-900">
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
              No tracks yet — click <span className="text-zinc-400">+</span> to add a track, then right-click a lane to draw blocks.
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
            style={{ width: TRACK_LABEL_WIDTH + PLAYHEAD_TRIANGLE_HALF + timelineWidthPx, minHeight: '100%' }}
          >
            <DndContext sensors={sensors} collisionDetection={closestCenter} autoScroll={false} onDragEnd={handleTrackDragEnd}>
              <SortableContext items={rootTrackIds} strategy={verticalListSortingStrategy}>
                {rootTrackIds.map((id, i) => {
                  const track = tracks[id]
                  return track ? (
                    <Track
                      key={id}
                      track={track}
                      isLast={i === rootTrackIds.length - 1}
                      liftOffset={dragActive ? (dragInsertIndex != null && i >= dragInsertIndex ? dragRowHeight : 0) : undefined}
                      onCopyDragStart={startTrackCopyDrag}
                      barWidthPx={barWidthPx}
                      timelineWidthPx={timelineWidthPx}
                      selectedBlockIds={selectedBlockIds}
                      onBlockPointerDown={handleBlockPointerDown}
                      onLanePointerDown={handleLanePointerDown}
                    />
                  ) : null
                })}
              </SortableContext>
            </DndContext>
            {/* Empty space below the tracks. The label-column portion belongs to the
                label section — it deselects but is otherwise inert (no marquee); only
                the lane portion behaves like the grid. */}
            <div className="flex-1 min-h-0 flex">
              <div
                className={`flex-shrink-0 sticky left-0 z-10 border-r border-r-zinc-800/60 bg-[#202024] ${
                  rootTrackIds.length > 0 ? 'border-t border-t-zinc-900' : ''
                }`}
                style={{ width: TRACK_LABEL_WIDTH }}
                onPointerDown={() => setSelectedTrackId(null)}
              />
              <div
                className="flex-1"
                onContextMenu={(e) => e.preventDefault()}
                onPointerDown={(e) => {
                  setSelectedTrackId(null)
                  handleLanePointerDown(e)
                }}
              />
            </div>

            {/* Marquee overlay (content space, so its coords match block rects). */}
            <div
              ref={laneRef}
              className="absolute bottom-0 top-0 z-10 pointer-events-none"
              style={{ left: TRACK_LABEL_WIDTH + PLAYHEAD_TRIANGLE_HALF, width: timelineWidthPx }}
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
        <div ref={clipRef} className="absolute top-0 overflow-hidden pointer-events-none" style={{ left: TRACK_LABEL_WIDTH + PLAYHEAD_TRIANGLE_HALF }}>
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
          style={{ left: copyDrag.labelLeft, width: TRACK_LABEL_WIDTH, height: copyDrag.rowHeight, backgroundColor: '#202024', opacity: 0.8 }}
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
    </div>
  )
}
