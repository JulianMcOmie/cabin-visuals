// Transport loop region, in absolute project beats. Ephemeral transport state
// (lives in TimeStore next to currentBeat) - never persisted.
export interface LoopRegion {
  startBeat: number
  endBeat: number
  enabled: boolean
}

// Regions shorter than this are inert - a degenerate drag must not trap the
// transport in a zero-length seek loop.
export const MIN_LOOP_LENGTH_BEATS = 0.25

/** True when a playing transport at `beat` should wrap back to the region start.
 *  The region only acts when playback reaches its end - a playhead before or
 *  inside the region plays normally. */
export function shouldLoopWrap(beat: number, region: LoopRegion | null): boolean {
  if (!region?.enabled) return false
  if (region.endBeat - region.startBeat < MIN_LOOP_LENGTH_BEATS) return false
  return beat >= region.endBeat
}
