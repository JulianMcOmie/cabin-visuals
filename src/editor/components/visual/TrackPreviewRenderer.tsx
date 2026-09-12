'use client'

import { Fragment, memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { AmbientLight, DirectionalLight, PerspectiveCamera, Scene, Vector4, Color, SRGBColorSpace, WebGLRenderTarget } from 'three'
import { isExportPinned } from '../../core/export/frameDriver'
import { createVisualEngine, type ObjectListEntry } from '../../core/visual/VisualEngine'
import { VisualEngineContext } from '../../core/visual/VisualEngineContext'
import type { ProjectSnapshot } from '../../core/visual/resolve'
import { streamCount, streamDensity } from '../../instruments/particleStreamCore'
import { getInstrument } from '../../instruments'
import { useProjectStore } from '../../store/ProjectStore'
import { useTimeStore } from '../../store/TimeStore'
import { trackPreviewStage } from '../timeline/trackPreviewStage'
import {
  PREVIEW_HEIGHT as H, PREVIEW_WIDTH as W, subscribeTrackPreviews,
  trackPreviewSurfaces, getTrackPreviewSurfaces,
} from '../timeline/trackPreviewRegistry'
import { ObjectRenderer } from './ObjectRenderer'
import { InstancedObjectRenderer } from './InstancedObjectRenderer'

const pendingReadbacks = new Set<Promise<void>>()
/** The worker waits for this atlas before transferring its thumbnail bitmaps. */
export async function whenTrackPreviewsPainted() { await Promise.all([...pendingReadbacks]) }

const EMPTY_SURFACES: ReturnType<typeof getTrackPreviewSurfaces> = []

function makeStage(id: string, project: ProjectSnapshot, previous?: Stage): Stage {
  const stage = trackPreviewStage(id, project)
  const engine = previous?.context.engine ?? createVisualEngine()
  engine.setProject(stage.snapshot)
  const scene = previous?.scene ?? new Scene()
  if (!previous) {
    scene.add(new AmbientLight('#ffffff', 0.65))
    const key = new DirectionalLight('#ffffff', 1.7)
    key.position.set(3, 4, 5)
    scene.add(key)
    const fill = new DirectionalLight('#ffffff', 0.8)
    fill.position.set(-3, -1, -4)
    scene.add(fill)
  }
  const camera = previous?.camera ?? new PerspectiveCamera(55, W / H, 0.1, 1000)
  camera.position.set(0, 0, 5)
  camera.updateMatrixWorld()
  return {
    id, snapshot: stage.snapshot, scene, camera,
    context: { engine, tracks: stage.snapshot.tracks, renderFrame: previous?.context.renderFrame ?? { current: false } },
    objects: engine.getObjectList().filter(object => stage.targets.has(object.trackId)),
    particleCount: [...new Map(engine.getObjectList().map(object => [object.trackId, object])).values()].reduce((total, object) => {
      const copies = engine.getVisualCopyCount(object.trackId)
      const params = stage.snapshot.tracks[object.trackId]?.params
      return total + (object.proceduralCopies ? copies : object.instrumentId === 'particleStream'
        ? copies * streamCount(params?.count ?? 6) * streamDensity(params?.density ?? 16) : 0)
    }, 0),
  }
}
interface Stage {
  id: string
  snapshot: ProjectSnapshot
  scene: Scene
  camera: PerspectiveCamera
  context: NonNullable<React.ContextType<typeof VisualEngineContext>>
  objects: ObjectListEntry[]
  particleCount: number
}

function sameInputs(a: ProjectSnapshot, b: ProjectSnapshot) {
  return a.bpm === b.bpm && a.beatsPerBar === b.beatsPerBar && a.totalBars === b.totalBars
    && a.rootTrackIds.join('|') === b.rootTrackIds.join('|')
    && Object.keys(a.tracks).length === Object.keys(b.tracks).length
    && Object.keys(a.tracks).every(id => a.tracks[id] === b.tracks[id])
}

// Memoized on the stage's identity: `stages` is a fresh array per revision but
// an untouched stage keeps its object, so the 80ms-debounced revision after
// every edit re-renders only the stages whose inputs changed - not every
// mounted preview's whole object tree (26ms of React per edit at 134 tracks).
const StageObjects = memo(function StageObjects({ stage, sceneId }: { stage: Stage; sceneId: string }) {
  const groups = useMemo(() => {
    const byTrack = new Map<string, ObjectListEntry[]>()
    for (const object of stage.objects) {
      const list = byTrack.get(object.trackId) ?? []
      list.push(object)
      byTrack.set(object.trackId, list)
    }
    return [...byTrack.values()]
  }, [stage.objects])
  return <>{groups.map(entries => {
    const first = entries[0]
    return getInstrument(first.instrumentId)?.instancedComponent
      ? <InstancedObjectRenderer key={first.trackId} sceneId={sceneId} trackId={first.trackId} instrumentId={first.instrumentId} entries={entries} keySuffix=":preview" />
      : entries.map(object => <ObjectRenderer key={`${object.trackId}:${object.visualCopyIndex}`} sceneId={sceneId} trackId={object.trackId} instrumentId={object.instrumentId} visualCopyIndex={object.visualCopyIndex} />)
  })}</>
})

/** Stage-specific scenes share the editor's WebGL context. Each uses the exact
 * production evaluator on an inclusive chain prefix, a fixed camera and the
 * SAME playhead. The 2D destination stays in its row, so scroll never waits for
 * a render or a coordinate mirror. */
export function TrackPreviewRenderer({ immediate = false }: { immediate?: boolean } = {}) {
  const immediateProject = useProjectStore(s => immediate ? s : null)
  const invalidate = useThree(s => s.invalidate)
  const surfaces = useSyncExternalStore(subscribeTrackPreviews, getTrackPreviewSurfaces, () => EMPTY_SURFACES)
  const [revision, setRevision] = useState(0)
  const cache = useRef(new Map<string, Stage>())
  useEffect(() => {
    if (immediate) return
    // Structural edits are batched off the pointermove path. A changed prefix
    // rebuilds only its affected stages; foreign edits preserve scene mounts.
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = useProjectStore.subscribe(() => {
      clearTimeout(timer)
      timer = setTimeout(() => { setRevision(value => value + 1); invalidate() }, 80)
    })
    return () => { stop(); clearTimeout(timer) }
  }, [invalidate, immediate])
  const stages = useMemo(() => {
    const p = useProjectStore.getState()
    const snapshot = { tracks: p.tracks, rootTrackIds: p.rootTrackIds, bpm: p.bpm, beatsPerBar: p.beatsPerBar, totalBars: p.totalBars }
    const active = new Set(surfaces.map(surface => surface.trackId))
    for (const surface of surfaces) {
      const previous = cache.current.get(surface.trackId)
      const inputs = trackPreviewStage(surface.trackId, snapshot).snapshot
      if (!previous || !sameInputs(previous.snapshot, inputs)) cache.current.set(surface.trackId, makeStage(surface.trackId, snapshot, previous))
    }
    // Retain a modest warm cache across scroll reversals, with inactive stages
    // fully parked. Active stages are never evicted, however small the rows.
    for (const id of cache.current.keys()) {
      if (cache.current.size <= Math.max(32, active.size)) break
      if (!active.has(id)) cache.current.delete(id)
    }
    return [...cache.current.values()]
    // revision represents the debounced project snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaces, revision, immediateProject])
  const sceneId = useProjectStore(s => s.activeSceneId)
  const runtime = useMemo(() => ({
    target: new WebGLRenderTarget(W, H), busy: false, alive: true,
    lastFrame: -Infinity, pending: false, paint: false,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    viewport: new Vector4(), scissor: new Vector4(), clear: new Color(),
  }), [])
  useEffect(() => {
    runtime.alive = true
    invalidate()
    return () => { runtime.alive = false; clearTimeout(runtime.timer); if (!runtime.busy) runtime.target.dispose() }
  }, [runtime, invalidate])
  useEffect(() => { invalidate() }, [stages, invalidate])

  useFrame(() => {
    for (const stage of stages) stage.context.renderFrame.current = false
    runtime.paint = false
    if (!surfaces.length || isExportPinned()) return
    if (runtime.busy) { runtime.pending = true; return }
    const now = performance.now() / 1000
    // A million-particle row still renders its complete cloud, but live atlas
    // refreshes must leave GPU time for the 60fps primary canvas.
    const dense = useTimeStore.getState().isPlaying && surfaces.reduce((sum, surface) => sum + (cache.current.get(surface.trackId)?.particleCount ?? 0), 0) >= 1_000_000
    const remaining = 1 / (dense ? 10 : 30) - (now - runtime.lastFrame)
    if (remaining > 0) {
      // Pointer/scroll invalidations can arrive at display refresh even paused.
      // Cap preview work too, then guarantee the final paused edit gets painted.
      if (!runtime.timer) runtime.timer = setTimeout(() => {
        runtime.timer = undefined
        if (runtime.alive) invalidate()
      }, remaining * 1000)
      return
    }
    clearTimeout(runtime.timer)
    runtime.timer = undefined
    runtime.lastFrame = now
    runtime.paint = true
    const beat = useTimeStore.getState().currentBeat
    for (const surface of surfaces) {
      const stage = cache.current.get(surface.trackId)
      if (!stage) continue
      stage.context.renderFrame.current = true
      stage.context.engine.computeAtBeat(beat)
    }
  }, -10)

  useFrame(({ gl }) => {
    if (!runtime.paint || isExportPinned()) return
    const count = Math.min(surfaces.length, Math.floor(gl.capabilities.maxTextureSize / H))
    const height = count * H
    runtime.target.setSize(W, height)
    runtime.target.texture.colorSpace = SRGBColorSpace
    const previousTarget = gl.getRenderTarget()
    gl.getViewport(runtime.viewport); gl.getScissor(runtime.scissor); gl.getClearColor(runtime.clear)
    const scissorTest = gl.getScissorTest(), alpha = gl.getClearAlpha(), autoClear = gl.autoClear
    try {
      gl.autoClear = false
      gl.setRenderTarget(runtime.target)
      gl.setScissorTest(true)
      gl.setClearColor('#101218', 1)
      for (let i = 0; i < count; i++) {
        // Glow captures can temporarily bind another target from a scene hook.
        // Keep the atlas tile on its target so rebinding restores the same region.
        runtime.target.viewport.set(0, i * H, W, H)
        runtime.target.scissor.set(0, i * H, W, H)
        runtime.target.scissorTest = true
        gl.setViewport(0, i * H, W, H); gl.setScissor(0, i * H, W, H)
        gl.clear(true, true, true)
        const stage = cache.current.get(surfaces[i].trackId)
        if (stage) gl.render(stage.scene, stage.camera)
      }
      const pixels = new Uint8Array(W * height * 4)
      runtime.busy = true
      runtime.pending = false
      const readback = gl.readRenderTargetPixelsAsync(runtime.target, 0, 0, W, height, pixels).then(() => {
        if (!runtime.alive || useProjectStore.getState().activeSceneId !== sceneId) return
        for (let i = 0; i < count; i++) {
          const surface = surfaces[i]
          if (!trackPreviewSurfaces.has(surface)) continue
          const ctx = surface.canvas.getContext('2d')
          if (!ctx) continue
          const image = ctx.createImageData(W, H)
          for (let y = 0; y < H; y++) {
            const start = ((i + 1) * H - 1 - y) * W * 4
            image.data.set(pixels.subarray(start, start + W * 4), y * W * 4)
          }
          ctx.putImageData(image, 0, 0)
        }
      }).catch(() => {}).finally(() => {
        pendingReadbacks.delete(readback)
        runtime.busy = false
        if (!runtime.alive) runtime.target.dispose()
        else if (runtime.pending) invalidate()
      })
      pendingReadbacks.add(readback)
    } finally {
      gl.autoClear = autoClear
      gl.setRenderTarget(previousTarget)
      gl.setViewport(runtime.viewport); gl.setScissor(runtime.scissor)
      gl.setScissorTest(scissorTest); gl.setClearColor(runtime.clear, alpha)
    }
  }, 101)

  return <>{stages.map(stage => <Fragment key={stage.scene.uuid}>{createPortal(
    <VisualEngineContext.Provider value={stage.context}>
      <StageObjects stage={stage} sceneId={sceneId} />
    </VisualEngineContext.Provider>,
    stage.scene,
    { camera: stage.camera, size: { width: W, height: H, top: 0, left: 0 } },
  )}</Fragment>)}</>
}
