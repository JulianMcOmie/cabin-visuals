'use client'

import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { setBeatOverride } from '../../core/visual/beatOverride'
import { registerFrameDriver } from '../../core/export/frameDriver'

/**
 * Mounted once inside <Canvas>, next to VisualBeatSync. Registers the
 * FrameDriver the export engine pulls frames through:
 *
 *  - renderFrame(beat) drives VisualBeatSync → computeAtBeat through the beat
 *    OVERRIDE (not the TimeStore), then advances R3F exactly one frame. Same
 *    pure engine path scrubbing takes — but the transport, playhead, and beat
 *    readouts never move, so the user sees nothing scrub during an export.
 *  - pin() stops the free-running loop (frameloop 'never'), pins the drawing
 *    buffer to the export resolution at DPR 1 (instruments that read `viewport`
 *    re-compose for the export aspect, which is the point) while the canvas
 *    element keeps its on-screen CSS size, and remembers what it changed;
 *    unpin() restores it all. unpin lives in the engine's `finally`, so a
 *    mid-export error can never leave the editor wedged at 1920×1080.
 */
export function ExportDriver() {
  const get = useThree((s) => s.get)

  useEffect(() => {
    let saved: { frameloop: 'always' | 'demand' | 'never'; width: number; height: number; dpr: number } | null = null

    registerFrameDriver({
      renderFrame(beat, timeMs) {
        setBeatOverride(beat)
        get().advance(timeMs)
      },
      pin(width, height) {
        if (saved) return // already pinned
        const s = get()
        saved = { frameloop: s.frameloop, width: s.size.width, height: s.size.height, dpr: s.viewport.dpr }
        s.setFrameloop('never')
        s.setDpr(1)
        s.setSize(width, height)
        // The drawing buffer is now export-sized, but the element must not
        // reflow the editor: keep its on-screen CSS box where it was.
        const el = s.gl.domElement
        el.style.width = `${saved.width}px`
        el.style.height = `${saved.height}px`
      },
      unpin() {
        // Clear the override even when never pinned — the pre-export snapshot
        // render sets it, and a failure before pin() must not leave it stuck.
        setBeatOverride(null)
        if (!saved) return
        const s = get()
        s.setSize(saved.width, saved.height) // also resets the element's CSS box
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
