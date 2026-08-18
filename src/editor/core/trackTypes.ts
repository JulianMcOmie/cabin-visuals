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
//
// Two rules the rows always keep: the BOTTOM row is the lane's min and the TOP
// row is its max, and the steps between them are EVEN. Integer snapping used to
// be a Math.round on top of whatever spread the rows already had, which broke
// both (a 1..12 count lane labelled two neighbouring rows "7" and stepped
// 3-2-3-2 across a five-row range) - so INT now derives the row count instead:
// the rows ARE the whole numbers, counting up from the min.

export type AutomationSpreadCurve = 'linear' | 'fineLow' | 'fineHigh' | 'sCurve'

export interface AutomationRange {
  /** Value at the BOTTOM row (defaults to the param's min). MAY sit outside the
   *  param's own bounds - see automationValueBounds. */
  min?: number
  /** Value at the TOP row (defaults to the param's max). May sit outside the
   *  param's own bounds. */
  max?: number
  /** Number of rows, 2..49 - rows sit at the BOTTOM of the pitch span. Ignored
   *  while `integer` is set, which derives the count from the value range. */
  rows?: number
  /** Rows are the whole numbers of the range: the count and the spread curve
   *  are derived, so every step is the same whole number of units. */
  integer?: boolean
  /** How values spread across the rows (default linear; ignored under `integer`,
   *  whose steps are even by definition). */
  curve?: AutomationSpreadCurve
}

export const AUTOMATION_MAX_ROWS = AUTOMATION_PITCH_MAX - AUTOMATION_PITCH_MIN + 1

/**
 * The lane's own value bounds: the range config's min/max where set, else the
 * param's own. Deliberately NOT clamped to the param's [min, max] - a lane is
 * allowed to aim past what the instrument declares (the panel's MIN/MAX knobs
 * travel one full param span beyond each end), and `automationOutputBounds`
 * (core/visual/automation.ts) widens this further when the AMOUNT gain boosts.
 */
export function automationValueBounds(
  range: AutomationRange | undefined,
  paramMin: number,
  paramMax: number,
): { min: number; max: number } {
  return { min: range?.min ?? paramMin, max: range?.max ?? paramMax }
}

/** The whole-number grid an INT lane counts on: the rows are `lo`, `lo + step`,
 *  … up to `hi`. `step` is 1 wherever the span fits in the available rows,
 *  otherwise the smallest wider step that still lands exactly on both ends
 *  (-360..360 counts by 15). A span with no such divisor near the floor (a
 *  prime) keeps the narrowest fitting step and spends its LAST row on the max,
 *  so the top row is still the max at the cost of one short gap. */
export function automationIntegerGrid(
  min: number,
  max: number,
): { lo: number; hi: number; step: number; rows: number } {
  // Round INWARD so the grid never invents a value outside the lane's range;
  // a range too narrow to hold two whole numbers rounds outward instead (the
  // pitch mapping needs at least two rows).
  let lo = Math.ceil(min - 1e-9)
  let hi = Math.floor(max + 1e-9)
  if (hi <= lo) {
    lo = Math.floor(min)
    hi = Math.max(lo + 1, Math.ceil(max))
  }
  const span = hi - lo
  const minStep = Math.max(1, Math.ceil(span / (AUTOMATION_MAX_ROWS - 1)))
  let step = minStep
  if (minStep > 1) {
    // Search a little past the floor for a step that divides the span exactly.
    for (let s = minStep; s <= minStep * 4 && s <= span; s++) {
      if (span % s === 0) { step = s; break }
    }
  }
  const whole = Math.floor(span / step)
  return { lo, hi, step, rows: whole + 1 + (whole * step < span ? 1 : 0) }
}

/** How many rows a lane's config asks for: derived from the whole-number grid
 *  under INT, the explicit count otherwise, and the full pitch span when the
 *  lane carries no config. */
export function automationRowCount(
  range: AutomationRange | undefined,
  paramMin: number,
  paramMax: number,
): number {
  if (!range) return AUTOMATION_MAX_ROWS
  if (range.integer) {
    const bounds = automationValueBounds(range, paramMin, paramMax)
    return automationIntegerGrid(bounds.min, bounds.max).rows
  }
  if (!range.rows) return AUTOMATION_MAX_ROWS
  return Math.max(2, Math.min(AUTOMATION_MAX_ROWS, Math.round(range.rows)))
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
 *  pitchToValue. Values always land inside the LANE's [min, max] - which is the
 *  param's own unless the lane was pointed past it (automationValueBounds). */
export function pitchToValueRanged(
  range: AutomationRange | undefined,
  pitch: number,
  paramMin: number,
  paramMax: number,
): number {
  if (!range) return pitchToValue(pitch, paramMin, paramMax)
  const { min: lo, max: hi } = automationValueBounds(range, paramMin, paramMax)
  if (range.integer) {
    // Row k IS the k-th whole number of the grid; the last row is the max, so a
    // grid whose step doesn't divide the span still tops out exactly on it.
    const grid = automationIntegerGrid(lo, hi)
    const k = Math.max(0, Math.min(grid.rows - 1, Math.round(pitch) - AUTOMATION_PITCH_MIN))
    return k === grid.rows - 1 ? grid.hi : grid.lo + k * grid.step
  }
  const span = automationRowCount(range, paramMin, paramMax) - 1
  const t = span > 0 ? clamp01((pitch - AUTOMATION_PITCH_MIN) / span) : 0
  return lo + spreadFraction(t, range.curve) * (hi - lo)
}
