// A snap increment only helps if you can actually land on it: below this many
// pixels per step, the pointer can't hit the increment reliably and dragging
// zoomed-out drifts blocks off by a beat.
const MIN_SNAP_PX = 8

/**
 * Zoom-aware snap step for block dragging, in beats: the smallest musical unit
 * (beat, then 1/2/4 bars) that still spans a comfortable pixel size at the
 * current zoom. Zoomed in this is the usual beat snap; zoomed far out, blocks
 * land on bar boundaries instead.
 */
export function snapStepBeats(pixelsPerBeat: number, beatsPerBar: number): number {
  if (pixelsPerBeat >= MIN_SNAP_PX) return 1
  for (const bars of [1, 2]) {
    if (bars * beatsPerBar * pixelsPerBeat >= MIN_SNAP_PX) return bars * beatsPerBar
  }
  return 4 * beatsPerBar
}
