import { assertExportSize } from './exportSurface'
import type { VideoEncodeSession } from './videoEncode'

/** The caller may discard this writer and retry the whole video sequentially.
 * Never append a serial retry to the partially written parallel stream. */
export class ParallelVideoEncodingError extends Error {
  readonly retryWithSerial = true
  constructor(message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'ParallelVideoEncodingError'
  }
}

export interface GopEncodeOptions {
  config: VideoEncoderConfig
  encodeOptions?: VideoEncoderEncodeOptions
  fps: number
  concurrency: 2 | 4
  signal?: AbortSignal
  /** Internal test seams; production keeps the existing two-second GOP. */
  gopFrames?: number
  maxBufferedBytes?: number
}

interface BufferedChunk {
  chunk: EncodedVideoChunk
}

interface Segment {
  index: number
  startFrame: number
  inputFrames: number
  outputFrames: number
  chunks: BufferedChunk[]
  complete: boolean
}

interface EncoderSlot {
  encoder: VideoEncoder
  segment?: Segment
  draining?: Promise<void>
  nextSegment: number
  probeFrames: number
  sawProbeConfig: boolean
}

/** Round-robin submission across contiguous GOPs, including a shortened final
 * batch. Each encoder still receives consecutive frames within its own GOP. */
export function interleavedGopFrameIndex(step: number, totalFrames: number, gopFrames: number, concurrency: number): number {
  if (![step, totalFrames, gopFrames, concurrency].every(Number.isSafeInteger)
    || step < 0 || step >= totalFrames || gopFrames < 1 || concurrency < 1) {
    throw new Error('Invalid parallel export frame schedule')
  }
  const batchFrames = gopFrames * concurrency
  const start = Math.floor(step / batchFrames) * batchFrames
  const remaining = Math.min(batchFrames, totalFrames - start)
  const streams = Math.ceil(remaining / gopFrames)
  const sharedRows = remaining - (streams - 1) * gopFrames
  const offset = step - start
  const sharedSteps = sharedRows * streams
  if (offset < sharedSteps) return start + (offset % streams) * gopFrames + Math.floor(offset / streams)
  const tail = offset - sharedSteps
  return start + (tail % (streams - 1)) * gopFrames + sharedRows + Math.floor(tail / (streams - 1))
}

function descriptionBytes(description: AllowSharedBufferSource): Uint8Array {
  return ArrayBuffer.isView(description)
    ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
    : new Uint8Array(description)
}

function stableValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(stableValue)
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .filter(([, value]) => value !== undefined).map(([key, value]) => [key, stableValue(value)]))
}

/** mp4-muxer has one avcC per track: parameter sets and every other decoder
 * property must agree. Comparing views must respect their offset and length. */
export function equalDecoderConfigs(a: VideoDecoderConfig, b: VideoDecoderConfig): boolean {
  if (!a.description || !b.description) return false
  const left = descriptionBytes(a.description), right = descriptionBytes(b.description)
  if (left.length !== right.length || left.some((byte, i) => byte !== right[i])) return false
  const { description: _a, ...restA } = a, { description: _b, ...restB } = b
  void _a; void _b
  return JSON.stringify(stableValue(restA)) === JSON.stringify(stableValue(restB))
}

function copyDecoderConfig(config: VideoDecoderConfig): VideoDecoderConfig {
  const { description, colorSpace, ...rest } = config
  return { ...rest, ...(colorSpace ? { colorSpace: { ...colorSpace } } : {}),
    ...(description ? { description: descriptionBytes(description).slice().buffer } : {}) }
}

function abortError(): DOMException {
  return new DOMException('Video encoding was cancelled', 'AbortError')
}

/** All instances are reserved and probed together before any data reaches the
 * writer. Preflight failure is handled by the factory's serial fallback. */
