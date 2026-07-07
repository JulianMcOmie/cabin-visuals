'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Canvas } from '@react-three/fiber'
import { Play, Square, SkipBack, Upload, ChevronLeft, Maximize, Minimize, Sparkles, CloudOff } from 'lucide-react'
import { useVerticalSplit, DIVIDER_GRAB_INSET } from './useVerticalSplit'
import { useTimeStore } from './store/TimeStore'
import { useProjectStore } from './store/ProjectStore'
import { useUIStore } from './store/UIStore'
import { VisualScene } from './components/visual/VisualScene'
import { ExportDriver } from './components/visual/ExportDriver'
import { VisualBeatSync } from './core/visual/VisualBeatSync'
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
import { useAnonymousAdoption } from './hooks/useAnonymousAdoption'
import { useSaveStatus } from '../persistence/autosave'
import { usePlan, openBillingPortal } from '../billing/usePlan'
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
    <div ref={panelRef} className="relative h-full bg-[var(--bg-canvas)]">
      <BeatOverlay />
      <Scene />
      <div className="absolute top-2 right-3 z-10 flex items-center gap-2">
        <span className="font-mono text-[11px] text-[var(--text-muted)] select-none pointer-events-none">
          16:9 · 1080p
        </span>
        <button
          onClick={toggle}
          title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
          className="flex items-center justify-center w-6 h-6 rounded border border-[var(--border)] bg-[rgba(30,30,35,0.8)] text-[var(--text-3)] hover:text-[var(--text)] transition-colors cursor-pointer"
        >
          {isFullscreen ? <Minimize size={11} /> : <Maximize size={11} />}
        </button>
      </div>
    </div>
  )
}

function BeatOverlay() {
  const currentBeat = useTimeStore((s) => s.currentBeat)
  return (
    <div className="absolute top-2 left-3 z-10 pointer-events-none select-none">
      <span className="font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
        BEAT {currentBeat.toFixed(2)}
      </span>
    </div>
  )
}

