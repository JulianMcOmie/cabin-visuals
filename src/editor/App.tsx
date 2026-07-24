'use client'

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Canvas, useThree } from '@react-three/fiber'
import { Play, Pause, Square, SkipBack, Repeat, Upload, ChevronLeft, Maximize, Minimize, Sparkles, CloudOff, Pencil, Loader2, Library, SlidersHorizontal } from 'lucide-react'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, type PanelImperativeHandle } from 'react-resizable-panels'
import { useVerticalSplit, DIVIDER_GRAB_INSET } from './useVerticalSplit'
import { useTimeStore } from './store/TimeStore'
import { getPlaybackEngine } from './core/playback'
import { useProjectStore } from './store/ProjectStore'
import { useUIStore } from './store/UIStore'
import { VisualScene } from './components/visual/VisualScene'
import { ExportDriver } from './components/visual/ExportDriver'
import { RenderGovernor } from './components/visual/RenderGovernor'
import { VisualBeatSync } from './core/visual/VisualBeatSync'
import { setEditorPreviewSceneId } from './core/visual/VisualEngine'
import { ProfileMenu } from '../components/ProfileMenu'
import { track } from '../analytics/analytics'
// Tutorial is disabled in the UI - see the commented mount below.
// import { TutorialOverlay } from './components/TutorialOverlay'
import { LeftSidebar } from './components/LeftSidebar'
import { TrackEditor } from './components/TrackEditor'
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
import { useScrub } from './hooks/useScrub'
import { readPaneDefaults, writePaneOpen } from './uiSettings'
import { useIsMobile } from '../components/useIsMobile'
// Already in the project (landing carousel, projects grid): framer-motion
// handles the controls' fade-in/out via AnimatePresence.
import { AnimatePresence, motion } from 'framer-motion'

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

function PreviewSceneSync({ sceneId }: { sceneId: string }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    setEditorPreviewSceneId(sceneId)
    invalidate()
    return () => setEditorPreviewSceneId(null)
  }, [sceneId, invalidate])
  return null
}

function CanvasSourceBridge({ sourceRef }: { sourceRef: RefObject<HTMLCanvasElement | null> }) {
  const canvas = useThree((s) => s.gl.domElement)

  useEffect(() => {
    sourceRef.current = canvas
    return () => {
      if (sourceRef.current === canvas) sourceRef.current = null
    }
  }, [canvas, sourceRef])

  return null
}

function Scene({
  previewSceneId,
  sourceCanvasRef,
}: {
  previewSceneId: string
  sourceCanvasRef: RefObject<HTMLCanvasElement | null>
}) {
  // Paused → 'demand': the render loop idles instead of redrawing a static
  // frame 60×/s (heavy instruments were starving the editor UI even while
  // paused). RenderGovernor requests single frames when an input changes.
  const isPlaying = useTimeStore((s) => s.isPlaying)
  return (
    <Canvas shadows="soft" frameloop={isPlaying ? 'always' : 'demand'} dpr={[1, 1.5]} camera={{ position: [0, 0, 5], fov: 55 }} gl={{ antialias: true }}>
      <color attach="background" args={['#09090b']} />
      <CanvasSourceBridge sourceRef={sourceCanvasRef} />
      <PreviewSceneSync sceneId={previewSceneId} />
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

/** A deliberately low-resolution copy of the finished WebGL frame. It is
 * stretched and heavily blurred behind the upper workspace, extending the
 * scene's color into otherwise blank UI space without rendering the Three
 * scene a second time or changing the visualizer's viewport calculations. */
function VisualAmbientBleed({ sourceCanvasRef }: { sourceCanvasRef: RefObject<HTMLCanvasElement | null> }) {
  const bleedCanvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const bleed = bleedCanvasRef.current
    const ctx = bleed?.getContext('2d')
    if (!bleed || !ctx) return

    let frame = 0
    let lastPaint = 0
    const paint = (now: number) => {
      // 15fps is plenty once the 128px copy has passed through an 80px blur.
      // The WebGL scene itself remains on its existing render schedule.
      if (now - lastPaint >= 1000 / 15) {
        const source = sourceCanvasRef.current
        if (source?.width && source.height) {
          try {
            ctx.drawImage(source, 0, 0, bleed.width, bleed.height)
          } catch {
            // A temporarily unavailable video-backed WebGL frame should not
            // take down the editor; the previous ambient frame can stay put.
          }
        }
        lastPaint = now
      }
      frame = requestAnimationFrame(paint)
    }
    frame = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(frame)
  }, [sourceCanvasRef])

  return <canvas ref={bleedCanvasRef} width={128} height={72} aria-hidden className="visual-ambient-bleed" />
}

