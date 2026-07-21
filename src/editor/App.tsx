'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Canvas, useThree } from '@react-three/fiber'
import { Play, Square, SkipBack, Upload, ChevronLeft, Maximize, Minimize, Sparkles, CloudOff, Pencil, Loader2 } from 'lucide-react'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { useVerticalSplit, DIVIDER_GRAB_INSET } from './useVerticalSplit'
import { useTimeStore } from './store/TimeStore'
import { useProjectStore, type ViewAspect } from './store/ProjectStore'
import { useUIStore } from './store/UIStore'
import { VisualScene } from './components/visual/VisualScene'
import { ExportDriver } from './components/visual/ExportDriver'
import { RenderGovernor } from './components/visual/RenderGovernor'
import { VisualBeatSync } from './core/visual/VisualBeatSync'
import { setMainPreviewEnabled } from './core/visual/VisualEngine'
import { ProfileMenu } from '../components/ProfileMenu'
import { track } from '../analytics/analytics'
import { TutorialOverlay } from './components/TutorialOverlay'
import { LeftSidebar } from './components/LeftSidebar'
import { TrackEditor } from './components/TrackEditor'
import { AudioBar } from './components/AudioBar'
import { BpmControl } from './components/BpmControl'
import { ProjectLengthControl } from './components/ProjectLengthControl'
import { ExportDialog } from './components/ExportDialog'
import { MediaFileDropLayer } from './components/MediaFileDropLayer'
import { isExportSupported } from './core/export/support'
import { PianoRollPanel } from './components/midi/PianoRollPanel'
import { PreviewCaptureButton } from './components/PreviewCaptureButton'
import { TimelineArea } from './components/timeline/TimelineArea'
import { SceneTabs } from './components/SceneTabs'
import { usePlayback } from './hooks/usePlayback'
import { useTransportKeys } from './hooks/useTransportKeys'
import { useUndoRedoKeys } from './hooks/useUndoRedoKeys'
import { useProjectPersistence } from './hooks/useProjectPersistence'
import { useAnonymousAdoption } from './hooks/useAnonymousAdoption'
import { useSaveStatus } from '../persistence/autosave'
import { ConflictDialog } from './components/ConflictDialog'
import * as projectStorage from '../persistence/projectStorage'
import { usePlan, openBillingPortal } from '../billing/usePlan'
import { useAuth } from '../persistence/hooks/useAuth'

// Dev-only: expose the stores for console/E2E debugging. Never ships.
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  ;(window as unknown as Record<string, unknown>).__cabinStores = {
    project: useProjectStore,
    ui: useUIStore,
    time: useTimeStore,
  }
}

function formatBeat(beat: number, beatsPerBar: number): string {
  const bar = Math.floor(beat / beatsPerBar) + 1
  const beatInBar = Math.floor(beat % beatsPerBar) + 1
  return `${bar.toString().padStart(3, '0')}:${beatInBar}`
}

// Dev-only companion to __cabinStores: exposes the r3f state (scene, camera,
// renderer) so console/E2E checks can inspect the scene graph. Never ships.
function DevThreeHook() {
  const three = useThree()
  if (process.env.NODE_ENV === 'development') {
    ;(window as unknown as Record<string, unknown>).__three = three
  }
  return null
}

function PreviewModeSync({ main }: { main: boolean }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    setMainPreviewEnabled(main)
    invalidate()
    return () => setMainPreviewEnabled(false)
  }, [main, invalidate])
  return null
}

function Scene({ previewMain }: { previewMain: boolean }) {
  // Paused → 'demand': the render loop idles instead of redrawing a static
  // frame 60×/s (heavy instruments were starving the editor UI even while
  // paused). RenderGovernor requests single frames when an input changes.
  const isPlaying = useTimeStore((s) => s.isPlaying)
  return (
    <Canvas shadows="soft" frameloop={isPlaying ? 'always' : 'demand'} dpr={[1, 1.5]} camera={{ position: [0, 1.2, 5], fov: 55 }} gl={{ antialias: true }}>
      <color attach="background" args={['#09090b']} />
      <PreviewModeSync main={previewMain} />
      <VisualBeatSync />
      <ExportDriver />
      <RenderGovernor />
      {process.env.NODE_ENV === 'development' && <DevThreeHook />}
      {/* Suspense: instruments may load assets through useLoader. */}
      <Suspense fallback={null}>
        <VisualScene />
      </Suspense>
    </Canvas>
  )
}

// The visual panel: the canvas plus fullscreen (button or F) and an aspect
// pin. Fullscreen targets the panel div, so the beat overlay and the buttons
// ride along; R3F resizes to whatever box the canvas gets, and the
// aspect-aware instruments re-compose - the same path the export pin
// exercises, which is exactly why pinning the editor view to 16:9 or 9:16
// previews what an export at that aspect will compose like.

