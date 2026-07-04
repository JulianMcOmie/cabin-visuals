// The frame loop — the one place export timing lives. Walks the beat from 0 to
// the end of the project at exactly one frame per step: beat(i) = i·bpm/(60·fps),
// pure arithmetic, no wall clock. Each step renders through the FrameDriver
// (the same path scrubbing takes) and hands the frame to a sink; the sink is
// where encoding plugs in, and its awaits are the loop's backpressure.

import type { ExportTimebase } from './types'
import { getFrameDriver, type FrameDriver } from './frameDriver'

export interface WalkHooks {
  /** Called about once a second of output (every `fps` frames) and once at the end. */
  onProgress?: (frame: number, total: number) => void
  signal?: AbortSignal
}

/**
 * Walk every frame of the project through the driver and the sink.
 * Returns true if it completed, false if aborted. The driver must already be
 * pinned by the caller — pin/unpin bracket the whole export (including audio),
 * not each walk.
 */
export async function walkFrames(
  timebase: ExportTimebase,
  fps: number,
  sink: (frameIndex: number, beat: number, driver: FrameDriver) => void | Promise<void>,
  hooks: WalkHooks = {},
): Promise<boolean> {
  const driver = getFrameDriver()
  if (!driver) throw new Error('Export driver is not mounted')

  for (let i = 0; i < timebase.frameCount; i++) {
    if (hooks.signal?.aborted) return false
    const beat = (i * timebase.bpm) / (60 * fps)
    driver.renderFrame(beat, (i * 1000) / fps)
    await sink(i, beat, driver)
    if (i % fps === 0) {
      hooks.onProgress?.(i, timebase.frameCount)
      // Yield a macrotask so the progress UI paints and aborts can land even
      // when the sink never truly waits (fast encoders, or the no-op sink).
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  hooks.onProgress?.(timebase.frameCount, timebase.frameCount)
  return true
}
