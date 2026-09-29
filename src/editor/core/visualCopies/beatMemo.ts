/**
 * One-slot memo keyed on the beat, for the part of a definition's `apply` that
 * depends on (beat, settings, notes) alone.
 *
 * `apply` runs once per COPY per frame, and the note walk most movers do there
 * - every burst launched so far, every held drift note, the return rows - is
 * the same answer for all N copies at that beat, so a 19×19 grid under a
 * Motion mover walked its notes 361 times a frame. Settings and notes are
 * fixed for the life of the resolve closure (an automated knob re-resolves
 * into a new closure, see resolve.ts), so the beat is the whole key.
 *
 * Pattern copies under a Stagger arrive at their own clocks, so the slot just
 * recomputes on every change of beat - never wrong, only un-memoized, the same
 * way the resolver's own one-slot per-beat memos degrade.
 *
 * The memoized value is SHARED across the copies of a frame: callers must
 * treat it as read-only (compose it into a fresh matrix, never `.multiply`
 * onto it).
 */
export function memoByBeat<T>(compute: (beat: number) => T): (beat: number) => T {
  let has = false
  let memoBeat = 0
  let memo: T
  return (beat) => {
    if (!has || !Object.is(beat, memoBeat)) {
      has = true
      memoBeat = beat
      memo = compute(beat)
    }
    return memo
  }
}
