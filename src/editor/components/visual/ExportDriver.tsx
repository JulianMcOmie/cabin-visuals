'use client'

import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { useTimeStore } from '../../store/TimeStore'
import { registerFrameDriver } from '../../core/export/frameDriver'

/**
 * Mounted once inside <Canvas>, next to VisualBeatSync. Registers the
 * FrameDriver the export engine pulls frames through:
 *
 *  - renderFrame(beat) sets the store beat and advances R3F exactly one frame,
 *    so VisualBeatSync → computeAtBeat runs the same path live scrubbing runs.
 *    Export IS scrubbing — just with nobody watching the wall clock.
 *  - pin() stops the free-running loop (frameloop 'never'), pins the drawing
 *    buffer to the export resolution at DPR 1 (instruments that read `viewport`
 *    re-compose for the export aspect, which is the point), and remembers what
 *    it changed; unpin() restores it all. unpin lives in the engine's `finally`,
 *    so a mid-export error can never leave the editor wedged at 1920×1080.
 */
export function ExportDriver() {
  const get = useThree((s) => s.get)

  useEffect(() => {
    let saved: { frameloop: 'always' | 'demand' | 'never'; width: number; height: number; dpr: number } | null = null

    registerFrameDriver({
      renderFrame(beat, timeMs) {
        useTimeStore.getState().setCurrentBeat(beat)
        get().advance(timeMs)
      },
      pin(width, height) {
        if (saved) return // already pinned
        const s = get()
        saved = { frameloop: s.frameloop, width: s.size.width, height: s.size.height, dpr: s.viewport.dpr }
        s.setFrameloop('never')
        s.setDpr(1)
        s.setSize(width, height)
      },
      unpin() {
        if (!saved) return
        const s = get()
        s.setSize(saved.width, saved.height)
        s.setDpr(saved.dpr)
        s.setFrameloop(saved.frameloop)
        saved = null
      },
      getCanvas() {
        return get().gl.domElement
      },
    })
    return () => registerFrameDriver(null)
  }, [get])

  return null
}
