import { afterEach, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { registerFrameDriver } from './frameDriver'
import { framePreparers, registerFramePreparer } from './framePreparers'
import { defaultSettings, type ExportSettings } from './types'
import type { ProjectTime } from './exportEngine'

const mockModule = (mock as unknown as { module(path: string, options: { namedExports: object }): void }).module.bind(mock)
class ParallelVideoEncodingError extends Error {}
class Writer {
  id = writers.length
  finalized = 0
  constructor() { writers.push(this) }
  finalize() { this.finalized++; return new Blob([String(this.id)]) }
}
type Session = {
  kind: 'serial' | 'parallel'
  concurrency: 1 | 2 | 4
  writer: Writer
  frames: number[]
  disposed: number
  flushed: number
}
let writers: Writer[] = [], sessions: Session[] = []
let renders: { beat: number; timeMs: number }[] = [], progress: number[] = [], events: string[] = []
let pinned = 0, unpinned = 0, lastFrame = -1, audioEncoded = 0
let settings: ExportSettings
let onPrepare: (() => Promise<void> | void) | undefined
let onEncode: ((session: Session, frame: number) => Promise<void> | void) | undefined
let onFlush: ((session: Session) => Promise<void> | void) | undefined
let audioRender: (() => Promise<AudioBuffer | null>) | undefined
let audioEncode: (() => Promise<void>) | undefined
const project: ProjectTime = { bpm: 120, beatsPerBar: 4, totalBars: 4, range: { startBeat: 8, endBeat: 12 } }
const frameCount = 60
const halfInterleave = (step: number, total: number) => step % 2 === 0 ? step / 2 : Math.ceil(total / 2) + Math.floor(step / 2)
const expectedOrder = Array.from({ length: frameCount }, (_, step) => halfInterleave(step, frameCount))
const chronological = Array.from({ length: frameCount }, (_, i) => i)

function createSession(kind: Session['kind'], writer: Writer, concurrency: Session['concurrency'] = 1) {
  const state: Session = { kind, concurrency, writer, frames: [], disposed: 0, flushed: 0 }
  sessions.push(state)
  return {
    ...(kind === 'parallel' ? { frameIndexAt: halfInterleave } : {}),
    async encodeFrame(_canvas: HTMLCanvasElement, frame: number, fps: number) {
      assert.equal(fps, settings.fps)
      assert.equal(lastFrame, frame, 'capture must use the frame just rendered')
      state.frames.push(frame)
      events.push(`encode:${frame}`)
      await onEncode?.(state, frame)
    },
    async flush() { state.flushed++; await onFlush?.(state) },
    dispose() { state.disposed++ },
  }
}

mockModule('./support.ts', { namedExports: { encoderProducesMuxableChunks: async () => true } })
mockModule('../../instruments/lazyInstrument.ts', { namedExports: { whenInstrumentsSettled: async () => {} } })
mockModule('./audioRender.ts', { namedExports: {
  willRenderAudio: () => true,
  renderAudioTrack: () => audioRender?.() ?? Promise.resolve(null),
  encodeAudioIntoWriter: async () => { audioEncoded++; await audioEncode?.() },
  EXPORT_AUDIO_SAMPLE_RATE: 48000,
} })
mockModule('./mux.ts', { namedExports: { Mp4Writer: Writer } })
mockModule('./videoEncode.ts', { namedExports: {
  exportEncoderConfig: () => ({}), exportEncodeOptions: () => undefined,
  ParallelVideoEncodingError,
  createVideoEncodeSession: (_settings: ExportSettings, writer: Writer) => createSession('serial', writer),
  createParallelVideoEncodeSession: async (_settings: ExportSettings, writer: Writer, options: { concurrency: 2 | 4 }) =>
    createSession('parallel', writer, options.concurrency),
} })
mockModule('./watermark.ts', { namedExports: { createWatermarkCompositor: () => { throw new Error('unexpected watermark') } } })
const engine = import('./exportEngine')
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  writers = []; sessions = []; renders = []; progress = []; events = []
  pinned = unpinned = audioEncoded = 0; lastFrame = -1
  onPrepare = onEncode = onFlush = audioRender = audioEncode = undefined
  settings = { ...defaultSettings('parallel-test'), fps: 30, includeAudio: false, watermark: false }
  framePreparers.clear()
  const canvas = { get width() { return settings.width }, get height() { return settings.height } }
  registerFrameDriver({
    pin() { pinned++ }, unpin() { unpinned++ },
    prepare: async () => { await onPrepare?.() },
    prepareFrame(beat) { events.push(`prepare:${beat}`) },
    renderFrame(beat, timeMs) {
      renders.push({ beat, timeMs })
      lastFrame = Math.round(timeMs * settings.fps / 1000)
      events.push(`render:${lastFrame}`)
    },
    getCanvas: () => canvas as HTMLCanvasElement,
  })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => {
      let captured = -1
      return { getContext: () => ({ drawImage: () => { captured = lastFrame } }), toDataURL: () => `poster:${captured}` }
    },
  } })
})

