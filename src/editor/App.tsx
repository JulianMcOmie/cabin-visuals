'use client'

import { useRef, type UIEvent as ReactScrollEvent } from 'react'
import Link from 'next/link'
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { Canvas } from '@react-three/fiber'
import { Play, Pause, Square, Upload, ChevronLeft, Plus } from 'lucide-react'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { useTimeStore } from './store/TimeStore'
import { useProjectStore } from './store/ProjectStore'
import { Cube } from './instruments/Cube'
import { Track } from './components/Track'
import { LeftSidebar } from './components/LeftSidebar'
import { TrackEditor } from './components/TrackEditor'
import { TimelineRuler } from './components/TimelineRuler'
import { AudioBar } from './components/AudioBar'
import { PianoRollPanel } from './components/PianoRollPanel'
import { useUIStore } from './store/UIStore'
import { usePlayback } from './hooks/usePlayback'
import { usePlayhead } from './hooks/usePlayhead'
import { useScrub } from './hooks/useScrub'
import { useTrackGestures } from './hooks/useTrackGestures'
import { TRACK_LABEL_WIDTH } from './constants'

if (typeof window !== 'undefined') {
  const { addTrack, addBlock, addNote, rootTrackIds } = useProjectStore.getState()
  if (rootTrackIds.length === 0) {
    const trackId = crypto.randomUUID()
    const blockId = crypto.randomUUID()

    addTrack({
      id: trackId,
      name: 'Cube',
      type: 'base' as const,
      instrumentId: 'cube',
      color: '#6366f1',
      muted: false,
      solo: false,
      blocks: [],
      childIds: [],
    })

    addBlock(trackId, {
      id: blockId,
      startBar: 0,
      durationBars: 1,
      loop: false,
      notes: [],
    })

    for (let i = 0; i < 4; i++) {
      addNote(trackId, blockId, {
        id: crypto.randomUUID(),
        startBeat: i,
        durationBeats: 0.5,
        pitch: 60,
        velocity: 100,
      })
    }
  }
}

function formatBeat(beat: number, beatsPerBar: number): string {
  const bar = Math.floor(beat / beatsPerBar) + 1
  const beatInBar = Math.floor(beat % beatsPerBar) + 1
  return `${bar.toString().padStart(3, '0')}:${beatInBar}`
}

function Scene() {
  return (
    <Canvas camera={{ position: [0, 1.2, 5], fov: 55 }} gl={{ antialias: true }}>
      <color attach="background" args={['#09090b']} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[4, 6, 4]} intensity={1.4} castShadow />
      <pointLight position={[-4, -2, 3]} color="#818cf8" intensity={3} />
      <pointLight position={[3, 3, -4]} color="#f0abfc" intensity={1.5} />
      <Cube />
      <gridHelper args={[24, 24, '#27272a', '#18181b']} position={[0, -2.2, 0]} />
    </Canvas>
  )
}

function BeatOverlay() {
  const currentBeat = useTimeStore((s) => s.currentBeat)
  return (
    <div className="absolute top-2 left-3 z-10 pointer-events-none select-none">
      <span className="text-xs text-zinc-500 font-mono tabular-nums">
        Beat: {currentBeat.toFixed(2)}
      </span>
    </div>
  )
}

