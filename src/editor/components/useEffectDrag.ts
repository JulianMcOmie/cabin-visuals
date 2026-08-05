import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useProjectStore } from '../store/ProjectStore'
import { useUIStore } from '../store/UIStore'
import { lockCursor, unlockCursor } from '../utils/dragCursor'

/**
 * Drag an effect from the library onto the Track Editor's Effects drop zone (marked
 * with `data-effects-drop`) to add it to the selected track. A floating ghost follows
 * the cursor; a pure click does nothing (a movement threshold gates it). The drop
 * target is located by coordinates (getBoundingClientRect), so it works even with
 * pointer events suppressed during the drag.
 */
export function useEffectDrag() {
  const ghostRef = useRef<HTMLDivElement>(null)
  const [ghostName, setGhostName] = useState<string | null>(null)

  const startEffectDrag = useCallback((e: ReactPointerEvent, plugin: { id: string; name: string }) => {
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    let started = false
    let over = false

    const moveGhost = (x: number, y: number) => {
      if (ghostRef.current) {
        ghostRef.current.style.left = `${x}px`
        ghostRef.current.style.top = `${y}px`
      }
    }

    const controller = new AbortController()
    const onMove = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3) return
        started = true
        setGhostName(plugin.name)
        useUIStore.getState().setEffectDragging(true)
        lockCursor('default')
        const px = ev.clientX, py = ev.clientY
        requestAnimationFrame(() => moveGhost(px, py))
      }
      moveGhost(ev.clientX, ev.clientY)

      const zone = document.querySelector('[data-effects-drop]') as HTMLElement | null
      let isOver = false
      if (zone) {
        const r = zone.getBoundingClientRect()
        isOver = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom
      }
      over = isOver
    }

    const onUp = () => {
      controller.abort()
      if (!started) return
      unlockCursor()
      setGhostName(null)
      useUIStore.getState().setEffectDragging(false)
      if (over) {
        // Match the Track Editor's target: the selected track's chain, else the
        // active scene's chain (the drop zone shown when nothing is selected).
        const { selectedTrackId } = useUIStore.getState()
        const project = useProjectStore.getState()
        if (selectedTrackId && project.tracks[selectedTrackId]) project.addEffect(selectedTrackId, plugin.id)
        else if (project.activeSceneId) project.addSceneEffect(project.activeSceneId, plugin.id)
      }
    }

    window.addEventListener('pointermove', onMove, { signal: controller.signal })
    window.addEventListener('pointerup', onUp, { signal: controller.signal })
  }, [])

  return { startEffectDrag, ghostRef, ghostName }
}
