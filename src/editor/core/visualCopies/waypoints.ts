// Waypoints: a position sequencer. The user lays out N positions (a line, a
// grid, a ring, or hand-placed customs), each position owns a MIDI row, and a
// note on that row means "travel to this position". A second cluster of rows
// LATCHES the travel curve for every subsequent move - the same latch grammar
// as Radial Motion's multipliers, so curve rows compose with position phrases
// instead of interrupting them.
//
// The curve set is the working vocabulary of motion design - the exact
// industry curves, evaluated as true cubic beziers (Newton-solved, with the
// analytic slope), not hand-rolled approximations:
//   Snap   - expo-out cubic-bezier(0.16, 1, 0.3, 1): the workhorse. Peak
//            velocity ON the note onset (opening slope ~6x average), ~78% of
//            the distance covered in the first fifth, the rest of the travel
//            spent settling - front-loaded velocity plus long tail is what
//            reads as simultaneously responsive and premium.
//   Flow   - the iOS-sheet curve cubic-bezier(0.32, 0.72, 0, 1): the
//            large-surface travel - a briefly gathered start into a long
//            deceleration, for big formations that shouldn't whip.
//   Pop    - back-out cubic-bezier(0.34, 1.56, 0.64, 1): the surgical
//            overshoot accent (Y control point past 1) - pops a little past
//            the target and settles, no anticipation dip.
//   Glide  - a critically damped spring. PHYSICS, not a keyframe: interruptible
//            by design - a retarget mid-flight inherits the current velocity
//            (C1 continuity) instead of restarting from rest and hitching,
//            and settles with smooth velocity AND acceleration, never
//            overshooting. For large surfaces.
//   Spring - the same solver underdamped, tuned to the platform-spring band
//            (zeta ~0.85 down to ~0.35 across the Bounce dial; the default
//            sits near zeta 0.65, a visible ring that stays musical).
//            Velocity carries, and the move overshoots and rings (the
//            aftershoot).
//
// Beziers are pre-recorded plans (zero initial velocity, fixed duration); the
// spring family is a simulation that inherits state - which is why retargets
// under Glide/Spring stay continuous while the bezier curves restart. Both
// behaviors are deliberate and per the guide: beziers for choreographed hits,
// springs for anything re-triggered mid-motion.
//
// The whole path is PRECOMPUTED at resolve as analytic segments: each position
// note opens a segment seeded with the exact position and velocity the
// previous segment held at that onset (sampled from its closed form). apply()
// is then a pure function of the beat - find the segment, evaluate its closed
// form - so pause, scrub and export agree exactly, and per-frame cost is a
// segment lookup, never an integration.
//
// COMPOSITION: LOCAL (previous * delta) with the field on the chain frame's
// XY plane - a splitter above re-frames each copy's waypoint field, so one
// phrase moves every copy through its own field in parallel. The field is
// CENTERED on the object's placement (the pattern surrounds it); at rest the
// object sits on position 1. Note velocity is deliberately ignored - a
// position is an absolute destination, not an intensity.

