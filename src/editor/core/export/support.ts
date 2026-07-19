// The capability gate. Export is Chrome-first by decision: WebCodecs hardware
// encoders or nothing (no MediaRecorder fallback - it records realtime and
// drops frames, which defeats the whole recompute-per-frame design). The
// Export button reads this once and disables with a reason elsewhere.

export interface ExportSupport {
  ok: boolean
  /** Video works but no AAC encoder - offer video-only export instead of blocking. */
  audioOk: boolean
  reason?: string
}

// H.264 High 4.2 - comfortably covers 1080p60.
const VIDEO_CONFIG: VideoEncoderConfig = {
  codec: 'avc1.64002a',
  width: 1920,
  height: 1080,
  framerate: 60,
  bitrate: 12_000_000,
}

const AUDIO_CONFIG: AudioEncoderConfig = {
  codec: 'mp4a.40.2', // AAC-LC
  sampleRate: 48_000,
  numberOfChannels: 2,
  bitrate: 192_000,
}

let cached: Promise<ExportSupport> | null = null

export function isExportSupported(): Promise<ExportSupport> {
  return (cached ??= probe())
}

/**
 * Encode a few real frames at the GIVEN config and confirm the encoder's
 * output satisfies what mp4-muxer actually requires of a track:
 *
 *  1. Chunk metadata carrying a decoderConfig with a `description` (the avcC
 *     record the MP4 header is built from), and
 *  2. a FIRST chunk with timestamp 0 - the muxer hard-rejects a non-zero
 *     first DTS, and because that first chunk is also the one carrying the
 *     decoderConfig, a single rejection cascades into "decoderConfig is null"
 *     at finalize (the error users actually see).
 *
 * isConfigSupported alone answers neither question: Firefox reports H.264 as
 * supported, then (per config/encoder class) omits the metadata or stamps the
 * first chunk one frame-duration late. The probe is only trustworthy at the
 * exact config that will actually encode - browsers pick different encoders
 * per resolution - which is why runExport re-runs it with the chosen settings
 * before rendering. Kept to what the muxer provably needs; the durable fix
 * for non-Chrome browsers is a muxer that tolerates their output (mediabunny).
 */
export async function encoderProducesMuxableChunks(config: VideoEncoderConfig): Promise<boolean> {
  let meta: EncodedVideoChunkMetadata | undefined
  let firstTimestamp: number | null = null
  const encoder = new VideoEncoder({
    output: (chunk, m) => {
      meta ??= m
      firstTimestamp ??= chunk.timestamp
    },
    error: () => { /* flush() rejects; the catch below answers false */ },
  })
  try {
    encoder.configure(config)
    const canvas = new OffscreenCanvas(config.width, config.height)
    canvas.getContext('2d')?.fillRect(0, 0, 1, 1) // a context so VideoFrame has pixels to read
    // Three frames, timestamped exactly like the real session (i/fps), so
    // reordering or off-by-one-frame stamping shows up here and not mid-export.
    const fps = config.framerate ?? 30
    for (let i = 0; i < 3; i++) {
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((i * 1e6) / fps),
        duration: Math.round(1e6 / fps),
      })
      encoder.encode(frame, { keyFrame: i === 0 })
      frame.close()
    }
    await encoder.flush()
    return !!meta?.decoderConfig?.description && firstTimestamp === 0
  } catch {
    return false
  } finally {
    try {
      if (encoder.state !== 'closed') encoder.close()
    } catch { /* already closed */ }
  }
}

async function probe(): Promise<ExportSupport> {
  if (typeof VideoEncoder === 'undefined') {
    return { ok: false, audioOk: false, reason: 'Video export requires Chrome (WebCodecs).' }
  }
  try {
    const video = await VideoEncoder.isConfigSupported(VIDEO_CONFIG)
    if (!video.supported) {
      return { ok: false, audioOk: false, reason: 'No H.264 encoder available in this browser.' }
    }
    // Probe at the default export shape (1080p60, quality mode) so the gate
    // exercises the same encoder class a real export will engage.
    if (!(await encoderProducesMuxableChunks({ ...VIDEO_CONFIG, latencyMode: 'quality' }))) {
      return { ok: false, audioOk: false, reason: 'Video export requires Chrome (WebCodecs).' }
    }
    const audioOk =
      typeof AudioEncoder !== 'undefined' &&
      (await AudioEncoder.isConfigSupported(AUDIO_CONFIG)).supported === true
    return { ok: true, audioOk }
  } catch {
    return { ok: false, audioOk: false, reason: 'Video export requires Chrome (WebCodecs).' }
  }
}
