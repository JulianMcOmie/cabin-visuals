import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { Raycaster, Vector2, type Scene } from 'three'
import { getCompositionLayers, getMountedRenderScenes } from '../../core/visual/VisualEngine'
import { layersUnderPoint, type HitPass } from '../../core/visual/hoverPickCore'
import { pickHoverTarget } from '../../core/visual/hoverTargets'
import { useProjectStore } from '../../store/ProjectStore'
import { useUIStore } from '../../store/UIStore'

/**
 * Shift-hover in the visualizer: hold Shift and move over the canvas to
 * highlight the instrument under the pointer (every copy of its track, via
 * VisualScene's glow pass) and light its timeline row; Shift + double-click
 * jumps to that track - switching scene if it lives in another one, expanding
 * collapsed ancestors, selecting it and scrolling its row into view.
 *
 * Mounted inside the Canvas so it can borrow the real camera and the canvas
 * element. Objects live in offscreen portaled scenes, so this raycasts the
 * hover registry by hand (core/visual/hoverTargets.ts) after mapping the
 * pointer through the composited layer it lands in (hoverPickCore.ts): in
 * Composite view a Cut director's viewport partitions each show a scene
 * squashed into a rect, and the pointer has to be un-squashed into that
 * scene's own camera space before the ray is cast.
 *
 * Nothing here runs per frame; hover state is written only when the hovered
 * track changes, and every write also invalidates a frame so the paused
 * canvas repaints the glow.
 */
export function CanvasHoverPicker() {
  const { gl, camera, invalidate } = useThree()
  const raycaster = useRef(new Raycaster()).current
  const ndc = useRef(new Vector2()).current

  useEffect(() => {
    const canvas = gl.domElement
    // Points/lines need a pick tolerance or a particle field is unhoverable.
    raycaster.params.Points.threshold = 0.12
    raycaster.params.Line.threshold = 0.06

    const clear = () => {
      useUIStore.getState().setCanvasHover(null)
      canvas.style.cursor = ''
    }

    /** Which pass scene a root's scene is, from the mounted scene map. */
    const passOf = (scene: Scene | null): HitPass | undefined => {
      if (!scene) return undefined
      for (const [key, mounted] of getMountedRenderScenes()) {
        if (mounted !== scene) continue
        const pass = key.slice(key.lastIndexOf(':') + 1)
        return pass === 'front' || pass === 'invert' ? pass : 'base'
      }
      return undefined
    }

    const pickAt = (clientX: number, clientY: number): { trackId: string; sceneId: string } | null => {
      const rect = canvas.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      const nx = (clientX - rect.left) / rect.width
      const ny = 1 - (clientY - rect.top) / rect.height
      if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null
      for (const layer of layersUnderPoint(getCompositionLayers(), nx, ny)) {
        ndc.set(layer.ndcX, layer.ndcY)
        raycaster.setFromCamera(ndc, camera)
        const hit = pickHoverTarget(raycaster, layer.sceneId, passOf)
        if (hit) return { trackId: hit.trackId, sceneId: layer.sceneId }
      }
      return null
    }

    const onMove = (e: PointerEvent) => {
      if (!e.shiftKey) { clear(); return }
      const hit = pickAt(e.clientX, e.clientY)
      const prev = useUIStore.getState().canvasHover
      if (hit?.trackId !== prev?.trackId || hit?.sceneId !== prev?.sceneId) {
        useUIStore.getState().setCanvasHover(hit)
        invalidate()
      }
      canvas.style.cursor = hit ? 'pointer' : ''
    }

    const onLeave = () => { clear(); invalidate() }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Shift') return
      if (e.type === 'keyup' && useUIStore.getState().canvasHover) { clear(); invalidate() }
    }

    const onDoubleClick = (e: MouseEvent) => {
      if (!e.shiftKey) return
      const hit = pickAt(e.clientX, e.clientY)
      if (!hit) return
      e.preventDefault()
      e.stopPropagation()
      const project = useProjectStore.getState()
      const ui = useUIStore.getState()
      // The object may belong to a scene other than the one being edited
      // (Composite view): editing it means switching there first.
      if (project.activeSceneId !== hit.sceneId) project.setActiveScene(hit.sceneId)
      // A row hidden under a collapsed ancestor cannot be scrolled to.
      const tracks = useProjectStore.getState().scenes[hit.sceneId]?.tracks ?? {}
      for (let cur = tracks[hit.trackId]?.parentId; cur != null; cur = tracks[cur]?.parentId) {
        if (ui.collapsedTrackIds.has(cur)) ui.setTrackCollapsed(cur, false)
      }
      ui.setSelectedTrackId(hit.trackId)
      ui.revealTrack(hit.trackId)
    }

    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('dblclick', onDoubleClick)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', onLeave)
    return () => {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('dblclick', onDoubleClick)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', onLeave)
      clear()
    }
  }, [gl, camera, invalidate, raycaster, ndc])

  return null
}
