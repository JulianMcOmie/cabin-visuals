/** Seconds → `m:ss` (floored, no hours). Negative input reads as 0:00. */
export function formatMinSec(seconds: number): string {
  const s = Math.max(0, seconds)
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}
