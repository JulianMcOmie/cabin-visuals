'use client'

import Link from 'next/link'
import { Canvas } from '@react-three/fiber'
import { Play, Pause, Square, Upload, ChevronLeft, Plus } from 'lucide-react'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { useTimeStore } from './store/timeStore'
import { useProjectStore } from './store/ProjectStore'
import { Cube } from './instruments/Cube'
import { Track } from './components/Track'
import { LeftSidebar } from './components/LeftSidebar'
import { TrackEditor } from './components/TrackEditor'
import { TimelineRuler } from './components/TimelineRuler'
import { AudioBar } from './components/AudioBar'
import { usePlayback } from './hooks/usePlayback'

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

  return (
    <div className="flex flex-col h-full border-t border-zinc-800">
      <div className="flex items-center gap-2 h-8 px-3 bg-zinc-900/60 border-b border-zinc-800 flex-shrink-0">
        <span className="text-xs font-medium text-zinc-300">Tracks</span>
        <button className="flex items-center justify-center w-5 h-5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                onClick={insertPopulatedTrack}>
          <Plus size={12} />
        </button>
      </div>
      <TimelineRuler />
      <div className="flex-1 overflow-y-auto">
        {rootTrackIds.map((id) => {
          const track = tracks[id]
          return track ? <Track key={id} track={track} /> : null
        })}
      </div>
    </div>
  )
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

          <PanelResizeHandle className="w-px bg-zinc-800 hover:bg-indigo-500 transition-colors cursor-col-resize" />

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

                    <PanelResizeHandle className="w-px bg-zinc-800 hover:bg-indigo-500 transition-colors cursor-col-resize" />

                    {/* Canvas */}
                    <Panel>
                      <div className="relative h-full">
                        <BeatOverlay />
                        <Scene />
                      </div>
                    </Panel>

                  </PanelGroup>
                </Panel>

                <PanelResizeHandle className="h-px bg-zinc-800 hover:bg-indigo-500 transition-colors cursor-row-resize" />

                {/* Tracks */}
                <Panel defaultSize="28%" minSize="12%">
                  <TimelineArea />
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
