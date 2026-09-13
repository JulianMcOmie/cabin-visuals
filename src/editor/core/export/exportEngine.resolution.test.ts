import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { registerFrameDriver, type FrameDriver } from './frameDriver'
import { defaultSettings } from './types'

const mockModule = (mock as unknown as { module(path: string, options: { namedExports: object }): void }).module.bind(mock)
let encoded = 0, finalized = 0, disposed = 0, composed = 0
mockModule('./support.ts', { namedExports: { encoderProducesMuxableChunks: async () => true } })
mockModule('../../instruments/lazyInstrument.ts', { namedExports: { whenInstrumentsSettled: async () => {} } })
mockModule('./audioRender.ts', { namedExports: {
  willRenderAudio: () => false, renderAudioTrack: async () => null,
  encodeAudioIntoWriter: async () => {}, EXPORT_AUDIO_SAMPLE_RATE: 48000,
} })
mockModule('./mux.ts', { namedExports: { Mp4Writer: class {
  finalize() { finalized++; return new Blob(['video']) }
} } })
mockModule('./videoEncode.ts', { namedExports: {
  exportEncoderConfig: () => ({}), exportEncodeOptions: () => undefined,
  createVideoEncodeSession: () => ({
    encodeFrame: async () => { encoded++ }, flush: async () => {}, dispose: () => { disposed++ },
  }),
} })
mockModule('./watermark.ts', { namedExports: {
  createWatermarkCompositor: (width: number, height: number) => ({
    compose: () => { composed++; return { width, height } },
  }),
} })
const engine = import('./exportEngine')

test('export never finalizes a resized source, including when watermark would mask the resize', async () => {
  const { runExport } = await engine
  for (const watermark of [false, true]) {
    encoded = finalized = disposed = composed = 0
    let unpinned = 0, renders = 0
    const settings = { ...defaultSettings('test'), includeAudio: false, watermark }
    const canvas = { width: settings.width, height: settings.height }
    const driver: FrameDriver = {
      pin() {}, unpin() { unpinned++ },
      renderFrame() { if (++renders === 2) canvas.width = 640 },
      getCanvas: () => canvas as HTMLCanvasElement,
    }
    registerFrameDriver(driver)
    try {
      await assert.rejects(runExport(settings, { bpm: 120, beatsPerBar: 4, totalBars: 1 }), /Export stopped.*expected/)
      assert.equal(encoded, 1)
      assert.equal(composed, watermark ? 1 : 0)
      assert.equal(finalized, 0)
      assert.equal(disposed, 1)
      assert.equal(unpinned, 1)
    } finally { registerFrameDriver(null) }
  }
})

test('prepare failure and cancellation release the pin without returning a partial file', async () => {
  const { runExport } = await engine
  for (const failure of ['prepare', 'cancel']) {
    encoded = finalized = disposed = 0
    let unpinned = 0
    const controller = new AbortController()
    const settings = { ...defaultSettings('test'), includeAudio: false, watermark: false }
    registerFrameDriver({
      pin() {}, unpin() { unpinned++ }, renderFrame() {},
      prepare: async () => {
        if (failure === 'prepare') throw new Error('graphics context was lost')
        controller.abort()
      },
      getCanvas: () => ({ width: settings.width, height: settings.height }) as HTMLCanvasElement,
    })
    try {
      const pending = runExport(settings, { bpm: 120, beatsPerBar: 4, totalBars: 1 }, { signal: controller.signal })
      if (failure === 'prepare') await assert.rejects(pending, /graphics context was lost/)
      else assert.equal((await pending).blob, null)
      assert.equal(encoded, 0)
      assert.equal(finalized, 0)
      assert.equal(disposed, 1)
      assert.equal(unpinned, 1)
    } finally { registerFrameDriver(null) }
  }
})

test('a failed or conflicting pin disposes its encoder without releasing another capture', async () => {
  const { runExport } = await engine
  disposed = finalized = 0
  let unpinned = 0
  registerFrameDriver({
    pin() { throw new Error('capture already running') }, unpin() { unpinned++ },
    renderFrame() {}, getCanvas: () => ({} as HTMLCanvasElement),
  })
  try {
    await assert.rejects(runExport({ ...defaultSettings('test'), watermark: false }, { bpm: 120, beatsPerBar: 4, totalBars: 1 }), /already running/)
    assert.equal(disposed, 1)
    assert.equal(finalized, 0)
    assert.equal(unpinned, 0)
  } finally { registerFrameDriver(null) }
})