const VIEW_ASPECTS: ViewAspect[] = ['fill', '16:9', '9:16']

function VisualPanel() {
  const panelRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [previewMode, setPreviewMode] = useState<'current' | 'main'>('current')
  // A project setting (persisted in the document, seeds the export default).
  const aspect = useProjectStore((s) => s.viewAspect)
  const setAspect = useProjectStore((s) => s.setViewAspect)
  // Panel size, tracked so the letterboxed canvas box is computed (CSS alone
  // can't contain-fit an aspect-ratio box against both dimensions).
  const [panelSize, setPanelSize] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect
      setPanelSize({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === panelRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    // Denied requests (kiosk/embedded contexts) fail quietly - the button just does nothing.
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

  // Contain-fit the chosen aspect inside the panel; 'fill' keeps the old
  // fill-the-panel behavior (box = null → plain inset-0).
  let box: { w: number; h: number } | null = null
  if (aspect !== 'fill' && panelSize) {
    const target = aspect === '16:9' ? 16 / 9 : 9 / 16
    let w = panelSize.w
    let h = w / target
    if (h > panelSize.h) { h = panelSize.h; w = h * target }
    box = { w, h }
  }

  return (
    <div ref={panelRef} className={`relative h-full ${box ? 'bg-[var(--bg-canvas-deep)]' : 'bg-[var(--bg-canvas)]'}`}>
      <div
        className={`absolute ${box ? 'border border-[var(--border-subtle)]' : 'inset-0'}`}
        style={box ? { width: box.w, height: box.h, left: (panelSize!.w - box.w) / 2, top: (panelSize!.h - box.h) / 2 } : undefined}
      >
        <Scene previewMain={previewMode === 'main'} />
      </div>
      <BeatOverlay />
      <TutorialOverlay />
      <div className="absolute top-2 right-3 z-10 flex items-center gap-2">
        <div
          role="group"
          aria-label="Canvas preview"
          className="flex items-center overflow-hidden rounded border border-[var(--border)] bg-[rgba(30,30,35,0.8)]"
        >
          {(['current', 'main'] as const).map((mode) => {
            const active = previewMode === mode
            return (
              <button
                key={mode}
                onClick={() => setPreviewMode(mode)}
                title={mode === 'current' ? 'View the scene currently being edited' : 'View the final Main composition'}
                aria-pressed={active}
                className={`h-6 px-2 text-[10px] font-medium transition-colors cursor-pointer ${
                  active
                    ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                    : 'text-[var(--text-3)] hover:text-[var(--text)]'
                }`}
              >
                {mode === 'current' ? 'Current' : 'Main'}
              </button>
            )
          })}
        </div>
        <button
          onClick={() => setAspect(VIEW_ASPECTS[(VIEW_ASPECTS.indexOf(aspect) + 1) % VIEW_ASPECTS.length])}
          title="Preview aspect ratio - see the visual as a 16:9 or 9:16 export would compose it"
          className="flex items-center justify-center h-6 px-1.5 rounded border border-[var(--border)] bg-[rgba(30,30,35,0.8)] font-mono text-[9px] text-[var(--text-3)] hover:text-[var(--text)] transition-colors cursor-pointer uppercase tracking-wide"
        >
          {aspect === 'fill' ? 'Fill' : aspect}
        </button>
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

// The project name in the top bar: double-click to rename (same contract as
// track rename - Enter/blur commits, Escape cancels). The name is a spine
// column, not part of the autosaved document, so the commit writes it through
// projectStorage.rename when a project row is bound; in unsaved demo mode the
// rename is local-only.
function EditableProjectName() {
  const projectName = useUIStore((s) => s.projectName)
  const projectId = useSearchParams().get('project')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const commit = () => {
    const name = draft.trim()
    setEditing(false)
    if (!name || name === projectName) return
    useUIStore.getState().setProjectName(name)
    if (projectId) {
      void projectStorage.rename(projectId, name).catch((err) => {
        console.error('Project rename failed:', err)
      })
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') setEditing(false)
        }}
        className="w-[180px] text-xs font-medium bg-[var(--bg-app)] text-[var(--text)] rounded-[4px] px-1.5 py-0.5 border border-[var(--border-strong)] outline-none focus:border-[var(--accent)]"
      />
    )
  }

  const startRename = () => {
    setDraft(projectName ?? 'Untitled Project')
    setEditing(true)
  }
  // Same hover-pencil affordance as track rename in the Track Editor:
  // present when you look, absent when you don't.
  return (
    <div
      onDoubleClick={startRename}
      title="Double-click to rename"
      className="group flex items-center gap-1.5 min-w-0 cursor-text select-none"
    >
      <span className="text-xs font-medium text-[var(--text)] whitespace-nowrap truncate max-w-[180px]">
        {projectName ?? 'Untitled Project'}
      </span>
      <button
        onClick={startRename}
        aria-label="Rename project"
        className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--text)] transition-opacity cursor-pointer"
      >
        <Pencil size={10} />
      </button>
    </div>
  )
}

