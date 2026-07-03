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

// ── Peaks ──
// Size-independent min/max envelope over the WHOLE clip, [min,max] interleaved
// per bucket, channels mixed. Base resolution serves most widths; when a block
// is drawn wider (deep zoom) the caller asks for more buckets and we re-extract
// from the cached buffer — a cheap array pass, never a re-decode.

export const BASE_PEAK_BUCKETS = 1000

const peaksCache = new Map<string, { buckets: number; data: Float32Array }>()

/** Peak envelope at ≥ `buckets` resolution (a finer cached array is reused). */
export async function getPeaks(ref: string, buckets = BASE_PEAK_BUCKETS): Promise<{ buckets: number; data: Float32Array }> {
  const cached = peaksCache.get(ref)
  if (cached && cached.buckets >= buckets) return cached
  const buffer = await getBuffer(ref)
  const n = Math.max(1, Math.round(buckets))
  const data = new Float32Array(n * 2)
  const frames = buffer.length
  const channels = buffer.numberOfChannels
  for (let b = 0; b < n; b++) {
    const start = Math.floor((b / n) * frames)
    const end = Math.max(start + 1, Math.floor(((b + 1) / n) * frames))
    let min = 1
    let max = -1
    for (let c = 0; c < channels; c++) {
      const ch = buffer.getChannelData(c)
      for (let i = start; i < end; i++) {
        const v = ch[i]
        if (v < min) min = v
        if (v > max) max = v
      }
    }
    data[b * 2] = min
    data[b * 2 + 1] = max
  }
  const entry = { buckets: n, data }
  peaksCache.set(ref, entry)
  return entry
}
