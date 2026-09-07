'use client'

import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Color, Group, SRGBColorSpace, Vector4, WebGLRenderTarget, type Object3D, type Scene } from 'three'
import { isExportPinned } from '../../core/export/frameDriver'
import { rootSceneOf } from '../../core/visual/hoverTargets'
import { useProjectStore } from '../../store/ProjectStore'
import { useTimeStore } from '../../store/TimeStore'
import { trackPreviewTargets } from '../timeline/trackPreviewTargets'
import {
  PREVIEW_HEIGHT as H, PREVIEW_WIDTH as W, registerTrackPreview,
  subscribeTrackPreviews, trackPreviewRoots, trackPreviewSurfaces,
} from '../timeline/trackPreviewRegistry'

// Wrap the FINAL output, including ShaderWrapper's processed quad. Reusing
// these meshes preserves video/photo textures, instancing, and object effects
// without mounting another instrument or advancing the simulation again.
export function TrackPreviewRoot({ sceneId, trackId, children }: { sceneId: string; trackId: string; children: ReactNode }) {
  const ref = useRef<Group>(null)
  useEffect(() => {
    if (ref.current) return registerTrackPreview(trackPreviewRoots, { sceneId, trackId, object: ref.current })
  }, [sceneId, trackId])
  return <group ref={ref}>{children}</group>
}

const PREVIEW_LAYER = 8 // separate from the hover mask's layer 7

/** One tiny atlas on the EXISTING renderer, one asynchronous GPU readback.
 * Native row canvases retain their last frame while scrolling. No layout reads,
 * per-frame React work, extra WebGL contexts, or synchronous readPixels stalls. */
export function TrackPreviewRenderer() {
  const invalidate = useThree(s => s.invalidate)
  const runtime = useMemo(() => ({
    target: new WebGLRenderTarget(W, H, { depthBuffer: true }),
    busy: false, alive: true, lastFrame: -Infinity, revision: 0,
    viewport: new Vector4(), scissor: new Vector4(), clear: new Color(),
  }), [])
  useEffect(() => {
    runtime.alive = true
    const unsubscribe = subscribeTrackPreviews(() => { runtime.revision++; invalidate() })
    return () => {
      runtime.alive = false
      unsubscribe()
      // A pending read owns its target until the fence resolves.
      if (!runtime.busy) runtime.target.dispose()
    }
  }, [invalidate, runtime])

  useFrame(({ gl, camera, size }) => {
    if (isExportPinned() || trackPreviewSurfaces.size === 0) return
    if (runtime.busy) { runtime.revision++; return }
    // The thumbnail cadence is independent of native scrolling. Paused edits
    // and scrubs always get a fresh frame, even inside the playback interval.
    // R3F resets its clock when switching demand/always. A monotonic budget
    // clock avoids freezing thumbnails for seconds after pressing Play.
    // Visual content still comes exclusively from the engine's current beat.
    const now = performance.now() / 1000
    if (useTimeStore.getState().isPlaying && now - runtime.lastFrame < 1 / 30) return
    runtime.lastFrame = now
    const surfaces = [...trackPreviewSurfaces]
    const project = useProjectStore.getState()
    const sceneId = project.activeSceneId
    const height = Math.min(surfaces.length, Math.floor(gl.capabilities.maxTextureSize / H)) * H
    const count = height / H
    const aspect = size.width / Math.max(1, size.height)
    const tileWidth = Math.min(W, H * aspect)
    const tileHeight = Math.min(H, W / aspect)
    const revision = runtime.revision
    runtime.target.setSize(W, height)
    runtime.target.texture.colorSpace = SRGBColorSpace
    const previousTarget = gl.getRenderTarget()
    const previousViewport = gl.getViewport(runtime.viewport)
    const previousScissor = gl.getScissor(runtime.scissor)
    const previousScissorTest = gl.getScissorTest()
    const previousClearAlpha = gl.getClearAlpha()
    gl.getClearColor(runtime.clear)
    const autoClear = gl.autoClear
    const cameraMask = camera.layers.mask
    const shadowAutoUpdate = gl.shadowMap.autoUpdate
    try {
      gl.autoClear = false
      gl.shadowMap.autoUpdate = false
      gl.setRenderTarget(runtime.target)
      gl.setScissorTest(true)
      gl.setClearColor('#101218', 1)
      camera.layers.set(PREVIEW_LAYER)
      const sceneRoots = [...trackPreviewRoots].filter(root => root.sceneId === sceneId)
      for (let i = 0; i < count; i++) {
        const ids = trackPreviewTargets(surfaces[i].trackId, project.tracks)
        const roots = sceneRoots.filter(root => ids.has(root.trackId))
        const scenes = new Set<Scene>()
        const masks = new Map<Object3D, number>()
        const enable = (object: Object3D) => {
          if (!masks.has(object)) masks.set(object, object.layers.mask)
          object.layers.enable(PREVIEW_LAYER)
        }
        gl.setViewport(0, i * H, W, H)
        gl.setScissor(0, i * H, W, H)
        gl.clear(true, true, true)
        // Keep the main camera's aspect, letterboxing instead of squashing
        // the instrument when the visualizer is tall or unusually wide.
        gl.setViewport((W - tileWidth) / 2, i * H + (H - tileHeight) / 2, tileWidth, tileHeight)
        try {
          for (const root of roots) {
            root.object.traverse(enable)
            const scene = rootSceneOf(root.object)
            if (scene) scenes.add(scene)
          }
          for (const scene of scenes) {
            // Keep the scene's real lighting, but isolate its object pixels.
            scene.traverse(object => { if ('isLight' in object) enable(object) })
            const background = scene.background
            const autoUpdate = scene.matrixWorldAutoUpdate
            scene.background = null
            // The main pass just updated these same world matrices.
            scene.matrixWorldAutoUpdate = false
            try { gl.render(scene, camera) } finally {
              scene.background = background
              scene.matrixWorldAutoUpdate = autoUpdate
            }
            gl.clearDepth()
          }
        } finally {
          for (const [object, mask] of masks) object.layers.mask = mask
        }
      }
      const pixels = new Uint8Array(W * height * 4)
      runtime.busy = true
      void gl.readRenderTargetPixelsAsync(runtime.target, 0, 0, W, height, pixels).then(() => {
        if (!runtime.alive || useProjectStore.getState().activeSceneId !== sceneId) return
        for (let i = 0; i < count; i++) {
          const surface = surfaces[i]
          if (!trackPreviewSurfaces.has(surface)) continue
          const context = surface.canvas.getContext('2d')
          if (!context) continue
          const frame = context.createImageData(W, H)
          for (let y = 0; y < H; y++) {
            const start = ((i + 1) * H - 1 - y) * W * 4
            frame.data.set(pixels.subarray(start, start + W * 4), y * W * 4)
          }
          context.putImageData(frame, 0, 0)
        }
      }).catch(() => {
        // A lost context leaves the last good thumbnail in place.
      }).finally(() => {
        runtime.busy = false
        if (!runtime.alive) runtime.target.dispose()
        else if (runtime.revision !== revision) invalidate()
      })
    } finally {
      camera.layers.mask = cameraMask
      gl.autoClear = autoClear
      gl.shadowMap.autoUpdate = shadowAutoUpdate
      gl.setRenderTarget(previousTarget)
      gl.setViewport(previousViewport)
      gl.setScissor(previousScissor)
      gl.setScissorTest(previousScissorTest)
      gl.setClearColor(runtime.clear, previousClearAlpha)
    }
  }, 101) // after the scene compositor and all object shader passes
  return null
}