// In ?template= demo mode nothing persists - say so, and point at signup.
function TemplateDemoChip() {
  const search = useSearchParams()
  if (search.get('project') || !search.get('template')) return null
  return (
    <span className="text-[11px] text-[var(--warn)] select-none whitespace-nowrap">
      Demo project - {' '}
      <Link href="/signup" onClick={() => track('nav_clicked', { from: 'editor-demo-chip', to: 'signup' })} className="text-[var(--warn)] underline underline-offset-2 hover:text-[#e0b568]">
        sign up to save it
      </Link>
    </span>
  )
}

// Autosave status: quiet when in sync, explicit when saving or in trouble.
function SaveStatusChip() {
  const status = useSaveStatus((s) => s.status)
  if (status === 'idle') return null
  const label =
    status === 'saving' ? 'Saving…'
    : status === 'saved' ? 'Saved'
    // Paused, not broken - the dialog over the top explains it.
    : status === 'conflict' ? 'Paused - changed elsewhere'
    : 'Save failed'
  return (
    <span
      className={`text-[11px] select-none whitespace-nowrap ${
        status === 'error' ? 'text-red-400'
        : status === 'conflict' ? 'text-[var(--warn)]'
        : 'text-[var(--text-muted)]'
      }`}
    >
      {label}
    </span>
  )
}

