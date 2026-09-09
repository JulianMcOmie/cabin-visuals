import type { Track } from '../../types'
import { getBuffer } from './waveform'
import { mixWaveformWindow, WAVEFORM_SECONDS, type WaveformQuery } from './waveformWindow'

/** Runs only on main. Decode is shared with playback, but no Player, transport,
 * or AudioContext scheduling is touched. Each RPC transfers exactly 4KiB. */
export async function readWaveformWindow(tracks: Record<string, Track>, query: WaveformQuery): Promise<Float32Array> {
  const all = Object.values(tracks), solo = all.some(t => t.solo)
  const seconds = query.beat * 60 / Math.max(1, query.bpm)
  const inputs = all.filter(t => !t.muted && (!solo || t.solo)).flatMap(t =>
    (t.audioBlocks ?? []).filter(block => {
      const offset = seconds - block.startBar * query.beatsPerBar * 60 / Math.max(1, query.bpm)
      return offset + WAVEFORM_SECONDS >= 0 && offset < block.trimEnd - block.trimStart
    }).map(block => ({ block, audible: true, volume: t.volume ?? 1 })))
  // Missing/failed clips contribute silence, as AudioEngine does; one bad
  // asset must not disable worker rendering for the rest of the document.
  const decoded = await Promise.all(inputs.map(async input => ({ ...input, buffer: await getBuffer(input.block.clipRef).catch(() => null) })))
  return mixWaveformWindow(decoded, query)
}
