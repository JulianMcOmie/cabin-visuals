// The WebCodecs video side: one hardware VideoEncoder, chunks streamed straight
// into the muxer, and the backpressure gate the frame loop leans on - encode()
// is fire-and-forget, so without the gate a fast walk would balloon the queue.

import { videoCodec, type ExportSettings } from './types'
import type { Mp4Writer } from './mux'

/** Encoder queue depth the loop tolerates before waiting on 'dequeue'. Small on
 *  purpose: memory stays flat and cancel latency stays at a few frames. */
const MAX_QUEUE = 2

/** H.264 QP for constant-quality mode (0-51, lower = better). 21 is visually
 *  clean on the grain/bloom/particle frames that macroblock at any fixed
 *  bitrate, while keeping the in-memory MP4 buffer (mux.ts holds the whole
 *  file until finalize) survivable on long grainy 4K exports. */
const EXPORT_QUANTIZER = 21

/** QP for 'lossless': quantization off as far as H.264 goes. Even QP 21 bands
 *  bloom's smooth dark falloff into visible layers (the grade's grain is under
 *  one 8-bit step in shadows, so the encoder smooths it away and un-dithers
 *  the gradient). Remember mux.ts holds the whole file in memory - at QP 0 a
 *  long 1080p60 export is gigabytes, which is the mode's real cost. */
const LOSSLESS_QUANTIZER = 0

/** Level 5.2: the codec-string floor for QP-0 exports (see videoCodec). */
const LOSSLESS_MIN_LEVEL_IDC = 52

/** The QP a settings object asks for, or null for plain bitrate mode. */
function quantizerFor(settings: ExportSettings): number | null {
  if (settings.rateControl === 'lossless') return LOSSLESS_QUANTIZER
  if (settings.rateControl === 'quality') return EXPORT_QUANTIZER
  return null
}

export interface VideoEncodeSession {
  /** Encode one canvas frame; resolves once the encoder queue has drained below the cap. */
  encodeFrame(canvas: HTMLCanvasElement, frameIndex: number, fps: number): Promise<void>
  /** Drain the queue and close the encoder. Call once after the last frame. */
  flush(): Promise<void>
  /** Close without flushing (cancel path). Safe after errors. */
  dispose(): void
}

/** The exact encoder config a session will run - exported so runExport can
 *  probe THIS config (not a stand-in) before spending minutes rendering. */
export function exportEncoderConfig(settings: ExportSettings): VideoEncoderConfig {
  const minLevel = settings.rateControl === 'lossless' ? LOSSLESS_MIN_LEVEL_IDC : 0
  const base: VideoEncoderConfig = {
    codec: videoCodec(settings.width, settings.height, settings.fps, minLevel),
    width: settings.width,
    height: settings.height,
    framerate: settings.fps,
    latencyMode: 'quality',
  }
  return quantizerFor(settings) !== null
    ? { ...base, bitrateMode: 'quantizer' }
    : { ...base, bitrate: settings.videoBitrate }
}

/** Per-frame encode options matching exportEncoderConfig: quantizer mode needs
 *  the QP handed to every encode() call. Exported so the runExport probe can
 *  encode exactly like the real session will. */
export function exportEncodeOptions(settings: ExportSettings): VideoEncoderEncodeOptions | undefined {
  const quantizer = quantizerFor(settings)
  return quantizer !== null
    ? ({ avc: { quantizer } } as VideoEncoderEncodeOptions)
    : undefined
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
  encoder.configure(exportEncoderConfig(settings))
  const encodeOptions = exportEncodeOptions(settings)

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
      encoder.encode(frame, { keyFrame: frameIndex % (fps * 2) === 0, ...encodeOptions })
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