function Header() {
  const isPlaying = useTimeStore((s) => s.isPlaying)
  const { play, pause, stop } = usePlayback();
  const currentBeat = useTimeStore((s) => s.currentBeat)
  const bpm = useTimeStore((s) => s.bpm)
  const beatsPerBar = useTimeStore((s) => s.beatsPerBar)

  return (
    <div className="h-14 flex-shrink-0 flex items-center gap-3 px-3 border-b border-zinc-800 bg-zinc-950 relative">
      <Link
        href="/"
        className="flex-shrink-0 flex items-center gap-0.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        <ChevronLeft size={14} />
        Projects
      </Link>

      <div className="w-px h-5 bg-zinc-800 flex-shrink-0" />

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          onClick={stop}
          title="Stop"
          className="flex items-center justify-center w-7 h-7 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <Square size={10} fill="currentColor" />
        </button>
        <button
          onClick={isPlaying ? pause : play}
          title={isPlaying ? 'Pause' : 'Play'}
          className="flex items-center justify-center w-8 h-8 rounded bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white transition-colors shadow-lg shadow-indigo-950/60"
        >
          {isPlaying
            ? <Pause size={13} fill="currentColor" />
            : <Play size={13} fill="currentColor" />}
        </button>
      </div>

      <div className="font-mono text-sm text-indigo-300 bg-zinc-900 px-3 py-1 rounded border border-zinc-800 min-w-[72px] text-center tabular-nums flex-shrink-0 select-none">
        {formatBeat(currentBeat, beatsPerBar)}
      </div>

      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-none select-none">
        <img src="/logo.svg" alt="" className="h-12 w-auto" />
        <span className="text-xl text-zinc-200 translate-y-2">Cabin Visuals</span>
      </div>

      <div className="ml-auto flex items-center gap-3 flex-shrink-0">
        <span className="font-mono text-xs text-zinc-500 select-none tabular-nums">
          BPM:{' '}
          <span className="text-zinc-200">{bpm}</span>
        </span>
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-semibold transition-colors">
          <Upload size={12} strokeWidth={2.5} />
          Export
        </button>
      </div>
    </div>
  )
}

