import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportEncodeOptions, exportEncoderConfig } from './videoEncode'
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
