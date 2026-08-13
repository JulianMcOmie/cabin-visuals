// Monitoring speed: the transport's gear lever. Kept apart from playback.ts (and
// therefore from Tone) so the store, the UI and the tests can read it without
// pulling in an AudioContext - the same shape as loopRegion.ts.

/** Monitoring speeds. Slow enough to read a busy frame, still musical. */
export type PlaybackRate = 1 | 0.5 | 0.25

export const PLAYBACK_RATES: readonly PlaybackRate[] = [1, 0.5, 0.25]

/**
 * The tempo the Tone transport actually runs at while monitoring at `rate`.
 *
 * Slow monitoring is a TRANSPORT gear, not a document edit: the project's bpm is
 * untouched, so everything beat-addressed downstream - the visual engine, blocks,
 * automation, export - keeps its musical position and simply arrives later in
 * wall-clock time. Only this function and the audio players' playbackRate know
 * the transport is in a lower gear.
 */
export function effectiveBpm(bpm: number, rate: number): number {
  return bpm * rate
}
