// Pure peak-envelope math behind waveform.ts, kept free of Tone/DOM imports so
// it runs under node --test. Format everywhere: [min,max] interleaved per
// bucket, channels mixed, `data.length === buckets * 2`.

export interface PeakEnvelope {
  buckets: number
  data: Float32Array
}

/** The subset of AudioBuffer the extraction reads - lets tests hand in plain arrays. */
export interface PeakSource {
  length: number
  numberOfChannels: number
  getChannelData(channel: number): Float32Array
}

/** The cached level that serves a request: the smallest power of two ≥ `buckets`. */
export function peakLevelFor(buckets: number): number {
  const n = Math.max(1, Math.round(buckets))
  return 2 ** Math.ceil(Math.log2(n))
}

/** Walk every sample once and fold it into `buckets` [min,max] pairs. */
export function extractPeaks(buffer: PeakSource, buckets: number): PeakEnvelope {
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
  return { buckets: n, data }
}

/**
 * Derive a coarser envelope from a finer one: each coarse bucket is the min of
 * the mins / max of the maxes over the fine buckets it spans (the same
 * boundary rule `extractPeaks` uses over samples, applied to buckets). A
 * request at or above the fine resolution returns the fine envelope itself -
 * there is nothing finer to derive from.
 */
export function reducePeaks(fine: PeakEnvelope, buckets: number): PeakEnvelope {
  const n = Math.max(1, Math.round(buckets))
  if (n >= fine.buckets) return fine
  const F = fine.buckets
  const src = fine.data
  const data = new Float32Array(n * 2)
  for (let b = 0; b < n; b++) {
    const start = Math.floor((b / n) * F)
    const end = Math.max(start + 1, Math.floor(((b + 1) / n) * F))
    let min = 1
    let max = -1
    for (let i = start; i < end; i++) {
      const lo = src[i * 2]
      const hi = src[i * 2 + 1]
      if (lo < min) min = lo
      if (hi > max) max = hi
    }
    data[b * 2] = min
    data[b * 2 + 1] = max
  }
  return { buckets: n, data }
}
