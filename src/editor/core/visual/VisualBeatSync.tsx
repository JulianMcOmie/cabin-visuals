import { useEffect, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { readWaveformWindow } from '../audio/readWaveformWindow'
import { getVideoSourceAsset } from '../video/videoSource'
import { getPhotoPlayableUrl } from '../photo/photoSource'
import { useVideoStore } from '../../store/VideoStore'
import { useTimeStore } from '../../store/TimeStore'
import { useProjectStore } from '../../store/ProjectStore'
import { useUIStore } from '../../store/UIStore'
import { preloadProjectInstruments } from '../../instruments'
import { visualEngine } from './VisualEngine'
import { getBeatOverride } from './beatOverride'
import { PauseCanary } from './pauseCanary'
import { isExportPinned, subscribeExportPinned } from '../export/frameDriver'
import { LatestPreview } from './latestPreview'
import { PreviewFrameDecoder } from './previewFrameCodec'
import { canRenderInWorker, type PreviewRequest, type PreviewResponse, type PreviewWorkerMessage } from './previewProtocol'
import { getTrackPreviewSurfaces, subscribeTrackPreviews } from '../../components/timeline/trackPreviewRegistry'
import { useGradientEditing } from '../../userInterfaceRenderers/gradientEditing'
import { previewRuntime, setPreviewRendering, notifyPreviewFrame, setWorkerPicker, type PreviewHit } from './previewRuntime'

/** Store listeners only mark work dirty. A single worker resolves, evaluates and
 * (where supported) renders the most recent document, independently of DOM input.
 * Export/capture explicitly evaluate their exact beat on the original canvas. */
export function VisualBeatSync({ sceneId, sourceRef }: {
  sceneId: string
  sourceRef: RefObject<HTMLCanvasElement | null>
}) {
  const canaries = useRef(new Map<string, PauseCanary>())
  const get = useThree(s => s.get)
  const scene = useRef(sceneId)
  scene.current = sceneId
  const syncProject = useRef<ReturnType<typeof useProjectStore.getState> | null>(null)
  useFrame(() => {
    const override = getBeatOverride()
    if (override === null && previewRuntime.worker) return
    const project = useProjectStore.getState()
    if (syncProject.current !== project) {
      visualEngine.setProject(project)
      syncProject.current = project
    }
    const time = useTimeStore.getState()
    const beat = override ?? (previewRuntime.worker ? previewRuntime.beat : time.currentBeat)
    visualEngine.computeAtBeat(beat)
    if (process.env.NODE_ENV !== 'production') {
      const roots = visualEngine.getMountedRenderScenes()
      for (const [key, root] of roots) {
        let canary = canaries.current.get(key)
        if (!canary) { canary = new PauseCanary(); canaries.current.set(key, canary) }
        canary.check(root, beat, time.isPlaying, project)
      }
      for (const key of canaries.current.keys()) if (!roots.has(key)) canaries.current.delete(key)
    }
  }, -100)

  useEffect(() => {
    const frameDecoder = new PreviewFrameDecoder()
    let alive = true
    let worker: Worker | undefined
    let pending: ((response: PreviewResponse) => void) | undefined
    let watchdog: ReturnType<typeof setTimeout> | undefined
    let revision = 0, lastSentRevision = -1, id = 0, epoch = 0
    let waveformTracks = useProjectStore.getState().audioTracks
    let renderFailed = false, pickId = 0
    let pick: { id: number; nx: number; ny: number; resolve: (hit: PreviewHit) => void } | undefined
    let selection: typeof pick
    const clearPick = () => { pick?.resolve(null); selection?.resolve(null); pick = selection = undefined }
    const canvas = get().gl.domElement
    const presentation = document.createElement('canvas')
    presentation.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none'
    canvas.parentElement!.appendChild(presentation)
    const context = presentation.getContext('2d')!
    const restoreCanvas = () => {
      presentation.style.display = 'none'
      sourceRef.current = canvas
      setPreviewRendering(false)
    }
    const fail = (error: string) => {
      clearPick()
      previewRuntime.error = error
      previewRuntime.worker = false
      previewRuntime.directParticles = false
      worker?.terminate(); worker = undefined
      clearTimeout(watchdog)
      pending?.({ id, revision, error, duration: 0 }); pending = undefined
      restoreCanvas()
      get().invalidate()
    }
    try {
      worker = new Worker(new URL('./preview.worker.ts', import.meta.url), { type: 'module' })
      previewRuntime.worker = true
      worker.onmessage = (event: MessageEvent<PreviewWorkerMessage>) => {
        if ('kind' in event.data) {
          if (event.data.kind === 'invalidate') { queue.request(); return }
          if (event.data.kind === 'waveform') {
            const message = event.data, target = worker
            // This is the audio document captured with this preview request,
            // not a newer edit that arrived while its renderer was busy.
            void readWaveformWindow(waveformTracks, message.query).then(samples => {
              if (alive && worker === target) target?.postMessage({ kind: 'waveform', requestId: message.requestId, samples }, [samples.buffer])
            }, error => {
              if (alive && worker === target) target?.postMessage({ kind: 'waveform', requestId: message.requestId, error: String(error) })
            })
            return
          }
          const message = event.data, target = worker
          const source = message.mediaKind === 'video' ? getVideoSourceAsset(message.ref) : getPhotoPlayableUrl(message.ref).then(url => new URL(url, location.origin).href)
          void source.then(value => {
            if (alive && target === worker) target?.postMessage({ kind: 'media', requestId: message.requestId, source: value })
          }, error => {
            if (alive && target === worker) target?.postMessage({ kind: 'media', requestId: message.requestId, error: String(error) })
          })
          return
        }
        clearTimeout(watchdog)
        if (pending) { const resolve = pending; pending = undefined; resolve(event.data) }
      }
      worker.onerror = event => fail(`${event.message || 'Preview worker failed'} (${event.filename}:${event.lineno})`)
      worker.onmessageerror = () => fail('Preview worker message could not be decoded')
    } catch (error) { fail(String(error)) }

    const queue = new LatestPreview(async () => {
      if (!alive || isExportPinned()) return
      if (!worker) {
        preloadProjectInstruments(useProjectStore.getState().scenes)
        previewRuntime.frameReady = true
        get().invalidate()
        return
      }
      const project = useProjectStore.getState()
      if (previewRuntime.directParticles) {
        if (syncProject.current !== project) {
          visualEngine.setProject(project)
          syncProject.current = project
        }
        if (visualEngine.isDirectParticleScene(scene.current)) {
          previewRuntime.frameReady = true
          get().invalidate()
          return
        }
        // A scene/edit left the compact path. The worker receives a fresh
        // document before it owns playback again.
        previewRuntime.directParticles = false
        previewRuntime.worker = true
        revision++; lastSentRevision = -1
      }
      waveformTracks = project.audioTracks
      const time = useTimeStore.getState()
      const state = get()
      const sentEpoch = epoch
      const requestedPick = selection ?? pick
      const request: PreviewRequest = {
        videoClips: useVideoStore.getState().videoClips,
        id: ++id, revision, frameBase: frameDecoder.id, beat: time.currentBeat, playing: time.isPlaying,
        sceneId: scene.current, width: Math.max(1, Math.round(state.size.width)), height: Math.max(1, Math.round(state.size.height)),
        dpr: state.viewport.dpr, quality: useUIStore.getState().previewQuality,
        pick: requestedPick ? { id: requestedPick.id, nx: requestedPick.nx, ny: requestedPick.ny } : undefined,
        canvasHover: useUIStore.getState().canvasHover,
        trackIds: getTrackPreviewSurfaces().map(s => s.trackId),
        render: !renderFailed && typeof OffscreenCanvas !== 'undefined' && canRenderInWorker(project),
        project: revision !== lastSentRevision ? {
          scenes: project.scenes, sceneOrder: project.sceneOrder, activeSceneId: project.activeSceneId,
          bpm: project.bpm, beatsPerBar: project.beatsPerBar, totalBars: project.totalBars,
          tracks: project.tracks, rootTrackIds: project.rootTrackIds,
        } : undefined,
      }
      lastSentRevision = revision
      const response = await new Promise<PreviewResponse>(resolve => {
        pending = resolve
        watchdog = setTimeout(() => fail('Preview worker timed out'), 30_000)
        try { worker!.postMessage(request) } catch (error) { fail(String(error)) }
      })
      if (!alive || sentEpoch !== epoch || isExportPinned()) { return }
      if (response.error || !response.frame) { fail(response.error ?? 'Missing preview frame'); return }
      if (response.renderError) { renderFailed = true; previewRuntime.error = response.renderError }
      if (response.pick && response.pick.id === selection?.id) {
        selection.resolve(response.pick.hit); selection = undefined
        if (pick) queue.request()
      } else if (response.pick && response.pick.id === pick?.id) {
        pick.resolve(response.pick.hit); pick = undefined
      } else if (!response.pixels) clearPick()
      const presentStart = performance.now()
      setPreviewRendering(!!response.pixels)
      visualEngine.applyFrame(frameDecoder.decode(response.frame), response.revision === previewRuntime.revision)
      const directParticles = visualEngine.isDirectParticleScene(scene.current)
      previewRuntime.directParticles = directParticles
      previewRuntime.worker = !directParticles
      // Export must resolve its own graph after a preview replaces evaluated caches.
      syncProject.current = null
      previewRuntime.revision = response.revision
      previewRuntime.beat = request.beat
      previewRuntime.duration = response.duration
      for (const thumbnail of response.thumbnails ?? []) {
        for (const surface of getTrackPreviewSurfaces()) if (surface.trackId === thumbnail.trackId) {
          surface.canvas.getContext('2d')?.putImageData(thumbnail.pixels, 0, 0)
        }
      }
      if (response.camera) {
        // DOM editor handles use the delivered camera without remounting any
        // scene geometry or advancing the main WebGL renderer.
        const camera = get().camera
        camera.matrixWorld.fromArray(response.camera.world)
        camera.matrixWorld.decompose(camera.position, camera.quaternion, camera.scale)
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
        camera.projectionMatrix.fromArray(response.camera.projection)
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
      }
      if (response.pixels && !directParticles) {
        if (presentation.width !== response.pixels.width) presentation.width = response.pixels.width
        if (presentation.height !== response.pixels.height) presentation.height = response.pixels.height
        context.putImageData(response.pixels, 0, 0)
        previewRuntime.ambient = response.ambient ?? null
        presentation.style.display = ''
        sourceRef.current = presentation
        setPreviewRendering(true)
      } else {
        restoreCanvas()
        preloadProjectInstruments(project.scenes)
        previewRuntime.frameReady = true
        get().invalidate()
      }
      previewRuntime.presentMs = performance.now() - presentStart
      notifyPreviewFrame()
    }, () => Math.min(500, Math.max(16, previewRuntime.duration * 2)), error => fail(String(error)))
    // No document traversal, resolve or cloning in these listeners.
    const stopProject = useProjectStore.subscribe((s, prev) => {
      if (s.audioTracks !== prev.audioTracks || s.scenes !== prev.scenes || s.sceneOrder !== prev.sceneOrder || s.activeSceneId !== prev.activeSceneId
        || s.bpm !== prev.bpm || s.beatsPerBar !== prev.beatsPerBar || s.totalBars !== prev.totalBars) {
        revision++; queue.request()
      }
    })
    const stopVideo = useVideoStore.subscribe(() => queue.request())
    const stopTime = useTimeStore.subscribe(() => queue.request())
    const stopGradient = useGradientEditing.subscribe(() => queue.request())
    const stopSurfaces = subscribeTrackPreviews(() => queue.request())
    const stopUI = useUIStore.subscribe(() => queue.request())
    const resize = new ResizeObserver(() => queue.request())
    resize.observe(canvas)
    const stopExport = subscribeExportPinned(() => {
      epoch++; clearPick()
      if (isExportPinned()) restoreCanvas()
      else { revision++; queue.request() }
    })
    setWorkerPicker((nx, ny, select) => new Promise(resolve => {
      if (select) { selection?.resolve(null); selection = undefined }
      else { pick?.resolve(null); pick = undefined }
      if (!alive || !worker || isExportPinned()) { resolve(null); return }
      const next = { id: ++pickId, nx, ny, resolve }
      if (select) selection = next
      else pick = next
      queue.request()
    }))
    if (process.env.NODE_ENV !== 'production') Object.assign(window, { __previewRuntime: previewRuntime })
    queue.request()
    return () => {
      clearPick(); setWorkerPicker(undefined)
      alive = false; epoch++; queue.dispose(); worker?.terminate(); clearTimeout(watchdog)
      pending?.({ id, revision, error: 'Disposed', duration: 0 })
      stopProject(); stopVideo(); stopTime(); stopUI(); stopSurfaces(); stopGradient(); resize.disconnect(); stopExport()
      presentation.remove(); restoreCanvas()
      previewRuntime.directParticles = false
      previewRuntime.worker = false; previewRuntime.frameReady = false; previewRuntime.revision = -1
    }
  }, [get, sourceRef])
  return null
}
