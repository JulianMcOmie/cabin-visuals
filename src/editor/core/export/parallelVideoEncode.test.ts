import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGopEncodeSession, equalDecoderConfigs, interleavedGopFrameIndex, ParallelVideoEncodingError } from './parallelVideoEncode'
import { createParallelVideoEncodeSession } from './videoEncode'
import { defaultSettings } from './types'
import type { Mp4Writer } from './mux'

const fps = 30
const config: VideoEncoderConfig = { codec: 'avc1.64002a', width: 8, height: 8, framerate: fps, latencyMode: 'quality', bitrateMode: 'quantizer' }
const decoderConfig = (): VideoDecoderConfig => ({ codec: config.codec, codedWidth: 8, codedHeight: 8,
  description: new Uint8Array([1, 2, 3]).buffer, colorSpace: { matrix: 'bt709', primaries: 'bt709', transfer: 'bt709', fullRange: false } })
const canvas = { width: 8, height: 8 } as HTMLCanvasElement
const pts = (frame: number) => Math.round(frame * 1e6 / fps)

interface FakeBehavior {
  hold: boolean
  incompatibleProbe?: boolean
  runtimeFault?: 'config' | 'duplicate' | 'reordered' | 'duration' | 'key' | 'drop'
  bytes: number
}

function fakeCodecs() {
  const original = { VideoEncoder: globalThis.VideoEncoder, VideoFrame: globalThis.VideoFrame, OffscreenCanvas: globalThis.OffscreenCanvas }
  const behavior: FakeBehavior = { hold: false, bytes: 16 }
  const encoders: Encoder[] = []
  let createdFrames = 0, closedFrames = 0
  class Frame {
    timestamp: number
    duration: number
    constructor(_canvas: unknown, init: VideoFrameInit) {
      this.timestamp = init.timestamp!
      this.duration = init.duration!
      createdFrames++
    }
    close() { closedFrames++ }
  }
  type Pending = { timestamp: number; duration: number; key: boolean; runtime: boolean; sequence: number }
  class Encoder extends EventTarget {
    static async isConfigSupported(value: VideoEncoderConfig) { return { supported: true, config: value } }
    state: CodecState = 'unconfigured'
    encodeQueueSize = 0
    encoded = 0
    readonly index = encoders.length
    readonly pending: Pending[] = []
    readonly requests: Pending[] = []
    readonly flushes: { resolve: () => void; reject: (error: Error) => void }[] = []
    configured?: VideoEncoderConfig
    constructor(readonly init: VideoEncoderInit) { super(); encoders.push(this) }
    configure(value: VideoEncoderConfig) { this.configured = value; this.state = 'configured' }
    encode(frame: Frame, options: VideoEncoderEncodeOptions) {
      if (this.state === 'closed') throw Error('closed encoder')
      const request = { timestamp: frame.timestamp, duration: frame.duration, key: !!options.keyFrame, runtime: this.encoded >= 3, sequence: this.encoded++ }
      this.pending.push(request); this.requests.push(request); this.encodeQueueSize++
      if (!behavior.hold) queueMicrotask(() => this.releaseOne())
    }
    releaseOne() {
      const request = this.pending.shift()
      if (!request || this.state === 'closed') return
      this.encodeQueueSize--
      let description = decoderConfig()
      if ((!request.runtime && behavior.incompatibleProbe && this.index === 1) || (request.runtime && behavior.runtimeFault === 'config')) {
        description = { ...description, description: new Uint8Array([1, 2, 4]).buffer }
      }
      const fault = request.runtime ? behavior.runtimeFault : undefined
      if (fault !== 'drop') {
        const chunk = { type: fault === 'key' ? 'delta' : request.key ? 'key' : 'delta',
          timestamp: fault === 'reordered' ? request.timestamp + 33333 : fault === 'duplicate' && request.sequence > 3 ? 0 : request.timestamp,
          duration: fault === 'duration' ? request.duration - 1 : request.duration,
          byteLength: behavior.bytes } as EncodedVideoChunk
        this.init.output(chunk, { decoderConfig: description })
      }
      this.dispatchEvent(new Event('dequeue'))
      if (!this.pending.length) this.flushes.splice(0).forEach(waiter => waiter.resolve())
    }
    releaseAll() { while (this.pending.length && this.state !== 'closed') this.releaseOne() }
    flush(): Promise<void> {
      if (this.state === 'closed') return Promise.reject(Error('closed encoder'))
      if (!this.pending.length) return Promise.resolve()
      return new Promise((resolve, reject) => this.flushes.push({ resolve, reject }))
    }
    close() {
      this.state = 'closed'; this.pending.length = 0; this.encodeQueueSize = 0
      this.flushes.splice(0).forEach(waiter => waiter.reject(Error('encoder closed')))
    }
    fail() { this.init.error(new DOMException('Encoder resource exhausted', 'OperationError')) }
  }
  class Canvas {
    constructor(readonly width: number, readonly height: number) {}
    getContext() { return { fillRect() {} } }
  }
  globalThis.VideoEncoder = Encoder as unknown as typeof VideoEncoder
  globalThis.VideoFrame = Frame as unknown as typeof VideoFrame
  globalThis.OffscreenCanvas = Canvas as unknown as typeof OffscreenCanvas
  return { behavior, encoders, frameCounts: () => ({ createdFrames, closedFrames }), restore: () => Object.assign(globalThis, original) }
}