afterEach(() => {
  registerFrameDriver(null)
  framePreparers.clear()
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
  else Reflect.deleteProperty(globalThis, 'document')
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
  else Reflect.deleteProperty(globalThis, 'navigator')
})

const defaultPolicyCases: {
  label: string
  seconds?: number
  cpu?: number
  settings?: Partial<ExportSettings>
  expected: Session['concurrency']
  absentNavigator?: boolean
}[] = [
  { label: '8-second 4K60 Maximum export on 8 threads uses four encoders', expected: 4 },
  { label: '4-second 4K60 Maximum export uses two encoders', seconds: 4, expected: 2 },
  { label: 'under 8 seconds reserves only two encoders', seconds: 7.5, expected: 2 },
  { label: '4-thread CPU uses two encoders for an 8-second clip', cpu: 4, expected: 2 },
  { label: 'under 4 seconds stays serial', seconds: 3.5, expected: 1 },
  { label: '1080p stays serial', settings: { width: 1920, height: 1080 }, expected: 1 },
  { label: 'bitrate mode stays serial', settings: { rateControl: 'bitrate' }, expected: 1 },
  { label: 'lossless mode stays serial', settings: { rateControl: 'lossless' }, expected: 1 },
  { label: 'low CPU concurrency stays serial', cpu: 2, expected: 1 },
  { label: 'missing browser CPU information stays serial', absentNavigator: true, expected: 1 },
  { label: '8-second eligibility also holds at 30 fps', settings: { fps: 30 }, expected: 4 },
  { label: 'portrait 4K uses the same policy', settings: { width: 2160, height: 3840, aspect: '9:16' }, expected: 4 },
]

for (const policy of defaultPolicyCases) {
  test(`default policy: ${policy.label}`, async () => {
    const { runExport } = await engine
    settings = { ...settings, width: 3840, height: 2160, fps: 60, rateControl: 'quality', ...policy.settings }
    if (policy.absentNavigator) Reflect.deleteProperty(globalThis, 'navigator')
    else Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { hardwareConcurrency: policy.cpu ?? 8 } })
    const seconds = policy.seconds ?? 8
    const result = await runExport(settings, {
      ...project, totalBars: 8, range: { startBeat: 8, endBeat: 8 + seconds * project.bpm / 60 },
    })
    assert.equal(sessions.length, 1)
    assert.equal(sessions[0].kind, policy.expected === 1 ? 'serial' : 'parallel')
    assert.equal(sessions[0].concurrency, policy.expected)
    assert.equal(result.frameCount, seconds * settings.fps)
    assert.equal(sessions[0].frames.length, result.frameCount)
    assert.equal(writers[0].finalized, 1)
    assert.equal(unpinned, 1)
  })
}

test('parallel submission preserves range beats, file times, middle-frame poster, and monotonic progress', async () => {
  const { runExport } = await engine
  const result = await runExport(settings, project, { onProgress: frame => progress.push(frame) }, { videoConcurrency: 4 })
  assert.equal(result.frameCount, frameCount)
  assert.equal(result.poster, 'poster:30')
  assert.equal(await result.blob?.text(), '0')
  assert.deepEqual(sessions.map(session => session.kind), ['parallel'])
  assert.deepEqual(sessions[0].frames, expectedOrder)
  assert.deepEqual(renders, expectedOrder.map(i => ({ beat: 8 + i * 120 / (60 * 30), timeMs: i * 1000 / 30 })))
  assert.deepEqual(progress, [0, 30, 60])
  assert.equal(writers[0].finalized, 1)
  assert.equal(pinned, 1)
  assert.equal(unpinned, 1)
})

test('a runtime parallel failure discards its partial writer and retries with a fresh serial export', async () => {
  const { runExport } = await engine
  onEncode = (session, frame) => {
    if (session.kind === 'parallel' && frame === 30) throw new ParallelVideoEncodingError('incompatible parameter sets')
  }
  const result = await runExport(settings, project, {}, { videoConcurrency: 4 })
  assert.equal(await result.blob?.text(), '1')
  assert.deepEqual(writers.map(writer => writer.finalized), [0, 1])
  assert.deepEqual(sessions.map(session => session.kind), ['parallel', 'serial'])
  assert.notEqual(sessions[0].writer, sessions[1].writer)
  assert.deepEqual(sessions[0].frames, [0, 30])
  assert.deepEqual(sessions[1].frames, chronological)
  assert.equal(sessions[0].disposed, 1)
  assert.equal(pinned, 2)
  assert.equal(unpinned, 2)
})

