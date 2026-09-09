'use client'

import { useEffect } from 'react'
import { reconciler, useThree } from '@react-three/fiber'
import { setBeatOverride } from '../../core/visual/beatOverride'
import { useTimeStore } from '../../store/TimeStore'
import { useProjectStore } from '../../store/ProjectStore'
import { preloadProjectInstruments } from '../../instruments'
import { whenFontsSettled } from '../../core/visual/fonts'
import { whenInstrumentsSettled } from '../../instruments/lazyInstrument'
import { computeAtBeat, setProject, setMainCompositionOverride } from '../../core/visual/VisualEngine'
import { registerFrameDriver, setExportPinned } from '../../core/export/frameDriver'

// MessageChannel yields without background-tab timer throttling.
function yieldRenderTask(): Promise<void> {
  return new Promise(resolve => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close(); channel.port2.close(); resolve()
    }
    channel.port2.postMessage(null)
  })
}

/**
 * Mounted once inside <Canvas>, next to VisualBeatSync. Registers the
 * FrameDriver the export engine pulls frames through:
 *
 *  - renderFrame(beat) drives VisualBeatSync → computeAtBeat through the beat
 *    OVERRIDE (not the TimeStore), then advances R3F exactly one frame. Same
 *    pure engine path scrubbing takes - but the transport, playhead, and beat
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
      async prepare(beat = useTimeStore.getState().currentBeat) {
        // Resolve the export composition before waiting for its React mounts.
        computeAtBeat(beat)
        // Publishing the exact document schedules React's structural mounts.
        // Yield a task before asking whether their lazy boundaries have settled.
        await yieldRenderTask()
        await whenInstrumentsSettled()
        // Lazy boundaries settle during layout effects; several instruments
        // allocate their Three objects in passive effects. Flush those as well,
        // before the encoder is allowed to see frame 0.
        const renderer = reconciler as unknown as { flushSyncWork: () => void; flushPassiveEffects: () => void }
        renderer.flushSyncWork()
        renderer.flushPassiveEffects()
        await whenInstrumentsSettled()
        renderer.flushSyncWork()
        renderer.flushPassiveEffects()
        computeAtBeat(beat)
        // A mount may create its render objects from its first pure frame.
        // Prime at the requested beat, then commit those objects before frame 0.
        setBeatOverride(beat)
        get().advance(0)
        await whenFontsSettled()
        await yieldRenderTask()
        renderer.flushSyncWork()
        renderer.flushPassiveEffects()
        await whenInstrumentsSettled()
      },
      prepareFrame(beat) {
        setBeatOverride(beat)
        computeAtBeat(beat)
      },
      renderFrame(beat, timeMs) {
        setBeatOverride(beat)
        get().advance(timeMs)
      },
      pin(width, height) {
        if (saved) return // already pinned
        const s = get()
        saved = { frameloop: s.frameloop, width: s.size.width, height: s.size.height, dpr: s.viewport.dpr }
        // Before setSize: VisualScene's target-resize effect must see the pin
        // and stand the draft preview scale down for the export dimensions.
        // React's separate canvas root must commit its object tree before a
        // frame-exact export can sample it. This synchronous flush is export-only.
        const flush = (reconciler as unknown as { flushSyncFromReconciler: (fn: () => void) => void }).flushSyncFromReconciler
        flush(() => {
          setExportPinned(true)
          const project = useProjectStore.getState()
          preloadProjectInstruments(project.scenes)
          setProject(project)
          setMainCompositionOverride(true)
          s.setFrameloop('never')
          s.setDpr(1)
          s.setSize(width, height)
        })
        // The drawing buffer is now export-sized, but the element must not
        // reflow the editor: keep its on-screen CSS box where it was.
        const el = s.gl.domElement
        el.style.width = `${saved.width}px`
        el.style.height = `${saved.height}px`
      },
      unpin() {
        // Clear the override even when never pinned - the pre-export snapshot
        // render sets it, and a failure before pin() must not leave it stuck.
        setBeatOverride(null)
        setMainCompositionOverride(false)
        setExportPinned(false)
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
