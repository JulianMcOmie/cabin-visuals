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

async function probe(): Promise<ExportSupport> {
  if (typeof VideoEncoder === 'undefined') {
    return { ok: false, audioOk: false, reason: 'Video export requires Chrome (WebCodecs).' }
  }
  try {
    const video = await VideoEncoder.isConfigSupported(VIDEO_CONFIG)
    if (!video.supported) {
      return { ok: false, audioOk: false, reason: 'No H.264 encoder available in this browser.' }
    }
    const audioOk =
      typeof AudioEncoder !== 'undefined' &&
      (await AudioEncoder.isConfigSupported(AUDIO_CONFIG)).supported === true
    return { ok: true, audioOk }
  } catch {
    return { ok: false, audioOk: false, reason: 'Video export requires Chrome (WebCodecs).' }
  }
}
