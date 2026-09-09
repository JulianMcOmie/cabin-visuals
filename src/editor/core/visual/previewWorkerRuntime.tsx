import { createElement, useEffect } from 'react'
import { createRoot, extend } from '@react-three/fiber'
import * as THREE from 'three'
import { whenTrackPreviewsPainted } from '../../components/visual/TrackPreviewRenderer'
import { registerTrackPreview, trackPreviewSurfaces, PREVIEW_WIDTH, PREVIEW_HEIGHT } from '../../components/timeline/trackPreviewRegistry'
import { VisualScene } from '../../components/visual/VisualScene'
import { useProjectStore } from '../../store/ProjectStore'
import { setPreviewMediaResolver } from './previewMedia'
import { setPreviewWaveformResolver, setPreviewWaveformRevision, whenWaveformsSettled } from './previewWaveform'
import { whenFontsSettled } from './fonts'
import { useVideoStore } from '../../store/VideoStore'
import { useTimeStore } from '../../store/TimeStore'
import { useUIStore } from '../../store/UIStore'
import { preloadProjectInstruments } from '../../instruments'
import { whenInstrumentsSettled } from '../../instruments/lazyInstrument'
import { visualEngine } from './VisualEngine'
import { pickRenderedTrack } from './previewPicking'
import { PauseCanary } from './pauseCanary'
import type { PreviewRequest, PreviewResponse, PreviewMediaResponse, PreviewWaveformResponse } from './previewProtocol'

function FrameCommit({ commit }: { commit: () => void }) {
  // Render only after child passive effects attach environments, scene roots
  // and frame resources. A layout-effect gate can cache an empty first frame.
  useEffect(commit, [commit])
  return <VisualScene trackPreviews={true} />
}

extend(THREE as unknown as Parameters<typeof extend>[0])
let mediaId = 0
const mediaRequests = new Map<number, { resolve: (source: Blob | string) => void; reject: (error: Error) => void }>()
setPreviewMediaResolver((mediaKind, ref) => new Promise((resolve, reject) => {
  const requestId = ++mediaId
  mediaRequests.set(requestId, { resolve, reject })
  self.postMessage({ kind: 'media', requestId, mediaKind, ref })
}))
const waveformRequests = new Map<number, { resolve: (samples: Float32Array) => void; reject: (error: Error) => void }>()
setPreviewWaveformResolver(query => new Promise((resolve, reject) => {
  const requestId = ++mediaId
  waveformRequests.set(requestId, { resolve, reject })
  self.postMessage({ kind: 'waveform', requestId, query })
}))
let canvas: OffscreenCanvas | undefined
let root: ReturnType<typeof createRoot> | undefined
let store: ReturnType<ReturnType<typeof createRoot>['render']> | undefined
let renderFailed: string | undefined
const surfaces = new Map<string, { canvas: OffscreenCanvas; stop: () => void }>()
let presentation: OffscreenCanvas | undefined
let ambient: OffscreenCanvas | undefined
let size = ''
const canaries = new Map<string, PauseCanary>()

async function render(request: PreviewRequest): Promise<ImageBitmap | undefined> {
  if (!request.render || renderFailed) return
  try {
    if (!canvas) {
      canvas = new OffscreenCanvas(request.width, request.height)
      root = createRoot(canvas)
    }
    const nextSize = `${request.width}:${request.height}:${request.dpr}`
    if (size !== nextSize) {
      await root!.configure({
        onCreated: state => state.set({ invalidate: () => self.postMessage({ kind: 'invalidate' }) }),
        frameloop: 'never', dpr: request.dpr, shadows: 'soft',
        size: { width: request.width, height: request.height, top: 0, left: 0 },
        camera: { position: [0, 0, 5], fov: 55 }, gl: { antialias: false },
      })
      size = nextSize
    }
    for (const [id, surface] of surfaces) if (!request.trackIds.includes(id)) {
      surface.stop(); surfaces.delete(id)
    }
    for (const trackId of request.trackIds) if (!surfaces.has(trackId)) {
      const canvas = new OffscreenCanvas(PREVIEW_WIDTH, PREVIEW_HEIGHT)
      canvas.getContext('2d')
      const stop = registerTrackPreview(trackPreviewSurfaces, { trackId, canvas: canvas as unknown as HTMLCanvasElement })
      surfaces.set(trackId, { canvas, stop })
    }
    preloadProjectInstruments(useProjectStore.getState().scenes)
    await whenInstrumentsSettled()
    // A worker owns its React root too: mounting thousands of copies cannot
    // block a DOM input event. Flush structural updates before sampling a frame.
    await new Promise<void>(resolve => {
      store = root!.render(createElement(FrameCommit, { commit: resolve }))
    })
    await whenInstrumentsSettled()
    store!.getState().advance(request.beat * 1000)
    if (await whenWaveformsSettled()) store!.getState().advance(request.beat * 1000)
    if (await whenFontsSettled()) store!.getState().advance(request.beat * 1000)
    if (process.env.NODE_ENV !== 'production') {
      const roots = visualEngine.getMountedRenderScenes()
      for (const [key, scene] of roots) {
        let canary = canaries.get(key)
        if (!canary) { canary = new PauseCanary(); canaries.set(key, canary) }
        canary.check(scene, request.beat, request.playing, useProjectStore.getState())
      }
      for (const key of canaries.keys()) if (!roots.has(key)) canaries.delete(key)
    }
    await whenTrackPreviewsPainted()
    return canvas.transferToImageBitmap()
  } catch (error) {
    renderFailed = String(error)
    root?.unmount()
    root = undefined
    return undefined
  }
}