function Header() {
  const isPlaying = useTimeStore((s) => s.isPlaying)
  const { play, pause, reset, restart } = usePlayback();
  useTransportKeys({ play, pause, reset })
  useUndoRedoKeys()
  const currentBeat = useTimeStore((s) => s.currentBeat)
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)

  // Export: capability-gated (Chrome-first - WebCodecs or nothing).
  const [exportOpen, setExportOpen] = useState(false)
  const [exportGate, setExportGate] = useState<{ ok: boolean; reason?: string } | null>(null)
  useEffect(() => {
    void isExportSupported().then((s) => setExportGate({ ok: s.ok, reason: s.reason }))
  }, [])

  const plan = usePlan()
  const { user, loading: authLoading, isAnonymous } = useAuth()
  // "Has an account" - anonymous sessions are signed in for persistence only.
  const permanent = !authLoading && !!user && !isAnonymous

  // Leaving the editor can hang on this heavy page for a beat or two before
  // Next paints the projects route, so the button must acknowledge the click
  // itself: a press contraction, then a spinner in the chevron's spot until
  // navigation unmounts us. Skip the spinner for open-in-new-tab clicks.
  const [leavingToProjects, setLeavingToProjects] = useState(false)

  return (
    <div className="h-12 flex-shrink-0 flex items-center gap-3 px-3 border-b border-[var(--border)] bg-[var(--bg-panel)] relative">
      <Link
        href="/projects"
        onClick={(e) => {
          if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) setLeavingToProjects(true)
        }}
        className="flex-shrink-0 flex items-center gap-1 text-xs text-[var(--text-3)] hover:text-[var(--text)] active:scale-[0.94] transition-[color,transform] cursor-pointer"
      >
        {leavingToProjects ? <Loader2 size={13} className="animate-spin" /> : <ChevronLeft size={13} />}
        Projects
      </Link>
      <div className="w-px h-4 bg-[var(--border)] flex-shrink-0" />
      <EditableProjectName />

      <SaveStatusChip />
      {!authLoading && !user && (
        <span className="hidden md:flex items-center gap-1.5 text-[11px] text-[var(--warn)] select-none whitespace-nowrap">
          <CloudOff size={12} />
          Not saved -{' '}
          <Link href="/signup" className="text-[var(--warn)] underline underline-offset-2 hover:text-[#e0b568]">
            sign up to save
          </Link>
        </span>
      )}
      {!authLoading && user && isAnonymous && (
        <span className="hidden md:flex items-center gap-1.5 text-[11px] text-[var(--warn)] select-none whitespace-nowrap">
          <CloudOff size={12} />
          Saved on this device -{' '}
          <Link href="/signup" className="text-[var(--warn)] underline underline-offset-2 hover:text-[#e0b568]">
            sign up to keep it forever
          </Link>
        </span>
      )}
      <TemplateDemoChip />

      {/* Center transport - absolutely centered on the bar. */}
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
            onClick={isPlaying ? restart : play}
            title={isPlaying ? 'Restart playback' : 'Play (Space)'}
            data-tutorial-play=""
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
        {process.env.NODE_ENV === 'development' && <PreviewCaptureButton />}
        <a
          href="https://discord.gg/ZrbQMFwCsb"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track('editor_discord_clicked')}
          title="Join the Cabin Visuals Discord"
          className="hidden md:flex items-center gap-1.5 h-7 px-2.5 rounded border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-3)] hover:text-[var(--text)] hover:border-[var(--border-strong)] text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-3 w-3 flex-shrink-0">
            <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
          </svg>
          Join Discord to give feedback
        </a>
        {permanent && !plan.loading && !plan.isPro && (
          <Link
            href="/pricing"
            onClick={() => track('editor_upgrade_clicked')}
            title="Cabin Visuals Pro - full HD 1080p exports, $9/mo"
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
        {/* Gated Export explains itself like the projects page's blocked
            "New project" button: an instant CSS group-hover panel, not a
            native title - titles never fire over disabled buttons in Firefox
            (the very browser the gate fires on), and the panel appears with
            no tooltip dwell. */}
        <div className="group relative">
          <button
            onClick={() => { track('export_clicked'); setExportOpen(true) }}
            disabled={exportGate?.ok === false}
            title={exportGate?.ok === false ? undefined : 'Export the project as an MP4'}
            className="flex items-center gap-1.5 h-7 px-3 rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:bg-[var(--bg-elevated)] disabled:text-[var(--text-muted)] text-[var(--on-accent)] text-[11px] font-bold transition-colors cursor-pointer disabled:cursor-default"
          >
            <Upload size={11} strokeWidth={2.5} />
            Export
          </button>
          {exportGate?.ok === false && (
            // Padding on a hidden wrapper (not a margin) so the pointer can
            // cross from the button into the panel without leaving the group.
            <div className="absolute right-0 top-full z-40 hidden pt-1.5 group-hover:block">
              <div className="w-56 rounded border border-[var(--border)] bg-[var(--bg-elevated)] p-2.5 text-left text-[11px] font-normal leading-relaxed text-[var(--text-2)] shadow-lg shadow-black/50">
                {exportGate.reason ?? 'Video export is not available in this browser.'}
              </div>
            </div>
          )}
        </div>
        <ProfileMenu size="sm" />
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
  // The library's resize hit-testing is document-level, so a modal's overlay
  // div can't block it - disable the groups outright while a dialog is up.
  // The conflict dialog counts: it's blocking, and it rides on autosave state
  // rather than the modal flag, so it's OR'd in here instead of writing to the
  // store (nothing else should have to coordinate with it).
  const conflicted = useSaveStatus((s) => s.status === 'conflict')
  const modalOpen = useUIStore((s) => s.modalOpen) || conflicted

  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden bg-[var(--bg-app)] text-[var(--text)]">
      {/* OS-file drops (audio/MIDI/video/photo) land anywhere in the editor. */}
      <MediaFileDropLayer />
      <ConflictDialog />
      <Header />
      <div className="flex-1 min-h-0">
        <PanelGroup orientation="horizontal" style={{ height: '100%' }} disabled={modalOpen}>

          {/* Library - resizable, pre-redesign proportions */}
          <Panel defaultSize="15%" minSize="8%" maxSize="30%">
            <LeftSidebar />
          </Panel>

          <PanelResizeHandle className="w-px bg-[var(--border)] cursor-col-resize outline-none focus:outline-none" />

          {/* Right section: inspector + canvas above, tracks + audio strip below */}
          <Panel>
            <div className="flex flex-col h-full">
              <div ref={containerRef} className="flex flex-col flex-1 min-h-0">

                {/* Upper: TRACK inspector + Canvas, resizable */}
                <div className="min-h-0" style={{ flexBasis: `${topFrac * 100}%`, flexGrow: 0, flexShrink: 0 }}>
                  <PanelGroup orientation="horizontal" style={{ height: '100%' }} disabled={modalOpen}>

                    <Panel defaultSize="55%" minSize="15%" maxSize="60%">
                      <TrackEditor />
                    </Panel>

                    <PanelResizeHandle className="w-px bg-[var(--border)] cursor-col-resize outline-none focus:outline-none" />

                    {/* Canvas */}
                    <Panel>
                      <VisualPanel />
                    </Panel>

                  </PanelGroup>
                </div>

                {/* Window-resize divider: invisible 1px line (the timeline's own border-t
                    draws the visible rule) with a grab pad on top of its neighbours. */}
                <div className="relative h-px bg-transparent shrink-0">
                  <div
                    onPointerDown={startResize}
                    className={`absolute inset-x-0 z-50 cursor-ns-resize ${modalOpen ? 'pointer-events-none' : ''}`}
                    style={{ top: -DIVIDER_GRAB_INSET, bottom: -DIVIDER_GRAB_INSET }}
                  />
                </div>

                {/* Tracks / Piano Roll */}
                <SceneTabs />
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
