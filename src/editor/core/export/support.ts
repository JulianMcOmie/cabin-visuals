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
 * Encode ONE real frame at the GIVEN config and confirm the chunk metadata
 * carries a decoderConfig with a `description` (the avcC record). Neither
 * isConfigSupported nor a token small-frame encode is a sufficient gate:
 * Firefox answers "supported" for H.264, and its SOFTWARE encoder (used at
 * tiny sizes) even provides the metadata - but the hardware encoder it picks
 * at real output sizes does not, and mp4-muxer builds the file header from
 * it, so the export dies at finalize with a null decoderConfig. The check is
 * only trustworthy at the exact config that will actually encode, which is
 * why runExport re-runs it with the chosen settings before rendering.
 */
export async function encoderProvidesMp4Metadata(config: VideoEncoderConfig): Promise<boolean> {
  let meta: EncodedVideoChunkMetadata | undefined
  const encoder = new VideoEncoder({
    output: (_chunk, m) => { meta ??= m },
    error: () => { /* flush() rejects; the catch below answers false */ },
  })
  try {
    encoder.configure(config)
    const canvas = new OffscreenCanvas(config.width, config.height)
    canvas.getContext('2d')?.fillRect(0, 0, 1, 1) // a context so VideoFrame has pixels to read
    const frame = new VideoFrame(canvas, { timestamp: 0, duration: 33_333 })
    encoder.encode(frame, { keyFrame: true })
    frame.close()
    await encoder.flush()
    return !!meta?.decoderConfig?.description
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
    if (!(await encoderProvidesMp4Metadata({ ...VIDEO_CONFIG, latencyMode: 'quality' }))) {
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
