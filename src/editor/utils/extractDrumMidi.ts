import { isUploadedRef } from '../core/audio/audioSource'
import { useAudioStore } from '../store/AudioStore'
import { useProjectStore } from '../store/ProjectStore'
import { firstAudioBlock } from './transcribeSong'
import { placeDrumMidi } from './drumMidi'
import type { DrumAnalysis, DrumPart } from './drumDetection'

export type DrumPhase = { label: string; progress?: number }
type Listener = (phase: DrumPhase) => void
// Session cache stores small hit lists, not decoded song buffers. Failed jobs
// are evicted so retries work; the server separately caches successful stems.
const analyses = new Map<string, { promise: Promise<DrumAnalysis>; listeners: Set<Listener>; phase: DrumPhase }>()

function analyseInWorker(samples: Float32Array, sampleRate: number, report: Listener): Promise<DrumAnalysis> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./drumDetection.worker.ts', import.meta.url))
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Drum analysis timed out. Please try again.')) }, 120_000)
    const finish = () => { clearTimeout(timer); worker.terminate() }
    worker.onmessage = (event: MessageEvent<{ progress?: number; analysis?: DrumAnalysis; error?: string }>) => {
      if (event.data.error) { finish(); reject(new Error(event.data.error)) }
      else if (event.data.analysis) { finish(); resolve(event.data.analysis) }
      else report({ label: 'Detecting drum hits…', progress: event.data.progress })
    }
    worker.onerror = () => { finish(); reject(new Error('Drum analysis could not start. Please try again.')) }
    worker.postMessage({ samples, sampleRate }, [samples.buffer])
  })
}

async function analyseSong(clipRef: string, report: Listener): Promise<DrumAnalysis> {
  const deadline = Date.now() + 180_000
  for (;;) {
    const upload = useAudioStore.getState().uploads[clipRef]
    if (!upload) break
    if (upload.status === 'failed') throw new Error(upload.error ?? 'The song upload failed.')
    if (Date.now() > deadline) throw new Error('The song upload timed out.')
    report({ label: 'Uploading song…', progress: upload.progress })
    await new Promise((r) => setTimeout(r, 200))
  }
  const duration = useAudioStore.getState().audioClips[clipRef]?.duration
  if (duration && duration > 900) throw new Error('Drum extraction supports songs up to 15 minutes.')
  report({ label: 'Separating drums — this can take a few minutes…' })
  const res = await fetch('/api/drum-stem', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clipRef }),
    signal: AbortSignal.timeout(290_000),
  })
  const data = await res.json().catch(() => ({})) as { url?: string; error?: string }
  if (!res.ok || !data.url) throw new Error(data.error ?? `Drum separation failed (${res.status}).`)
  report({ label: 'Decoding drum audio…' })
  const stem = await fetch(data.url, { signal: AbortSignal.timeout(60_000) })
  if (!stem.ok) throw new Error('The drum audio could not be downloaded. Please try again.')
  const context = new OfflineAudioContext(1, 1, 44100)
  let decoded: AudioBuffer
  try { decoded = await context.decodeAudioData(await stem.arrayBuffer()) }
  catch { throw new Error('The drum audio could not be decoded in this browser.') }
  if (decoded.duration > 900) throw new Error('Drum extraction supports songs up to 15 minutes.')
  if (duration && Math.abs(decoded.duration - duration) > 0.5) throw new Error('The drum stem length does not match the song. Cannot safely align MIDI.')
  const samples = new Float32Array(decoded.length)
  // Pick the strongest channel to avoid cancelling anti-phase stereo drums.
  let channel = 0, strongest = -1
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const a = decoded.getChannelData(c)
    let energy = 0
    for (let i = 0; i < a.length; i += 32) energy += a[i] * a[i]
    if (energy > strongest) { strongest = energy; channel = c }
  }
  samples.set(decoded.getChannelData(channel))
  return analyseInWorker(samples, decoded.sampleRate, report)
}

export async function extractDrumMidi(part: DrumPart, report: Listener, signal: AbortSignal): Promise<number> {
  signal.throwIfAborted()
  const initial = firstAudioBlock()
  const sceneId = useProjectStore.getState().activeSceneId
  if (!initial) throw new Error('Add a song to the timeline first.')
  if (!isUploadedRef(initial.clipRef)) throw new Error('Sign in and save the project so the song uploads, then try again.')
  let entry = analyses.get(initial.clipRef)
  if (!entry) {
    const listeners = new Set<Listener>()
    const job = { listeners, phase: { label: 'Preparing song…' } as DrumPhase, promise: null as unknown as Promise<DrumAnalysis> }
    job.promise = analyseSong(initial.clipRef, (phase) => { job.phase = phase; for (const listener of listeners) listener(phase) })
      .catch((error) => {
        analyses.delete(initial.clipRef)
        if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
          throw new Error('Drum processing timed out. Please try again later.')
        }
        throw error
      })
    analyses.set(initial.clipRef, job)
    entry = job
    // Bound completed session history without interrupting shared promises.
    if (analyses.size > 8) analyses.delete(analyses.keys().next().value!)
  }
  entry.listeners.add(report)
  report(entry.phase)
  try {
    const analysis = await entry.promise
    // Decode writes the detected grid and trims asynchronously. Require a
    // settled clip rather than guessing placement when it failed to decode.
    const deadline = Date.now() + 30_000
    while (!signal.aborted && firstAudioBlock()?.id === initial.id && firstAudioBlock()!.trimEnd <= 0 && Date.now() < deadline) {
      report({ label: 'Waiting for the song’s beat grid…' })
      await new Promise((r) => setTimeout(r, 200))
    }
    signal.throwIfAborted()
    const block = firstAudioBlock()
    const state = useProjectStore.getState()
    if (!block || block.id !== initial.id || block.clipRef !== initial.clipRef || state.activeSceneId !== sceneId) {
      throw new Error('The song or scene changed while processing. Select the intended scene and try again.')
    }
    if (block.trimEnd <= block.trimStart) throw new Error('The song is not ready or has no playable audio. Please try again.')
    const track = placeDrumMidi(analysis[part], part, block, state.bpm, state.beatsPerBar)
    if (!track.notes.length) throw new Error('No clear hits for this drum part were found in the song’s trimmed region.')
    state.importMidiTracks([track])
    return track.notes.length
  } finally { entry.listeners.delete(report) }
}
