import { detectBeats, type BeatDetection } from './beatDetect'

/**
 * Beat detection without freezing the UI. A song import used to run the
 * detector synchronously on the main thread - a few hundred ms of hard block
 * exactly while the new block's placeholder should be animating. This hands
 * the channel data to a Worker (copied, not transferred: the AudioBuffer stays
 * usable for playback) and falls back to the synchronous path where Workers
 * are unavailable or fail to spin up.
 */
export function detectBeatsAsync(buffer: AudioBuffer): Promise<BeatDetection | null> {
  if (typeof Worker === 'undefined') return Promise.resolve(detectBeats(buffer))
  return new Promise((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./beatDetect.worker.ts', import.meta.url))
    } catch {
      resolve(detectBeats(buffer))
      return
    }
    const finish = (result: BeatDetection | null) => { worker.terminate(); resolve(result) }
    worker.onmessage = (e: MessageEvent<BeatDetection | null>) => finish(e.data)
    worker.onerror = () => finish(detectBeats(buffer))
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice())
    worker.postMessage({ channels, sampleRate: buffer.sampleRate }, channels.map((c) => c.buffer))
  })
}
