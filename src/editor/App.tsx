'use client'

import dynamic from 'next/dynamic'
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { InstantLink as Link } from '../components/instantNavigation'
import { useSearchParams } from 'next/navigation'
import { Canvas, useThree } from '@react-three/fiber'
import { Play, Pause, Upload, Maximize, Minimize, Cloud, Pencil, Loader2 } from 'lucide-react'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, type PanelImperativeHandle } from 'react-resizable-panels'
import { useVerticalSplit, DIVIDER_GRAB_INSET } from './useVerticalSplit'
import { useTimeStore } from './store/TimeStore'
import { getPlaybackEngine } from './core/playback'
import { useProjectStore, type ViewAspect } from './store/ProjectStore'
import { ASPECT_RATIO_IDS, aspectRatioValue } from './core/aspectRatios'
import { PREVIEW_QUALITIES, useUIStore, type PreviewQuality } from './store/UIStore'
import { VisualScene } from './components/visual/VisualScene'
import { ExportDriver } from './components/visual/ExportDriver'
import { RenderGovernor } from './components/visual/RenderGovernor'
import { DevRenderStats } from './components/visual/DevRenderStats'
import { VisualBeatSync } from './core/visual/VisualBeatSync'
import { getCompositionLayers, getMountedRenderScenes, getObjectState, getSceneBackdrop, getVisualCopies, getVisualCopyCount, setEditorPreviewSceneId, subscribeObjects } from './core/visual/VisualEngine'
import { track } from '../analytics/analytics'
import { formatMinSec } from './utils/time'
// Tutorial is disabled in the UI - see the commented mount below.
// import { TutorialOverlay } from './components/TutorialOverlay'
import { LeftSidebar } from './components/LeftSidebar'
import { TrackEditor } from './components/TrackEditor'
import { PlayIcon, PauseIcon, SkipBackIcon, LoopIcon } from './components/TransportIcons'
import { BpmControl } from './components/BpmControl'
import { PlaybackRateControl } from './components/PlaybackRateControl'
// Loaded on first open: the dialog drags the whole export engine (encoder,
// muxer, audio render) behind it, none of which the editor needs until then.
const ExportDialog = dynamic(() => import('./components/ExportDialog').then((m) => m.ExportDialog), { ssr: false })
import { SaveToCloudDialog } from './components/SaveToCloudDialog'
import { EditorSignupGate } from './components/EditorSignupGate'
import { MediaFileDropLayer } from './components/MediaFileDropLayer'
import { isExportSupported } from './core/export/support'
import { PianoRollPanel } from './components/midi/PianoRollPanel'
import { PreviewCaptureButton } from './components/PreviewCaptureButton'
import { TimelineArea } from './components/timeline/TimelineArea'
import { SceneTabs } from './components/SceneTabs'
import { usePlayback } from './hooks/usePlayback'
import { useTransportKeys } from './hooks/useTransportKeys'
import { useUndoRedoKeys } from './hooks/useUndoRedoKeys'
import { useGroupKeys } from './hooks/useGroupKeys'
import { useSceneTrackKeys } from './hooks/useSceneTrackKeys'
import { useProjectPersistence } from './hooks/useProjectPersistence'
import { useAnonymousAdoption } from './hooks/useAnonymousAdoption'
import { useSaveStatus } from '../persistence/autosave'
import { ConflictDialog } from './components/ConflictDialog'
import * as projectStorage from '../persistence/projectStorage'
import { usePlan } from '../billing/usePlan'
import { useAuth } from '../persistence/hooks/useAuth'
import { useScrub } from './hooks/useScrub'
import { readPaneDefaults, writePaneOpen } from './uiSettings'
import { useIsMobile } from '../components/useIsMobile'
// Already in the project (landing carousel, projects grid): framer-motion
// handles the controls' fade-in/out via AnimatePresence.
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'

// Dev-only: expose the stores for console/E2E debugging. Never ships.
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  ;(window as unknown as Record<string, unknown>).__cabinStores = {
    project: useProjectStore,
    ui: useUIStore,
    time: useTimeStore,
  }
  // The VisualCopy pull API too, so E2E checks can read a track's resolved
  // copies (transform + opacity) without reaching into an R3F scene graph.
  // getSceneBackdrop rides along because a scene colorizer's whole effect is a
  // clear colour - there is no object state to read it off (core/sceneTrack.ts).
  ;(window as unknown as Record<string, unknown>).__cabinVisual = { getVisualCopies, getVisualCopyCount, getMountedRenderScenes, getCompositionLayers, getObjectState, getSceneBackdrop }
}

// Sidebar toggles glide (Material 3 emphasized-decelerate - the .panel-toggle-anim
// rule in globals.css). The class goes on the panel's GROUP so both siblings'
// flex-grow interpolate together - animating only the toggled panel makes the
// neighbor's share jump, then drift. It lives only for the toggle's duration,
// so separator drags stay 1:1; re-toggling mid-glide re-arms the removal timer
// instead of stripping the class out from under the second transition.
const PANEL_TOGGLE_MS = 400
const panelToggleTimers = new WeakMap<HTMLElement, number>()
function holdClassForGlide(el: HTMLElement, className: string) {
  el.classList.add(className)
  const prev = panelToggleTimers.get(el)
  if (prev !== undefined) window.clearTimeout(prev)
  panelToggleTimers.set(el, window.setTimeout(() => el.classList.remove(className), PANEL_TOGGLE_MS + 50))
}
function glidePanelToggle(panelDomId: string) {
  const toggled = document.getElementById(panelDomId)
  const group = toggled?.closest('[data-group]')
  if (!toggled || !(group instanceof HTMLElement)) return
  holdClassForGlide(group, 'panel-toggle-anim')
  // The glide only moves the canvas horizontally, and resizing the GL buffer
  // per frame stretches the picture (the buffer lags the element). So the
  // canvas root is FROZEN for the glide, centered, at a width ≥ wherever it
  // will land: its current width plus everything the toggled panel could
  // hand it. The camera's FOV is vertical, so the wider render center-crops
  // to exactly the narrower one - the overshoot and the settle resize are
  // invisible, and the glide just reveals/covers a fully-rendered scene
  // (no bars, no stretching; one buffer resize at start, one at settle).
  // (.canvas-glide-freeze in globals.css.)
  const panel = document.querySelector<HTMLElement>('.visual-canvas-smooth')
  const root = panel?.querySelector<HTMLElement>('.visual-canvas-root')
  if (panel && root) {
    const bound = root.getBoundingClientRect().width + toggled.getBoundingClientRect().width
    panel.style.setProperty('--glide-canvas-w', `${bound}px`)
    holdClassForGlide(panel, 'canvas-glide-freeze')
  }
}

