import type { ResolvedNote } from '../visual/types'

/** The existing positive X/Y/Z pitches. Direction alternates per axis here;
 * pitch selects an axis, never a position or an explicit direction. */
export const DANCE_PITCHES = [60, 62, 64] as const
export const DANCE_EVENT_EPSILON = 1e-6

export interface DanceSegment {
  readonly start: number
  readonly end: number
  /** Position polynomial in normalized segment time, ascending powers. */
  readonly coefficients: readonly [number, number, number, number, number, number]
}
export interface DanceAxisCurve {
  readonly beats: readonly number[]
  readonly segments: readonly DanceSegment[]
}
export type DanceCurves = readonly [DanceAxisCurve, DanceAxisCurve, DanceAxisCurve]

/** Note arrays are immutable resolver snapshots. Knob automation re-resolves
 * entries with the same array: retain geometry independently of amplitudes. */
const curvesByNotes = new WeakMap<readonly ResolvedNote[], DanceCurves>()

export function prepareDanceCurves(notes: readonly ResolvedNote[]): DanceCurves {
  const cached = curvesByNotes.get(notes)
  if (cached) return cached
  const times: [number[], number[], number[]] = [[], [], []]
  for (const note of notes) {
    const axis = DANCE_PITCHES.findIndex(pitch => pitch === note.pitch)
    // A clipped-away onset must not acquire a new crossing at the clip edge.
    if (axis < 0 || !Number.isFinite(note.beat) ||
        note.beat < note.blockStartBeat || note.beat >= note.blockEndBeat) continue
    times[axis].push(note.beat)
  }
  const curves = times.map(buildAxisCurve) as unknown as DanceCurves
  curvesByNotes.set(notes, curves)
  return curves
}

/** Shape VELOCITY first. Each crossing has signed speed v and zero
 * acceleration. The outward half uses v(1 - 3u² + 2u³); the inward half
 * uses -w(3u² - 2u³). Their integrals are quartics. Both end at rest with
 * zero acceleration, so their turnaround is C2 as well as every crossing.
 *
 * For gap h, split at d = hw/(v+w). Both halves then travel the SAME
 * distance vh w / (2(v+w)), and velocity magnitude decreases monotonically
 * away from either beat. Each beat is consequently a strict local speed
 * maximum, even for uneven spacing. v_i = 4/max(adjacent gaps, 1/64) bounds
 * every excursion by 1 and caps speed for nearly coincident notes. Uneven
 * or very dense notes reduce travel, rather than introduce discontinuities.
 */
function buildAxisCurve(times: number[]): DanceAxisCurve {
  times.sort((a, b) => a - b)
  const beats: number[] = []
  for (const beat of times) {
    if (!beats.length || beat - beats[beats.length - 1] > DANCE_EVENT_EPSILON) beats.push(beat)
  }
  const segments: DanceSegment[] = []
  if (!beats.length) return { beats, segments }
  const gaps = beats.slice(1).map((beat, i) => beat - beats[i])
  const speeds = beats.map((_, i) => 4 / Math.max(
    gaps[i - 1] ?? gaps[i] ?? 1,
    gaps[i] ?? gaps[i - 1] ?? 1,
    1 / 64,
  ))
  const add = (start: number, end: number, coefficients: DanceSegment['coefficients']) => {
    segments.push({ start, end, coefficients })
  }
  const settle = (start: number, end: number, from: number, to: number) => {
    const delta = to - from
    add(start, end, [from, 0, 0, 10 * delta, -15 * delta, 6 * delta])
  }
  // Extend through clip edges. Cutting at a note-on edge would require both
  // zero and nonzero velocity there. Up to one beat of lead-in/tail gives a
  // stationary home pose outside the phrase, including the single-note case.
  const first = beats[0]
  const lead = Math.min(gaps[0] ?? 1, 1) / 2
  const leadTravel = speeds[0] * lead / 2
  settle(first - 2 * lead, first - lead, 0, -leadTravel)
  add(first - lead, first, [-leadTravel, 0, 0, 2 * leadTravel, -leadTravel, 0])
  for (let i = 0; i < gaps.length; i++) {
    const start = beats[i], end = beats[i + 1], h = gaps[i]
    const sign = i % 2 === 0 ? 1 : -1
    const v = speeds[i], w = speeds[i + 1]
    const turn = start + h * w / (v + w)
    const travel = sign * v * (turn - start) / 2
    add(start, turn, [0, 2 * travel, 0, -2 * travel, travel, 0])
    add(turn, end, [travel, 0, 0, -2 * travel, travel, 0])
  }
  const last = beats[beats.length - 1]
  const tail = Math.min(gaps[gaps.length - 1] ?? 1, 1) / 2
  const tailTravel = (beats.length % 2 === 1 ? 1 : -1) * speeds[speeds.length - 1] * tail / 2
  add(last, last + tail, [0, 2 * tailTravel, 0, -2 * tailTravel, tailTravel, 0])
  settle(last + tail, last + 2 * tail, tailTravel, 0)
  return { beats, segments }
}

/** Binary search, then a fixed number of multiplies. No note scan, integration,
 * mutable playback cursor, or cache growth as the playhead moves. */
export function sampleDanceAxis(curve: DanceAxisCurve, beat: number): number {
  const segments = curve.segments
  if (!segments.length || !Number.isFinite(beat) || beat < segments[0].start ||
      beat >= segments[segments.length - 1].end) return 0
  let lo = 0, hi = segments.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (segments[mid].start <= beat) lo = mid + 1
    else hi = mid
  }
  const segment = segments[lo - 1]
  const u = (beat - segment.start) / (segment.end - segment.start)
  const c = segment.coefficients
  return c[0] + u * (c[1] + u * (c[2] + u * (c[3] + u * (c[4] + u * c[5]))))
}
