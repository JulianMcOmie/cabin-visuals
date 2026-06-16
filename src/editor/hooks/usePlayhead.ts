import { useEffect, useRef } from 'react'
import { useTimeStore } from '../store/TimeStore'

/**
 * Runs a requestAnimationFrame loop and calls `apply(currentBeat)` every frame
 * so the caller can position playhead element(s) imperatively (via transform,
 * left, etc.) without triggering React re-renders. `apply` is mirrored in a ref
 * so the loop is installed once and never reads a stale closure.
 */
export function usePlayhead(apply: (beat: number) => void) {
  const applyRef = useRef(apply)
  applyRef.current = apply

  useEffect(() => {
    let rafId: number
    const tick = () => {
      applyRef.current(useTimeStore.getState().currentBeat)
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])
}