// In ?template= demo mode nothing persists — say so, and point at signup.
function TemplateDemoChip() {
  const search = useSearchParams()
  if (search.get('project') || !search.get('template')) return null
  return (
    <span className="text-[11px] text-[var(--warn)] select-none whitespace-nowrap">
      Demo project — {' '}
      <Link href="/signup" className="text-[var(--warn)] underline underline-offset-2 hover:text-[#e0b568]">
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
        status === 'error' ? 'text-red-400' : 'text-[var(--text-muted)]'
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
  const projectName = useUIStore((s) => s.projectName)

  // Export: capability-gated (Chrome-first — WebCodecs or nothing).
  const [exportOpen, setExportOpen] = useState(false)
  const [exportGate, setExportGate] = useState<{ ok: boolean; reason?: string } | null>(null)
  useEffect(() => {
    void isExportSupported().then((s) => setExportGate({ ok: s.ok, reason: s.reason }))
  }, [])

  const plan = usePlan()
  const { user, loading: authLoading, isAnonymous } = useAuth()
  // "Has an account" — anonymous sessions are signed in for persistence only.
  const permanent = !authLoading && !!user && !isAnonymous

  return (
    <div className="h-12 flex-shrink-0 flex items-center gap-3 px-3 border-b border-[var(--border)] bg-[var(--bg-panel)] relative">
      <Link
        href={user ? '/projects' : '/'}
        className="flex-shrink-0 flex items-center gap-1 text-xs text-[var(--text-3)] hover:text-[var(--text)] transition-colors"
      >
        <ChevronLeft size={13} />
        {user ? 'Projects' : 'Home'}
      </Link>
      <div className="w-px h-4 bg-[var(--border)] flex-shrink-0" />
      <span className="text-xs font-medium text-[var(--text)] whitespace-nowrap truncate max-w-[180px]">
        {projectName ?? 'Untitled Project'}
      </span>

      <SaveStatusChip />
      {!authLoading && !user && (
        <span className="hidden md:flex items-center gap-1.5 text-[11px] text-[var(--warn)] select-none whitespace-nowrap">
          <CloudOff size={12} />
          Not saved —{' '}
          <Link href="/signup" className="text-[var(--warn)] underline underline-offset-2 hover:text-[#e0b568]">
            sign up to save
          </Link>
        </span>
      )}
      {!authLoading && user && isAnonymous && (
        <span className="hidden md:flex items-center gap-1.5 text-[11px] text-[var(--warn)] select-none whitespace-nowrap">
          <CloudOff size={12} />
          Saved on this device —{' '}
          <Link href="/signup" className="text-[var(--warn)] underline underline-offset-2 hover:text-[#e0b568]">
            sign up to keep it forever
          </Link>
        </span>
      )}
      <TemplateDemoChip />

      {/* Center transport — absolutely centered on the bar. */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-none select-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            onClick={isPlaying ? pause : reset}
            title={isPlaying ? 'Pause' : 'Return to start'}
            className="flex items-center justify-center w-7 h-7 rounded border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-3)] hover:text-[var(--text)] hover:border-[var(--border-strong)] transition-colors cursor-pointer"
          >
            {isPlaying
              ? <Square size={10} fill="currentColor" />
              : <SkipBack size={11} fill="currentColor" />}
          </button>
          <button
            onClick={isPlaying ? reset : play}
            title={isPlaying ? 'Restart from beginning' : 'Play (Space)'}
            className="flex items-center justify-center w-[34px] h-7 rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] transition-colors cursor-pointer"
          >
            <Play size={12} fill="currentColor" />
          </button>

          <span className="font-mono text-[13px] text-[var(--text)] bg-[var(--bg-app)] border border-[var(--border)] rounded px-2.5 py-1 min-w-[62px] text-center tabular-nums whitespace-nowrap">
            {formatBeat(currentBeat, beatsPerBar)}
          </span>

          <ProjectLengthControl />
          <BpmControl />
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2 flex-shrink-0">
        {permanent && !plan.loading && !plan.isPro && (
          <Link
            href="/pricing"
            title="Cabin Visuals Pro — watermark-free 1080p exports, $9/mo"
            className="flex items-center gap-1.5 h-7 px-2.5 rounded border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--warn)] hover:border-[var(--border-strong)] text-[11px] font-semibold transition-colors cursor-pointer"
          >
            <Sparkles size={11} strokeWidth={2.5} />
            Upgrade
          </Link>
        )}
        {plan.isPro && (
          <button
            onClick={() => void openBillingPortal().catch(() => {})}
            title="Manage your Pro subscription"
            className="h-7 px-2.5 rounded border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--warn)] text-[11px] font-semibold tracking-wide hover:border-[var(--border-strong)] transition-colors cursor-pointer"
          >
            PRO
          </button>
        )}
        <button
          onClick={() => setExportOpen(true)}
          disabled={exportGate?.ok === false}
          title={exportGate?.ok === false ? exportGate.reason : 'Export the project as an MP4'}
          className="flex items-center gap-1.5 h-7 px-3 rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:bg-[var(--bg-elevated)] disabled:text-[var(--text-muted)] text-[var(--on-accent)] text-[11px] font-bold transition-colors cursor-pointer disabled:cursor-default"
        >
          <Upload size={11} strokeWidth={2.5} />
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
  useAnonymousAdoption()
  const { topFrac, containerRef, startResize } = useVerticalSplit()

  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden bg-[var(--bg-app)] text-[var(--text)]">
      <Header />
      <div className="flex-1 min-h-0 flex">

        {/* Library — fixed 208px column, full height */}
        <div className="w-[208px] flex-shrink-0 min-w-0">
          <LeftSidebar />
        </div>

        {/* Center column: (inspector + canvas) above, tracks + audio strip below */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div ref={containerRef} className="flex flex-col flex-1 min-h-0">

            {/* Upper: TRACK inspector (280px fixed) + Canvas */}
            <div
              className="min-h-0 flex"
              style={{ flexBasis: `${topFrac * 100}%`, flexGrow: 0, flexShrink: 1 }}
            >
              <div className="w-[280px] flex-shrink-0 h-full">
                <TrackEditor />
              </div>
              <div className="flex-1 min-w-0 h-full">
                <VisualPanel />
              </div>
            </div>

            {/* Window-resize divider: invisible 1px line (the timeline's own border-t
                draws the visible rule) with a grab pad on top of its neighbours. */}
            <div className="relative h-px bg-transparent shrink-0">
              <div
                onPointerDown={startResize}
                className="absolute inset-x-0 z-50 cursor-ns-resize"
                style={{ top: -DIVIDER_GRAB_INSET, bottom: -DIVIDER_GRAB_INSET }}
              />
            </div>

            {/* Tracks / Piano Roll */}
            <div className="flex-1 min-h-[240px]">
              <BottomArea />
            </div>

          </div>

          <AudioBar />
        </div>
      </div>
    </div>
  )
}