function TimelineArea() {
  const tracks = useProjectStore((s) => s.tracks)
  const rootTrackIds = useProjectStore((s) => s.rootTrackIds)
  const beatsPerBar = useTimeStore((s) => s.beatsPerBar)
  const totalBars = useTimeStore((s) => s.totalBars)
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
  }

  const { selectedBlockIds, marqueeRect, handleBlockPointerDown, handleLanePointerDown } = useTrackGestures({ laneRef })

  // Track reordering via dnd-kit (drag the track label). A 5px activation
  // distance keeps clicks (select / mute / solo) from starting a drag.
  const reorderRootTracks = useProjectStore((s) => s.reorderRootTracks)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const handleTrackDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = rootTrackIds.indexOf(active.id as string)
    const newIndex = rootTrackIds.indexOf(over.id as string)
    if (oldIndex < 0 || newIndex < 0) return
    reorderRootTracks(arrayMove(rootTrackIds, oldIndex, newIndex))
  }

  const { startScrub } = useScrub({
    computeBeat: (clientX) => {
      if (!laneRef.current) return null
      const rect = laneRef.current.getBoundingClientRect()
      const beat = (clientX - rect.left) / pixelsPerBeat
      return Math.max(0, Math.min(maxBeat, beat))
    },
  })

  usePlayhead((beat) => {
    const beatX = beat * pixelsPerBeat
    const sc = scrollRef.current
    // Clip the playhead overlay to the scroll container's client area (excludes the
    // scrollbars) so the line never draws over them.
    if (sc && clipRef.current) {
      clipRef.current.style.width = `${Math.max(0, sc.clientWidth - TRACK_LABEL_WIDTH)}px`
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

  function insertPopulatedTrack() {
    const { addTrack, addBlock, addNote } = useProjectStore.getState()
    const trackId = crypto.randomUUID()
    const blockId = crypto.randomUUID()
  
    addTrack({
      id: trackId,
      name: 'Cube',
      type: 'base' as const,
      instrumentId: 'cube',
      color: '#6366f1',
      muted: false,
      solo: false,
      blocks: [],
      childIds: [],
    })
  
    addBlock(trackId, {
      id: blockId,
      startBar: Math.random() * 2,
      durationBars: Math.round(Math.random() * 3 + 1),
      loop: false,
      notes: [],
    })
  
    for (let i = 0; i < 4; i++) {
      addNote(trackId, blockId, {
        id: crypto.randomUUID(),
        startBeat: i,
        durationBeats: 0.5,
        pitch: 60,
        velocity: 100,
      })
    }
  }

  return (
    <div className="flex flex-col h-full border-t border-zinc-800">
      <div className="flex items-center gap-2 h-8 px-3 bg-zinc-900/60 border-b border-zinc-800 flex-shrink-0">
        <span className="text-xs font-medium text-zinc-300">Tracks</span>
        <button className="flex items-center justify-center w-5 h-5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                onClick={insertPopulatedTrack}>
          <Plus size={12} />
        </button>
      </div>
      {/* Ruler in its own row (not inside the lane scroll container) so the lanes
          own the only scrollbars: the vertical one then ends below the ruler. Its
          content is translated to mirror the lane scroll (onTimelineScroll); the
          gutter reserves the lanes' scrollbar width so the strip ends where the
          lanes' content does. */}
      <div className="flex-shrink-0">
        <TimelineRuler
          onScrubStart={startScrub}
          barWidthPx={barWidthPx}
          timelineWidthPx={timelineWidthPx}
          gutterPx={0}
          contentRef={rulerContentRef}
          playheadHeadRef={playheadHeadRef}
        />
      </div>

      {/* Lanes: a relative wrapper holds the scroll container plus a viewport-space
          playhead overlay clipped to the lane region (so the playhead is never drawn
          over the frozen label column, its dividers, or the empty space — it slides
          under the label edge when scrolled). */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          className="absolute inset-0 overflow-auto timeline-scrollbar"
          onScroll={onTimelineScroll}
        >
          <div
            className="relative flex flex-col"
            style={{ width: TRACK_LABEL_WIDTH + timelineWidthPx, minHeight: '100%' }}
          >
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleTrackDragEnd}>
              <SortableContext items={rootTrackIds} strategy={verticalListSortingStrategy}>
                {rootTrackIds.map((id) => {
                  const track = tracks[id]
                  return track ? (
                    <Track
                      key={id}
                      track={track}
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
              onPointerDown={(e) => {
                setSelectedTrackId(null)
                handleLanePointerDown(e)
              }}
            />

            {/* Marquee overlay (content space, so its coords match block rects). */}
            <div
              ref={laneRef}
              className="absolute bottom-0 top-0 z-10 pointer-events-none"
              style={{ left: TRACK_LABEL_WIDTH, width: timelineWidthPx }}
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
        <div ref={clipRef} className="absolute top-0 overflow-hidden pointer-events-none" style={{ left: TRACK_LABEL_WIDTH }}>
          <div ref={playheadRef} className="absolute top-0 bottom-0" style={{ left: 0, width: 0 }}>
            <div className="absolute top-0 bottom-0" style={{ left: -0.25, width: 0.5, backgroundColor: '#ffffff' }} />
            <div
              className="absolute top-0 bottom-0 pointer-events-auto cursor-col-resize"
              style={{ left: -5, width: 10 }}
              onPointerDown={startScrub}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function BottomArea() {
  const editingBlock = useUIStore((s) => s.editingBlock)
  return editingBlock ? <PianoRollPanel /> : <TimelineArea />
}

export default function EditorApp() {
  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden bg-zinc-950">
      <Header />
      <div className="flex-1 min-h-0">
        <PanelGroup orientation="horizontal" style={{ height: '100%' }}>

          {/* Library */}
          <Panel defaultSize="19%" minSize="8%" maxSize="30%">
            <LeftSidebar />
          </Panel>

          <PanelResizeHandle className="w-px bg-zinc-800 cursor-col-resize outline-none focus:outline-none" />

          {/* Right section: TrackEditor + Canvas above, Tracks + AudioBar below */}
          <Panel>
            <div className="flex flex-col h-full">
              <PanelGroup orientation="vertical" style={{ flex: 1, minHeight: 0 }}>

                {/* Upper: TrackEditor + Canvas */}
                <Panel defaultSize="53%" minSize="30%">
                  <PanelGroup orientation="horizontal" style={{ height: '100%' }}>

                    <Panel defaultSize="40%" minSize="15%" maxSize="60%">
                      <TrackEditor />
                    </Panel>

                    <PanelResizeHandle className="w-px bg-zinc-800 cursor-col-resize outline-none focus:outline-none" />

                    {/* Canvas */}
                    <Panel>
                      <div className="relative h-full">
                        <BeatOverlay />
                        <Scene />
                      </div>
                    </Panel>

                  </PanelGroup>
                </Panel>

                <PanelResizeHandle className="h-px bg-zinc-800 cursor-row-resize outline-none focus:outline-none" />

                {/* Tracks / Piano Roll */}
                <Panel defaultSize="28%" minSize="12%">
                  <BottomArea />
                </Panel>

              </PanelGroup>

              <AudioBar />
            </div>
          </Panel>

        </PanelGroup>
      </div>
    </div>
  )
}
