// The export island's one shared type. Export is an ACTION, not state: nothing
// here touches the project document (no schema bump) - settings live with the
// dialog and die with it (a localStorage nicety aside).

import { ASPECT_RATIO_IDS, frameSizeFor, type AspectRatioId } from '../aspectRatios'

export type ExportRangeMode = 'whole' | 'loop' | 'custom'

/** Output frame shape. Any of the shapes the editor can pin - see
 *  core/aspectRatios.ts. */
export type ExportAspect = AspectRatioId
export const EXPORT_ASPECTS = ASPECT_RATIO_IDS

/** What the export dialog offers, and it is deliberately only TWO cards:
 *  the shape you composed against (the viewport's pin, 16:9 when nothing is
 *  pinned) and 9:16, because the vertical cut is a second RELEASE of the same
 *  piece rather than a different composition. Choosing the shape belongs to
 *  the viewport, where you can see it; the dialog just confirms it. A viewport
 *  pinned to 9:16 pairs with 16:9 instead, so the picker is never one lonely
 *  card. First entry is the default. */
export function exportAspectChoices(pinned: AspectRatioId | 'fill'): [ExportAspect, ExportAspect] {
  const primary: ExportAspect = pinned === 'fill' ? '16:9' : pinned
  return primary === '9:16' ? ['9:16', '16:9'] : [primary, '9:16']
}

/** Rate control. 'bitrate' = fixed target (predictable size, but busy grainy
 *  frames get starved and macroblock). 'quality' = constant-quality quantizer
 *  mode: every frame gets the bits it needs and the size floats with content.
 *  'lossless' = quantizer mode at QP 0: quantization off as far as H.264
 *  allows (8-bit 4:2:0 remain), for the smooth bloom/gradient falloffs that
 *  band into visible layers at ANY real QP. Files get enormous. */
export type ExportRateControl = 'bitrate' | 'quality' | 'lossless'

/** A slice of the project in absolute beats, [startBeat, endBeat). */
export interface BeatRange {
  startBeat: number
  endBeat: number
}

export interface ExportSettings {
  /** Output size - independent of the editing window. width/height already
   *  encode the orientation; `aspect` is what the dialog's pickers key off. */
  width: number
  height: number
  aspect: ExportAspect
  fps: 30 | 60
  /** Off = skip the offline audio render entirely; video-only MP4. */
  includeAudio: boolean
  /** Video bitrate in bits/second (used when rateControl is 'bitrate'). */
  videoBitrate: number
  /** Encoder rate control - see ExportRateControl. */
  rateControl: ExportRateControl
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

/** The tiers, named by the SHORT edge they render at - the axis every aspect
 *  shares (see frameSizeFor). 16:9 lands on the canonical 3840×2160 /
 *  1920×1080 / 1280×720; 9:16 on those rotated. */
export const RESOLUTION_TIERS = [
  { label: '4K', shortEdge: 2160 },
  { label: '1080p', shortEdge: 1080 },
  { label: '720p', shortEdge: 720 },
] as const

/** Free-tier ceiling and the fallback tier the pickers land on. */
const FREE_TIER_SHORT_EDGE = 720

export const RESOLUTIONS = RESOLUTION_TIERS.map((t) => ({ label: t.label, ...frameSizeFor('16:9', t.shortEdge) }))

/** The tier list for an aspect, widest-first-tier order preserved. */
export function resolutionsFor(aspect: ExportAspect): { label: string; shortEdge: number; width: number; height: number }[] {
  return RESOLUTION_TIERS.map((t) => ({ label: t.label, shortEdge: t.shortEdge, ...frameSizeFor(aspect, t.shortEdge) }))
}

// Bitrate keys off the frame's SHORT edge - the axis the tiers are named for
// and the only one that's orientation- AND aspect-independent: 1080×1920,
// 1920×1080 and 2160×1080 are all "the 1080 tier". (Keying off the long edge
// worked while 16:9 and its rotation were the only shapes; a 2:1 1080p is
// 2160 wide and would have been charged the 4K rate.) Callers pass
// min(width, height).

/** Motion-friendly H.264 bitrates for each fixed output tier.
 *
 *  Deliberately ABOVE platform re-encode recommendations: our frames are
 *  near-worst-case for a fixed-bitrate encoder (full-frame animated grain in
 *  the final grade, HDR bloom halos, particle fields), so busy projects were
 *  visibly starved at the old tiers (12/35-50 Mbps) while simple ones looked
 *  fine. Headroom costs file size, never quality; the platform re-encode gets
 *  a cleaner source to work from. All values sit inside the H.264 High profile
 *  level ceilings picked by videoCodec below. */
export function defaultBitrate(shortEdge: number, fps: number): number {
  if (shortEdge >= 2160) return fps === 30 ? 60_000_000 : 80_000_000
  const base = shortEdge >= 1080 ? 20_000_000 : 12_000_000
  return fps === 30 ? Math.round(base * 0.75) : base
}

/** H.264 High profile levels: [level_idc, MaxFS in macroblocks, MaxMBPS].
 *  Only the rungs we can actually land on, lowest first - a level that's too
 *  low is a lie in the bitstream (players may refuse the file), and one that's
 *  needlessly high narrows the hardware that will decode it. */
const H264_LEVELS: readonly [number, number, number][] = [
  [42, 8_704, 522_240],      // 4.2 - up to 1080p60
  [51, 36_864, 983_040],     // 5.1 - 4K30
  [52, 36_864, 2_073_600],   // 5.2 - 4K60
  [60, 139_264, 4_177_920],  // 6.0 - wider-than-16:9 4K60 (e.g. 2:1 at 4320×2160)
]

/** H.264 High profile codec string for the selected frame size/rate: the
 *  lowest level whose frame-size AND macroblock-rate ceilings both fit.
 *  `minLevelIdc` floors the pick for configs whose BITRATE outruns the level
 *  the frame size alone would land on - QP-0 exports run 5-10x the level-4.2
 *  bitrate ceiling at 1080p60, and an encoder honoring a too-low level would
 *  quantize to fit it, silently undoing the whole point of the mode. */
export function videoCodec(width: number, height: number, fps: number, minLevelIdc = 0): string {
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16)
  const level =
    H264_LEVELS.find(([idc, maxFs, maxMbps]) => idc >= minLevelIdc && macroblocks <= maxFs && macroblocks * fps <= maxMbps)?.[0] ??
    H264_LEVELS[H264_LEVELS.length - 1][0]
  return `avc1.6400${level.toString(16)}`
}

export function defaultSettings(fileName: string): ExportSettings {
  return {
    width: 1920,
    height: 1080,
    aspect: '16:9',
    fps: 60,
    includeAudio: true,
    videoBitrate: defaultBitrate(1080, 60),
    rateControl: 'bitrate',
    fileName,
    watermark: false,
    rangeMode: 'whole',
    rangeFromBar: 1,
    rangeToBar: 1,
  }
}

/** The free-tier ceiling: 720p (no watermark - resolution is the only gate).
 *  Applied to settings at dialog-open AND at export-start, so a stale
 *  localStorage 1080p can't leak through. */
export function clampToFreeTier(s: ExportSettings): ExportSettings {
  return {
    ...s,
    ...frameSizeFor(s.aspect, FREE_TIER_SHORT_EDGE),
    videoBitrate: defaultBitrate(FREE_TIER_SHORT_EDGE, s.fps),
    watermark: false,
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
