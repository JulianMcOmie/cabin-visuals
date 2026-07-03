import * as Tone from 'tone'
import { getPlayableUrl } from './audioSource'

// Decode-once buffer cache, keyed by clip ref. The SAME decoded AudioBuffer
// feeds the AudioEngine's players and (phase 3) the waveform peak extraction —
// one decode per ref, ever. Failures aren't cached, so a flaky network fetch
// can retry.

const bufferCache = new Map<string, Promise<AudioBuffer>>()

/** Decode a clip's bytes (cached). Pre-decoding on block insert keeps play() fast. */
export function getBuffer(ref: string): Promise<AudioBuffer> {
  let pending = bufferCache.get(ref)
  if (!pending) {
    pending = (async () => {
      const url = await getPlayableUrl(ref)
      const res = await fetch(url)
      const bytes = await res.arrayBuffer()
      const ctx = Tone.getContext().rawContext as AudioContext
      return await ctx.decodeAudioData(bytes)
    })()
    bufferCache.set(ref, pending)
    pending.catch(() => bufferCache.delete(ref))
  }
  return pending
}
