// WebCodecs video sessions: bounded frame submission and encoded output to the
// muxer. Eligible high-resolution exports can use multiple independent GOP
// encoders; the serial session remains the compatibility path.

import { videoCodec, type ExportSettings } from './types'
import type { Mp4Writer } from './mux'
import { assertExportSize } from './exportSurface'
import { createGopEncodeSession } from './parallelVideoEncode'
export { ParallelVideoEncodingError } from './parallelVideoEncode'

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
  /** Optional render order for independently encoded contiguous GOPs. The
   * sink still receives the original frame index and uses its exact PTS. */
  frameIndexAt?(step: number, totalFrames: number): number
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
  options: { signal?: AbortSignal } = {},
): VideoEncodeSession {
  let error: Error | null = null
  let encoder: VideoEncoder | undefined
  let disposed = false
  const waiters = new Set<() => void>()
  const notify = () => { for (const resolve of waiters) resolve(); waiters.clear() }
  const close = () => {
    options.signal?.removeEventListener('abort', cancel)
    if (!disposed) {
      disposed = true
      try { if (encoder && encoder.state !== 'closed') encoder.close() } catch { /* already closed */ }
    }
    notify()
  }
  const fail = (failure: unknown) => {
    error ??= failure instanceof Error ? failure : new Error(String(failure))
    close()
  }
  const cancel = () => fail(new DOMException('Video encoding was cancelled', 'AbortError'))

  const activeEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (disposed) return
      try { writer.addVideoChunk(chunk, meta) } catch (failure) { fail(failure) }
    },
    error: fail,
  })
  encoder = activeEncoder
  try { activeEncoder.configure(exportEncoderConfig(settings)) }
  catch (failure) { fail(failure); throw error }
  const encodeOptions = exportEncodeOptions(settings)
  options.signal?.addEventListener('abort', cancel, { once: true })
  if (options.signal?.aborted) cancel()
  activeEncoder.addEventListener?.('dequeue', notify)

  return {
    async encodeFrame(canvas, frameIndex, fps) {
      if (error) throw error
      if (disposed) throw new DOMException('Video encoder is closed', 'InvalidStateError')
      assertExportSize(canvas, settings.width, settings.height)
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
      try {
        activeEncoder.encode(frame, { keyFrame: frameIndex % (fps * 2) === 0, ...encodeOptions })
      } catch (failure) {
        fail(failure)
      } finally {
        frame.close()
      }
      while (!error && activeEncoder.encodeQueueSize > MAX_QUEUE) await new Promise<void>(resolve => waiters.add(resolve))
      if (error) throw error
    },
    async flush() {
      if (error) throw error
      try {
        await activeEncoder.flush()
        if (error) throw error
        close()
      } catch (failure) {
        fail(failure)
        throw error
      }
    },
    dispose() {
      if (!disposed) cancel()
    },
  }
}

/** Reserves and validates concurrent encoders before returning a render order.
 * Unsupported configurations and device resource limits keep the serial path.
 * A failure after encoding starts requires the caller to discard its writer
 * and retry serially; it is never safe to concatenate a retry onto that file. */
export async function createParallelVideoEncodeSession(
  settings: ExportSettings,
  writer: Mp4Writer,
  options: { concurrency?: 1 | 2 | 4; signal?: AbortSignal } = {},
): Promise<VideoEncodeSession> {
  const concurrency = options.concurrency ?? 2
  if (options.signal?.aborted) throw new DOMException('Video encoding was cancelled', 'AbortError')
  if (concurrency === 1) return createVideoEncodeSession(settings, writer, options)
  try {
    return await createGopEncodeSession({
      config: exportEncoderConfig(settings), encodeOptions: exportEncodeOptions(settings),
      fps: settings.fps, concurrency, signal: options.signal,
    }, (chunk, meta) => writer.addVideoChunk(chunk, meta))
  } catch (error) {
    if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
    return createVideoEncodeSession(settings, writer, options)
  }
}
