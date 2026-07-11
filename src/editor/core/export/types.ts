// The export island's one shared type. Export is an ACTION, not state: nothing
// here touches the project document (no schema bump) - settings live with the
// dialog and die with it (a localStorage nicety aside).

export type ExportRangeMode = 'whole' | 'loop' | 'custom'

/** A slice of the project in absolute beats, [startBeat, endBeat). */
export interface BeatRange {
  startBeat: number
  endBeat: number
}

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
  /** Which slice to export. 'loop' resolves the transport loop region at
   *  export time; 'custom' uses the bar bounds below. */
  rangeMode: ExportRangeMode
  /** Custom range in bars, 1-indexed, BOTH ends inclusive: 2..4 = bars 2,3,4. */
  rangeFromBar: number
  rangeToBar: number
}

/** Resolve the settings' range choice to absolute beats; null = whole project.
 *  Custom bars clamp to [1, totalBars] with toBar >= fromBar (min one bar).
 *  A missing or degenerate loop region resolves to null, so a stale 'loop'
 *  choice degrades to a full export - callers surface the fallback. */
export function resolveExportRange(
  settings: Pick<ExportSettings, 'rangeMode' | 'rangeFromBar' | 'rangeToBar'>,
  beatsPerBar: number,
  totalBars: number,
  loopRegion: BeatRange | null,
): BeatRange | null {
  if (settings.rangeMode === 'custom') {
    const fromBar = Math.min(Math.max(Math.round(settings.rangeFromBar), 1), totalBars)
    const toBar = Math.min(Math.max(Math.round(settings.rangeToBar), fromBar), totalBars)
    return { startBeat: (fromBar - 1) * beatsPerBar, endBeat: toBar * beatsPerBar }
  }
  if (settings.rangeMode === 'loop' && loopRegion) {
    const totalBeats = totalBars * beatsPerBar
    const startBeat = Math.min(Math.max(loopRegion.startBeat, 0), totalBeats)
    const endBeat = Math.min(Math.max(loopRegion.endBeat, startBeat), totalBeats)
    if (endBeat > startBeat) return { startBeat, endBeat }
  }
  return null
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
    rangeMode: 'whole',
    rangeFromBar: 1,
    rangeToBar: 1,
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
 *  beat(i) = startBeat + i · bpm / (60 · fps) - pure arithmetic, no wall clock
 *  anywhere. Media timestamps stay frame-index based (file-local, first frame
 *  at 0); only the beat the renderer is asked about shifts with the range. */
export interface ExportTimebase {
  bpm: number
  /** Absolute beat of exported frame 0; 0 for a whole-project export. */
  startBeat: number
  /** Beats in the exported span, not the whole project. */
  totalBeats: number
  durationSec: number
  frameCount: number
}

export function makeTimebase(
  bpm: number,
  beatsPerBar: number,
  totalBars: number,
  fps: number,
  range?: BeatRange | null,
): ExportTimebase {
  const projectBeats = totalBars * beatsPerBar
  const startBeat = range ? Math.min(Math.max(range.startBeat, 0), projectBeats) : 0
  const endBeat = range ? Math.min(Math.max(range.endBeat, startBeat), projectBeats) : projectBeats
  const totalBeats = endBeat - startBeat
  const durationSec = (totalBeats * 60) / bpm
  return { bpm, startBeat, totalBeats, durationSec, frameCount: Math.ceil(durationSec * fps) }
}
