/**
 * Tap-tempo math. Taps ACCUMULATE until reset (no idle timeout), and the
 * estimate is a least-squares fit of tap time against tap index rather than
 * (last - first) / (n - 1): the endpoint form hangs the whole answer on the two
 * sloppiest taps of a run (the first, before you have found the beat, and the
 * last), while the fit lets every tap vote, so the number settles as you go.
 * Pure + clock-free (timestamps come from the caller) so it is testable.
 */
export function tapTempoBpm(taps: readonly number[]): number | null {
  const n = taps.length
  if (n < 2) return null
  const meanI = (n - 1) / 2
  const meanT = taps.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (i - meanI) * (taps[i] - meanT)
    den += (i - meanI) ** 2
  }
  const msPerBeat = num / den
  if (!(msPerBeat > 0)) return null
  return 60000 / msPerBeat
}
