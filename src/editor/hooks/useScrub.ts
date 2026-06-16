import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useTimeStore } from '../store/TimeStore'

interface UseScrubOptions {
  /** Map a pointer's clientX to an absolute beat, or null to ignore the event. */
  computeBeat: (clientX: number) => number | null
  /** Called when a scrub begins (e.g. set the cursor). */
  onStart?: () => void
  /** Called when a scrub ends (e.g. reset the cursor). */
  onEnd?: () => void
}

/**
 * Shared playhead-scrubbing gesture. pointerdown begins tracking via window-level
 * listeners; each move maps the cursor to a beat (via computeBeat) and writes
 * currentBeat. Text selection is suppressed for the duration. Returns the
 * scrubbingRef so other gesture code can tell a scrub is in progress.
 */
export function useScrub({ computeBeat, onStart, onEnd }: UseScrubOptions) {
  const scrubbingRef = useRef(false)
  const computeRef = useRef(computeBeat)
  computeRef.current = computeBeat
  const onStartRef = useRef(onStart)
  onStartRef.current = onStart
  const onEndRef = useRef(onEnd)
  onEndRef.current = onEnd

  const scrubTo = useCallback((clientX: number) => {
    const beat = computeRef.current(clientX)
    if (beat == null) return
    useTimeStore.getState().setCurrentBeat(beat)
  }, [])

  const startScrub = useCallback((e: ReactPointerEvent) => {
    e.stopPropagation()
    scrubbingRef.current = true
    document.body.style.userSelect = 'none'
    onStartRef.current?.()
    scrubTo(e.clientX)

    const controller = new AbortController()
    const onMove = (ev: PointerEvent) => {
      if (scrubbingRef.current) scrubTo(ev.clientX)
    }
    const onUp = () => {
      scrubbingRef.current = false
      document.body.style.userSelect = ''
      onEndRef.current?.()
      controller.abort()
    }
    window.addEventListener('pointermove', onMove, { signal: controller.signal })
    window.addEventListener('pointerup', onUp, { signal: controller.signal })
  }, [scrubTo])

  return { scrubbingRef, startScrub }
}
