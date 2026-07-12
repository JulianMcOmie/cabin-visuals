// Track semantics shared by the UI and the engines - promoted out of the visual
// engine because none of this is about rendering.

// ── Automation lane encoding ──
// An automation lane encodes its value in each note's PITCH, mapped linearly across
// this pitch span onto the target param's [min, max]. A wide span → fine resolution;
// the value editor labels the same rows by value. Shared by the piano roll (row
// labels) and the visual engine (keyframe extraction) - document semantics, not
// rendering, hence promoted here.
export const AUTOMATION_PITCH_MIN = 36
export const AUTOMATION_PITCH_MAX = 84

const clamp01 = (t: number) => Math.max(0, Math.min(1, t))

/** Map a note pitch to a param value in [paramMin, paramMax]. */
export function pitchToValue(pitch: number, paramMin: number, paramMax: number): number {
  const span = AUTOMATION_PITCH_MAX - AUTOMATION_PITCH_MIN
  const t = span > 0 ? clamp01((pitch - AUTOMATION_PITCH_MIN) / span) : 0
  return paramMin + t * (paramMax - paramMin)
}

/** Inverse of pitchToValue - the pitch a value lands on (for placing/reading notes). */
export function valueToPitch(value: number, paramMin: number, paramMax: number): number {
  const t = paramMax === paramMin ? 0 : clamp01((value - paramMin) / (paramMax - paramMin))
  return Math.round(AUTOMATION_PITCH_MIN + t * (AUTOMATION_PITCH_MAX - AUTOMATION_PITCH_MIN))
}