// Shared segment styling for the header transport band. Segments are flush -
// the band's overflow clipping rounds the two ends at rest, but the END
// segments also carry their own matching outer radius so the press
// contraction (scale) keeps the rounded shape instead of revealing square
// corners as they shrink away from the clip edge.
const transportBtn =
  'flex w-8 cursor-pointer items-center justify-center transition-[color,background-color,transform] duration-100 active:scale-[0.92] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]'

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
    // dpr 1 + no MSAA: every scene rasterizes into 1× (CSS-pixel) offscreen
    // targets, and the ONLY thing drawn to the default framebuffer is the final
    // fullscreen grade quad - so a 1.5× multisampled backbuffer just ran the
    // heaviest fragment shader on 2.25× the pixels to bilinearly upscale a 1×
    // image. This is also exactly what the export renders (ExportDriver pins
    // dpr 1), so the preview now matches the file.
    <Canvas className="visual-canvas-root" shadows="soft" frameloop={isPlaying ? 'always' : 'demand'} dpr={1} camera={{ position: [0, 0, 5], fov: 55 }} gl={{ antialias: false }}>
      <color attach="background" args={['#09090b']} />
      <CanvasSourceBridge sourceRef={sourceCanvasRef} />
      <PreviewSceneSync sceneId={previewSceneId} />
      <VisualBeatSync />
      <ExportDriver />
      <RenderGovernor />
      {process.env.NODE_ENV === 'development' && <DevThreeHook />}
      {process.env.NODE_ENV === 'development' && <DevRenderStats />}
      {/* Suspense: instruments may load assets through useLoader. */}
      <Suspense fallback={null}>
        <VisualScene />
      </Suspense>
    </Canvas>
  )
}

/** A deliberately low-resolution copy of the finished WebGL frame. It is
 * stretched and heavily blurred behind the ENTIRE workspace card - anchored to
 * the top, where the visualizer lives, and fading as it runs down through the
 * timeline - so every translucent surface (inspector glass, timeline lanes) is
 * a window onto the same continuous field of light rather than its own copy of
 * the frame. One canvas, one 15fps painter; the Three scene is never rendered
 * a second time and the visualizer's viewport calculations are untouched. */
function VisualAmbientBleed({ sourceCanvasRef }: { sourceCanvasRef: RefObject<HTMLCanvasElement | null> }) {
  const bleedCanvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const bleed = bleedCanvasRef.current
    const ctx = bleed?.getContext('2d')
    if (!bleed || !ctx) return

    let frame = 0
    let lastPaint = 0
    // The WebGL frame only changes while playing or for a beat after an edit /
    // scrub / resolve (RenderGovernor's demand frames). Copying it - and so
    // re-blurring the whole workspace layer - 15×/s while paused and idle was
    // a permanent GPU tax for an image that never changed. `dirtyUntil` keeps
    // painting for a short window after a change so the copy lands after r3f
    // has actually rendered the new frame, then the loop parks itself.
    let dirtyUntil = performance.now() + 500
    const paint = (now: number) => {
      const active = useTimeStore.getState().isPlaying || now < dirtyUntil
      // 15fps is plenty once the 128px copy has passed through an 80px blur.
      // The WebGL scene itself remains on its existing render schedule.
      if (active && now - lastPaint >= 1000 / 15) {
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
      frame = active ? requestAnimationFrame(paint) : 0
    }
    const wake = () => {
      dirtyUntil = performance.now() + 300
      if (!frame) frame = requestAnimationFrame(paint)
    }
    frame = requestAnimationFrame(paint)
    const unsubProject = useProjectStore.subscribe(wake)
    const unsubGraph = subscribeObjects(wake)
    const unsubTime = useTimeStore.subscribe(wake)
    const resize = new ResizeObserver(wake)
    if (sourceCanvasRef.current) resize.observe(sourceCanvasRef.current)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      unsubProject()
      unsubGraph()
      unsubTime()
      resize.disconnect()
    }
  }, [sourceCanvasRef])

  return <canvas ref={bleedCanvasRef} width={128} height={72} aria-hidden className="visual-ambient-bleed" />
}

// The visual panel: the canvas plus fullscreen (button or F) and an aspect
// pin. Fullscreen targets the panel div, so the buttons
// ride along; R3F resizes to whatever box the canvas gets, and the
// aspect-aware instruments re-compose - the same path the export pin
// exercises, which is exactly why pinning the editor view to 16:9 or 9:16
// previews what an export at that aspect will compose like.

// Aspect switches glide (.aspect-glide-anim in globals.css - keep the two
// durations in step): the framed box travels between the two contain-fit
// rects, so the letterbox bars grow in from the edges and slide horizontally
// when the orientation flips, instead of appearing on one frame.
const ASPECT_GLIDE_MS = 400

/** The aspect's contain-fit box inside a cw×ch panel - the px form of the
 *  resting CSS below, and the glide's two endpoints. */
function fitAspectBox(cw: number, ch: number, aspect: ViewAspect): { width: number; height: number } {
  if (aspect === 'fill') return { width: cw, height: ch }
  const ratio = aspectRatioValue(aspect)
  return { width: Math.min(cw, ch * ratio), height: Math.min(ch, cw / ratio) }
}

/** Resting geometry: container query units size the box against BOTH panel
 *  dimensions, so it tracks the sidebar glides every frame with no
 *  measure → state → render round-trip (the old ResizeObserver path lagged
 *  frames under render load and the box visibly stepped). Both axes are
 *  written out rather than leaning on aspect-ratio, so the glide's px pair
 *  hands back to exactly the same two properties. */