import { Matrix4 } from 'three'
import type { MidiRowDef, ParamDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import type { VisualCopy } from './types'
import { WAYPOINTS_COLOR } from './identityColors'

export const WAYPOINT_LAYOUT_LINE = 0
export const WAYPOINT_LAYOUT_GRID = 1
export const WAYPOINT_LAYOUT_RING = 2
export const WAYPOINT_LAYOUT_CUSTOM = 3

export const WAYPOINT_CURVE_SNAP = 0
export const WAYPOINT_CURVE_FLOW = 1
export const WAYPOINT_CURVE_POP = 2
export const WAYPOINT_CURVE_GLIDE = 3
export const WAYPOINT_CURVE_SPRING = 4

export const WAYPOINT_CURVE_LABELS = ['Snap', 'Flow', 'Pop', 'Glide', 'Spring'] as const

export const MAX_WAYPOINTS = 8
/** Position rows: pitch 60 = position 1 ... 67 = position 8 (frozen). */
export const WAYPOINT_BASE_PITCH = 60
/** Curve latch rows: 54 Snap ... 58 Spring (frozen). */
export const WAYPOINT_CURVE_BASE_PITCH = 54

export interface WaypointsSettings {
  layout: number
  positions: number
  /** Line/grid spacing between neighbours; the ring's radius. */
  spread: number
  /** Snap/Flow/Anticipate: the move's length in beats. Glide/Spring: the settle time. */
  travelBeats: number
  /** Spring only: 0 = barely rings, 1 = long wobble. */
  bounce: number
  /** The curve in force before any curve-row note (WAYPOINT_CURVE_*). */
  curve: number
  [key: string]: number // posNX / posNY customs
}

// Default customs trace a ring so Custom starts arranged, not stacked.
const customDefault = (index: number, axis: 'x' | 'y'): number => {
  const angle = Math.PI / 2 - (index / MAX_WAYPOINTS) * Math.PI * 2
  const v = axis === 'x' ? Math.cos(angle) * 2 : Math.sin(angle) * 2
  return Number(v.toFixed(2))
}

const CUSTOM_PARAMS: ParamDef[] = Array.from({ length: MAX_WAYPOINTS }, (_, i) => [
  { key: `pos${i + 1}X`, label: `P${i + 1} X`, min: -20, max: 20, step: 0.1, default: customDefault(i, 'x'), showIf: 'layout=3' },
  { key: `pos${i + 1}Y`, label: `P${i + 1} Y`, min: -20, max: 20, step: 0.1, default: customDefault(i, 'y'), showIf: 'layout=3' },
] as ParamDef[]).flat()

const WAYPOINTS_PARAMS: ParamDef[] = [
  {
    key: 'layout',
    label: 'Layout',
    type: 'select',
    options: [
      { value: WAYPOINT_LAYOUT_LINE, label: 'Line' },
      { value: WAYPOINT_LAYOUT_GRID, label: 'Grid' },
      { value: WAYPOINT_LAYOUT_RING, label: 'Ring' },
      { value: WAYPOINT_LAYOUT_CUSTOM, label: 'Custom' },
    ],
    default: WAYPOINT_LAYOUT_RING,
  },
  { key: 'positions', label: 'Positions', min: 2, max: MAX_WAYPOINTS, step: 1, default: 4 },
  { key: 'spread', label: 'Spread', min: 0, max: 12, step: 0.1, default: 2 },
  {
    key: 'curve',
    label: 'Curve',
    type: 'select',
    options: WAYPOINT_CURVE_LABELS.map((label, value) => ({ value, label })),
    default: WAYPOINT_CURVE_SNAP,
  },
  { key: 'travelBeats', label: 'Travel beats', min: 0.05, max: 8, step: 0.05, default: 0.5 },
  { key: 'bounce', label: 'Bounce', min: 0, max: 1, step: 0.01, default: 0.4, showIf: 'curve=4' },
  ...CUSTOM_PARAMS,
]

/** The laid-out field, CENTERED on the object's home placement - the pattern
 *  surrounds the object, and the moves dance around it. At rest (no notes yet)
 *  the object sits on position 1. */
export function waypointPositions(settings: WaypointsSettings): [number, number][] {
  const count = Math.max(2, Math.min(MAX_WAYPOINTS, Math.round(settings.positions)))
  const spread = settings.spread
  const raw: [number, number][] = []
  const layout = Math.round(settings.layout)
  if (layout === WAYPOINT_LAYOUT_LINE) {
    for (let i = 0; i < count; i++) raw.push([(i - (count - 1) / 2) * spread, 0])
  } else if (layout === WAYPOINT_LAYOUT_GRID) {
    const cols = Math.ceil(Math.sqrt(count))
    const rows = Math.ceil(count / cols)
    for (let i = 0; i < count; i++) {
      const c = i % cols
      const r = Math.floor(i / cols)
      raw.push([(c - (cols - 1) / 2) * spread, ((rows - 1) / 2 - r) * spread])
    }
  } else if (layout === WAYPOINT_LAYOUT_CUSTOM) {
    for (let i = 0; i < count; i++) {
      raw.push([settings[`pos${i + 1}X`] ?? 0, settings[`pos${i + 1}Y`] ?? 0])
    }
  } else {
    // Ring: position 1 at the top, clockwise.
    for (let i = 0; i < count; i++) {
      const angle = Math.PI / 2 - (i / count) * Math.PI * 2
      raw.push([Math.cos(angle) * spread, Math.sin(angle) * spread])
    }
  }
  return raw
}

// ── The closed forms ─────────────────────────────────────────────────────────

interface AxisState { p: number; v: number }

// The exact curves, as CSS would speak them.
const CURVE_BEZIERS: Record<number, readonly [number, number, number, number]> = {
  [WAYPOINT_CURVE_SNAP]: [0.16, 1, 0.3, 1],
  [WAYPOINT_CURVE_FLOW]: [0.32, 0.72, 0, 1],
  [WAYPOINT_CURVE_POP]: [0.34, 1.56, 0.64, 1],
}

/** One cubic-bezier component B(t) and B'(t) for control values (c1, c2)
 *  with endpoints 0 and 1. */
const bezier = (c1: number, c2: number, t: number): [number, number] => {
  const inv = 1 - t
  return [
    3 * inv * inv * t * c1 + 3 * inv * t * t * c2 + t * t * t,
    3 * inv * inv * c1 + 6 * inv * t * (c2 - c1) + 3 * t * t * (1 - c2),
  ]
}

/** Keyframe shape s(u) and slope ds/du on u ∈ [0,1]: solve the bezier's x
 *  component for the parameter at time-progress u (Newton with a bisection
 *  net), then read y and the chain-rule slope y'/x'. */
function keyframeShape(curve: number, u: number): { s: number; dsdu: number } {
  const [x1, y1, x2, y2] = CURVE_BEZIERS[curve] ?? CURVE_BEZIERS[WAYPOINT_CURVE_SNAP]
  if (u <= 0) return { s: 0, dsdu: 0 }
  if (u >= 1) return { s: 1, dsdu: 0 }
  // Newton from a good seed, falling back to bisection when the slope is flat.
  let t = u
  for (let i = 0; i < 8; i++) {
    const [x, dx] = bezier(x1, x2, t)
    const err = x - u
    if (Math.abs(err) < 1e-7) break
    if (Math.abs(dx) < 1e-6) break
    t = Math.min(1, Math.max(0, t - err / dx))
  }
  let [x] = bezier(x1, x2, t)
  if (Math.abs(x - u) > 1e-5) {
    let lo = 0
    let hi = 1
    for (let i = 0; i < 40; i++) {
      t = (lo + hi) / 2
      ;[x] = bezier(x1, x2, t)
      if (x < u) lo = t
      else hi = t
    }
  }
  const [, dx] = bezier(x1, x2, t)
  const [y, dy] = bezier(y1, y2, t)
  return { s: y, dsdu: Math.abs(dx) < 1e-6 ? 0 : dy / dx }
}

/** One axis of one segment at `dt` beats after its onset. */
function evalAxis(
  curve: number,
  from: number,
  v0: number,
  target: number,
  dt: number,
  travel: number,
  bounce: number,
): AxisState {
  const T = Math.max(0.05, travel)
  if (curve === WAYPOINT_CURVE_SNAP || curve === WAYPOINT_CURVE_FLOW || curve === WAYPOINT_CURVE_POP) {
    if (dt >= T) return { p: target, v: 0 }
    const { s, dsdu } = keyframeShape(curve, dt / T)
    return { p: from + (target - from) * s, v: ((target - from) * dsdu) / T }
  }
  // The spring family. ω sized so a critically damped move settles in roughly
  // Travel beats (e^-6 ≈ 0.25%); Spring underdamps the same oscillator.
  const omega = 6 / T
  const u0 = from - target
  if (curve === WAYPOINT_CURVE_GLIDE) {
    // Critically damped: u = (A + Bt)e^(-ωt)
    const A = u0
    const B = v0 + omega * u0
    const decay = Math.exp(-omega * dt)
    return {
      p: target + (A + B * dt) * decay,
      v: (B - omega * (A + B * dt)) * decay,
    }
  }
  // Underdamped: ζ < 1, u = e^(-ζωt)(A cos ω_d t + B sin ω_d t). The Bounce
  // dial walks the platform-spring band: ζ 0.85 (a whisper of overshoot) down
  // to 0.35 (a long ring); the default lands near ζ 0.65.
  const zeta = 0.85 - Math.max(0, Math.min(1, bounce)) * 0.5
  const omegaD = omega * Math.sqrt(1 - zeta * zeta)
  const A = u0
  const B = (v0 + zeta * omega * u0) / omegaD
  const decay = Math.exp(-zeta * omega * dt)
  const cos = Math.cos(omegaD * dt)
  const sin = Math.sin(omegaD * dt)
  return {
    p: target + decay * (A * cos + B * sin),
    v: decay * ((B * omegaD - zeta * omega * A) * cos - (A * omegaD + zeta * omega * B) * sin),
  }
}

interface Segment {
  onset: number
  curve: number
  from: [number, number]
  v0: [number, number]
  target: [number, number]
}

function segmentAt(seg: Segment, dt: number, travel: number, bounce: number): { x: AxisState; y: AxisState } {
  return {
    x: evalAxis(seg.curve, seg.from[0], seg.v0[0], seg.target[0], dt, travel, bounce),
    y: evalAxis(seg.curve, seg.from[1], seg.v0[1], seg.target[1], dt, travel, bounce),
  }
}

/** The precomputed path: every position note opens a segment seeded with the
 *  exact state (position AND velocity) the previous segment held at that
 *  onset. Exported for the tests. */
export function buildWaypointSegments(
  notes: readonly ResolvedNote[],
  settings: WaypointsSettings,
): Segment[] {
  const points = waypointPositions(settings)
  const travel = settings.travelBeats
  const bounce = settings.bounce

  // Curve latches, in onset order: a move uses the most recent curve row at
  // or before its own onset (ties: the curve note wins - it was placed to
  // shape exactly that move).
  const curveNotes = notes
    .filter((n) => {
      const c = n.pitch - WAYPOINT_CURVE_BASE_PITCH
      return c >= 0 && c < WAYPOINT_CURVE_LABELS.length
    })
    .sort((a, b) => a.beat - b.beat)
  const curveAt = (beat: number): number => {
    let curve = Math.round(settings.curve)
    for (const n of curveNotes) {
      if (n.beat > beat) break
      curve = n.pitch - WAYPOINT_CURVE_BASE_PITCH
    }
    return curve
  }

  const moves = notes
    .filter((n) => {
      const p = n.pitch - WAYPOINT_BASE_PITCH
      return p >= 0 && p < points.length
    })
    .sort((a, b) => a.beat - b.beat)

  const segments: Segment[] = []
  let state: { p: [number, number]; v: [number, number] } = { p: points[0], v: [0, 0] }
  let previous: Segment | null = null
  for (const move of moves) {
    if (previous) {
      const dt = move.beat - previous.onset
      const at = segmentAt(previous, dt, travel, bounce)
      state = { p: [at.x.p, at.y.p], v: [at.x.v, at.y.v] }
    }
    previous = {
      onset: move.beat,
      curve: curveAt(move.beat),
      from: state.p,
      // Linear and Ease are keyframe curves - they restart from rest. The
      // spring family carries the arriving velocity (that's the physics).
      v0: [0, 0],
      target: points[move.pitch - WAYPOINT_BASE_PITCH],
    }
    if (previous.curve === WAYPOINT_CURVE_GLIDE || previous.curve === WAYPOINT_CURVE_SPRING) {
      previous.v0 = state.v
    }
    segments.push(previous)
  }
  return segments
}

/** The field offset at `beat`, relative to home. Exported for the tests. */
export function evaluateWaypointOffset(
  segments: readonly Segment[],
  settings: WaypointsSettings,
  beat: number,
): [number, number] {
  const points = waypointPositions(settings)
  let active: Segment | null = null
  for (const seg of segments) {
    if (seg.onset > beat) break
    active = seg
  }
  if (!active) return points[0]
  const at = segmentAt(active, beat - active.onset, settings.travelBeats, settings.bounce)
  return [at.x.p, at.y.p]
}

function nextCopy(visualCopy: VisualCopy, transform: Matrix4): VisualCopy {
  return {
    transform,
    opacity: visualCopy.opacity,
    colorShift: { ...visualCopy.colorShift },
  }
}

export function waypointsMidiRows(settings: WaypointsSettings): MidiRowDef[] {
  const count = Math.max(2, Math.min(MAX_WAYPOINTS, Math.round(settings.positions)))
  const rows: MidiRowDef[] = []
  for (let i = 0; i < count; i++) {
    rows.push({ pitch: WAYPOINT_BASE_PITCH + i, label: `Position ${i + 1}`, emphasized: i === 0 })
  }
  for (let c = 0; c < WAYPOINT_CURVE_LABELS.length; c++) {
    rows.push({ pitch: WAYPOINT_CURVE_BASE_PITCH + c, label: `Curve · ${WAYPOINT_CURVE_LABELS[c]}` })
  }
  return rows
}

export const waypointsMover: MoverOrSplitterDefinition<WaypointsSettings> = {
  id: 'waypoints',
  label: 'Waypoints',
  kind: 'mover',
  identityColor: WAYPOINTS_COLOR,
  params: WAYPOINTS_PARAMS,
  midiRows: waypointsMidiRows,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const segments = buildWaypointSegments(notes, settings)
    return {
      apply(visualCopy, { beat }) {
        const [x, y] = evaluateWaypointOffset(segments, settings, beat)
        return [nextCopy(
          visualCopy,
          visualCopy.transform.clone().multiply(new Matrix4().makeTranslation(x, y, 0)),
        )]
      },
    }
  },
}
