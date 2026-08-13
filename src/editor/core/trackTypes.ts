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

// ── Per-lane row spread (Track.automationRange) ──
// A lane may reshape how its pitch rows spread onto the value range: a value
// SUB-range, a row COUNT (rows occupy the bottom of the pitch span), INTEGER
// snapping, and a spread CURVE. Absent = the historical full-span linear
// mapping above, bit-identical for every pre-existing save. The engine
// (extraction) and the editor (row labels) both read the lane's config through
// pitchToValueRanged, so they can never disagree about what a note means.

export type AutomationSpreadCurve = 'linear' | 'fineLow' | 'fineHigh' | 'sCurve'

export interface AutomationRange {
  /** Value at the BOTTOM row (defaults to the param's min). */
  min?: number
  /** Value at the TOP row (defaults to the param's max). */
  max?: number
  /** Number of rows, 2..49 - rows sit at the BOTTOM of the pitch span. */
  rows?: number
  /** Snap every row's value to a whole number. */
  integer?: boolean
  /** How values spread across the rows (default linear). */
  curve?: AutomationSpreadCurve
}

export const AUTOMATION_MAX_ROWS = AUTOMATION_PITCH_MAX - AUTOMATION_PITCH_MIN + 1

/** The highest pitch that is a row under this config (rows fill upward from
 *  AUTOMATION_PITCH_MIN). */
export function automationTopPitch(range?: AutomationRange): number {
  if (!range?.rows) return AUTOMATION_PITCH_MAX
  const rows = Math.max(2, Math.min(AUTOMATION_MAX_ROWS, Math.round(range.rows)))
  return AUTOMATION_PITCH_MIN + rows - 1
}

/** The spread curve on a 0..1 fraction: fineLow squares (more resolution near
 *  the min), fineHigh mirrors it, sCurve is smoothstep. */
export function spreadFraction(t: number, curve?: AutomationSpreadCurve): number {
  switch (curve) {
    case 'fineLow': return t * t
    case 'fineHigh': return 1 - (1 - t) * (1 - t)
    case 'sCurve': return t * t * (3 - 2 * t)
    default: return t
  }
}

/** pitchToValue with a lane's row-spread config. Absent config = identical to
 *  pitchToValue. Values always land inside the param's own [min, max]. */
export function pitchToValueRanged(
  range: AutomationRange | undefined,
  pitch: number,
  paramMin: number,
  paramMax: number,
): number {
  if (!range) return pitchToValue(pitch, paramMin, paramMax)
  const clampParam = (v: number) => Math.max(paramMin, Math.min(paramMax, v))
  const lo = clampParam(range.min ?? paramMin)
  const hi = clampParam(range.max ?? paramMax)
  const top = automationTopPitch(range)
  const span = top - AUTOMATION_PITCH_MIN
  const t = span > 0 ? clamp01((pitch - AUTOMATION_PITCH_MIN) / span) : 0
  let value = lo + spreadFraction(t, range.curve) * (hi - lo)
  if (range.integer) value = Math.round(value)
  return clampParam(value)
}
