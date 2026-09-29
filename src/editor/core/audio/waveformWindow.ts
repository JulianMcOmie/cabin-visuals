import type { AudioBlock } from '../../types'

export const WAVEFORM_SAMPLES = 1024
export const WAVEFORM_SECONDS = 1 / 50
export interface WaveformQuery { beat: number; bpm: number; beatsPerBar: number }
export interface WaveformInput {
  block: AudioBlock
  audible: boolean
  volume: number
  buffer: Pick<AudioBuffer, 'numberOfChannels' | 'sampleRate' | 'length' | 'getChannelData'> | null
}

/** Shared by live audio inspection and worker-window transport. No audio clock,
 * resampling drift or rolling analyser state: each sample is beat-addressed. */
export function mixWaveformWindow(inputs: readonly WaveformInput[], query: WaveformQuery, count = WAVEFORM_SAMPLES): Float32Array {
  count = Math.max(2, Math.round(count))
  const out = new Float32Array(count)
  const projectSec = query.beat * 60 / Math.max(1, query.bpm)
  for (const { block, audible, volume, buffer } of inputs) {
    if (!audible || !buffer) continue
    const offset = projectSec - block.startBar * query.beatsPerBar * 60 / Math.max(1, query.bpm)
    if (offset + WAVEFORM_SECONDS < 0 || offset >= block.trimEnd - block.trimStart) continue
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
    for (let i = 0; i < count; i++) {
      const clipSec = block.trimStart + offset + i / (count - 1) * WAVEFORM_SECONDS
      if (clipSec < block.trimStart || clipSec >= block.trimEnd) continue
      const frame = Math.min(buffer.length - 1, Math.max(0, Math.floor(clipSec * buffer.sampleRate)))
      let sample = 0
      for (const channel of channels) sample += channel[frame]
      out[i] += sample / Math.max(1, channels.length) * 0.85 * volume
    }
  }
  return out
}
