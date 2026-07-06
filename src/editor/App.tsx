'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Canvas } from '@react-three/fiber'
import { Play, Square, SkipBack, Upload, ChevronLeft, Maximize, Minimize, Sparkles, CloudOff } from 'lucide-react'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { useVerticalSplit, DIVIDER_GRAB_INSET } from './useVerticalSplit'
import { useTimeStore } from './store/TimeStore'
import { useProjectStore } from './store/ProjectStore'
import { useUIStore } from './store/UIStore'
import { VisualScene } from './components/visual/VisualScene'
import { ExportDriver } from './components/visual/ExportDriver'
import { VisualBeatSync } from './core/visual/VisualBeatSync'
import { CabinLogo } from '../components/CabinLogo'
import { LeftSidebar } from './components/LeftSidebar'
import { TrackEditor } from './components/TrackEditor'
import { AudioBar } from './components/AudioBar'
import { BpmControl } from './components/BpmControl'
import { ProjectLengthControl } from './components/ProjectLengthControl'
import { ExportDialog } from './components/ExportDialog'
import { isExportSupported } from './core/export/support'
import { PianoRollPanel } from './components/midi/PianoRollPanel'
import { TimelineArea } from './components/timeline/TimelineArea'
import { usePlayback } from './hooks/usePlayback'
import { useTransportKeys } from './hooks/useTransportKeys'
import { useUndoRedoKeys } from './hooks/useUndoRedoKeys'
import { useProjectPersistence } from './hooks/useProjectPersistence'
import { useSaveStatus } from '../persistence/autosave'
import { usePlan, startCheckout, openBillingPortal } from '../billing/usePlan'
import { useAuth } from '../persistence/hooks/useAuth'

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
      <VisualBeatSync />
      <ExportDriver />
      <VisualScene />
    </Canvas>
  )
}

// The visual panel: the canvas plus a fullscreen toggle (button or F).
// Fullscreen targets the panel div, so the beat overlay and this button ride
// along; R3F resizes to the new box on its own, and the aspect-aware
// instruments re-compose — the same path the export pin exercises.
function VisualPanel() {
  const panelRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === panelRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    // Denied requests (kiosk/embedded contexts) fail quietly — the button just does nothing.
    else void panelRef.current?.requestFullscreen().catch(() => {})
  }

  // F toggles fullscreen (guarded like the transport keys: not while typing).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.code === 'KeyF') toggle()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div ref={panelRef} className="relative h-full bg-[#09090b]">
      <BeatOverlay />
      <Scene />
      <button
        onClick={toggle}
        title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
        className="absolute top-2 right-3 z-10 flex items-center justify-center w-6 h-6 rounded bg-zinc-900/70 hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors"
      >
        {isFullscreen ? <Minimize size={12} /> : <Maximize size={12} />}
      </button>
    </div>
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

// In ?template= demo mode nothing persists — say so, and point at signup.
function TemplateDemoChip() {
  const search = useSearchParams()
  if (search.get('project') || !search.get('template')) return null
  return (
    <span className="text-[11px] text-amber-400/90 select-none whitespace-nowrap">
      Demo project — {' '}
      <Link href="/signup" className="underline underline-offset-2 hover:text-amber-300">
        sign up to save it
      </Link>
    </span>
  )
}

// Autosave status: quiet when in sync, explicit when saving or in trouble.
function SaveStatusChip() {
  const status = useSaveStatus((s) => s.status)
  if (status === 'idle') return null
  const label = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save failed'
  return (
    <span
      className={`text-[11px] select-none whitespace-nowrap ${
        status === 'error' ? 'text-red-400' : 'text-zinc-600'
      }`}
    >
      {label}
    </span>
  )
}

