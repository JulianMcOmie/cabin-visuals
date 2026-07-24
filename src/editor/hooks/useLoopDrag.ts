import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useTimeStore } from '../store/TimeStore'
import { lockCursor, unlockCursor } from '../utils/dragCursor'

// Under this much horizontal movement the press is a click, and a click on the
// loop lane clears the region.
const CLICK_THRESHOLD_PX = 3
const MIN_RESIZED_LOOP_BEATS = 1

export type LoopResizeEdge = 'start' | 'end'
export interface LoopDragGuide {
  startBeat: number | null
  endBeat: number | null
  enabled: boolean
}

function toggleLoopEnabled() {
  const { loopRegion, setLoopRegion } = useTimeStore.getState()
  if (loopRegion) setLoopRegion({ ...loopRegion, enabled: !loopRegion.enabled })
}

interface UseLoopDragOptions {
  /** Map a pointer clientX to a whole-beat boundary (snapped + clamped by the
   *  caller), or null to ignore the event. */
  computeBeat: (clientX: number) => number | null
  /** Last beat available on this ruler, used to clamp moved loop regions. */
  maxBeat: number
  /** Optional full-height boundary guides supplied by the main timeline. */
  onGuideChange?: (guide: LoopDragGuide | null) => void
}

/**
 * Loop-region gesture for a ruler's top half: drag spans the region between the
 * press anchor and the pointer (live-updated, min/max normalized), a plain
 * click clears it. Window-level listeners + the shared cursor lock, same shape
 * as useScrub. The region lives in TimeStore (ephemeral transport state).
 */
export function useLoopDrag({ computeBeat, maxBeat, onGuideChange }: UseLoopDragOptions) {
  const computeRef = useRef(computeBeat)
  computeRef.current = computeBeat
  const maxBeatRef = useRef(maxBeat)
  maxBeatRef.current = maxBeat
  const guideRef = useRef(onGuideChange)
  guideRef.current = onGuideChange

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
        enabled: true,
      })
    }
    const onUp = () => {
      unlockCursor()
      if (!dragging) {
        const { loopRegion } = useTimeStore.getState()
        // A click on the existing band toggles playback while preserving its range.
        // Clicking elsewhere is inert so the loop is not accidentally lost.
        if (loopRegion && anchor >= loopRegion.startBeat && anchor <= loopRegion.endBeat) {
          toggleLoopEnabled()
        }
      }
      controller.abort()
    }
    window.addEventListener('pointermove', onMove, { signal: controller.signal })
    window.addEventListener('pointerup', onUp, { signal: controller.signal })
  }, [])

  const startLoopMove = useCallback((e: ReactPointerEvent) => {
    e.stopPropagation()
    const anchor = computeRef.current(e.clientX)
    const origin = useTimeStore.getState().loopRegion
    if (anchor == null || !origin) return

    const originX = e.clientX
    let dragging = false
    lockCursor('grabbing')
    const controller = new AbortController()
    const onMove = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientX - originX) < CLICK_THRESHOLD_PX) return
      dragging = true
      const beat = computeRef.current(ev.clientX)
      if (beat == null) return
      const duration = origin.endBeat - origin.startBeat
      const maxStart = Math.max(0, maxBeatRef.current - duration)
      const startBeat = Math.max(0, Math.min(maxStart, origin.startBeat + beat - anchor))
      const endBeat = startBeat + duration
      useTimeStore.getState().setLoopRegion({ ...origin, startBeat, endBeat })
      guideRef.current?.({ startBeat, endBeat, enabled: origin.enabled })
    }
    const onUp = () => {
      unlockCursor()
      if (!dragging) toggleLoopEnabled()
      guideRef.current?.(null)
      controller.abort()
    }
    const onCancel = () => {
      unlockCursor()
      guideRef.current?.(null)
      controller.abort()
    }
    window.addEventListener('pointermove', onMove, { signal: controller.signal })
    window.addEventListener('pointerup', onUp, { signal: controller.signal })
    window.addEventListener('pointercancel', onCancel, { signal: controller.signal })
  }, [])

  const startLoopResize = useCallback((e: ReactPointerEvent, edge: LoopResizeEdge) => {
    e.stopPropagation()
    const origin = useTimeStore.getState().loopRegion
    if (!origin) return

    const originX = e.clientX
    let dragging = false
    lockCursor('ew-resize')
    const controller = new AbortController()
    const onMove = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientX - originX) < CLICK_THRESHOLD_PX) return
      dragging = true
      const beat = computeRef.current(ev.clientX)
      if (beat == null) return
      const next = edge === 'start'
        ? { ...origin, startBeat: Math.max(0, Math.min(beat, origin.endBeat - MIN_RESIZED_LOOP_BEATS)) }
        : { ...origin, endBeat: Math.min(maxBeatRef.current, Math.max(beat, origin.startBeat + MIN_RESIZED_LOOP_BEATS)) }
      useTimeStore.getState().setLoopRegion(next)
      guideRef.current?.({
        startBeat: edge === 'start' ? next.startBeat : null,
        endBeat: edge === 'end' ? next.endBeat : null,
        enabled: origin.enabled,
      })
    }
    const onUp = () => {
      unlockCursor()
      if (!dragging) toggleLoopEnabled()
      guideRef.current?.(null)
      controller.abort()
    }
    const onCancel = () => {
      unlockCursor()
      guideRef.current?.(null)
      controller.abort()
    }
    window.addEventListener('pointermove', onMove, { signal: controller.signal })
    window.addEventListener('pointerup', onUp, { signal: controller.signal })
    window.addEventListener('pointercancel', onCancel, { signal: controller.signal })
  }, [])

  return { startLoopDrag, startLoopMove, startLoopResize }
}
