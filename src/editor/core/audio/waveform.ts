import * as Tone from 'tone'
import { fetchAudioBytes } from './audioSource'
import { extractPeaks, peakLevelFor, reducePeaks, type PeakEnvelope } from './peaks'

// Decode-once buffer cache, keyed by clip ref. The SAME decoded AudioBuffer
// feeds the AudioEngine's players and (phase 3) the waveform peak extraction -
// one decode per ref, ever. Failures aren't cached, so a flaky network fetch
// can retry.

const bufferCache = new Map<string, Promise<AudioBuffer>>()

/** Decode a clip's bytes (cached). Pre-decoding on block insert keeps play() fast. */
export function getBuffer(ref: string): Promise<AudioBuffer> {
  let pending = bufferCache.get(ref)
  if (!pending) {
    pending = (async () => {
      const bytes = await fetchAudioBytes(ref)
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
// per bucket, channels mixed. The samples are walked ONCE per clip, at
// FINE_PEAK_BUCKETS (the finest any caller asks for - AudioTrackDetail's deep
// zoom tops out at 2^18); every coarser request is a reduction of that fine
// array (min of mins / max of maxes over bucket groups), cached per level. The
// old scheme re-walked every sample for each finer request - a 30-80ms
// main-thread pass per zoom notch, and again per width during a sync drag.

export const BASE_PEAK_BUCKETS = 1000
export const FINE_PEAK_BUCKETS = 1 << 18

interface PeakLevels {
  fine: Promise<PeakEnvelope>
  levels: Map<number, PeakEnvelope>
}

const peaksCache = new Map<string, PeakLevels>()

/** Peak envelope at ≥ `buckets` resolution (or the clip's finest, if that is
 *  coarser). Levels are quantized UP to a power of two, so a width that changes
 *  every pointermove (AudioBlock during a tempo drag) hits at most ~18 cached
 *  levels per clip instead of minting one per pixel. Same [min,max]-interleaved
 *  shape at every level; callers read `buckets` back. */
export async function getPeaks(ref: string, buckets = BASE_PEAK_BUCKETS): Promise<PeakEnvelope> {
  let entry = peaksCache.get(ref)
  if (!entry) {
    // A clip shorter than the fine bucket count has nothing finer to offer
    // than one bucket per sample.
    const fine = getBuffer(ref).then((buffer) => extractPeaks(buffer, Math.min(FINE_PEAK_BUCKETS, Math.max(1, buffer.length))))
    entry = { fine, levels: new Map() }
    peaksCache.set(ref, entry)
    // Failures aren't cached (matches getBuffer), so a flaky fetch can retry.
    fine.catch(() => { if (peaksCache.get(ref) === entry) peaksCache.delete(ref) })
  }
  const fine = await entry.fine
  const n = peakLevelFor(buckets)
  if (n >= fine.buckets) return fine
  let level = entry.levels.get(n)
  if (!level) {
    level = reducePeaks(fine, n)
    entry.levels.set(n, level)
  }
  return level
}
