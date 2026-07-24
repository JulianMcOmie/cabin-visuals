/** The zoom-adaptive ruler grid (Logic-style), shared by the Ruler's rendering
 *  and the playhead snap in both the main timeline and the MIDI editor - ONE
 *  place defines what subdivisions are visible at a given zoom. */
export interface RulerGrid {
  /** Numbered "major" lines sit every `majorBars` bars (a power of 2). */
  majorBars: number
  /** Minor tick interval (beats) - 4 per major span (beats when majors are
   *  single bars, the musical case). */
  minorBeats: number
  /** Faint 16th sub-tick interval (beats); null below the zoom threshold. */
  subBeats: number | null
  /** The smallest subdivision currently visible (beats). */
  smallestBeats: number
  /** Playhead snap: half the smallest visible subdivision. */
  playheadSnapBeats: number
}

/** Minimum spacing (px) between numbered bar lines before they thin 2x. */
const MIN_MAJOR_PX = 64
/** Beat width (px) at which faint 16th sub-ticks appear. */
const SUB_TICK_MIN_BEAT_PX = 48

export function computeRulerGrid(pixelsPerBeat: number, beatsPerBar: number, totalBars: number): RulerGrid {
  const barWidthPx = beatsPerBar * pixelsPerBeat
  let majorBars = 1
  while (majorBars < totalBars && majorBars * barWidthPx < MIN_MAJOR_PX) majorBars *= 2
  const majorBeats = majorBars * beatsPerBar
  const minorBeats = majorBars === 1 ? 1 : majorBeats / 4
  const subBeats = majorBars === 1 && pixelsPerBeat >= SUB_TICK_MIN_BEAT_PX ? 0.25 : null
  const smallestBeats = subBeats ?? minorBeats
  return { majorBars, minorBeats, subBeats, smallestBeats, playheadSnapBeats: smallestBeats / 2 }
}