// The visual panel: the canvas plus fullscreen (button or F) and an aspect
// pin. Fullscreen targets the panel div, so the buttons
// ride along; R3F resizes to whatever box the canvas gets, and the
// aspect-aware instruments re-compose - the same path the export pin
// exercises, which is exactly why pinning the editor view to 16:9 or 9:16
// previews what an export at that aspect will compose like.

/** The phone canvas transport (YouTube-style): play/pause, a seek bar mapped
 *  over the whole project, and the current position. Mounted only while the
 *  tap-toggled controls are up - AnimatePresence in VisualPanel fades it in
 *  and out. Scrubbing reuses the timeline's shared gesture (audio is muted
 *  for the drag and resumes at the drop point); `onInteract`/`onScrub*` let
 *  the owner keep the controls alive while they're being used. */
function CanvasTransportBar({
  playback,
  onInteract,
  onScrubStart,
  onScrubEnd,
}: {
  playback: PlaybackControls
  onInteract: () => void
  onScrubStart: () => void
  onScrubEnd: () => void
}) {
  const isPlaying = useTimeStore((s) => s.isPlaying)
  const currentBeat = useTimeStore((s) => s.currentBeat)
  const bpm = useProjectStore((s) => s.bpm)
  const totalBeats = useProjectStore((s) => s.totalBars * s.beatsPerBar)
  const trackRef = useRef<HTMLDivElement>(null)

  const { startScrub } = useScrub({
    computeBeat: (clientX) => {
      const el = trackRef.current
      if (!el) return null
      const r = el.getBoundingClientRect()
      if (r.width <= 0) return null
      const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
      return frac * totalBeats
    },
    onStart: onScrubStart,
    onEnd: onScrubEnd,
  })

  const fmtTime = (beat: number) => {
    const sec = Math.max(0, (beat * 60) / Math.max(1, bpm))
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
  }
  const frac = totalBeats > 0 ? Math.min(1, currentBeat / totalBeats) : 0

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      // Taps on the controls are interactions, not toggle-offs.
      onClick={(e) => e.stopPropagation()}
      className="absolute inset-x-0 bottom-0 z-10"
    >
      <div className="bg-gradient-to-t from-black/75 via-black/35 to-transparent px-3 pb-1.5 pt-8">
        {/* Seek bar: the padded wrapper is the hit target (a 4px line is not
            a touch target); touch-none so a phone drag scrubs instead of
            scrolling. */}
        <div
          ref={trackRef}
          onPointerDown={startScrub}
          className="group/scrub relative cursor-pointer touch-none py-2"
          aria-label="Seek"
        >
          <div className="relative h-1 rounded-full bg-white/25 transition-[height] duration-100 group-hover/scrub:h-1.5">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]"
              style={{ width: `${frac * 100}%` }}
            />
          </div>
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)] shadow shadow-black/40"
            style={{ left: `${frac * 100}%` }}
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              onInteract()
              if (isPlaying) playback.pause()
              else void playback.play()
            }}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="visualizer-glass-control flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-[rgba(30,30,35,0.8)] text-white/90 transition-colors hover:text-white cursor-pointer"
          >
            {isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="translate-x-px" />}
          </button>
          <span className="select-none font-mono text-[11px] tabular-nums text-white/80">
            {fmtTime(currentBeat)} / {fmtTime(totalBeats)}
          </span>
        </div>
      </div>
    </motion.div>
  )
}