self.onmessage = async (event: MessageEvent<PreviewRequest | PreviewMediaResponse | PreviewWaveformResponse>) => {
  if ('kind' in event.data) {
    if (event.data.kind === 'waveform') {
      const message = event.data, pending = waveformRequests.get(message.requestId)
      waveformRequests.delete(message.requestId)
      if (message.samples) pending?.resolve(message.samples)
      else pending?.reject(new Error(message.error ?? 'Waveform unavailable'))
      return
    }
    const message = event.data, pending = mediaRequests.get(message.requestId)
    mediaRequests.delete(message.requestId)
    if (message.source !== undefined) pending?.resolve(message.source)
    else pending?.reject(new Error(message.error ?? 'Media unavailable'))
    return
  }
  const request = event.data
  const start = performance.now()
  const response: PreviewResponse = { id: request.id, revision: request.revision, duration: 0 }
  try {
    if (request.project) {
      useProjectStore.setState(request.project)
      visualEngine.setProject(useProjectStore.getState())
    }
    Object.assign(globalThis, { devicePixelRatio: request.dpr })
    setPreviewWaveformRevision(request.revision)
    useVideoStore.setState({ videoClips: request.videoClips })
    useTimeStore.setState({ currentBeat: request.beat, isPlaying: request.playing })
    useUIStore.setState({ previewQuality: request.quality, canvasHover: request.canvasHover })
    visualEngine.setEditorPreviewSceneId(request.sceneId)
    visualEngine.computeAtBeat(request.beat)
    const bitmap = await render(request)
    if (bitmap) {
      const camera = store!.getState().camera
      camera.updateMatrixWorld()
      if (request.pick) response.pick = { id: request.pick.id, hit: pickRenderedTrack(camera, request.pick.nx, request.pick.ny) }
      response.camera = { world: camera.matrixWorld.toArray(), projection: camera.projectionMatrix.toArray() }
      presentation ??= new OffscreenCanvas(1, 1)
      ambient ??= new OffscreenCanvas(192, 108)
      const presentationContext = presentation.getContext('2d', { willReadFrequently: true })!
      const ambientContext = ambient.getContext('2d', { willReadFrequently: true })!
      // CPU pixels deliberately sever the compositor's dependency on the busy
      // worker GL context. Passing its GPU ImageBitmap directly to the DOM can
      // block Chromium's main-thread Commit while the NEXT frame renders.
      if (presentation.width !== bitmap.width) presentation.width = bitmap.width
      if (presentation.height !== bitmap.height) presentation.height = bitmap.height
      presentationContext.drawImage(bitmap, 0, 0)
      response.pixels = presentationContext.getImageData(0, 0, bitmap.width, bitmap.height)
      ambientContext.drawImage(bitmap, 0, 0, 192, 108)
      bitmap.close()
      response.ambient = ambientContext.getImageData(0, 0, 192, 108)
      response.thumbnails = [...surfaces].map(([trackId, surface]) => ({
        trackId, pixels: surface.canvas.getContext('2d')!.getImageData(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT),
      }))
    }
    response.renderError = renderFailed
    response.frame = visualEngine.captureFrame()
  } catch (error) { response.error = String(error) }
  response.duration = performance.now() - start
  self.postMessage(response, { transfer: [...(response.pixels ? [response.pixels.data.buffer] : []), ...(response.thumbnails?.map(t => t.pixels.data.buffer) ?? []), ...(response.ambient ? [response.ambient.data.buffer] : [])] })
}
