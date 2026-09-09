import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { pickRenderedTrack } from '../../core/visual/previewPicking'
import { pickInWorker } from '../../core/visual/previewRuntime'
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

  useEffect(() => {
    const canvas = gl.domElement
    let generation = 0, selectionGeneration = 0
    const clear = () => {
      generation++
      useUIStore.getState().setCanvasHover(null)
      canvas.style.cursor = ''
    }

    const pickAt = async (clientX: number, clientY: number, select = false) => {
      const rect = canvas.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      const nx = (clientX - rect.left) / rect.width, ny = 1 - (clientY - rect.top) / rect.height
      return await (pickInWorker(nx, ny, select) ?? pickRenderedTrack(camera, nx, ny))
    }

    const onMove = async (e: PointerEvent) => {
      if (!e.shiftKey) { clear(); return }
      const stamp = ++generation
      const hit = await pickAt(e.clientX, e.clientY)
      if (stamp !== generation) return
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
      if (e.type === 'keyup') { clear(); invalidate() }
    }

    const onDoubleClick = async (e: MouseEvent) => {
      if (!e.shiftKey) return
      e.preventDefault()
      e.stopPropagation()
      const stamp = ++selectionGeneration
      const hit = await pickAt(e.clientX, e.clientY, true)
      if (stamp !== selectionGeneration || !hit) return
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
      generation++; selectionGeneration++
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('dblclick', onDoubleClick)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', onLeave)
      clear()
    }
  }, [gl, camera, invalidate])

  return null
}