function VisualPanel({
  previewSceneId,
  sourceCanvasRef,
  playback,
}: {
  previewSceneId: string
  sourceCanvasRef: RefObject<HTMLCanvasElement | null>
  playback: PlaybackControls
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const fullscreenControlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [fullscreenControlVisible, setFullscreenControlVisible] = useState(false)
  // A project setting (persisted in the document, seeds the export default).
  const aspect = useProjectStore((s) => s.viewAspect)

  // Phones: YouTube-style tap-toggled controls. One tap reveals play/scrub
  // (+ fullscreen), they fade away on their own after a few seconds, and a
  // second tap on the canvas dismisses them immediately. Desktop keeps its
  // hover-revealed fullscreen button and has no canvas transport at all.
  const isMobile = useIsMobile()
  const [touchControlsVisible, setTouchControlsVisible] = useState(false)
  const touchHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressTapRef = useRef(false)
  const clearTouchTimer = () => {
    if (!touchHideTimerRef.current) return
    clearTimeout(touchHideTimerRef.current)
    touchHideTimerRef.current = null
  }
  const armTouchHide = () => {
    clearTouchTimer()
    touchHideTimerRef.current = setTimeout(() => {
      setTouchControlsVisible(false)
      touchHideTimerRef.current = null
    }, 3000)
  }
  const onCanvasTap = () => {
    if (!isMobile) return
    // A scrub that ends over the canvas fires a click - not a toggle.
    if (suppressTapRef.current) return
    if (touchControlsVisible) {
      clearTouchTimer()
      setTouchControlsVisible(false)
    } else {
      setTouchControlsVisible(true)
      armTouchHide()
    }
  }
  useEffect(() => () => clearTouchTimer(), [])
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

  useEffect(() => () => {
    if (fullscreenControlTimerRef.current) clearTimeout(fullscreenControlTimerRef.current)
  }, [])

  const clearFullscreenControlTimer = () => {
    if (!fullscreenControlTimerRef.current) return
    clearTimeout(fullscreenControlTimerRef.current)
    fullscreenControlTimerRef.current = null
  }

  const revealFullscreenControl = () => {
    clearFullscreenControlTimer()
    setFullscreenControlVisible(true)
    fullscreenControlTimerRef.current = setTimeout(() => {
      setFullscreenControlVisible(false)
      fullscreenControlTimerRef.current = null
    }, 1800)
  }

  const hideFullscreenControl = () => {
    clearFullscreenControlTimer()
    setFullscreenControlVisible(false)
  }

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
    <div
      ref={panelRef}
      onPointerEnter={isMobile ? undefined : revealFullscreenControl}
      onPointerMove={isMobile ? undefined : revealFullscreenControl}
      onPointerLeave={isMobile ? undefined : hideFullscreenControl}
      onClick={onCanvasTap}
      className={`relative h-full ${box ? 'bg-[var(--bg-canvas-deep)]' : 'bg-[var(--bg-canvas)]'}`}
    >
      <div
        className={`absolute ${box ? 'border border-[var(--border-subtle)]' : 'inset-0'}`}
        style={box ? { width: box.w, height: box.h, left: (panelSize!.w - box.w) / 2, top: (panelSize!.h - box.h) / 2 } : undefined}
      >
        <Scene previewSceneId={previewSceneId} sourceCanvasRef={sourceCanvasRef} />
      </div>
      {/* First-run tutorial: switched OFF in the UI, kept intact in the code.
          Re-enable by uncommenting this and its import at the top of the file -
          nothing else was removed. Unmounted rather than early-returned on
          purpose: its eligibility effect stamps localStorage the first time it
          runs, so a mounted-but-hidden tutorial would quietly burn the
          "first open" flag on every browser and never show again when you
          turn it back on. */}
      {/* <TutorialOverlay /> */}
      {isMobile && (
        <AnimatePresence>
          {touchControlsVisible && (
            <CanvasTransportBar
              playback={playback}
              onInteract={armTouchHide}
              onScrubStart={() => { suppressTapRef.current = true; clearTouchTimer() }}
              onScrubEnd={() => {
                // The release's synthetic click must not toggle the controls;
                // clear the guard next tick so real taps work again.
                setTimeout(() => { suppressTapRef.current = false }, 120)
                armTouchHide()
              }}
            />
          )}
        </AnimatePresence>
      )}
      <div className={`absolute top-2 right-3 z-10 transition-opacity duration-300 ${
        (isMobile ? touchControlsVisible : fullscreenControlVisible)
          ? 'pointer-events-auto opacity-100'
          : 'pointer-events-none opacity-0'
      }`}>
        <button
          onClick={(e) => { e.stopPropagation(); toggle() }}
          onFocus={() => {
            clearFullscreenControlTimer()
            setFullscreenControlVisible(true)
          }}
          onBlur={hideFullscreenControl}
          title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
          className="visualizer-glass-control flex items-center justify-center w-6 h-6 rounded border border-[var(--border)] bg-[rgba(30,30,35,0.8)] text-[var(--text-3)] hover:text-[var(--text)] transition-colors cursor-pointer"
        >
          {isFullscreen ? <Minimize size={11} /> : <Maximize size={11} />}
        </button>
      </div>
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
  if (status === 'idle' || status === 'saved') return null
  const label =
    status === 'saving' ? 'Saving…'
    // Paused, not broken - the dialog over the top explains it.
    : status === 'conflict' ? 'Paused - changed elsewhere'
    // The project never opened; nothing has been saved or lost.
    : status === 'load-failed' ? "Couldn't open project"
    : 'Save failed'
  return (
    <span
      className={`text-[11px] select-none whitespace-nowrap ${
        status === 'error' || status === 'load-failed' ? 'text-red-400'
        : status === 'conflict' ? 'text-[var(--warn)]'
        : 'text-[var(--text-muted)]'
      }`}
    >
      {label}
    </span>
  )
}

function EditorPanelToggle({
  label,
  open,
  onToggle,
  controls,
  children,
}: {
  label: string
  open: boolean
  onToggle: () => void
  controls: string
  children: ReactNode
}) {
  return (
    <button
      onClick={onToggle}
      aria-label={`${open ? 'Hide' : 'Show'} ${label}`}
      aria-controls={controls}
      aria-pressed={open}
      title={`${open ? 'Hide' : 'Show'} ${label}`}
      className={`flex h-7 w-7 items-center justify-center rounded transition-colors cursor-pointer ${
        open
          ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
          : 'text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text)]'
      }`}
    >
      {children}
    </button>
  )
}

function Header({
  libraryOpen,
  sceneEditorOpen,
  onToggleLibrary,
  onToggleSceneEditor,
  playback,
}: {
  libraryOpen: boolean
  sceneEditorOpen: boolean
  onToggleLibrary: () => void
  onToggleSceneEditor: () => void
  playback: PlaybackControls
}) {
  const isPlaying = useTimeStore((s) => s.isPlaying)
  const { play, pause, reset, restart } = playback
  useTransportKeys({ play, pause, reset })
  useUndoRedoKeys()
  const currentBeat = useTimeStore((s) => s.currentBeat)
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)
  const totalBars = useProjectStore((s) => s.totalBars)
  const loopEnabled = useTimeStore((s) => !!s.loopRegion?.enabled)

  // Keep a loop region always present so the ruler shows a (grey, disabled) band
  // and the loop button has something to toggle: default it to the first four
  // measures, off. Only fills in when none is set (a drawn region is left alone).
  const defaultLoopEndBeat = Math.min(4, Math.max(1, totalBars)) * beatsPerBar
  useEffect(() => {
    const { loopRegion, setLoopRegion } = useTimeStore.getState()
    if (!loopRegion) setLoopRegion({ startBeat: 0, endBeat: defaultLoopEndBeat, enabled: false })
  }, [defaultLoopEndBeat])

  const toggleLoop = () => {
    const { loopRegion, setLoopRegion } = useTimeStore.getState()
    setLoopRegion(loopRegion
      ? { ...loopRegion, enabled: !loopRegion.enabled }
      : { startBeat: 0, endBeat: defaultLoopEndBeat, enabled: true })
  }

  // Export: capability-gated (Chrome-first - WebCodecs or nothing).
  const [exportOpen, setExportOpen] = useState(false)
  const [exportGate, setExportGate] = useState<{ ok: boolean; reason?: string } | null>(null)
  // Touch path for the gate explanation: tap toggles what hover reveals.
  const [gateNoteOpen, setGateNoteOpen] = useState(false)
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
    <div className="h-12 flex-shrink-0 flex items-center gap-3 px-3 border-b border-[var(--border)] bg-[var(--bg-topbar)] relative">
      <Link
        href="/projects"
        aria-label="Back to projects"
        title="Back to projects"
        onClick={(e) => {
          if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) setLeavingToProjects(true)
        }}
        className="flex-shrink-0 flex items-center text-[var(--text-3)] hover:text-[var(--text)] active:scale-[0.94] transition-[color,transform] cursor-pointer"
      >
        {leavingToProjects ? <Loader2 size={13} className="animate-spin" /> : <ChevronLeft size={13} />}
      </Link>
      <EditableProjectName />

      <div
        className="flex flex-shrink-0 items-center gap-0.5 rounded-lg bg-[var(--bg-elevated)] p-0.5"
        role="group"
        aria-label="Editor panels"
      >
        <EditorPanelToggle
          label="library"
          open={libraryOpen}
          onToggle={onToggleLibrary}
          controls="library-panel"
        >
          <Library size={13} />
        </EditorPanelToggle>
        <EditorPanelToggle
          label="scene editor"
          open={sceneEditorOpen}
          onToggle={onToggleSceneEditor}
          controls="scene-editor-panel"
        >
          <SlidersHorizontal size={13} />
        </EditorPanelToggle>
      </div>

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

      {/* Center transport - absolutely centered on the bar. Hidden on phones:
          it would collide with the side clusters, and the canvas overlay
          carries play/pause/scrub there. */}
      <div className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-2 pointer-events-none select-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          {/* Transport band - a continuous elevated strip (same surface the
              buttons used); each control is a segment whose hover/active state is
              a rounded rectangle within the band (GarageBand-style). Segment
              radius is concentric with the band's so the highlights sit flush.
              Play lights accent while playing, loop while enabled. */}
          <div className="flex items-center gap-0.5 overflow-hidden rounded-lg bg-[var(--bg-elevated)]">
            <button
              onClick={isPlaying ? pause : reset}
              title={isPlaying ? 'Pause' : 'Return to start'}
              className="flex items-center justify-center w-8 h-6 rounded-md text-[var(--text-3)] hover:text-[var(--text)] hover:bg-white/10 transition-colors cursor-pointer"
            >
              {isPlaying
                ? <Square size={10} fill="currentColor" />
                : <SkipBack size={11} fill="currentColor" />}
            </button>
            <button
              onClick={isPlaying ? restart : play}
              title={isPlaying ? 'Restart playback' : 'Play (Space)'}
              data-tutorial-play=""
              className={`flex items-center justify-center w-8 h-6 rounded-md transition-colors cursor-pointer ${
                isPlaying
                  ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)]'
                  : 'text-[var(--text-3)] hover:text-[var(--text)] hover:bg-white/10'
              }`}
            >
              <Play size={12} fill="currentColor" />
            </button>
            <button
              onClick={toggleLoop}
              title={loopEnabled ? 'Loop on' : 'Loop off'}
              className={`flex items-center justify-center w-8 h-6 rounded-md transition-colors cursor-pointer ${
                loopEnabled
                  ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)]'
                  : 'text-[var(--text-3)] hover:text-[var(--text)] hover:bg-white/10'
              }`}
            >
              <Repeat size={12} />
            </button>
          </div>

          {/* One continuous pill: beat readout, BARS, and BPM share a single
              recessed track, separated by thin dividers rather than sitting as
              three detached chips. */}
          <div className="flex items-stretch h-7 rounded bg-[var(--bg-app)] overflow-hidden select-none">
            <div className="flex items-center justify-center px-2.5 min-w-[62px] font-mono text-[13px] text-[var(--text)] tabular-nums whitespace-nowrap">
              {formatBeat(currentBeat, beatsPerBar)}
            </div>
            <div className="w-px bg-[var(--border)]" />
            <div className="flex items-center px-2.5">
              <ProjectLengthControl />
            </div>
            <div className="w-px bg-[var(--border)]" />
            <div className="flex items-center px-2.5">
              <BpmControl />
            </div>
          </div>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2 flex-shrink-0">
        {process.env.NODE_ENV === 'development' && <PreviewCaptureButton />}
        <a
          href="https://discord.gg/ZrbQMFwCsb"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track('editor_discord_clicked')}
          aria-label="Join the Cabin Visuals Discord"
          title="Join the Cabin Visuals Discord"
          className="hidden md:flex items-center justify-center h-7 w-7 rounded border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-3)] hover:text-[var(--text)] hover:border-[var(--border-strong)] transition-colors cursor-pointer"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-3 w-3 flex-shrink-0">
            <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
          </svg>
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
            (the very browser the capability gate fires on), and the panel
            appears with no tooltip dwell. Two gates share it: browser
            capability first (signing in wouldn't help there), then account
            (export requires a real sign-in; anonymous sessions don't count).
            Ungated, the button keeps a NATIVE title like PRO and the profile
            icon beside it - same box, same fade - kept short so the
            OS-positioned tooltip stays inside the window. */}
        <div className="group relative">
          <button
            onClick={() => {
              // Gated: the button stays TAPPABLE and toggles the explanation
              // panel - hover never happens on touch, and a disabled button
              // swallows the tap silently (the mobile "where is export?"
              // failure mode).
              if (exportGate?.ok === false || !permanent) { setGateNoteOpen((v) => !v); return }
              track('export_clicked')
              setExportOpen(true)
            }}
            aria-disabled={exportGate?.ok === false || !permanent}
            title={exportGate?.ok === false || !permanent ? undefined : 'Export as MP4'}
            className={`flex items-center gap-1.5 h-7 px-3 rounded text-[11px] font-bold transition-colors cursor-pointer ${
              exportGate?.ok === false || !permanent
                ? 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
                : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)]'
            }`}
          >
            <Upload size={11} strokeWidth={2.5} />
            Export
          </button>
          {(exportGate?.ok === false || (!authLoading && !permanent)) && (
            // Padding on a hidden wrapper (not a margin) so the pointer can
            // cross from the button into the panel without leaving the group.
            <div className={`absolute right-0 top-full z-40 pt-1.5 ${gateNoteOpen ? 'block' : 'hidden group-hover:block'}`}>
              <div className="w-56 rounded border border-[var(--border)] bg-[var(--bg-elevated)] p-2.5 text-left text-[11px] font-normal leading-relaxed text-[var(--text-2)] shadow-lg shadow-black/50">
                {exportGate?.ok === false
                  ? exportGate.reason ?? 'Video export is not available in this browser.'
                  : (
                    <>
                      Video export needs a free account.{' '}
                      <Link
                        href="/signup"
                        onClick={() => track('nav_clicked', { from: 'editor-export-gate', to: 'signup' })}
                        className="whitespace-nowrap text-[var(--accent)] underline underline-offset-2 hover:text-[var(--accent-hover)]"
                      >
                        Sign up
                      </Link>
                      {' or '}
                      <Link
                        href="/login"
                        onClick={() => track('nav_clicked', { from: 'editor-export-gate', to: 'login' })}
                        className="whitespace-nowrap text-[var(--accent)] underline underline-offset-2 hover:text-[var(--accent-hover)]"
                      >
                        sign in
                      </Link>
                      {' '}to export your video.
                    </>
                  )}
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

/** The transport handles usePlayback returns - created once in EditorApp and
 *  shared by the header band and the canvas overlay, so the engine is only
 *  initialized once. */
type PlaybackControls = ReturnType<typeof usePlayback>

export default function EditorApp() {
  useProjectPersistence()
  useAnonymousAdoption()
  // Leaving the editor stops the transport. The playback engine and Tone's
  // transport are module singletons that outlive this component, so unmounting
  // does not silence them by itself - hitting Projects used to leave the song
  // playing over a page with no transport controls to stop it. On the editor
  // root rather than the Projects link so every exit is covered (back button,
  // the lyric-setup handoff, a redirect out of a dead project).
  useEffect(() => () => {
    getPlaybackEngine().pause()
    useTimeStore.getState().setIsPlaying(false)
  }, [])
  const { topFrac, containerRef, startResize } = useVerticalSplit()
  const visualCanvasRef = useRef<HTMLCanvasElement>(null)
  const libraryPanelRef = useRef<PanelImperativeHandle>(null)
  const sceneEditorPanelRef = useRef<PanelImperativeHandle>(null)
  // One engine wiring for the whole editor: the header band and the canvas
  // overlay share these handles.
  const playback = usePlayback()
  // Pane visibility is a remembered per-device setting; phones start with both
  // collapsed (canvas-first) until the user opens them. Read once at mount -
  // the Panels' defaultSize only applies then anyway.
  const paneDefaults = useMemo(readPaneDefaults, [])
  const [libraryOpen, setLibraryOpen] = useState(paneDefaults.library)
  const [sceneEditorOpen, setSceneEditorOpen] = useState(paneDefaults.sceneEditor)
  // Persist only on actual open/closed flips - onResize streams every drag frame.
  const libraryOpenRef = useRef(paneDefaults.library)
  const sceneEditorOpenRef = useRef(paneDefaults.sceneEditor)

  const togglePanel = (panelRef: RefObject<PanelImperativeHandle | null>, fallbackSize: string) => {
    const panel = panelRef.current
    if (!panel) return
    if (panel.isCollapsed()) {
      panel.expand()
      // A panel that MOUNTED collapsed has no remembered size for expand() to
      // restore - open it explicitly. Percentage STRING on purpose: resize()
      // reads bare numbers as PIXELS (resize(15) = a 15px sliver).
      if (panel.isCollapsed() || panel.getSize().inPixels === 0) panel.resize(fallbackSize)
    } else {
      panel.collapse()
    }
  }
  // The library's resize hit-testing is document-level, so a modal's overlay
  // div can't block it - disable the groups outright while a dialog is up.
  // The conflict dialog counts: it's blocking, and it rides on autosave state
  // rather than the modal flag, so it's OR'd in here instead of writing to the
  // store (nothing else should have to coordinate with it).
  const conflicted = useSaveStatus((s) => s.status === 'conflict')
  const modalOpen = useUIStore((s) => s.modalOpen) || conflicted
  const scenes = useProjectStore((s) => s.scenes)
  const activeSceneId = useProjectStore((s) => s.activeSceneId)
  const [previewSceneId, setPreviewSceneId] = useState(activeSceneId)
  // Project hydration and scene deletion can invalidate a local preview id.
  // Falling back at render time keeps the canvas and segmented control live
  // without writing an ephemeral viewing choice into the project document.
  const resolvedPreviewSceneId = scenes[previewSceneId] ? previewSceneId : activeSceneId

  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden bg-[var(--bg-app)] text-[var(--text)]">
      {/* OS-file drops (audio/MIDI/video/photo) land anywhere in the editor. */}
      <MediaFileDropLayer />
      <ConflictDialog />
      <Header
        libraryOpen={libraryOpen}
        sceneEditorOpen={sceneEditorOpen}
        onToggleLibrary={() => togglePanel(libraryPanelRef, '15%')}
        onToggleSceneEditor={() => togglePanel(sceneEditorPanelRef, '55%')}
        playback={playback}
      />
      <div className="flex-1 min-h-0">
        <PanelGroup orientation="horizontal" style={{ height: '100%' }} disabled={modalOpen}>

          {/* Library - dragging below its minimum snaps it closed; the matching
              header icon uses the same imperative panel state. */}
          <Panel
            id="library-panel"
            panelRef={libraryPanelRef}
            defaultSize={paneDefaults.library ? '15%' : '0%'}
            minSize="8%"
            maxSize="30%"
            collapsible
            collapsedSize="0%"
            onResize={(size, _id, prevSize) => {
              const open = size.inPixels > 0
              setLibraryOpen(open)
              // Persist only real transitions (prev defined = not the mount
              // layout, whose transient 0px sizes are noise, not intent).
              if (prevSize !== undefined && libraryOpenRef.current !== open) {
                libraryOpenRef.current = open
                writePaneOpen('library', open)
              }
            }}
          >
            <LeftSidebar />
          </Panel>

          <PanelResizeHandle className="w-px bg-[var(--border)] cursor-col-resize outline-none focus:outline-none" />

          {/* Right section: inspector + canvas above, tracks + audio strip below */}
          <Panel>
            <div className="flex flex-col h-full">
              <div ref={containerRef} className="flex flex-col flex-1 min-h-0">

                {/* Upper: TRACK inspector + Canvas, resizable */}
                <div className="relative min-h-0 overflow-hidden" style={{ flexBasis: `${topFrac * 100}%`, flexGrow: 0, flexShrink: 0 }}>
                  <VisualAmbientBleed sourceCanvasRef={visualCanvasRef} />
                  <PanelGroup
                    orientation="horizontal"
                    style={{ height: '100%' }}
                    disabled={modalOpen}
                  >
                    <Panel
                      id="scene-editor-panel"
                      panelRef={sceneEditorPanelRef}
                      defaultSize={paneDefaults.sceneEditor ? '55%' : '0%'}
                      minSize="15%"
                      maxSize="60%"
                      collapsible
                      collapsedSize="0%"
                      onResize={(size, _id, prevSize) => {
                        const open = size.inPixels > 0
                        setSceneEditorOpen(open)
                        if (prevSize !== undefined && sceneEditorOpenRef.current !== open) {
                          sceneEditorOpenRef.current = open
                          writePaneOpen('sceneEditor', open)
                        }
                      }}
                    >
                      <TrackEditor />
                    </Panel>

                    <PanelResizeHandle className="w-px bg-[var(--border)] cursor-col-resize outline-none focus:outline-none" />

                    {/* The visualizer keeps its original panel and dimensions;
                        only the cheap ambient copy extends behind its sibling. */}
                    <Panel>
                      <VisualPanel previewSceneId={resolvedPreviewSceneId} sourceCanvasRef={visualCanvasRef} playback={playback} />
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
                <SceneTabs previewSceneId={resolvedPreviewSceneId} onPreviewSceneChange={setPreviewSceneId} />
                <div className="flex-1 min-h-0">
                  <BottomArea />
                </div>

              </div>
            </div>
          </Panel>

        </PanelGroup>
      </div>
    </div>
  )
}