function Header() {
  const isPlaying = useTimeStore((s) => s.isPlaying)
  const { play, pause, reset } = usePlayback();
  useTransportKeys({ play, pause, reset })
  useUndoRedoKeys()
  const currentBeat = useTimeStore((s) => s.currentBeat)
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)

  // Export: capability-gated (Chrome-first — WebCodecs or nothing).
  const [exportOpen, setExportOpen] = useState(false)
  const [exportGate, setExportGate] = useState<{ ok: boolean; reason?: string } | null>(null)
  useEffect(() => {
    void isExportSupported().then((s) => setExportGate({ ok: s.ok, reason: s.reason }))
  }, [])

  const plan = usePlan()
  const { user, loading: authLoading } = useAuth()

  return (
    <div className="h-14 flex-shrink-0 flex items-center gap-3 px-3 border-b border-zinc-800 bg-[#1e1e21] relative">
      <Link
        href={user ? '/projects' : '/'}
        className="flex-shrink-0 flex items-center gap-0.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        <ChevronLeft size={14} />
        {user ? 'Projects' : 'Home'}
      </Link>

      <SaveStatusChip />
      {!authLoading && !user && (
        <span className="hidden md:flex items-center gap-1.5 text-[11px] text-amber-400/90 select-none whitespace-nowrap">
          <CloudOff size={12} />
          Your work isn&apos;t saved —{' '}
          <Link href="/signup" className="underline underline-offset-2 hover:text-amber-300">
            sign up to keep it
          </Link>
        </span>
      )}
      <TemplateDemoChip />

      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-10 pointer-events-none select-none">
        <CabinLogo className="h-10 w-auto -translate-y-0 pointer-events-auto" strokeWidth={95} />

        {/* Transport + beat readout — its own group, right of centre with a gap from
            the logo (which sits left of centre), so the pair straddles the page centre. */}
        <div className="flex items-center gap-2.5 pointer-events-auto">
          <div className="flex items-center gap-1.5">
            <button
              onClick={isPlaying ? pause : reset}
              title={isPlaying ? 'Pause' : 'Return to start'}
              className="flex items-center justify-center w-7 h-7 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {isPlaying
                ? <Square size={10} fill="currentColor" />
                : <SkipBack size={12} fill="currentColor" />}
            </button>
            <button
              onClick={isPlaying ? reset : play}
              title={isPlaying ? 'Restart from beginning' : 'Play'}
              className={`flex items-center justify-center w-8 h-8 rounded transition-colors ${
                isPlaying
                  ? 'bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white shadow-lg shadow-indigo-950/60'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Play size={13} fill="currentColor" />
            </button>
          </div>

          <div className="font-mono text-sm text-indigo-300 bg-zinc-900 px-3 py-1 rounded border border-zinc-800 min-w-[72px] text-center tabular-nums whitespace-nowrap">
            {formatBeat(currentBeat, beatsPerBar)}
          </div>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-3 flex-shrink-0">
        <ProjectLengthControl />
        <BpmControl />
        {!authLoading && !user && (
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="px-3 py-1.5 rounded text-zinc-300 hover:text-white hover:bg-zinc-800 text-xs font-semibold transition-colors cursor-pointer"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              Sign up
            </Link>
          </div>
        )}
        {!authLoading && user && !plan.loading && !plan.isPro && (
          <button
            onClick={() => void startCheckout().catch(() => {})}
            title="Cabin Visuals Pro — watermark-free 1080p exports, $9/mo"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-amber-500/50 text-amber-400 hover:bg-amber-500/10 hover:border-amber-400 text-xs font-semibold transition-colors cursor-pointer"
          >
            <Sparkles size={12} strokeWidth={2.5} />
            Upgrade
          </button>
        )}
        {plan.isPro && (
          <button
            onClick={() => void openBillingPortal().catch(() => {})}
            title="Manage your Pro subscription"
            className="px-2 py-1 rounded bg-amber-500/15 text-amber-400 text-[11px] font-semibold tracking-wide hover:bg-amber-500/25 transition-colors cursor-pointer"
          >
            PRO
          </button>
        )}
        <button
          onClick={() => setExportOpen(true)}
          disabled={exportGate?.ok === false}
          title={exportGate?.ok === false ? exportGate.reason : 'Export the project as an MP4'}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-xs font-semibold transition-colors cursor-pointer disabled:cursor-default"
        >
          <Upload size={12} strokeWidth={2.5} />
          Export
        </button>
      </div>
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} isPro={plan.isPro} />}
    </div>
  )
}

function BottomArea() {
  const editingBlock = useUIStore((s) => s.editingBlock)
  return editingBlock ? <PianoRollPanel /> : <TimelineArea />
}

export default function EditorApp() {
  useProjectPersistence()
  const { topFrac, containerRef, startResize } = useVerticalSplit()

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
              <div ref={containerRef} className="flex flex-col flex-1 min-h-0">

                {/* Upper: TrackEditor + Canvas */}
                <div className="min-h-0" style={{ flexBasis: `${topFrac * 100}%`, flexGrow: 0, flexShrink: 0 }}>
                  <PanelGroup orientation="horizontal" style={{ height: '100%' }}>

                    <Panel defaultSize="55%" minSize="15%" maxSize="60%">
                      <TrackEditor />
                    </Panel>

                    <PanelResizeHandle className="w-px bg-zinc-800 cursor-col-resize outline-none focus:outline-none" />

                    {/* Canvas */}
                    <Panel>
                      <VisualPanel />
                    </Panel>

                  </PanelGroup>
                </div>

                {/* Window-resize divider: a 1px line (unchanged look) with an invisible
                    grab pad on top of its neighbours — see note above. */}
                <div className="relative h-px bg-zinc-800/60 shrink-0">
                  <div
                    onPointerDown={startResize}
                    className="absolute inset-x-0 z-50 cursor-ns-resize"
                    style={{ top: -DIVIDER_GRAB_INSET, bottom: -DIVIDER_GRAB_INSET }}
                  />
                </div>

                {/* Tracks / Piano Roll */}
                <div className="flex-1 min-h-0">
                  <BottomArea />
                </div>

              </div>

              <AudioBar />
            </div>
          </Panel>

        </PanelGroup>
      </div>
    </div>
  )
}
