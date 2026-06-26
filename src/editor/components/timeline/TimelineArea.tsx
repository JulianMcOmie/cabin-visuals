'use client'

import { useRef, useLayoutEffect, type UIEvent as ReactScrollEvent } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { Plus, Magnet } from 'lucide-react'
import { useTimeStore } from '../../store/TimeStore'
import { useProjectStore } from '../../store/ProjectStore'
import { useUIStore } from '../../store/UIStore'
import { Track } from './Track'
import { TimelineRuler } from './TimelineRuler'
import { usePlayhead } from '../../hooks/usePlayhead'
import { useScrub } from '../../hooks/useScrub'
import { useTrackGestures } from './useTrackGestures'
import { useTrackCopyDrag, TRACK_ROW_HEIGHT } from './useTrackCopyDrag'
import { TRACK_LABEL_WIDTH, PLAYHEAD_TRIANGLE_HALF } from '../../constants'

export function TimelineArea() {
  const tracks = useProjectStore((s) => s.tracks)
  const rootTrackIds = useProjectStore((s) => s.rootTrackIds)
  const beatsPerBar = useTimeStore((s) => s.beatsPerBar)
  const totalBars = useTimeStore((s) => s.totalBars)
  const setSelectedTrackId = useUIStore((s) => s.setSelectedTrackId)
  const pixelsPerBeat = useUIStore((s) => s.tracksPixelsPerBeat)
  const timelineSnap = useUIStore((s) => s.timelineSnap)
  const setTimelineSnap = useUIStore((s) => s.setTimelineSnap)
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
      let beat = (clientX - rect.left) / pixelsPerBeat
      if (timelineSnap) beat = Math.round(beat) // snap to nearest beat
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
              <button
                onClick={() => setTimelineSnap(!timelineSnap)}
                title={`Snap playhead to beats (${timelineSnap ? 'on' : 'off'})`}
                className={`ml-auto flex items-center justify-center w-5 h-5 rounded transition-colors ${
                  timelineSnap
                    ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                }`}
              >
                <Magnet size={12} />
              </button>
            </div>
          }
        />
      </div>

      {/* Lanes: a relative wrapper holds the scroll container plus a viewport-space
          playhead overlay clipped to the lane region (so the playhead is never drawn
          over the frozen label column, its dividers, or the empty space — it slides
          under the label edge when scrolled). */}
      <div className="relative flex-1 min-h-0">
        {rootTrackIds.length === 0 && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
            <p className="text-xs text-zinc-600 text-center px-4">
              No tracks yet — click <span className="text-zinc-400">+</span> to add a track, then right-click a lane to draw blocks.
            </p>
          </div>
        )}
        <div
          ref={scrollRef}
          className="absolute inset-0 overflow-auto timeline-scrollbar"
          onScroll={onTimelineScroll}
        >
          <div
            className="relative flex flex-col"
            style={{ width: TRACK_LABEL_WIDTH + PLAYHEAD_TRIANGLE_HALF + timelineWidthPx, minHeight: '100%' }}
          >
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleTrackDragEnd}>
              <SortableContext items={rootTrackIds} strategy={verticalListSortingStrategy}>
                {rootTrackIds.map((id, i) => {
                  const track = tracks[id]
                  return track ? (
                    <Track
                      key={id}
                      track={track}
                      isLast={i === rootTrackIds.length - 1}
                      liftOffset={copyDrag ? (copyDrag.insertIndex != null && i >= copyDrag.insertIndex ? TRACK_ROW_HEIGHT : 0) : undefined}
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
            {/* Empty space below the tracks: deselect track + blocks, start a marquee */}
            <div
              className="flex-1 min-h-0"
              onContextMenu={(e) => e.preventDefault()}
              onPointerDown={(e) => {
                setSelectedTrackId(null)
                handleLanePointerDown(e)
              }}
            />

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

      {/* Floating ghost of the row being Alt-copy-dragged (top set imperatively). */}
      {copyDrag && (
        <div
          ref={ghostRef}
          className="fixed z-50 pointer-events-none flex items-center px-3 rounded border border-zinc-700 shadow-xl shadow-black/50"
          style={{ left: copyDrag.labelLeft, width: TRACK_LABEL_WIDTH, height: TRACK_ROW_HEIGHT, backgroundColor: '#27272a', opacity: 0.95 }}
        >
          <span className="text-xs font-medium text-white truncate">{copyDrag.name}</span>
        </div>
      )}
    </div>
  )
}
