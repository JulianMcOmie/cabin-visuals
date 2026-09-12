import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { emptyDocument } from '../../persistence/types'
import { hydrate } from '../../persistence/serialize'
import { useProjectStore } from '../store/ProjectStore'
import { useAudioStore } from '../store/AudioStore'
import { extractDrumMidi } from './extractDrumMidi'

function setup(ref: string) {
  hydrate(emptyDocument())
  useAudioStore.getState().addClip({ ref, fileName: 'song.mp3', duration: 4 })
  useProjectStore.getState().addTrack({ id: ref, name: 'Song', type: 'audio', instrumentId: 'audio', color: '#fff', muted: false, solo: false, blocks: [], childIds: [], audioBlocks: [{ id: ref, clipRef: ref, startBar: 2, trimStart: 0.5, trimEnd: 4 }] })
}
class FakeContext {
  async decodeAudioData() { return { duration: 4, length: 4 * 44100, sampleRate: 44100, numberOfChannels: 1, getChannelData: () => new Float32Array(4 * 44100) } }
}
class FakeWorker {
  onmessage?: (event: unknown) => void
  onerror?: () => void
  postMessage() { queueMicrotask(() => this.onmessage?.({ data: { analysis: { kick: [{ time: 1, velocity: 100 }], snare: [{ time: 2, velocity: 90 }], hihat: [{ time: 3, velocity: 80 }] } } })) }
  terminate() {}
}
// These test orchestration only. Detector accuracy has separate fixtures.
function browserMocks(t: TestContext) {
  const globals = globalThis as unknown as Record<string, unknown>
  for (const [name, value] of Object.entries({ Worker: FakeWorker, OfflineAudioContext: FakeContext })) {
    const original = globals[name]; globals[name] = value
    t.after(() => { if (original === undefined) delete globals[name]; else globals[name] = original })
  }
}
test('three parts reuse one analysis and import additive tracks with the latest placement', async (t) => {
  browserMocks(t)
  setup('u/p/cache')
  let requests = 0
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url === '/api/drum-stem') { requests++; return Response.json({ url: 'https://test.invalid/drum' }) }
    return new Response(new Uint8Array(4))
  })
  for (const part of ['kick', 'snare', 'hihat'] as const) await extractDrumMidi(part, () => {}, new AbortController().signal)
  assert.equal(requests, 1)
  const tracks = Object.values(useProjectStore.getState().tracks).filter((t) => t.drumMidi)
  assert.equal(tracks.length, 3)
  assert.deepEqual(tracks.map((t) => t.blocks[0].notes[0].pitch), [36, 38, 42])
})
test('failed separation is retryable and does not create tracks', async (t) => {
  browserMocks(t); setup('u/p/retry')
  let requests = 0
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url !== '/api/drum-stem') return new Response(new Uint8Array(4))
    requests++
    return requests === 1 ? Response.json({ error: 'No credits.' }, { status: 502 }) : Response.json({ url: 'https://test.invalid/drum' })
  })
  await assert.rejects(extractDrumMidi('kick', () => {}, new AbortController().signal), /No credits/)
  assert.equal(Object.values(useProjectStore.getState().tracks).filter((t) => t.drumMidi).length, 0)
  assert.equal(await extractDrumMidi('kick', () => {}, new AbortController().signal), 1)
  assert.equal(requests, 2)
})
test('scene switches and cancellation never land stale MIDI', async (t) => {
  browserMocks(t); setup('u/p/stale')
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url !== '/api/drum-stem') return new Response(new Uint8Array(4))
    await gate; return Response.json({ url: 'https://test.invalid/drum' })
  })
  const pending = extractDrumMidi('kick', () => {}, new AbortController().signal)
  const s = useProjectStore.getState(); s.setActiveScene(s.sceneOrder.find((id) => id !== s.activeSceneId)!)
  release()
  await assert.rejects(pending, /scene changed/)
  const cancelled = new AbortController(); cancelled.abort()
  await assert.rejects(extractDrumMidi('snare', () => {}, cancelled.signal))
  assert.equal(Object.values(useProjectStore.getState().scenes).flatMap((s) => Object.values(s.tracks)).filter((t) => t.drumMidi).length, 0)
})

test('failed uploads and an already-cancelled action never call the provider', async (t) => {
  setup('u/p/upload-failed')
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected request') })
  useAudioStore.getState().patchUpload('u/p/upload-failed', { status: 'failed', error: 'Upload failed.' })
  await assert.rejects(extractDrumMidi('kick', () => {}, new AbortController().signal), /Upload failed/)
  const cancelled = new AbortController(); cancelled.abort()
  await assert.rejects(extractDrumMidi('kick', () => {}, cancelled.signal))
  assert.equal(fetch.mock.callCount(), 0)
})