function restingAspectBox(aspect: ViewAspect): { width: string; height: string } {
  if (aspect === 'fill') return { width: '100cqw', height: '100cqh' }
  const ratio = aspectRatioValue(aspect)
  return {
    width: `min(100cqw, calc(100cqh * ${ratio}))`,
    height: `min(100cqh, calc(100cqw * ${1 / ratio}))`,
  }
}

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

  const fmtTime = (beat: number) => formatMinSec((beat * 60) / Math.max(1, bpm))
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
            className="visualizer-glass-control flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-[rgba(16,19,28,0.8)] text-white/90 transition-colors hover:text-white cursor-pointer"
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

  // Fullscreen is a two-phase theater glide (mock pick: "house hybrid",
  // outro rule copied from MaterialContainerTransform - returns DECELERATE
  // into their resting box, never the accelerate curve):
  //   enter - FLIP the panel to fixed at its own rect, glide it over the
  //   editor to fill the window (the sidebars' 400ms emphasized-decelerate),
  //   and only THEN request native fullscreen: layout already fills the
  //   window, so the native snap is invisible.
  //   exit - leave native fullscreen first (button OR Esc both land in the
  //   fullscreenchange listener), then glide home on the full emphasized
  //   curve, 300ms. The canvas resizes continuously through both glides -
  //   RenderGovernor's sync pre-paint render keeps every frame undistorted.
  const fsBusyRef = useRef(false)
  const wasNativeRef = useRef(false)
  const FS_ENTER = '400ms cubic-bezier(0.05, 0.7, 0.1, 1)'
  const FS_EXIT = '300ms cubic-bezier(0.2, 0, 0, 1)'

  const setGlideRect = (el: HTMLElement, r: { top: number; left: number; width: number; height: number }) => {
    el.style.top = `${r.top}px`
    el.style.left = `${r.left}px`
    el.style.width = `${r.width}px`
    el.style.height = `${r.height}px`
  }
  const clearGlideStyles = (el: HTMLElement) => {
    for (const p of ['position', 'top', 'left', 'width', 'height', 'zIndex', 'transition'] as const) el.style[p] = ''
    const card = el.closest<HTMLElement>('[data-workspace-card]')
    if (card) card.style.zIndex = ''
  }
  const beginGlide = (el: HTMLElement, timing: string) => {
    // z-90: over the whole editor, under modals (z-100). But the workspace
    // card is `isolate` (its own stacking context), so the panel's z-90 only
    // wins INSIDE the card - the timeline chrome (z up to 80), the split
    // divider (z-50) and everything else outside it would paint over the
    // glide. Raise the card itself for the glide's duration so its whole
    // context - and the panel with it - floats above the rest of the editor.
    const card = el.closest<HTMLElement>('[data-workspace-card]')
    if (card) card.style.zIndex = '90'
    el.style.position = 'fixed'
    el.style.zIndex = '90'
    void el.offsetWidth
    el.style.transition = ['top', 'left', 'width', 'height'].map((p) => `${p} ${timing}`).join(', ')
  }
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    const onChange = () => {
      const el = panelRef.current
      const isFs = document.fullscreenElement === el
      setIsFullscreen(isFs)
      if (!el) return
      if (isFs) {
        // Native fullscreen holds the screen now - drop the glide's inline
        // styles so the top-layer styling owns the element.
        clearGlideStyles(el)
        wasNativeRef.current = true
        fsBusyRef.current = false
      } else if (wasNativeRef.current) {
        // Left native fullscreen (button or Esc): the element is back in
        // flow at its resting rect - glide home from the full window.
        wasNativeRef.current = false
        if (reducedMotion()) return
        fsBusyRef.current = true
        const home = el.getBoundingClientRect()
        setGlideRect(el, { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight })
        beginGlide(el, FS_EXIT)
        setGlideRect(el, home)
        window.setTimeout(() => {
          clearGlideStyles(el)
          fsBusyRef.current = false
        }, 320)
      }
    }
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
    if (fsBusyRef.current) return
    if (document.fullscreenElement) {
      // The return glide runs from the fullscreenchange listener, so Esc and
      // the button share one path.
      void document.exitFullscreen()
      return
    }
    const el = panelRef.current
    if (!el) return
    // Denied requests (kiosk/embedded contexts) fail quietly - the panel just
    // snaps back to rest.
    if (reducedMotion()) {
      void el.requestFullscreen().catch(() => {})
      return
    }
    fsBusyRef.current = true
    setGlideRect(el, el.getBoundingClientRect())
    beginGlide(el, FS_ENTER)
    setGlideRect(el, { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight })
    window.setTimeout(() => {
      el.style.transition = ''
      el.requestFullscreen().then(
        () => {}, // fullscreenchange clears the glide styles
        () => {
          clearGlideStyles(el)
          fsBusyRef.current = false
        },
      )
    }, 420)
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

  // The framed box: contain-fit for any pinned aspect, fill-the-panel for 'fill'
  // and fullscreen. Everything outside it is the panel's deep background -
  // that IS the letterbox bar - so animating the box animates the bars.
  //
  // While a switch glides, React hands the box an explicit px pair instead of
  // the resting container-query math: both endpoints have to be px, because a
  // transition between two min()/cq expressions is not a portable
  // interpolation. The px pair also can't track a panel resize, so it is only
  // in force for the glide and the box snaps back onto the container at the
  // end (same geometry - the handover is invisible).
  //
  // Two commits, and the `moving` flag (which carries the transition) has to
  // stay off for the first one: this effect MEASURES the panel, and that flush
  // recalculates the box's style too - so by the time the old rect is pinned,
  // the browser's before-change value is already the NEW resting box. Arming
  // the transition on the same commit therefore animates backwards (from the
  // destination to the origin) and the rAF retarget swallows the glide whole.
  // Pin the old rect untransitioned, let it paint, then move.
  //
  // `pin` is the canvas half, and it is not optional: an element that GROWS
  // ahead of the GL buffer is exactly the case object-fit: cover resolves by
  // scaling the frame UP, so a glide out to Fill visibly zoomed the picture
  // for its duration (shrinking only crops, which is why the artifact was
  // one-directional). So the r3f root is pinned, centered, and unresized for
  // the whole glide - one buffer resize at the start, none during - and the
  // moving box just reveals/covers a fully-rendered scene.
  //
  // It is pinned at the LARGER of the two boxes per axis, not at the
  // destination: pin the destination and a SHRINKING glide starts with the box
  // wider than the render and opens a dark gap down each side before the edge
  // catches up. `≥ wherever the glide lands` is the same rule the sidebar
  // freeze follows, and it leans on the same identity - the camera's FOV is
  // vertical, so an over-wide render center-crops pixel-identically to the
  // narrower one, making both the start and the settle resize invisible. (Any
  // aspect NARROWER than the panel is height-limited, so a switch between two
  // of them keeps the height constant and only the width is over-rendered. A
  // switch involving one that's wider than the panel - 2:1 in a squat pane,
  // anything at all in a pane taller than it is wide - does over-render the
  // height for the glide's duration: bounded and uniform, the same trade the
  // sidebar freeze documents.) It also spares the instrument tree
  // ~24 re-renders per switch.
  const [glide, setGlide] = useState<{
    width: number
    height: number
    moving: boolean
    pin: { width: number; height: number }
  } | null>(null)
  const prevAspectRef = useRef(aspect)
  const boxRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const from = prevAspectRef.current
    prevAspectRef.current = aspect
    const panel = panelRef.current
    if (!panel || from === aspect || isFullscreen || reducedMotion()) return
    const { width: cw, height: ch } = panel.getBoundingClientRect()
    // Switching again mid-glide starts from where the box actually IS (the
    // running transition's live rect), not from the previous aspect's box.
    const live = glide ? boxRef.current?.getBoundingClientRect() : null
    const start = live ? { width: live.width, height: live.height } : fitAspectBox(cw, ch, from)
    const end = fitAspectBox(cw, ch, aspect)
    // The box is borderless, so its inner box - what the r3f root fills at
    // rest - is the box itself.
    const pin = {
      width: Math.max(0, Math.max(start.width, end.width)),
      height: Math.max(0, Math.max(start.height, end.height)),
    }
    setGlide({ ...start, moving: false, pin })
    const raf = requestAnimationFrame(() => setGlide({ ...end, moving: true, pin }))
    const settle = window.setTimeout(() => setGlide(null), ASPECT_GLIDE_MS + 60)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(settle)
    }
    // glide is read for the mid-glide handoff, never a trigger - depending on
    // it would restart the glide on its own first commit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspect, isFullscreen])

  const boxStyle = glide
    ? { width: glide.width, height: glide.height }
    : restingAspectBox(isFullscreen ? 'fill' : aspect)

  return (
    <div
      ref={panelRef}
      onPointerEnter={isMobile ? undefined : revealFullscreenControl}
      onPointerMove={isMobile ? undefined : revealFullscreenControl}
      onPointerLeave={isMobile ? undefined : hideFullscreenControl}
      onClick={onCanvasTap}
      className={`visual-canvas-smooth relative flex h-full items-center justify-center bg-[var(--bg-canvas-deep)] [container-type:size] ${glide ? 'aspect-canvas-pin' : ''}`}
      style={glide
        ? ({ '--aspect-canvas-w': `${glide.pin.width}px`, '--aspect-canvas-h': `${glide.pin.height}px` } as CSSProperties)
        : undefined}
    >
      {/* overflow-CLIP: both pins (.canvas-glide-freeze for sidebar toggles,
          .aspect-canvas-pin for aspect switches) make the r3f root an absolute
          child of THIS box, wider than it and centered - so under `hidden` the
          box grew real scroll range for the length of every glide (measured
          150px on a 300px sidebar). A wheel inside that 400ms window banked it
          and left the canvas sitting off-centre in its frame for good.
          See src/editor/CLAUDE.md. */}
      <div
        ref={boxRef}
        className={`relative overflow-clip ${glide?.moving ? 'aspect-glide-anim' : ''}`}
        style={boxStyle}
      >
        <Scene previewSceneId={previewSceneId} sourceCanvasRef={sourceCanvasRef} />
      <div className={`absolute top-2 right-2 z-10 transition-opacity duration-300 ${
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
          className="visualizer-glass-control flex items-center justify-center w-6 h-6 rounded border border-[var(--border)] bg-[rgba(16,19,28,0.8)] text-[var(--text-3)] hover:text-[var(--text)] transition-colors cursor-pointer"
        >
          {isFullscreen ? <Minimize size={11} /> : <Maximize size={11} />}
        </button>
      </div>
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
      className="group relative flex items-center min-w-0 cursor-text select-none"
    >
      <span className="mr-[-0.06em] text-[13px] leading-none [font-family:var(--font-archivo)] font-bold tracking-[0.06em] text-[var(--text)] whitespace-nowrap truncate max-w-[calc(100vw-600px)]">
        {projectName ?? 'Untitled Project'}
      </span>
      <button
        onClick={startRename}
        aria-label="Rename project"
        className="absolute left-full ml-1.5 opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--text)] transition-opacity cursor-pointer"
      >
        <Pencil size={10} />
      </button>
    </div>
  )
}

/** Where the work is, and where it could go. Two plain facts and a separator.
 *
 *  Deliberately NOT a warning: an anonymous session is autosaving to real rows,
 *  so amber here would spend the alarm colour on a system that is working - and
 *  the accent is the only affordance, which is why the cloud glyph rides the
 *  ACTION half rather than prefixing the whole chip (the same icon+verb pairing
 *  as the Export pill beside it). The word "sign up" belongs to the dialog this
 *  opens, not to the bar.
 *
 *  In ?template= demo mode nothing persists at all, so the left half tells that
 *  truth instead. */
function SaveToCloudChip({ onOpen }: { onOpen: () => void }) {
  const search = useSearchParams()
  const demo = !search.get('project') && !!search.get('template')
  return (
    <span className="hidden md:inline-flex items-center gap-[5px] text-[11px] leading-none select-none whitespace-nowrap">
      <span className="text-[var(--text-3)]">{demo ? 'Demo project' : 'Saved locally'}</span>
      <span className="text-[var(--text-muted)]">·</span>
      <button
        onClick={() => { track('save_to_cloud_clicked', { from: demo ? 'demo' : 'guest' }); onOpen() }}
        className="group inline-flex items-center gap-1 text-[var(--accent)] transition-colors hover:text-[var(--accent-hover)] cursor-pointer"
      >
        <Cloud size={12} />
        <span className="group-hover:underline underline-offset-2">Save to cloud</span>
      </button>
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

/** Panel toggle (Console spec): a "window with a sidebar" glyph whose divider
 *  side names the panel it controls - library at the bar's far left, inspector
 *  at its far right, each directly above its panel. Open = soft accent fill +
 *  accent icon; closed = quiet muted; hover shows the fill in either state. */
function EditorPanelToggle({
  label,
  open,
  onToggle,
  controls,
  side,
}: {
  label: string
  open: boolean
  onToggle: () => void
  controls: string
  side: 'left' | 'right'
}) {
  return (
    <button
      onClick={onToggle}
      aria-label={`${open ? 'Hide' : 'Show'} ${label}`}
      aria-controls={controls}
      aria-pressed={open}
      title={`${open ? 'Hide' : 'Show'} ${label}`}
      className={`flex h-9 w-[38px] flex-shrink-0 items-center justify-center rounded-[10px] transition-[color,background-color] duration-[400ms] ease-[cubic-bezier(0.05,0.7,0.1,1)] cursor-pointer hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] ${
        open ? 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]' : 'text-[var(--text-3)]'
      }`}
    >
      <span className="relative block h-[12px] w-[16px] rounded-[3px] border-[1.5px] border-current">
        <span className={`absolute inset-y-0 w-[1.5px] bg-current ${side === 'left' ? 'left-[2.5px]' : 'right-[2.5px]'}`} />
      </span>
    </button>
  )
}

const VIEW_ASPECTS: ViewAspect[] = ['fill', ...ASPECT_RATIO_IDS]

// Fast Preview levels as the toolbar spells them (the store owns the order and
// the resolution each one renders at - see UIStore.PREVIEW_QUALITY_SCALE).
const PREVIEW_QUALITY_LABELS: Record<PreviewQuality, string> = {
  final: 'Final',
  auto: 'Auto',
  fast: 'Fast',
  fastest: 'Fastest',
}

/** The transport, below the preview (DAW Console 4a): band of skip/play/loop
 *  segments plus the recessed position+tempo readout, centered under the
 *  canvas. Hidden on phones - the canvas overlay carries play/pause/scrub
 *  there. Keyboard transport stays wired in the Header (it owns the page). */
function TransportStrip({ playback }: { playback: PlaybackControls }) {
  const isPlaying = useTimeStore((s) => s.isPlaying)
  const { play, pause, reset, restart } = playback
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

  const aspect = useProjectStore((s) => s.viewAspect)
  const setAspect = useProjectStore((s) => s.setViewAspect)
  const [aspectOpen, setAspectOpen] = useState(false)
  const previewQuality = useUIStore((s) => s.previewQuality)
  const setPreviewQuality = useUIStore((s) => s.setPreviewQuality)
  const canvasView = useUIStore((s) => s.canvasView)
  const setCanvasView = useUIStore((s) => s.setCanvasView)
  // The chip names the scene the canvas is showing. String-valued selector on
  // purpose (never the scenes record - its identity changes on every edit).
  const viewedSceneName = useProjectStore((s) => {
    const id = canvasView === 'main'
      ? s.sceneOrder.find((sid) => s.scenes[sid]?.isMain) ?? s.activeSceneId
      : s.activeSceneId
    return s.scenes[id]?.name ?? 'Scene'
  })
  // No "click to ..." half: that a chip toggles is discoverable by clicking it,
  // and spending half the panel on it crowds out the part only the panel can
  // say. In Current the chip reads the MODE, so the panel is the one place the
  // scene's actual name appears.
  const canvasViewNote = canvasView === 'main'
    ? 'Rendering the Composite: all scenes composed into the final frame.'
    : `Rendering ${viewedSceneName}, the scene you are editing.`

  return (
    // THREE REAL COLUMNS, not a centered band with absolutely-positioned
    // clusters beside it. The old layout let the left cluster grow silently
    // under the centered transport (nothing could see the collision), and the
    // View chip's scene name was enough to reach it. Equal `flex-1` side
    // columns keep the transport EXACTLY centered - the thing you aim a mouse
    // at never moves - while `min-w-0` makes the chips shrink/collapse inside
    // their own column instead of overlapping anything.
    // The strip is the @container the chips collapse against; see the ladder
    // on Quality/View below.
    <div className="@container relative hidden md:flex h-12 flex-shrink-0 items-center gap-3 select-none px-4">
      {/* Preview aspect + draft resolution + canvas view, bottom-left.
          Every chip is fixed-width now that the view value is two known words,
          so nothing in here absorbs pressure by shrinking - which is why the
          narrow tier tightens the GAP and the chips' padding alongside
          abbreviating the words. Without that, the cluster overflowed its
          column at ~440px of content-box and painted over the transport (the
          bug the three-column layout exists to prevent), and it could not be
          fixed by clipping this box: the view chip's hover panel is an
          absolutely-positioned child that has to escape upward. */}
      <div className="flex min-w-0 flex-1 items-center gap-1 @[530px]:gap-1.5">
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setAspectOpen((v) => !v)}
            title="Preview aspect ratio - see the visual as an export at that shape would compose it"
            className="flex h-7 items-center gap-1.5 rounded-md bg-[var(--bg-elevated)] px-2 @[530px]:px-2.5 font-mono text-[9px] uppercase tracking-wide text-[var(--text-3)] transition-colors hover:text-[var(--text)] cursor-pointer"
          >
            {aspect === 'fill' ? 'Fill' : aspect}
            <span className="text-[7px] leading-none">▾</span>
          </button>
          {aspectOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setAspectOpen(false)} />
              <div className="absolute bottom-full left-0 z-50 mb-1 min-w-[76px] rounded-md border border-[var(--border)] bg-[var(--bg-panel-raised)] py-1 shadow-lg shadow-black/50">
                {VIEW_ASPECTS.map((a) => (
                  <button
                    key={a}
                    onClick={() => { setAspect(a); setAspectOpen(false) }}
                    className={`flex w-full items-center px-2.5 py-1 font-mono text-[9px] uppercase tracking-wide transition-colors cursor-pointer ${
                      a === aspect ? 'text-[var(--accent)]' : 'text-[var(--text-3)] hover:text-[var(--text)]'
                    }`}
                  >
                    {a === 'fill' ? 'Fill' : a}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {/* Fast Preview: renders the canvas pipeline at a fraction of full size
            for smoother playback on heavy projects. The field name rides INSIDE
            the chip at the muted level so the control says what it is at rest -
            a lone "Final" says nothing. Lit while a faster level is active, so
            a softer picture reads as a chosen mode rather than a bug. */}
        <button
          onClick={() => {
            const index = PREVIEW_QUALITIES.indexOf(previewQuality)
            setPreviewQuality(PREVIEW_QUALITIES[(index + 1) % PREVIEW_QUALITIES.length])
          }}
          title="Fast Preview - trades sharpness for smoother playback. Auto softens only while playing. Export always renders final quality."
          className="group flex h-7 flex-shrink-0 items-center gap-1.5 rounded-md bg-[var(--bg-elevated)] px-2 @[530px]:px-2.5 font-mono text-[9px] uppercase tracking-wide transition-colors cursor-pointer"
        >
          {/* The field name is the first thing to go when the strip narrows -
              the VALUE is the payload, and the same collapse order the library
              header uses. 800px is MEASURED, not guessed: the left cluster's
              natural width with both labels is 331px, the side columns are
              (content-box - 120 transport - 24 gaps) / 2, so labels only fit
              from ~806px up. Set it lower and the scene NAME starts truncating
              while the labels still show - values collapsing before labels,
              which is backwards. Re-measure if a chip, the font, or the
              transport's width changes. Literal variant strings on purpose:
              Tailwind extracts classes by scanning source text, so a threshold
              built from a constant would silently generate no CSS. */}
          <span className={`hidden @[670px]:inline ${previewQuality === 'final' ? 'text-[var(--text-muted)]' : 'text-[var(--accent-muted)]'}`}>
            Quality
          </span>
          <span
            className={
              previewQuality === 'final'
                ? 'text-[var(--text-3)] transition-colors group-hover:text-[var(--text)]'
                : 'text-[var(--accent)]'
            }
          >
            {PREVIEW_QUALITY_LABELS[previewQuality]}
          </span>
        </button>
        {/* Canvas view: the Composite scene's final frame (the deliverable,
            the resting default) or the scene being edited. Same anatomy as
            Quality - field name inside the chip, value lit while off the
            default.
            The value names the MODE, not the scene. It used to be the viewed
            scene's own name, which made the chip a readout but also made it
            the one control whose width a user could set by typing - hence a
            truncation ladder, and "CHOR..." at narrow widths. Two fixed words
            with fixed abbreviations are legible at every size, and the scene
            is still identified: Composite is a tab you can see, Current IS the
            highlighted tab. So the tabs still need no eye. */}
        {/* The explanation is a CSS group-hover panel, NOT a native `title` -
            the same call the gated Export button makes below, for the same
            reasons: a title waits out a dwell nobody sits still for, renders
            as OS chrome nothing here can style, and never appears on touch.
            It says what the canvas IS rendering, never what a mode leaves out
            ("the Composite doesn't show your edits" invites the reader to
            distrust the picture, when each mode simply renders a different
            true thing), and in Current it is the only place the scene's name
            appears. `aria-label` carries the same sentence, because the
            visible chip reads only "VIEW CURRENT". */}
        <div className="group/view relative flex flex-shrink-0">
          <button
            onClick={() => setCanvasView(canvasView === 'main' ? 'scene' : 'main')}
            aria-label={canvasViewNote}
            className="group flex h-7 items-center gap-1.5 rounded-md bg-[var(--bg-elevated)] px-2 @[530px]:px-2.5 font-mono text-[9px] uppercase tracking-wide transition-colors cursor-pointer"
          >
            <span className={`hidden @[670px]:inline ${canvasView === 'main' ? 'text-[var(--text-muted)]' : 'text-[var(--accent-muted)]'}`}>
              View
            </span>
            {/* Discrete abbreviation, not a truncation cap: below the
                threshold the word is REPLACED by a fixed short form (the tab
                rail's label/short pattern), so the chip never renders a
                half-word with an ellipsis. */}
            <span
              className={
                canvasView === 'main'
                  ? 'text-[var(--text-3)] transition-colors group-hover:text-[var(--text)]'
                  : 'text-[var(--accent)]'
              }
            >
              <span className="hidden @[530px]:inline">{canvasView === 'main' ? 'Composite' : 'Current'}</span>
              <span className="@[530px]:hidden">{canvasView === 'main' ? 'Comp' : 'Curr'}</span>
            </span>
          </button>
          {/* Opens UPWARD (the scene tabs sit directly below the strip), and
              the dwell padding rides the hidden wrapper rather than a margin
              so the pointer never leaves the group on its way across. */}
          <div className="pointer-events-none absolute bottom-full left-0 z-40 hidden pb-1.5 group-hover/view:block">
            <div className="w-56 rounded border border-[var(--border)] bg-[var(--bg-elevated)] p-2.5 text-left font-sans text-[11px] font-normal normal-case leading-relaxed tracking-normal text-[var(--text-2)] shadow-lg shadow-black/50">
              {canvasViewNote}
            </div>
          </div>
        </div>
      </div>
      {/* Transport band - a continuous elevated strip matching the
          display's height and radius. Segment highlights run flush to the
          band's edges (overflow clipping rounds the two ends); the 1px gap
          is invisible at rest and becomes a hairline seam only between two
          lit/hovered segments. Each active control has its own hue: play
          goes green while playing; loop goes the looped-region blue
          (LOOP_REGION_ENABLED_COLOR) while enabled. Custom glyphs - see
          TransportIcons. */}
      <div className="flex h-9 flex-shrink-0 items-center gap-2">
        <button
          onClick={isPlaying ? pause : reset}
          title={isPlaying ? 'Pause (Space)' : 'Return to start (Enter)'}
          className={`${transportBtn} rounded-md text-[var(--text-3)] hover:text-[var(--accent-hover)]`}
        >
          {isPlaying ? <PauseIcon /> : <SkipBackIcon />}
        </button>
        <button
          onClick={isPlaying ? restart : play}
          title={isPlaying ? 'Restart playback' : 'Play (Space)'}
          data-tutorial-play=""
          className={`${transportBtn} !w-10 rounded-md text-[var(--text-2)] hover:text-[var(--accent-hover)]`}
        >
          <PlayIcon size={22} />
        </button>
        <button
          onClick={toggleLoop}
          title={loopEnabled ? 'Loop on' : 'Loop off'}
          className={`${transportBtn} rounded-md ${
            loopEnabled
              ? 'text-[var(--accent)] hover:text-[var(--accent-hover)]'
              : 'text-[var(--text-3)] hover:text-[var(--accent-hover)]'
          }`}
        >
          <LoopIcon />
        </button>
      </div>

      {/* Tempo, bottom-right - quiet inline readout, no chrome. The bar:beat
          position readout is gone; the playhead and ruler carry position.
          Monitoring speed sits beside it: the two things that set how fast the
          playhead moves read as one corner (the tempo is the document, the
          speed is only the lens - see PlaybackRateControl). */}
      <div className="flex h-9 min-w-0 flex-1 items-center justify-end gap-2.5">
        <PlaybackRateControl />
        <BpmControl />
      </div>
    </div>
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
  const { play, pause, reset } = playback
  useTransportKeys({ play, pause, reset })
  useUndoRedoKeys()
  useGroupKeys()
  useSceneTrackKeys()

  // Export: capability-gated (Chrome-first - WebCodecs or nothing).
  const [exportOpen, setExportOpen] = useState(false)
  const [saveToCloudOpen, setSaveToCloudOpen] = useState(false)
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
    <div className="h-12 flex-shrink-0 flex items-center gap-3 px-3 bg-[var(--bg-topbar)] border-b border-[var(--border-subtle)] relative">
      <EditorPanelToggle
        label="library"
        open={libraryOpen}
        onToggle={onToggleLibrary}
        controls="library-panel"
        side="left"
      />
      {/* The wordmark, top-left beside the library toggle - it IS the way
          back to projects. Serif italic ice, per the Console spec. */}
      <Link
        href="/projects"
        aria-label="Back to projects"
        title="Back to projects"
        onClick={(e) => {
          if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) setLeavingToProjects(true)
        }}
        className="flex-shrink-0 flex items-center active:scale-[0.96] transition-transform cursor-pointer"
      >
        {leavingToProjects
          ? <Loader2 size={16} className="animate-spin text-[var(--text-3)]" />
          : (
            <span className="text-[17px] italic leading-none [font-family:var(--font-display)] text-[var(--accent)] select-none">
              Cabin
            </span>
          )}
      </Link>
      {/* The project title rides the CENTER of the bar (still double-click
          renamable). Inline on phones, where an absolute center would
          collide with the side clusters. */}
      <div className="md:hidden"><EditableProjectName /></div>
      <div className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 md:block">
        <EditableProjectName />
      </div>

      <SaveStatusChip />
      {/* One chip for every account-less state (no session yet, or an
          anonymous one): both mean "this lives in this browser". */}
      {!authLoading && !permanent && <SaveToCloudChip onOpen={() => setSaveToCloudOpen(true)} />}

      <div className="ml-auto flex items-center gap-2 flex-shrink-0">
        {process.env.NODE_ENV === 'development' && <PreviewCaptureButton />}
        <EditorPanelToggle
          label="scene editor"
          open={sceneEditorOpen}
          onToggle={onToggleSceneEditor}
          controls="scene-editor-panel"
          side="right"
        />
        {/* Gated Export explains itself like the projects page's blocked
            "New project" button: an instant CSS group-hover panel, not a
            native title - titles never fire over disabled buttons in Firefox
            (the very browser the capability gate fires on), and the panel
            appears with no tooltip dwell. Only the browser-capability gate
            lives here now - the account gate moved INSIDE the export flow
            (ExportDialog's final button invites signup), so the button reads
            fully functional to everyone whose browser can export. */}
        <div className="group relative">
          <button
            onClick={() => {
              // Gated: the button stays TAPPABLE and toggles the explanation
              // panel - hover never happens on touch, and a disabled button
              // swallows the tap silently (the mobile "where is export?"
              // failure mode).
              if (exportGate?.ok === false) { setGateNoteOpen((v) => !v); return }
              track('export_clicked')
              setExportOpen(true)
            }}
            aria-disabled={exportGate?.ok === false}
            title={exportGate?.ok === false ? undefined : 'Export as MP4'}
            className={`flex items-center gap-1.5 h-7 px-4 rounded-full text-[11px] font-semibold [font-family:var(--font-plex-sans)] transition-colors cursor-pointer ${
              exportGate?.ok === false
                ? 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
                : 'bg-[var(--accent-button)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)]'
            }`}
          >
            <Upload size={11} strokeWidth={2.5} />
            Export
          </button>
          {exportGate?.ok === false && (
            // Padding on a hidden wrapper (not a margin) so the pointer can
            // cross from the button into the panel without leaving the group.
            <div className={`absolute right-0 top-full z-40 pt-1.5 ${gateNoteOpen ? 'block' : 'hidden group-hover:block'}`}>
              <div className="w-56 rounded border border-[var(--border)] bg-[var(--bg-elevated)] p-2.5 text-left text-[11px] font-normal leading-relaxed text-[var(--text-2)] shadow-lg shadow-black/50">
                {exportGate.reason ?? 'Video export is not available in this browser.'}
              </div>
            </div>
          )}
        </div>
      </div>
      {/* AnimatePresence keeps the dialog mounted through its 150ms exit
          animation (the motion divs inside portal to document.body). */}
      <AnimatePresence>
        {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} isPro={plan.isPro} canExport={permanent} />}
      </AnimatePresence>
      <AnimatePresence>
        {saveToCloudOpen && <SaveToCloudDialog onClose={() => setSaveToCloudOpen(false)} />}
      </AnimatePresence>
    </div>
  )
}

function BottomArea() {
  // The ref itself, not a boolean: it only changes when a different block is
  // opened (never per pointermove), and the exit animation needs its value.
  const editingBlock = useUIStore((s) => s.editingBlock)
  const editing = editingBlock != null
  // PianoRollPanel reads editingBlock from the store too, so dismissing would
  // empty it in the same commit that starts its slide away - a black box
  // moving down. Hand it the last ref to render while it leaves.
  const lastBlockRef = useRef(editingBlock)
  if (editingBlock) lastBlockRef.current = editingBlock
  // The roll rises over the timeline (Material 3 emphasized-decelerate, the
  // sidebar glide's curve) and sinks away on dismiss (M3's accelerate exit).
  // The timeline stays mounted UNDER the roll only while it animates: at rest
  // the old single-surface swap is preserved, because TimelineArea's
  // whole-tracks subscription must not re-render beneath the roll's
  // per-pointermove note edits (render budget, components/CLAUDE.md).
  const [rollSettled, setRollSettled] = useState(false)
  useEffect(() => {
    if (!editing) setRollSettled(false)
  }, [editing])
  return (
    // overflow-CLIP: the roll slides in from y:'100%', which under `hidden`
    // gives this box a pane-height of vertical scroll range for the length of
    // the animation - a wheel or focus mid-slide banks it and the timeline
    // sits shifted afterwards. See src/editor/CLAUDE.md.
    <div className="relative h-full overflow-clip">
      {(!editing || !rollSettled) && <TimelineArea />}
      <MotionConfig reducedMotion="user">
        <AnimatePresence>
          {/* z-[80]: the timeline's own chrome stacks up to z-[70] (loop
              badge popovers), and the rising roll must cover ALL of it. */}
          {editing && (
            <motion.div
              key="piano-roll"
              className="absolute inset-0 z-[80] bg-[var(--bg-app)]"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%', transition: { duration: 0.25, ease: [0.3, 0, 0.8, 0.15] } }}
              transition={{ duration: 0.4, ease: [0.05, 0.7, 0.1, 1] }}
              onAnimationComplete={(target) => {
                if (typeof target === 'object' && target !== null && 'y' in target && target.y === 0) setRollSettled(true)
              }}
            >
              <PianoRollPanel frozenRef={lastBlockRef.current} />
            </motion.div>
          )}
        </AnimatePresence>
      </MotionConfig>
    </div>
  )
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
  // A toggle animates the panel over PANEL_TOGGLE_MS, and onResize tracks the
  // DOM through the whole glide - so open/closed state is set from INTENT at
  // click (the header icon's accent fades in step with the movement, not at
  // its end) and onResize's writes are suppressed until the glide settles.
  // Separator drags never set this, so they keep streaming through onResize.
  const suppressResizeUntilRef = useRef(0)

  const applyPaneOpen = (
    pane: 'library' | 'sceneEditor',
    open: boolean,
  ) => {
    const [setOpen, openRef] = pane === 'library'
      ? [setLibraryOpen, libraryOpenRef] as const
      : [setSceneEditorOpen, sceneEditorOpenRef] as const
    setOpen(open)
    if (openRef.current !== open) {
      openRef.current = open
      writePaneOpen(pane, open)
    }
  }

  const togglePanel = (
    panelRef: RefObject<PanelImperativeHandle | null>,
    pane: 'library' | 'sceneEditor',
    domId: string,
    fallbackSize: string,
  ) => {
    const panel = panelRef.current
    if (!panel) return
    glidePanelToggle(domId)
    suppressResizeUntilRef.current = Date.now() + PANEL_TOGGLE_MS + 100
    applyPaneOpen(pane, panel.isCollapsed())
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
  // The empty scene's action list offers "start from a template", which lives
  // in the library - so a request to show a tab has to be able to OPEN the pane
  // too. Reacts to the request object changing (nonce), never to its presence,
  // so a second request re-fires and nothing has to clear it. Only expands:
  // togglePanel flips, and calling it on an already-open library would close it.
  const libraryRequest = useUIStore((s) => s.libraryRequest)
  useEffect(() => {
    if (!libraryRequest) return
    if (libraryPanelRef.current?.isCollapsed()) {
      togglePanel(libraryPanelRef, 'library', 'library-panel', '25%')
    }
    // togglePanel is re-created every render and reads only refs; depending on
    // it would fire this effect on every render instead of on a new request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryRequest])

  // The library's resize hit-testing is document-level, so a modal's overlay
  // div can't block it - disable the groups outright while a dialog is up.
  // The conflict dialog counts: it's blocking, and it rides on autosave state
  // rather than the modal flag, so it's OR'd in here instead of writing to the
  // store (nothing else should have to coordinate with it).
  const conflicted = useSaveStatus((s) => s.status === 'conflict')
  const modalOpen = useUIStore((s) => s.modalOpen) || conflicted
  // The canvas view is a two-state toggle (the VIEW chip in TransportStrip):
  // 'main' holds on the final director composition, 'scene' follows whichever
  // scene is being edited. Derived to a scene id here, never stored as one -
  // so scene deletion/hydration can't strand the canvas on a dead id.
  // Subscribed as a primitive (never the scenes record, whose identity changes
  // on every track edit): this is the editor ROOT, and a whole-record selector
  // here re-renders the entire shell on every pointermove of a drag.
  const canvasView = useUIStore((s) => s.canvasView)
  const resolvedPreviewSceneId = useProjectStore((s) =>
    canvasView === 'main'
      ? s.sceneOrder.find((id) => s.scenes[id]?.isMain) ?? s.activeSceneId
      : s.activeSceneId
  )

  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden bg-[var(--bg-app)] text-[var(--text)]">
      {/* OS-file drops (audio/MIDI/video/photo) land anywhere in the editor. */}
      <MediaFileDropLayer />
      <ConflictDialog />
      {/* No account, no editor. Mounted at the root so every way in meets it. */}
      <EditorSignupGate />
      <Header
        libraryOpen={libraryOpen}
        sceneEditorOpen={sceneEditorOpen}
        onToggleLibrary={() => togglePanel(libraryPanelRef, 'library', 'library-panel', '25%')}
        onToggleSceneEditor={() => togglePanel(sceneEditorPanelRef, 'sceneEditor', 'scene-editor-panel', '30%')}
        playback={playback}
      />
      {/* The library's panel color fills everything below the header, so the
          workspace reads as one card inset within the library's surface. */}
      <div className="flex-1 min-h-0 bg-[var(--bg-shell)]">
        <div ref={containerRef} className="flex h-full flex-col">
        {/* Upper row: library | workspace card. The timeline lives BELOW this
            whole row (DAW Console 4a), so it runs under the library too. */}
        <div className="relative min-h-0" style={{ flexBasis: `${topFrac * 100}%`, flexGrow: 0, flexShrink: 0 }}>
        {/* overflow visible so the workspace card's glow can spill past the
            group's top edge onto the header band. */}
        <PanelGroup orientation="horizontal" style={{ height: '100%', overflow: 'visible' }} disabled={modalOpen}>

          {/* Library - dragging below its minimum snaps it closed; the matching
              header icon uses the same imperative panel state. */}
          <Panel
            id="library-panel"
            panelRef={libraryPanelRef}
            defaultSize={paneDefaults.library ? '25%' : '0%'}
            minSize="8%"
            maxSize="30%"
            collapsible
            collapsedSize="0%"
            onResize={(size, _id, prevSize) => {
              // Mid-glide sizes are the animation, not intent - see
              // suppressResizeUntilRef.
              if (Date.now() < suppressResizeUntilRef.current) return
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

          {/* No visible rule: the card's inset gap separates library from
              workspace now. A slim invisible strip keeps the drag target,
              tinting on hover so it stays discoverable. */}
          <PanelResizeHandle className="w-px cursor-col-resize bg-[var(--border-subtle)] outline-none transition-colors hover:bg-[var(--border-strong)] focus:outline-none" />

          {/* Right section: inspector + canvas above, tracks + audio strip below.
              The shell shows only along the top and left; the workspace runs
              flush to the viewport's right and bottom edges. */}
          {/* overflow-visible (overriding the wrapper's overflow:auto) lets the
              card's glow bleed past the inset gap onto the shell surface. */}
          <Panel style={{ overflow: 'visible' }}>
            {/* relative: the header band is positioned, so the card must be
                positioned too (and later in the DOM) for its glow to paint
                over the header and the library rather than under them. */}
            {/* isolate: the ambient bleed paints at z-index -1, and the card's
                stacking context keeps that above the card's own background
                instead of letting it vanish beneath it. */}
            {/* data-workspace-card: VisualPanel's fullscreen glide raises this
                card's z-index for the glide (see beginGlide) - the isolate
                stacking context would otherwise trap the gliding panel under
                the timeline. */}
            {/* overflow-CLIP, not hidden, and that is load-bearing. The ambient
                bleed is an absolute child hanging 15% past this card's right
                edge (left:-15%, width:130%), which under `hidden` makes the
                card a real scroll container with ~15% of horizontal scroll
                range. Nothing ever wanted to scroll here, but a stray
                trackpad swipe, a focus, or a scrollIntoView anywhere inside
                would slide the whole card left and open a blank margin down
                the right side - the visualizer and the inspector shoved off
                the viewport edge, with no way back but scrolling it home.
                `clip` clips identically (verified) and simply is not
                scrollable; fixed-position descendants still escape it, so the
                fullscreen glide is untouched. Anything else that hangs
                decoration past this card's edges depends on this. */}
            <div data-workspace-card className="relative isolate flex h-full flex-col overflow-clip">
              <VisualAmbientBleed sourceCanvasRef={visualCanvasRef} />
              <div className="min-h-0 flex-1">
                  <PanelGroup
                    orientation="horizontal"
                    style={{ height: '100%' }}
                    disabled={modalOpen}
                  >
                    {/* DAW Console 4a: preview center (with margin, transport
                        beneath it), plugin-style inspector on the RIGHT. */}
                    <Panel>
                      {/* The stage: a step darker than the chrome around it,
                          so the preview area reads as the room the canvas
                          sits in (spec: stage #0a0b10 vs app #0c0d12). */}
                      <div className="flex h-full flex-col bg-[var(--bg-canvas-deep)]">
                        <div className="min-h-0 flex-1 p-3 sm:px-6 sm:pt-5">
                          <VisualPanel previewSceneId={resolvedPreviewSceneId} sourceCanvasRef={visualCanvasRef} playback={playback} />
                        </div>
                        <TransportStrip playback={playback} />
                      </div>
                    </Panel>

                    <PanelResizeHandle className="w-px bg-[var(--border)] cursor-col-resize outline-none focus:outline-none" />

                    <Panel
                      id="scene-editor-panel"
                      panelRef={sceneEditorPanelRef}
                      defaultSize={paneDefaults.sceneEditor ? '30%' : '0%'}
                      minSize="15%"
                      maxSize="60%"
                      collapsible
                      collapsedSize="0%"
                      onResize={(size, _id, prevSize) => {
                        if (Date.now() < suppressResizeUntilRef.current) return
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
                  </PanelGroup>
              </div>
            </div>
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

        {/* Tracks / Piano Roll - full width, running under the library (4a). */}
        <SceneTabs />
        {/* timeline-glass-scope makes --bg-timeline (the lanes + ruler
            strip) slightly translucent. Label rows and blocks keep their
            opaque chrome. */}
        <div className="timeline-glass-scope flex-1 min-h-0">
          <BottomArea />
        </div>
        </div>
      </div>
    </div>
  )
}
