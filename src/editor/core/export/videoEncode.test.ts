import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createVideoEncodeSession, exportEncodeOptions, exportEncoderConfig } from './videoEncode'
import type { Mp4Writer } from './mux'
import { defaultSettings, type ExportSettings } from './types'

const settings = (rateControl: ExportSettings['rateControl']): ExportSettings => ({
  ...defaultSettings('test'),
  rateControl,
})

test('bitrate mode configures a fixed bitrate and no per-frame options', () => {
  const config = exportEncoderConfig(settings('bitrate'))
  assert.equal(config.bitrate, settings('bitrate').videoBitrate)
  assert.equal(config.bitrateMode, undefined)
  assert.equal(exportEncodeOptions(settings('bitrate')), undefined)
})

test('quality mode is quantizer-driven at QP 21', () => {
  const config = exportEncoderConfig(settings('quality'))
  assert.equal(config.bitrateMode, 'quantizer')
  assert.equal(config.bitrate, undefined)
  assert.deepEqual(exportEncodeOptions(settings('quality')), { avc: { quantizer: 21 } })
})

test('lossless mode is QP 0 with the level floored to 5.2', () => {
  const config = exportEncoderConfig(settings('lossless'))
  assert.equal(config.bitrateMode, 'quantizer')
  assert.equal(config.bitrate, undefined)
  // 1080p60 alone is level 4.2; QP-0 bitrates blow past its ceiling, and an
  // encoder honoring the low level would quantize to fit it.
  assert.equal(config.codec, 'avc1.640034')
  assert.deepEqual(exportEncodeOptions(settings('lossless')), { avc: { quantizer: 0 } })
})

test('the encoder rejects resized input before VideoFrame capture and closes frames on encode failure', async () => {
  const originalEncoder = globalThis.VideoEncoder, originalFrame = globalThis.VideoFrame
  let captured = 0, closed = 0
  class Encoder {
    configure() {}
    encode() { throw new Error('encoder failed') }
    close() {}
  }
  class Frame {
    constructor() { captured++ }
    close() { closed++ }
  }
  globalThis.VideoEncoder = Encoder as unknown as typeof VideoEncoder
  globalThis.VideoFrame = Frame as unknown as typeof VideoFrame
  try {
    const config = settings('bitrate')
    const session = createVideoEncodeSession(config, {} as Mp4Writer)
    await assert.rejects(session.encodeFrame({ width: 640, height: 360 } as HTMLCanvasElement, 0, 30), /Export stopped.*expected/)
    assert.equal(captured, 0)
    await assert.rejects(session.encodeFrame({ width: config.width, height: config.height } as HTMLCanvasElement, 0, 30), /encoder failed/)
    assert.equal(captured, 1)
    assert.equal(closed, 1)
    session.dispose()
  } finally {
    globalThis.VideoEncoder = originalEncoder
    globalThis.VideoFrame = originalFrame
  }
})
