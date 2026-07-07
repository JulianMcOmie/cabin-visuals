'use client'

import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { useTimeStore } from '../../store/TimeStore'
import { useProjectStore } from '../../store/ProjectStore'
import { subscribeObjects } from '../../core/visual/VisualEngine'

/**
 * Mounted once inside <Canvas>. While the transport is paused the Canvas runs
 * frameloop='demand' (the prop is set in Scene — it must be the PROP, because
 * <Canvas> re-applies its props on every re-render and would clobber an
 * imperative setFrameloop). The pause invariant makes the frame a pure function
 * of (beat, document): with both static there is nothing to render, the loop
 * idles, and heavy instruments stop stealing main-thread time from the UI.
 *
 * "Paused" freezes the beat, not the document — so this component asks R3F for
 * exactly one frame (invalidate) whenever an input changes:
 *
 *  - any ProjectStore change: edits reach the engine synchronously via
 *    VisualBeatSync.syncParams, so render now. One whole-store subscription —
 *    no enumeration of edit types that could miss one;
 *  - the debounced structural re-resolve landing ~80ms later: notes, blocks,
 *    and tracks live in the RESOLVED graph, not in syncParams — without this
 *    second frame, a note added while paused would render once against the old
 *    graph and then sit stale;
 *  - the beat moving while paused (scrub, ruler click, jump-to-start), and the
 *    play→pause edge (one settled frame at the paused position);
 *  - canvas geometry changes (panel resize, fullscreen): viewport-aware
 *    instruments re-compose for the new box.
 *
 * While playing the loop is 'always', where invalidate is inert. The export
 * path pins frameloop='never', where invalidate is a hard no-op (verified in
 * R3F source) — the governor cannot fight the export pin.
 */
export function RenderGovernor() {
  const invalidate = useThree((s) => s.invalidate)
  const size = useThree((s) => s.size)
  const get = useThree((s) => s.get)

  // Dev hook: read the live loop state from the console —
  // __r3fState().frameloop / .internal.frames (pending demand frames).
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    ;(window as unknown as { __r3fState?: typeof get }).__r3fState = get
    return () => {
      delete (window as unknown as { __r3fState?: typeof get }).__r3fState
    }
  }, [get])

  useEffect(() => {
    const unsubProject = useProjectStore.subscribe(() => invalidate())
    const unsubGraph = subscribeObjects(() => invalidate())
    const unsubTime = useTimeStore.subscribe((s, prev) => {
      if (!s.isPlaying && (s.currentBeat !== prev.currentBeat || prev.isPlaying)) invalidate()
    })
    return () => {
      unsubProject()
      unsubGraph()
      unsubTime()
    }
  }, [invalidate])

  // First frame on mount, and one frame per resize.
  useEffect(() => {
    invalidate()
  }, [size, invalidate])

  return null
}
