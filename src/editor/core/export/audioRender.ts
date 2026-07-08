// The audio half of export: the whole track rendered in ONE offline pass -
// no frame stepping, no realtime. Every audible block schedules its clip slice
// into an OfflineAudioContext through the same blockPlacement() the live
// AudioEngine arms with (from beat 0 - the trivial case), under the same 0.85
// master gain, so the file sounds exactly like the editor. The rendered buffer
// is AAC-encoded into the muxer; A/V sync is arithmetic, not synchronization -
// both timelines derive from the same bpm.

import type { Track } from '../../types'
import { getBuffer } from '../audio/waveform'
import { blockPlacement } from '../audio/placement'
import type { Mp4Writer } from './mux'

export const EXPORT_AUDIO_BITRATE = 192_000

/**
 * Mix every audible audio block into one stereo buffer spanning the project.
 * Mute/solo fold in exactly as the live engine's setBlocks does. Returns null
 * when there is nothing audible to render (caller emits a video-only file).
 */
export async function renderAudioTrack(
  audioTracks: Track[],
  bpm: number,
  beatsPerBar: number,
  durationSec: number,
): Promise<AudioBuffer | null> {
  const anySolo = audioTracks.some((t) => t.solo)
  const blocks = audioTracks
    .filter((t) => !t.muted && !(anySolo && !t.solo))
    .flatMap((t) => t.audioBlocks ?? [])
  if (blocks.length === 0 || durationSec <= 0) return null

  // Decode first (cached - playback has usually already paid this).
  const buffers = await Promise.all(blocks.map((b) => getBuffer(b.clipRef)))

  const sampleRate = 48_000
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(durationSec * sampleRate)), sampleRate)
  const master = ctx.createGain()
  master.gain.value = 0.85 // the live engine's headroom - same loudness as the editor
  master.connect(ctx.destination)

  blocks.forEach((block, i) => {
    const p = blockPlacement(block, 0, bpm, beatsPerBar)
    if (!p) return
    const src = ctx.createBufferSource()
    src.buffer = buffers[i] // resampled by the source node if rates differ
    src.connect(master)
    src.start(p.delaySec, p.offset, p.duration)
  })

  return ctx.startRendering()
}

/** AAC-encode a rendered buffer into the writer's audio track. */
export async function encodeAudioIntoWriter(buffer: AudioBuffer, writer: Mp4Writer): Promise<void> {
  let error: Error | null = null
  const encoder = new AudioEncoder({
    output: (chunk, meta) => writer.addAudioChunk(chunk, meta),
    error: (e) => { error = e instanceof Error ? e : new Error(String(e)) },
  })
  encoder.configure({
    codec: 'mp4a.40.2', // AAC-LC
    sampleRate: buffer.sampleRate,
    numberOfChannels: 2,
    bitrate: EXPORT_AUDIO_BITRATE,
  })

  const ch0 = buffer.getChannelData(0)
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0
  const CHUNK = 4800 // 100ms per AudioData keeps allocations small
  for (let off = 0; off < buffer.length; off += CHUNK) {
    if (error) break
    const n = Math.min(CHUNK, buffer.length - off)
    const planar = new Float32Array(n * 2)
    planar.set(ch0.subarray(off, off + n), 0)
    planar.set(ch1.subarray(off, off + n), n)
    const data = new AudioData({
      format: 'f32-planar',
      sampleRate: buffer.sampleRate,
      numberOfFrames: n,
      numberOfChannels: 2,
      timestamp: Math.round((off / buffer.sampleRate) * 1e6),
      data: planar,
    })
    encoder.encode(data)
    data.close()
  }
  await encoder.flush()
  encoder.close()
  if (error) throw error
}