export async function createGopEncodeSession(
  options: GopEncodeOptions,
  output: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void,
): Promise<VideoEncodeSession> {
  const { config, encodeOptions, fps, concurrency, signal } = options
  const gopFrames = options.gopFrames ?? fps * 2
  const maxBufferedBytes = options.maxBufferedBytes ?? 64 * 1024 * 1024
  const queueLimit = 2
  const slots: EncoderSlot[] = []
  const segments = new Map<number, Segment>()
  const waiters = new Set<() => void>()
  let canonicalConfig: VideoDecoderConfig | undefined
  let error: Error | null = null
  let probing = true, disposed = false, flushed = false
  let bufferedBytes = 0, nextSegmentToWrite = 0, nextFrameToWrite = 0
  const timestamp = (index: number) => Math.round(index * 1e6 / fps)
  const duration = Math.round(1e6 / fps)
  const notify = () => { for (const resolve of waiters) resolve(); waiters.clear() }
  const close = () => {
    signal?.removeEventListener('abort', cancel)
    for (const slot of slots) {
      try { if (slot.encoder.state !== 'closed') slot.encoder.close() } catch { /* already closed */ }
      slot.segment = undefined
    }
    // Pending flush callbacks can still retain a Segment after cancellation.
    // Release the encoded payloads even while those promises are rejecting.
    for (const segment of segments.values()) segment.chunks.length = 0
    segments.clear()
    bufferedBytes = 0
    notify()
  }
  const fail = (failure: Error) => { error ??= failure; disposed = true; close() }
  const cancel = () => fail(abortError())
  const check = () => {
    if (error) throw error
    if (disposed || flushed) throw abortError()
  }
  const parallelError = (message: string, cause?: unknown) => new ParallelVideoEncodingError(message, cause)
  const validateConfig = (meta?: EncodedVideoChunkMetadata) => {
    if (!meta?.decoderConfig) return
    if (!meta.decoderConfig.description) throw parallelError('Parallel encoder omitted its decoder description')
    if (canonicalConfig && !equalDecoderConfigs(canonicalConfig, meta.decoderConfig)) {
      throw parallelError('Parallel encoders produced incompatible decoder configurations')
    }
    canonicalConfig ??= copyDecoderConfig(meta.decoderConfig)
  }
  const writeReady = () => {
    for (;;) {
      const segment = segments.get(nextSegmentToWrite)
      if (!segment) return
      // Retain encoder callback order. Sorting PTS would corrupt references
      // on a reordering encoder; those encoders are rejected below instead.
      for (const { chunk } of segment.chunks) {
        if (chunk.timestamp !== timestamp(nextFrameToWrite)) throw parallelError('Parallel export has a missing or duplicate frame')
        // The muxer mutates metadata. Give it its own canonical copy once,
        // and validate later configurations without passing them through.
        output(chunk, nextFrameToWrite === 0 ? { decoderConfig: copyDecoderConfig(canonicalConfig!) } : undefined)
        bufferedBytes -= chunk.byteLength
        nextFrameToWrite++
      }
      segment.chunks.length = 0
      if (!segment.complete) return
      segments.delete(nextSegmentToWrite++)
    }
  }
  const onOutput = (slot: EncoderSlot, chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => {
    if (disposed) return
    try {
      validateConfig(meta)
      if (probing) {
        slot.sawProbeConfig ||= !!meta?.decoderConfig?.description
        if (chunk.timestamp !== timestamp(slot.probeFrames) || (slot.probeFrames === 0 && chunk.type !== 'key')) {
          throw parallelError('Parallel encoder does not preserve frame order and keyframes')
        }
        slot.probeFrames++
        return
      }
      const segment = slot.segment
      if (!segment || segment.outputFrames >= segment.inputFrames
        || chunk.timestamp !== timestamp(segment.startFrame + segment.outputFrames)
        || (segment.outputFrames === 0 && chunk.type !== 'key')
        || chunk.duration !== duration) {
        throw parallelError('Parallel encoder changed frame order, duration, or a GOP keyframe')
      }
      segment.outputFrames++
      segment.chunks.push({ chunk })
      bufferedBytes += chunk.byteLength
      writeReady()
      if (bufferedBytes > maxBufferedBytes) throw parallelError('Parallel export exceeded its compressed-frame buffer limit')
    } catch (failure) {
      fail(failure instanceof ParallelVideoEncodingError ? failure : parallelError('Parallel video output failed', failure))
    }
    notify()
  }
  const finishSegment = (slot: EncoderSlot): Promise<void> => {
    if (slot.draining) return slot.draining
    const segment = slot.segment
    if (!segment) return Promise.resolve()
    slot.draining = slot.encoder.flush().then(() => {
      check()
      if (segment.inputFrames !== segment.outputFrames) throw parallelError('Parallel encoder dropped frames while flushing a GOP')
      segment.complete = true
      writeReady()
      slot.segment = undefined
      slot.draining = undefined
      notify()
    }).catch(failure => {
      if (!error) fail(parallelError('Parallel encoder could not finish a GOP', failure))
      throw error
    })
    // Full GOPs drain in the background while the next slot receives frames.
    slot.draining.catch(() => {})
    return slot.draining
  }

  try {
    if (signal?.aborted) throw abortError()
    signal?.addEventListener('abort', cancel, { once: true })
    if (!(await VideoEncoder.isConfigSupported(config)).supported) throw parallelError('Parallel encoder configuration is unsupported')
    check()
    for (let index = 0; index < concurrency; index++) {
      const slot = { nextSegment: index, probeFrames: 0, sawProbeConfig: false } as EncoderSlot
      slot.encoder = new VideoEncoder({
        output: (chunk, meta) => onOutput(slot, chunk, meta),
        error: failure => fail(parallelError('A parallel video encoder failed', failure)),
      })
      slots.push(slot)
      slot.encoder.addEventListener('dequeue', notify)
      slot.encoder.configure(config)
    }
    const canvas = new OffscreenCanvas(config.width, config.height)
    const context = canvas.getContext('2d')
    if (!context) throw parallelError('Unable to prepare parallel encoders')
    context.fillRect(0, 0, 1, 1)
    for (let i = 0; i < 3; i++) {
      const frame = new VideoFrame(canvas, { timestamp: timestamp(i), duration })
      try { for (const slot of slots) slot.encoder.encode(frame, { keyFrame: i === 0, ...encodeOptions }) }
      finally { frame.close() }
    }
    await Promise.all(slots.map(slot => slot.encoder.flush()))
    check()
    if (!canonicalConfig || slots.some(slot => slot.probeFrames !== 3 || !slot.sawProbeConfig)) {
      throw parallelError('Parallel encoder preflight did not produce a complete compatible stream')
    }
    probing = false
  } catch (failure) {
    const reason = error ?? (failure instanceof Error ? failure : parallelError('Parallel encoder setup failed', failure))
    fail(reason)
    throw reason
  }

  return {
    frameIndexAt: (step, totalFrames) => interleavedGopFrameIndex(step, totalFrames, gopFrames, concurrency),
    async encodeFrame(canvas, frameIndex, frameRate) {
      check()
      assertExportSize(canvas, config.width, config.height)
      if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameRate !== fps) throw parallelError('Invalid parallel export frame')
      const segmentIndex = Math.floor(frameIndex / gopFrames)
      const slot = slots[segmentIndex % concurrency]
      if (slot.draining) await slot.draining
      check()
      if (!slot.segment) {
        if (segmentIndex !== slot.nextSegment || frameIndex !== segmentIndex * gopFrames) {
          throw parallelError('Parallel encoder received a non-contiguous GOP')
        }
        slot.nextSegment += concurrency
        slot.segment = { index: segmentIndex, startFrame: frameIndex, inputFrames: 0, outputFrames: 0, chunks: [], complete: false }
        segments.set(segmentIndex, slot.segment)
      }
      const segment = slot.segment
      if (segment.index !== segmentIndex || frameIndex !== segment.startFrame + segment.inputFrames) {
        throw parallelError('Parallel encoder received an out-of-order input frame')
      }
      const frame = new VideoFrame(canvas, { timestamp: timestamp(frameIndex), duration })
      try {
        segment.inputFrames++
        slot.encoder.encode(frame, { keyFrame: frameIndex === segment.startFrame, ...encodeOptions })
      } catch (failure) {
        fail(parallelError('Parallel encoder could not accept a frame', failure))
      } finally { frame.close() }
      while (!error && slot.encoder.encodeQueueSize > queueLimit) await new Promise<void>(resolve => waiters.add(resolve))
      check()
      if (segment.inputFrames === gopFrames) void finishSegment(slot)
    },
    async flush() {
      check()
      try {
        await Promise.all(slots.map(finishSegment))
        check()
        if (segments.size || bufferedBytes) throw parallelError('Parallel export ended before all GOPs were written')
        flushed = true
        close()
      } catch (failure) {
        if (!error) fail(parallelError('Parallel export could not flush', failure))
        throw error
      }
    },
    dispose() { if (!flushed && !disposed) cancel() },
  }
}