test('the serial retry is attempted only once even if it also fails with a parallel-class error', async () => {
  const { runExport } = await engine
  onEncode = () => { throw new ParallelVideoEncodingError('encoder unavailable') }
  await assert.rejects(runExport(settings, project, {}, { videoConcurrency: 2 }), /encoder unavailable/)
  assert.deepEqual(sessions.map(session => session.kind), ['parallel', 'serial'])
  assert.deepEqual(sessions.map(session => session.disposed), [1, 1])
  assert.deepEqual(writers.map(writer => writer.finalized), [0, 0])
  assert.equal(unpinned, 2)
})

test('cancellation during parallel encoding never starts a retry or returns a partial file', async () => {
  const { runExport } = await engine
  const controller = new AbortController()
  onEncode = () => {
    controller.abort()
    throw new ParallelVideoEncodingError('encoder closed by cancellation')
  }
  const result = await runExport(settings, project, { signal: controller.signal }, { videoConcurrency: 4 })
  assert.equal(result.blob, null)
  assert.equal(result.poster, null)
  assert.equal(result.frameCount, frameCount)
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].disposed, 1)
  assert.equal(writers[0].finalized, 0)
  assert.equal(unpinned, 1)
})

test('frame preparers mounted during driver preparation keep export sequential and settle before each render', async () => {
  const { runExport } = await engine
  onPrepare = () => { registerFramePreparer(async beat => { events.push(`settled:${beat}`) }) }
  await runExport(settings, project, {}, { videoConcurrency: 4 })
  assert.deepEqual(sessions.map(session => session.kind), ['serial'])
  assert.deepEqual(sessions[0].frames, chronological)
  assert.deepEqual(events, chronological.flatMap(i => {
    const beat = 8 + i * 120 / (60 * 30)
    return [`prepare:${beat}`, `settled:${beat}`, `render:${i}`, `encode:${i}`]
  }))
  assert.equal(writers[0].finalized, 1)
})

test('a frame preparer mounted after parallel submission begins triggers a fresh sequential retry', async () => {
  const { runExport } = await engine
  const prepared: number[] = []
  onEncode = session => {
    if (session.kind === 'parallel') registerFramePreparer(beat => { prepared.push(beat) })
  }
  await runExport(settings, project, {}, { videoConcurrency: 4 })
  assert.deepEqual(sessions.map(session => session.kind), ['parallel', 'serial'])
  assert.deepEqual(sessions[0].frames, [0])
  assert.deepEqual(sessions[1].frames, chronological)
  assert.deepEqual(prepared, chronological.map(i => 8 + i * 120 / (60 * 30)))
  assert.deepEqual(writers.map(writer => writer.finalized), [0, 1])
  assert.equal(unpinned, 2)
})

test('cancellation while offline audio is pending after video flush never encodes audio or finalizes', async () => {
  const { runExport } = await engine
  const controller = new AbortController(), audio = deferred<AudioBuffer | null>(), videoDone = deferred<void>()
  audioRender = () => audio.promise
  onFlush = () => videoDone.resolve()
  const pending = runExport({ ...settings, includeAudio: true }, { ...project, audioTracks: [{}] as ProjectTime['audioTracks'] },
    { signal: controller.signal }, { videoConcurrency: 4 })
  await videoDone.promise
  controller.abort()
  audio.resolve({} as AudioBuffer)
  assert.equal((await pending).blob, null)
  assert.equal(audioEncoded, 0)
  assert.equal(writers[0].finalized, 0)
  assert.equal(sessions.length, 1)
  assert.equal(unpinned, 1)
})

test('cancellation during audio encoding after video flush never finalizes', async () => {
  const { runExport } = await engine
  const controller = new AbortController(), audioDone = deferred<void>(), audioStarted = deferred<void>()
  audioRender = async () => ({} as AudioBuffer)
  audioEncode = () => { audioStarted.resolve(); return audioDone.promise }
  const pending = runExport({ ...settings, includeAudio: true }, { ...project, audioTracks: [{}] as ProjectTime['audioTracks'] },
    { signal: controller.signal }, { videoConcurrency: 2 })
  await audioStarted.promise
  controller.abort()
  audioDone.resolve()
  assert.equal((await pending).blob, null)
  assert.equal(audioEncoded, 1)
  assert.equal(writers[0].finalized, 0)
  assert.equal(sessions.length, 1)
  assert.equal(unpinned, 1)
})
