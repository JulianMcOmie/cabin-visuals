import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useTimeStore } from '../store/TimeStore'
import { lockCursor, unlockCursor } from '../utils/dragCursor'

// Under this much horizontal movement the press is a click, and a click on the
// loop lane clears the region.
const CLICK_THRESHOLD_PX = 3

interface UseLoopDragOptions {
  /** Map a pointer clientX to a whole-beat boundary (snapped + clamped by the
   *  caller), or null to ignore the event. */
  computeBeat: (clientX: number) => number | null
}

/**
 * Loop-region gesture for a ruler's top half: drag spans the region between the
 * press anchor and the pointer (live-updated, min/max normalized), a plain
 * click clears it. Window-level listeners + the shared cursor lock, same shape
 * as useScrub. The region lives in TimeStore (ephemeral transport state).
 */
export function useLoopDrag({ computeBeat }: UseLoopDragOptions) {
  const computeRef = useRef(computeBeat)
  computeRef.current = computeBeat

  const startLoopDrag = useCallback((e: ReactPointerEvent) => {
    e.stopPropagation()
    const anchor = computeRef.current(e.clientX)
    if (anchor == null) return
    const originX = e.clientX
    let dragging = false
    // Keep the loop-region gesture on the normal arrow cursor throughout.
    lockCursor('default')

    const controller = new AbortController()
    const onMove = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientX - originX) < CLICK_THRESHOLD_PX) return
      dragging = true
      const beat = computeRef.current(ev.clientX)
      if (beat == null) return
      useTimeStore.getState().setLoopRegion({
        startBeat: Math.min(anchor, beat),
        endBeat: Math.max(anchor, beat),
      })
    }
    const onUp = () => {
      unlockCursor()
      if (!dragging) {
        const { loopRegion, setLoopRegion } = useTimeStore.getState()
        // A click on the existing band clears it. Clicking elsewhere is inert so
        // the loop is not accidentally lost while positioning the pointer.
        if (loopRegion && anchor >= loopRegion.startBeat && anchor <= loopRegion.endBeat) {
          setLoopRegion(null)
        }
      }
      controller.abort()
    }
    window.addEventListener('pointermove', onMove, { signal: controller.signal })
    window.addEventListener('pointerup', onUp, { signal: controller.signal })
  }, [])

  return { startLoopDrag }
}