test('the interleaved schedule visits each frame once and preserves each GOP, including partial batches', () => {
  for (const concurrency of [2, 4]) for (const gop of [3, 60, 120]) {
    for (const count of [1, 2, gop - 1, gop, gop + 1, gop * concurrency - 1, gop * concurrency, gop * concurrency + 1, gop * concurrency * 2 + 7]) {
      const order = Array.from({ length: count }, (_, step) => interleavedGopFrameIndex(step, count, gop, concurrency))
      assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: count }, (_, i) => i))
      for (let start = 0; start < count; start += gop) {
        assert.deepEqual(order.filter(i => i >= start && i < start + gop), Array.from({ length: Math.min(gop, count - start) }, (_, i) => start + i))
      }
    }
  }
  assert.throws(() => interleavedGopFrameIndex(0, 0, 120, 2), /Invalid/)
})

test('decoder configuration equality compares view contents and all decoder properties', () => {
  const a = decoderConfig(), b = decoderConfig()
  b.description = new Uint8Array([0, 1, 2, 3, 0]).subarray(1, 4)
  assert.equal(equalDecoderConfigs(a, b), true)
  assert.equal(equalDecoderConfigs(a, { ...b, codedWidth: 9 }), false)
  assert.equal(equalDecoderConfigs(a, { ...b, colorSpace: { ...b.colorSpace, fullRange: true } }), false)
  assert.equal(equalDecoderConfigs(a, { ...b, description: undefined }), false)
  assert.equal(equalDecoderConfigs(a, { ...b, description: new Uint8Array([1, 2, 4]) }), false)
})

test('interleaved GOPs produce a complete ordered stream, reuse encoders, and isolate mux metadata mutation', async () => {
  const fake = fakeCodecs()
  try {
    const output: number[] = []
    let metadataCount = 0
    const session = await createGopEncodeSession({ config, fps, concurrency: 2, gopFrames: 3 }, (chunk, meta) => {
      output.push(chunk.timestamp)
      if (meta?.decoderConfig) {
        metadataCount++
        meta.decoderConfig.codec = 'mutated by muxer'
        new Uint8Array(meta.decoderConfig.description as ArrayBuffer)[0] = 255
      }
    })
    for (let step = 0; step < 13; step++) await session.encodeFrame(canvas, session.frameIndexAt!(step, 13), fps)
    await session.flush()
    assert.deepEqual(output, Array.from({ length: 13 }, (_, i) => pts(i)))
    assert.equal(metadataCount, 1)
    for (const encoder of fake.encoders) {
      assert.equal(encoder.state, 'closed')
      const starts = encoder.requests.filter(r => r.runtime && r.key).map(r => r.timestamp)
      assert.deepEqual(starts, encoder.index === 0 ? [pts(0), pts(6), pts(12)] : [pts(3), pts(9)])
      assert.equal(encoder.configured?.latencyMode, 'quality')
    }
    const frames = fake.frameCounts()
    assert.equal(frames.createdFrames, frames.closedFrames)
  } finally { fake.restore() }
})

