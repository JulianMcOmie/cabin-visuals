/**
 * Return the horizontal scroll position that keeps an absolute timeline beat
 * at the same viewport x while the timeline's pixels-per-beat changes.
 *
 * Any fixed content offset (for example a frozen label gutter) cancels out of
 * the calculation, so this works for both the tracks timeline and piano roll.
 */
export function scrollLeftAroundBeat(
  scrollLeft: number,
  beat: number,
  previousPixelsPerBeat: number,
  nextPixelsPerBeat: number,
) {
  return Math.max(0, scrollLeft + beat * (nextPixelsPerBeat - previousPixelsPerBeat))
}
