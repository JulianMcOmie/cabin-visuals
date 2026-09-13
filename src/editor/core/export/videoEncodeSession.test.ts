import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createVideoEncodeSession } from './videoEncode'
import { defaultSettings } from './types'
import type { Mp4Writer } from './mux'

const settings = { ...defaultSettings('cleanup'), width: 8, height: 8, fps: 30 as const, rateControl: 'bitrate' as const }
const canvas = { width: 8, height: 8 } as HTMLCanvasElement

function fakeCodecs() {
  const originalEncoder = globalThis.VideoEncoder, originalFrame = globalThis.VideoFrame
  let configuredFailure: Error | null = null, queueSize = 0, closedFrames = 0
  const encoders: Encoder[] = []
  class Encoder extends EventTarget {
    state: CodecState = 'unconfigured'
    encodeQueueSize = 0
    closeCalls = 0
    rejectFlush?: (error: Error) => void
    constructor(readonly init: VideoEncoderInit) { super(); encoders.push(this) }
    configure() {
      if (configuredFailure) throw configuredFailure
      this.state = 'configured'
    }
    encode() { this.encodeQueueSize = queueSize }
    flush(): Promise<void> { return new Promise((_resolve, reject) => { this.rejectFlush = reject }) }
    close() {
      this.closeCalls++; this.state = 'closed'
      this.rejectFlush?.(new DOMException('Encoder closed', 'AbortError'))
    }
    emit() { this.init.output({ timestamp: 0 } as EncodedVideoChunk, {}) }
  }
  class Frame { close() { closedFrames++ } }
  globalThis.VideoEncoder = Encoder as unknown as typeof VideoEncoder
  globalThis.VideoFrame = Frame as unknown as typeof VideoFrame
  return { encoders, closedFrames: () => closedFrames, rejectConfigure: (error: Error) => { configuredFailure = error },
    blockQueue: () => { queueSize = 3 }, restore: () => { globalThis.VideoEncoder = originalEncoder; globalThis.VideoFrame = originalFrame } }
}

test('a configure failure closes the constructed serial encoder before propagating', () => {
  const fake = fakeCodecs()
  try {
    const failure = new Error('Hardware configuration failed')
    fake.rejectConfigure(failure)
    assert.throws(() => createVideoEncodeSession(settings, {} as Mp4Writer), error => error === failure)
    assert.equal(fake.encoders[0].state, 'closed')
    assert.equal(fake.encoders[0].closeCalls, 1)
  } finally { fake.restore() }
})

test('a writer output failure wakes serial backpressure, closes the encoder, and propagates the original error', async () => {
  const fake = fakeCodecs()
  try {
    fake.blockQueue()
    const failure = new Error('MP4 writer failed')
    let writes = 0
    const writer = { addVideoChunk() { writes++; throw failure } } as unknown as Mp4Writer
    const session = createVideoEncodeSession(settings, writer)
    const waiting = session.encodeFrame(canvas, 0, 30)
    fake.encoders[0].emit()
    await assert.rejects(waiting, error => error === failure)
    assert.equal(fake.encoders[0].state, 'closed')
    assert.equal(fake.closedFrames(), 1)
    assert.equal(fake.encoders[0].closeCalls, 1)
    fake.encoders[0].emit()
    assert.equal(writes, 1, 'late output after failure must not reach the writer')
    session.dispose()
    assert.equal(fake.encoders[0].closeCalls, 1)
  } finally { fake.restore() }
})

test('a writer output failure also rejects a pending serial flush with the writer error', async () => {
  const fake = fakeCodecs()
  try {
    const failure = new Error('MP4 allocation failed')
    const session = createVideoEncodeSession(settings, { addVideoChunk() { throw failure } } as unknown as Mp4Writer)
    await session.encodeFrame(canvas, 0, 30)
    const flushing = session.flush()
    fake.encoders[0].emit()
    await assert.rejects(flushing, error => error === failure)
    assert.equal(fake.encoders[0].closeCalls, 1)
  } finally { fake.restore() }
})

test('serial codec errors and cancellation close the encoder and wake a blocked frame', async () => {
  for (const source of ['codec', 'signal', 'dispose']) {
    const fake = fakeCodecs()
    try {
      fake.blockQueue()
      const controller = new AbortController()
      const session = createVideoEncodeSession(settings, {} as Mp4Writer, { signal: controller.signal })
      const waiting = session.encodeFrame(canvas, 0, 30)
      const failure = new DOMException('Encoder failed', 'OperationError')
      if (source === 'codec') fake.encoders[0].init.error(failure)
      else if (source === 'signal') controller.abort()
      else session.dispose()
      await assert.rejects(waiting, error => source === 'codec' ? error === failure : error instanceof Error && error.name === 'AbortError')
      assert.equal(fake.encoders[0].state, 'closed')
      assert.equal(fake.encoders[0].closeCalls, 1)
    } finally { fake.restore() }
  }
})
