// The export island's one shared type. Export is an ACTION, not state: nothing
// here touches the project document (no schema bump) - settings live with the
// dialog and die with it (a localStorage nicety aside).

export interface ExportSettings {
  /** Output size, fixed 16:9 - independent of the editing window. */
  width: number
  height: number
  fps: 30 | 60
  /** Off = skip the offline audio render entirely; video-only MP4. */
  includeAudio: boolean
  /** Video bitrate in bits/second. */
  videoBitrate: number
  /** Without extension; the muxer writes `${fileName}.mp4`. */
  fileName: string
  /** Free tier: burn the "Made with Cabin Visuals" mark into every frame.
   *  Derived from the user's plan at export time - never persisted. */
  watermark: boolean
}

export const RESOLUTIONS = [
  { label: '1080p', width: 1920, height: 1080 },
  { label: '720p', width: 1280, height: 720 },
] as const

/** 12 Mbps at 1080p60 reads clean for motion-heavy visuals; scale down with area/rate. */
export function defaultBitrate(width: number, fps: number): number {
  const base = width >= 1920 ? 12_000_000 : 8_000_000
  return fps === 30 ? Math.round(base * 0.75) : base
}

export function defaultSettings(fileName: string): ExportSettings {
  return {
    width: 1920,
    height: 1080,
    fps: 60,
    includeAudio: true,
    videoBitrate: defaultBitrate(1920, 60),
    fileName,
    watermark: true,
  }
}

/** The free-tier ceiling: 720p, watermarked. Applied to settings at dialog-open
 *  AND at export-start, so a stale localStorage 1080p can't leak through. */
export function clampToFreeTier(s: ExportSettings): ExportSettings {
  return {
    ...s,
    width: 1280,
    height: 720,
    videoBitrate: defaultBitrate(1280, s.fps),
    watermark: true,
  }
}

/** Everything the frame loop needs to know about time, derived once up front.
 *  beat(i) = i · bpm / (60 · fps) - pure arithmetic, no wall clock anywhere. */
export interface ExportTimebase {
  bpm: number
  totalBeats: number
  durationSec: number
  frameCount: number
}

export function makeTimebase(bpm: number, beatsPerBar: number, totalBars: number, fps: number): ExportTimebase {
  const totalBeats = totalBars * beatsPerBar
  const durationSec = (totalBeats * 60) / bpm
  return { bpm, totalBeats, durationSec, frameCount: Math.ceil(durationSec * fps) }
}