test('four encoders drain a one-frame partial last GOP without dropping or duplicating it', async () => {
  const fake = fakeCodecs()
  try {
    const output: number[] = []
    const session = await createGopEncodeSession({ config, fps, concurrency: 4, gopFrames: 3 }, chunk => output.push(chunk.timestamp))
    for (let step = 0; step < 10; step++) await session.encodeFrame(canvas, session.frameIndexAt!(step, 10), fps)
    await session.flush()
    assert.deepEqual(output, Array.from({ length: 10 }, (_, i) => pts(i)))
  } finally { fake.restore() }
})

test('incompatible setup closes every reserved encoder and falls back before writing any video', async () => {
  const fake = fakeCodecs()
  try {
    fake.behavior.incompatibleProbe = true
    let writes = 0
    const settings = { ...defaultSettings('test'), width: 8, height: 8, fps: 30 as const, rateControl: 'quality' as const }
    const session = await createParallelVideoEncodeSession(settings, { addVideoChunk() { writes++ } } as unknown as Mp4Writer, { concurrency: 2 })
    assert.equal(session.frameIndexAt, undefined)
    assert.equal(writes, 0)
    assert.equal(fake.encoders.length, 3)
    assert.equal(fake.encoders[0].state, 'closed')
    assert.equal(fake.encoders[1].state, 'closed')
    session.dispose()
    assert.equal(fake.encoders[2].state, 'closed')
  } finally { fake.restore() }
})

for (const fault of ['config', 'reordered', 'duration', 'key', 'duplicate', 'drop'] as const) {
  test(`runtime ${fault} output requests a fresh serial retry and closes all encoders`, async () => {
    const fake = fakeCodecs()
    try {
      const session = await createGopEncodeSession({ config, fps, concurrency: 2, gopFrames: 3 }, () => {})
      fake.behavior.runtimeFault = fault
      await assert.rejects(async () => {
        await session.encodeFrame(canvas, 0, fps)
        await session.encodeFrame(canvas, 1, fps)
        await session.flush()
      }, error => error instanceof ParallelVideoEncodingError && error.retryWithSerial)
      assert.ok(fake.encoders.every(encoder => encoder.state === 'closed'))
    } finally { fake.restore() }
  })
}

test('compressed out-of-order output has a byte limit independent of raw encode queue depth', async () => {
  const fake = fakeCodecs()
  try {
    const session = await createGopEncodeSession({ config, fps, concurrency: 2, gopFrames: 3, maxBufferedBytes: 100 }, () => {})
    fake.behavior.hold = true; fake.behavior.bytes = 70
    for (const frame of [0, 3, 1, 4]) await session.encodeFrame(canvas, frame, fps)
    fake.encoders[1].releaseAll()
    await assert.rejects(session.encodeFrame(canvas, 2, fps), /buffer limit/)
    assert.ok(fake.encoders.every(encoder => encoder.state === 'closed'))
  } finally { fake.restore() }
})

test('abort and actor errors wake queue backpressure and close every encoder', async () => {
  for (const cause of ['abort', 'actor', 'dispose']) {
    const fake = fakeCodecs()
    try {
      const controller = new AbortController()
      const session = await createGopEncodeSession({ config, fps, concurrency: 2, gopFrames: 3, signal: controller.signal }, () => {})
      fake.behavior.hold = true
      for (const frame of [0, 3, 1, 4]) await session.encodeFrame(canvas, frame, fps)
      const waiting = session.encodeFrame(canvas, 2, fps)
      if (cause === 'abort') controller.abort()
      else if (cause === 'actor') fake.encoders[1].fail()
      else session.dispose()
      await assert.rejects(waiting, error => error instanceof Error && error.name === (cause === 'actor' ? 'ParallelVideoEncodingError' : 'AbortError'))
      assert.ok(fake.encoders.every(encoder => encoder.state === 'closed'))
      assert.equal(fake.frameCounts().createdFrames, fake.frameCounts().closedFrames)
    } finally { fake.restore() }
  }
})

test('abort also wakes a pending GOP flush without falling back to serial', async () => {
  const fake = fakeCodecs()
  try {
    const controller = new AbortController()
    const session = await createGopEncodeSession({ config, fps, concurrency: 2, gopFrames: 3, signal: controller.signal }, () => {})
    fake.behavior.hold = true
    await session.encodeFrame(canvas, 0, fps)
    const flushing = session.flush()
    controller.abort()
    await assert.rejects(flushing, { name: 'AbortError' })
    assert.ok(fake.encoders.every(encoder => encoder.state === 'closed'))
  } finally { fake.restore() }
})
