'use client'

import Link from 'next/link'
import { Canvas } from '@react-three/fiber'
import { Play, Pause, Square, Upload, ChevronLeft } from 'lucide-react'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { useTimeStore } from './store/TimeStore'
import { useProjectStore } from './store/ProjectStore'
import { useUIStore } from './store/UIStore'
import { Cube } from './instruments/Cube'
import { CabinLogo } from '../components/CabinLogo'
import { LeftSidebar } from './components/LeftSidebar'
import { TrackEditor } from './components/TrackEditor'
import { AudioBar } from './components/AudioBar'
import { BpmControl } from './components/BpmControl'
import { PianoRollPanel } from './components/midi/PianoRollPanel'
import { TimelineArea } from './components/timeline/TimelineArea'
import { usePlayback } from './hooks/usePlayback'
import { useTransportKeys } from './hooks/useTransportKeys'
import { useUndoRedoKeys } from './hooks/useUndoRedoKeys'
import { PANEL_RESIZE_HIT } from './constants'

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
  const { play, pause, reset } = usePlayback();
  useTransportKeys({ play, pause, reset })
  useUndoRedoKeys()
  const currentBeat = useTimeStore((s) => s.currentBeat)
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)

  return (
    <div className="h-14 flex-shrink-0 flex items-center gap-3 px-3 border-b border-zinc-800 bg-[#1e1e21] relative">
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
          onClick={reset}
          title="Return to start (Enter)"
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
        <CabinLogo className="h-12 w-auto" />
        <span className="text-xl text-zinc-200 translate-y-2">Cabin Visuals</span>
      </div>

      <div className="ml-auto flex items-center gap-3 flex-shrink-0">
        <BpmControl />
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-semibold transition-colors">
          <Upload size={12} strokeWidth={2.5} />
          Export
        </button>
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
    <div className="w-screen h-screen flex flex-col overflow-hidden bg-[#1e1e21]">
      <Header />
      <div className="flex-1 min-h-0">
        <PanelGroup orientation="horizontal" style={{ height: '100%' }}>

          {/* Library */}
          <Panel defaultSize="15%" minSize="8%" maxSize="30%">
            <LeftSidebar />
          </Panel>

          <PanelResizeHandle className="w-px bg-zinc-800 cursor-col-resize outline-none focus:outline-none" />

          {/* Right section: TrackEditor + Canvas above, Tracks + AudioBar below */}
          <Panel>
            <div className="flex flex-col h-full">
              <PanelGroup orientation="vertical" style={{ flex: 1, minHeight: 0 }} resizeTargetMinimumSize={{ coarse: 2 * PANEL_RESIZE_HIT, fine: PANEL_RESIZE_HIT }}>

                {/* Upper: TrackEditor + Canvas */}
                <Panel defaultSize="45%" minSize="30%">
                  <PanelGroup orientation="horizontal" style={{ height: '100%' }}>

                    <Panel defaultSize="55%" minSize="15%" maxSize="60%">
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
                <Panel defaultSize="55%" minSize="12%">
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
