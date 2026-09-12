'use client'

import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { useUIStore } from '../../store/UIStore'
import { useTimeStore } from '../../store/TimeStore'
import { useProjectStore } from '../../store/ProjectStore'
import { subscribeObjects } from '../../core/visual/VisualEngine'
import { isExportPinned } from '../../core/export/frameDriver'
import { getBeatOverride } from '../../core/visual/beatOverride'
import { previewRuntime } from '../../core/visual/previewRuntime'

/** The primary canvas never joins R3F's shared animation loop. Batched particle
 * scenes advance directly at 60fps without worker readback. Other worker frames
 * arrive independently; compatibility renders get one background task and an
 * adaptive cooldown (at most 30fps, at most ~25% CPU duty after a slow frame).
 * A single non-preemptible compatibility render can still take longer than an
 * input budget, which is why suitable instruments render in the worker. */
export function RenderGovernor() {
  const get = useThree(s => s.get)
  useEffect(() => {
    let alive = true, dirty = true, next = 0
    let timer: ReturnType<typeof setTimeout>
    let animation = 0, nextDirect = -Infinity
    const originalInvalidate = get().invalidate
    const request = () => { dirty = true }
    get().set({ invalidate: request })
    const stopProject = useProjectStore.subscribe(request)
    const stopGraph = subscribeObjects(request)
    // Includes timeline Shift-hover changes while paused.
    const stopUI = useUIStore.subscribe(request)
    const stopTime = useTimeStore.subscribe(request)
    const tick = () => {
      if (!alive) return
      const now = performance.now()
      const input = navigator as Navigator & { scheduling?: { isInputPending?: () => boolean } }
      if (!previewRuntime.directParticles && !isExportPinned() && getBeatOverride() === null && !previewRuntime.rendering && now >= next
        && !input.scheduling?.isInputPending?.()
        && (previewRuntime.frameReady || dirty)) {
        dirty = false; previewRuntime.frameReady = false
        const start = performance.now()
        get().advance(start)
        next = performance.now() + Math.max(33, (performance.now() - start) * 3)
      }
      timer = setTimeout(tick, 16)
    }
    // Batched particle scenes avoid repeated local fields and pixel readback.
    // Present directly at display cadence; retain the old cooldown for all
    // other scenes and stop redraws while a direct scene is paused and clean.
    const directTick = (now: number) => {
      if (!alive) return
      if (previewRuntime.directParticles && !previewRuntime.rendering && !isExportPinned()
        && getBeatOverride() === null && now >= nextDirect - 0.5
        && (dirty || previewRuntime.frameReady || useTimeStore.getState().isPlaying)) {
        dirty = false; previewRuntime.frameReady = false
        // Preserve the deadline phase when callbacks arrive slightly late;
        // resetting to now + interval would permanently lower the frame rate.
        nextDirect = Math.max(nextDirect + 1000 / 60, now - 1000 / 60)
        get().advance(now)
      }
      animation = requestAnimationFrame(directTick)
    }
    animation = requestAnimationFrame(directTick)
    timer = setTimeout(tick, 0)
    if (process.env.NODE_ENV !== 'production') Object.assign(window, { __r3fState: get })
    return () => {
      alive = false; clearTimeout(timer); cancelAnimationFrame(animation)
      stopProject(); stopGraph(); stopUI(); stopTime()
      get().set({ invalidate: originalInvalidate })
    }
  }, [get])
  return null
}
