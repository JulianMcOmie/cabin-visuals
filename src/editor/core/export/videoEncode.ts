// The WebCodecs video side: one hardware VideoEncoder, chunks streamed straight
// into the muxer, and the backpressure gate the frame loop leans on - encode()
// is fire-and-forget, so without the gate a fast walk would balloon the queue.

import { videoCodec, type ExportSettings } from './types'
import type { Mp4Writer } from './mux'

/** Encoder queue depth the loop tolerates before waiting on 'dequeue'. Small on
 *  purpose: memory stays flat and cancel latency stays at a few frames. */
const MAX_QUEUE = 2

export interface VideoEncodeSession {
  /** Encode one canvas frame; resolves once the encoder queue has drained below the cap. */
  encodeFrame(canvas: HTMLCanvasElement, frameIndex: number, fps: number): Promise<void>
  /** Drain the queue and close the encoder. Call once after the last frame. */
  flush(): Promise<void>
  /** Close without flushing (cancel path). Safe after errors. */
  dispose(): void
}

export function createVideoEncodeSession(
  settings: ExportSettings,
  writer: Mp4Writer,
): VideoEncodeSession {
  let error: Error | null = null

  const encoder = new VideoEncoder({
    output: (chunk, meta) => writer.addVideoChunk(chunk, meta),
    error: (e) => { error = e instanceof Error ? e : new Error(String(e)) },
  })
  encoder.configure({
    codec: videoCodec(settings.width, settings.fps),
    width: settings.width,
    height: settings.height,
    framerate: settings.fps,
    bitrate: settings.videoBitrate,
    latencyMode: 'quality',
  })

  const dequeue = () =>
    new Promise<void>((resolve) => encoder.addEventListener('dequeue', () => resolve(), { once: true }))

  return {
    async encodeFrame(canvas, frameIndex, fps) {
      if (error) throw error
      // Same task as the render - the GL surface still holds this frame, so no
      // pixel readback and no preserveDrawingBuffer anywhere.
      // Uniform PTS, exactly i/fps. Do NOT add an A/V offset here: a brief
      // "AAC priming compensation" (+44ms on every frame after the first)
      // shipped on 2026-07-10 and made sync WORSE - audio landed audibly
      // early. AAC decoders discard the 2112 priming samples themselves, so
      // the audio track was never actually late; the shift was pure error.
      // See exportEngine.runExport and mux.test.ts for the full findings.
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((frameIndex * 1e6) / fps),
        duration: Math.round(1e6 / fps),
      })
      // Keyframe every 2 seconds of output: scrubbable, negligible size cost.
      encoder.encode(frame, { keyFrame: frameIndex % (fps * 2) === 0 })
      frame.close()
      while (encoder.encodeQueueSize > MAX_QUEUE) await dequeue()
      if (error) throw error
    },
    async flush() {
      if (error) throw error
      await encoder.flush()
      if (error) throw error
      encoder.close()
    },
    dispose() {
      try {
        if (encoder.state !== 'closed') encoder.close()
      } catch { /* already closed */ }
    },
  }
}
