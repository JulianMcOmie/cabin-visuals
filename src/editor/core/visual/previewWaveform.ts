import type { WaveformQuery } from '../audio/waveformWindow'
import { useProjectStore } from '../../store/ProjectStore'

let resolver: ((query: WaveformQuery) => Promise<Float32Array>) | undefined
let revision = 0
let audioDocument: unknown
const inflight = new Map<string, Promise<Float32Array>>()
const pending = new Set<Promise<Float32Array>>()
export function setPreviewWaveformResolver(value: typeof resolver) { resolver = value }
export function setPreviewWaveformRevision(value: number) { revision = value }
export function waveformRevision(): unknown { return resolver ? revision : useProjectStore.getState().audioTracks }
export function waveformKey(query: WaveformQuery): string { return `${query.beat}:${query.bpm}:${query.beatsPerBar}` }

/** Only concurrent identical windows are shared. Fulfilled windows belong to
 * their mounted instrument, so scrubbing cannot grow a global PCM cache. */
export function requestWaveform(query: WaveformQuery): Promise<Float32Array> {
  const nextDocument = waveformRevision()
  if (audioDocument !== nextDocument) { audioDocument = nextDocument; inflight.clear() }
  const key = waveformKey(query)
  const existing = inflight.get(key)
  if (existing) return existing
  const tracks = useProjectStore.getState().audioTracks
  const promise = resolver ? resolver(query) : import('../audio/readWaveformWindow').then(m => m.readWaveformWindow(tracks, query))
  inflight.set(key, promise); pending.add(promise)
  const done = () => { pending.delete(promise); if (inflight.get(key) === promise) inflight.delete(key) }
  promise.then(done, done)
  return promise
}
export async function whenWaveformsSettled() {
  if (!pending.size) return false
  await Promise.all([...pending])
  return true
}
