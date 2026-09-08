import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useTimeStore } from '../store/TimeStore'

/**
 * Calls `apply(currentBeat)` so the caller can position playhead element(s)
 * imperatively (via transform, left, etc.) without triggering React re-renders.
 * `apply` runs on every TimeStore write - playback writes the beat once per
 * animation frame (core/playback.ts), so during play this tracks per frame,
 * and while paused it runs only on a seek - and again after every render of the
 * caller, so a zoom or layout change re-lands the head. It used to be a
 * requestAnimationFrame loop that re-applied the same beat 60 times a second
 * forever; this is what kept a paused, idle editor from ever going quiet.
 *
 * Returns a re-apply function for the caller's own imperative moves that shift
 * the head without a beat write or a render (a scroll, a size measurement).
 * `apply` is mirrored in a ref so the subscription is installed once and never
 * reads a stale closure.
 */
export function usePlayhead(apply: (beat: number) => void): () => void {
  const applyRef = useRef(apply)
  applyRef.current = apply

  const reapply = useCallback(() => applyRef.current(useTimeStore.getState().currentBeat), [])
  // No deps on purpose: every render of the caller may have changed the
  // px-per-beat, the clip size or the pickup this position depends on.
  useLayoutEffect(reapply)
  useEffect(() => useTimeStore.subscribe((s) => applyRef.current(s.currentBeat)), [])

  return reapply
}
