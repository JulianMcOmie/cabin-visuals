import { useEffect, useRef } from 'react'
import { useProjectStore } from '../../store/ProjectStore'
import { useUIStore } from '../../store/UIStore'

/** Feed the existing scene outline from a timeline row. Native row events keep
 * portaled controls out of the hit area; only the hovered row listens for Shift. */
export function useTrackSceneHover(trackId: string, enabled: boolean) {
  const rowRef = useRef<HTMLDivElement>(null)
  const sceneId = useProjectStore((s) => s.activeSceneId)

  useEffect(() => {
    const row = rowRef.current
    if (!row || !enabled) return
    let ownedHover: ReturnType<typeof useUIStore.getState>['canvasHover'] = null

    const clear = () => {
      const ui = useUIStore.getState()
      if (ownedHover && ui.canvasHover === ownedHover) ui.setCanvasHover(null)
      ownedHover = null
    }
    const update = (shift: boolean) => {
      if (!shift) { clear(); return }
      const project = useProjectStore.getState()
      if (project.activeSceneId !== sceneId || !project.scenes[sceneId]?.tracks[trackId]) {
        clear()
        return
      }
      useUIStore.getState().setCanvasHover({ trackId, sceneId })
      ownedHover = useUIStore.getState().canvasHover
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Shift') update(event.shiftKey)
    }
    const leave = () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', leave)
      clear()
    }
    const enter = (event: PointerEvent) => {
      window.addEventListener('keydown', onKey)
      window.addEventListener('keyup', onKey)
      window.addEventListener('blur', leave)
      update(event.shiftKey)
    }
    // Movement also recovers modifier state after returning from another window.
    row.addEventListener('pointerenter', enter)
    row.addEventListener('pointermove', enter)
    row.addEventListener('pointerleave', leave)
    row.addEventListener('pointercancel', leave)
    return () => {
      row.removeEventListener('pointerenter', enter)
      row.removeEventListener('pointermove', enter)
      row.removeEventListener('pointerleave', leave)
      row.removeEventListener('pointercancel', leave)
      leave()
    }
  }, [trackId, sceneId, enabled])

  return rowRef
}
