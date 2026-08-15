// Physics: a VALUE lane joined by real mechanics instead of by an easing curve.
//
// The lane is the automation 36-84 pitch encoding (the same one Radial's radius
// rows use), so a note's PITCH names a scalar in 0..1 and its onset names the
// beat that scalar must be true. What happens BETWEEN two onsets is the whole
// definition: instead of interpolating, we integrate a law of motion and solve
// its INITIAL CONDITIONS so the trajectory intercepts the next value at exactly
// the next onset. The object is thrown, not tweened - it has weight, hangtime
// and follow-through that a bezier can only imitate.
//
// Three laws x three ways of setting initial conditions:
//
//   ARRIVE   the trajectory passes exactly through every note value at its
//            onset. The physics fills the interval.
//   APEX     the note value is the trajectory's EXTREMUM, not a waypoint - the
//            ball crests on the note and falls away from it. Under Gravity this
//            is the bouncing ball: fall, bounce, crest on the beat.
//   IMPULSE  the onset injects ENERGY sized by the note's value (under Gravity,
//            exactly enough to peak there) and the law then free-runs. Values
//            are hit only on the way past; this is the loosest and the most
//            alive.
//
// TUNE is the one real tension in the design, and it cannot be dodged: a
// second-order law cannot both arrive on time and keep its velocity
// continuous - the interval is already fully constrained by two endpoint
// values. Something has to give, so TUNE says what:
//
//   STRIKE   the field constant is fixed and the LAUNCH VELOCITY is solved.
//            Velocity jumps on every onset, which reads as a hit - the note
//            visibly strikes the object.
//   SMOOTH   velocity carries through the onset and the FIELD CONSTANT is
//            solved per interval instead (gravity, or the spring's rest
//            target). C1 continuous, at the price of gravity that breathes
//            from interval to interval.
//
// Note DURATION and VELOCITY are deliberately ignored, exactly as in Waypoints:
// a value is a destination, not an intensity, and the interval between onsets
// is what the physics is solved against. Chords collapse to one gate (the
// highest pitch wins) - two values at one instant cannot both be true.
//
// PURITY: the entire trajectory is precomputed at resolve into a list of
// analytic PIECES (parabola / damped spring / exponential / hold), each seeded
// with the exact state the previous piece held at that instant. Bounces are
// pieces too, so nothing is ever integrated per frame: apply() binary-searches
// for the piece covering the beat and evaluates its closed form. Pause, scrub,
// playback and export therefore agree exactly, and a dense lane costs a lookup.
//
// COMPOSITION: LOCAL (previous * delta), like Waypoints - the displacement
// happens on the chain frame's axes, so a splitter above it runs the same
// phrase through every copy's own frame. The value is centered: 0.5 (pitch 60)
// is the object's home placement, so an empty lane is a no-op and the lane's
// middle row is "rest".

import { Matrix4, MathUtils } from 'three'
import type { MidiRowDef, ParamDef } from '../../instruments/types'
import { AUTOMATION_PITCH_MAX, AUTOMATION_PITCH_MIN, pitchToValue } from '../trackTypes'
import type { MoverOrSplitterDefinition } from './definitions'
import { PHYSICS_COLOR } from './identityColors'

export const PHYSICS_LAW_GRAVITY = 0
export const PHYSICS_LAW_SPRING = 1
export const PHYSICS_LAW_DRAG = 2

export const PHYSICS_SOLVE_ARRIVE = 0
export const PHYSICS_SOLVE_APEX = 1
export const PHYSICS_SOLVE_IMPULSE = 2

export const PHYSICS_TUNE_STRIKE = 0
export const PHYSICS_TUNE_SMOOTH = 1

export const PHYSICS_TARGET_X = 0
export const PHYSICS_TARGET_Y = 1
export const PHYSICS_TARGET_Z = 2
export const PHYSICS_TARGET_SIZE = 3
export const PHYSICS_TARGET_ROT_X = 4
export const PHYSICS_TARGET_ROT_Y = 5
export const PHYSICS_TARGET_ROT_Z = 6

/** The value a lane rests at with no notes: the middle row, the object's home. */
export const PHYSICS_REST_VALUE = 0.5

export interface PhysicsSettings {
  law: number
  solve: number
  tune: number
  target: number
  amount: number
  force: number
  bounce: number
  damp: number
}

// FORCE is one knob wearing three meanings, because the three laws each have
// exactly one field constant and a panel with three mutually-exclusive knobs
// says less than one honest one. The multipliers put all three in the same
// musical band at the default 1.6: an interval of about one beat gets a
// readable arc, a visible spring ring, and a settle you can watch.
const gravityOf = (settings: PhysicsSettings): number => Math.max(0.05, settings.force) * 1.6
const omegaOf = (settings: PhysicsSettings): number => Math.sqrt(Math.max(0.05, settings.force) * 6)
const rateOf = (settings: PhysicsSettings): number => Math.max(0.05, settings.force) * 1.8
const zetaOf = (settings: PhysicsSettings): number => Math.min(0.999, Math.max(0.02, settings.damp))

/** Values live in 0..1 (the lane's own span); the floor a bounce happens on is
 *  the bottom of that span, which is `amount / 2` below the object's home. */
const VALUE_FLOOR = 0

/** Guards against a pathological lane (a dense phrase under a nearly elastic
 *  bounce) turning resolve into an unbounded emit. Past this the trajectory
 *  simply rests - a silent cap is better than a frozen editor, and no musical
 *  lane comes close. */
const MAX_PIECES = 4096
const MAX_BOUNCES_PER_INTERVAL = 64
/** Below this rebound speed a bounce chain has visually stopped. */
const REST_SPEED = 0.02

// ── The analytic pieces ──────────────────────────────────────────────────────

/** y = y0 + v0·t + ½a·t² - a parabola (gravity), or a straight line at a = 0. */
interface PolyPiece { kind: 'poly'; onset: number; y0: number; v0: number; a: number }
/** y = target + x0·P(t) + v0·Q(t) - a damped harmonic oscillator. */
interface SpringPiece { kind: 'spring'; onset: number; target: number; x0: number; v0: number; omega: number; zeta: number }
/** y = target + x0·e^(-rate·t) - first-order pull, no overshoot ever. */
interface ExpoPiece { kind: 'expo'; onset: number; target: number; x0: number; rate: number }
/** A value that has stopped moving (before the first note, or at rest). */
interface HoldPiece { kind: 'hold'; onset: number; value: number }

export type PhysicsPiece = PolyPiece | SpringPiece | ExpoPiece | HoldPiece

interface State { y: number; v: number }

/** The damped-spring closed form as a LINEAR BASIS: x(t) = P·x0 + Q·v0 and
 *  v(t) = R·x0 + S·v0. Linearity is the point - every "solve the initial
 *  conditions" below is then a 1x1 or 2x2 solve rather than a search. */
export function springBasis(t: number, omega: number, zeta: number): { P: number; Q: number; R: number; S: number } {
  if (zeta >= 0.999) {
    const e = Math.exp(-omega * t)
    return { P: (1 + omega * t) * e, Q: t * e, R: -omega * omega * t * e, S: (1 - omega * t) * e }
  }
  const wd = omega * Math.sqrt(1 - zeta * zeta)
  const e = Math.exp(-zeta * omega * t)
  const cos = Math.cos(wd * t)
  const sin = Math.sin(wd * t)
  return {
    P: e * (cos + (zeta * omega * sin) / wd),
    Q: (e * sin) / wd,
    R: (-e * omega * omega * sin) / wd,
    S: e * (cos - (zeta * omega * sin) / wd),
  }
}

/** One piece's state `t` beats after its own onset. */
export function pieceState(piece: PhysicsPiece, t: number): State {
  const dt = Math.max(0, t)
  switch (piece.kind) {
    case 'poly':
      return { y: piece.y0 + piece.v0 * dt + 0.5 * piece.a * dt * dt, v: piece.v0 + piece.a * dt }
    case 'spring': {
      const b = springBasis(dt, piece.omega, piece.zeta)
      return {
        y: piece.target + b.P * piece.x0 + b.Q * piece.v0,
        v: b.R * piece.x0 + b.S * piece.v0,
      }
    }
    case 'expo': {
      const decay = Math.exp(-piece.rate * dt)
      return { y: piece.target + piece.x0 * decay, v: -piece.rate * piece.x0 * decay }
    }
    default:
      return { y: piece.value, v: 0 }
  }
}

// ── Gates: the lane read as values in time ───────────────────────────────────

export interface PhysicsGate { beat: number; value: number }

/** Notes on the automation pitch span, as sorted value gates. Simultaneous
 *  onsets cannot each be true, so a chord collapses to its highest pitch - the
 *  same "one boundary per instant" rule Radial's cycle gates use. */
export function physicsGates(notes: readonly { beat: number; pitch: number }[]): PhysicsGate[] {
  return notes
    .filter((note) => note.pitch >= AUTOMATION_PITCH_MIN && note.pitch <= AUTOMATION_PITCH_MAX)
    .map((note) => ({ beat: note.beat, value: pitchToValue(note.pitch, 0, 1) }))
    .sort((a, b) => a.beat - b.beat || a.value - b.value)
    .filter((gate, index, all) => index === all.length - 1 || all[index + 1].beat !== gate.beat)
}

// ── Building the trajectory ──────────────────────────────────────────────────

/** A ballistic run from (y, v) under gravity `g`, bouncing off VALUE_FLOOR with
 *  restitution `e`, emitted as one parabola per flight until `until` (the next
 *  onset) or until the ball has visibly stopped. Returns the state at `until`.
 *
 *  Closed form throughout: a flight ends at the positive root of the parabola
 *  through the floor, so a bounce is another piece rather than a collision
 *  test run per frame. */
function emitBallistic(
  pieces: PhysicsPiece[],
  onset: number,
  start: State,
  until: number,
  g: number,
  restitution: number,
): State {
  let t = onset
  let { y, v } = start
  for (let i = 0; i < MAX_BOUNCES_PER_INTERVAL; i++) {
    if (pieces.length >= MAX_PIECES) break
    pieces.push({ kind: 'poly', onset: t, y0: y, v0: v, a: -g })
    if (y <= VALUE_FLOOR && Math.abs(v) < REST_SPEED) {
      // Come to rest on the floor: replace the degenerate flight with a hold,
      // or the parabola would keep falling for the rest of the timeline.
      pieces[pieces.length - 1] = { kind: 'hold', onset: t, value: VALUE_FLOOR }
      return { y: VALUE_FLOOR, v: 0 }
    }
    // Positive root of y + v·τ - ½g·τ² = 0 (the floor crossing).
    const disc = v * v + 2 * g * Math.max(0, y - VALUE_FLOOR)
    const impact = (v + Math.sqrt(Math.max(0, disc))) / g
    if (!isFinite(impact) || impact <= 0) break
    if (t + impact >= until) return pieceState(pieces[pieces.length - 1], until - t)
    t += impact
    y = VALUE_FLOOR
    v = Math.abs(v - g * impact) * Math.max(0, Math.min(1, restitution))
    if (v < REST_SPEED) {
      pieces.push({ kind: 'hold', onset: t, value: VALUE_FLOOR })
      return { y: VALUE_FLOOR, v: 0 }
    }
  }
  // Ran out of budget (a nearly elastic ball with no next onset to stop it).
  // Terminate on the floor: a parabola left as the LAST piece would keep
  // falling for the rest of the timeline and drag the object out of frame.
  pieces.push({ kind: 'hold', onset: t, value: VALUE_FLOOR })
  return { y: VALUE_FLOOR, v: 0 }
}

/** Solve one ARRIVE / APEX interval and emit its piece(s). Returns the state at
 *  the interval's end, which seeds the next one. */
function emitInterval(
  pieces: PhysicsPiece[],
  settings: PhysicsSettings,
  onset: number,
  y0: number,
  vin: number,
  y1: number,
  dt: number,
): State {
  const law = Math.round(settings.law)
  const solve = Math.round(settings.solve)
  const smooth = Math.round(settings.tune) === PHYSICS_TUNE_SMOOTH
  const dy = y1 - y0

  // The fallback every ill-conditioned solve degrades to: the plain thrown
  // parabola. It always exists (dt > 0), always arrives, and is the mover's
  // most legible behavior - far better than a NaN reaching a matrix.
  const ballisticArrive = (): State => {
    const g = gravityOf(settings)
    const v0 = (dy + 0.5 * g * dt * dt) / dt
    pieces.push({ kind: 'poly', onset, y0, v0, a: -g })
    return { y: y1, v: v0 - g * dt }
  }

  if (law === PHYSICS_LAW_GRAVITY) {
    const g = gravityOf(settings)
    if (solve === PHYSICS_SOLVE_APEX) {
      // The note value is the crest, so the interval is: fall from this apex,
      // bounce, rise to the next apex exactly on its onset. Two unknowns (when
      // the bounce happens, and how high the bounce plane sits) and two
      // conditions, which closes.
      if (!smooth) {
        // Fixed gravity: solve the bounce TIME, and the plane floats to
        // whatever height makes the timing work.
        //   ½g(b² - a²) = Δy with a + b = dt  ⇒  b - a = 2Δy/(g·dt)
        let a = (dt - (2 * dy) / (g * dt)) / 2
        // Infeasible when gravity is too weak for the jump (|Δy| > ½g·dt²) -
        // clamp rather than refuse: the value still lands on the beat, the
        // bounce just happens at an edge of the interval.
        if (!isFinite(a)) a = dt / 2
        a = Math.min(0.98 * dt, Math.max(0.02 * dt, a))
        const b = dt - a
        const plane = y0 - 0.5 * g * a * a
        pieces.push({ kind: 'poly', onset, y0, v0: 0, a: -g })
        pieces.push({ kind: 'poly', onset: onset + a, y0: plane, v0: g * b, a: -g })
        return { y: y1, v: 0 }
      }
      // SMOOTH: pin the bounce to the FLOOR and solve gravity instead, so the
      // ball really is bouncing on the ground. Fall time √(2y0/g) plus rise
      // time √(2y1/g) must equal dt, which gives g in closed form.
      const h0 = Math.max(0, y0 - VALUE_FLOOR)
      const h1 = Math.max(0, y1 - VALUE_FLOOR)
      const gs = (2 * (Math.sqrt(h0) + Math.sqrt(h1)) ** 2) / (dt * dt)
      if (!isFinite(gs) || gs <= 0) return ballisticArrive()
      const a = Math.sqrt((2 * h0) / gs)
      pieces.push({ kind: 'poly', onset, y0, v0: 0, a: -gs })
      pieces.push({ kind: 'poly', onset: onset + a, y0: VALUE_FLOOR, v0: gs * (dt - a), a: -gs })
      return { y: y1, v: 0 }
    }
    if (!smooth) return ballisticArrive()
    // SMOOTH arrive: keep the incoming velocity and solve the ACCELERATION.
    // Gravity now varies per interval (it can even point up over a rising
    // phrase) - that is the trade C1 continuity costs, and it is the reason
    // both tunes ship.
    const a = (2 * (dy - vin * dt)) / (dt * dt)
    pieces.push({ kind: 'poly', onset, y0, v0: vin, a })
    return { y: y1, v: vin + a * dt }
  }

  if (law === PHYSICS_LAW_SPRING || (law === PHYSICS_LAW_DRAG && solve === PHYSICS_SOLVE_APEX)) {
    // Drag has no extremum to land on (a first-order pull never turns around),
    // so its APEX cell is the honest reading of the ask: a CRITICALLY DAMPED
    // arrival - dead on the value, zero velocity, no overshoot ever.
    const omega = omegaOf(settings)
    const zeta = law === PHYSICS_LAW_DRAG ? 0.999 : zetaOf(settings)
    const b = springBasis(dt, omega, zeta)
    if (solve === PHYSICS_SOLVE_APEX) {
      // Two conditions - arrive AT the value and arrive AT REST - against the
      // two unknowns (rest target, launch velocity). Linear in both.
      if (Math.abs(b.S) < 1e-6) return ballisticArrive()
      const M = b.P - (b.Q * b.R) / b.S
      if (Math.abs(1 - M) < 1e-6) return ballisticArrive()
      const target = (y1 - M * y0) / (1 - M)
      const x0 = y0 - target
      const v0 = (-b.R * x0) / b.S
      if (!isFinite(target) || !isFinite(v0)) return ballisticArrive()
      pieces.push({ kind: 'spring', onset, target, x0, v0, omega, zeta })
      return pieceState(pieces[pieces.length - 1], dt)
    }
    if (!smooth) {
      // STRIKE: the spring rests ON the note and the launch velocity is solved
      // so it gets there exactly on the beat rather than asymptotically.
      if (Math.abs(b.Q) < 1e-6) return ballisticArrive()
      const target = y1
      const x0 = y0 - target
      const v0 = (-b.P * x0) / b.Q
      if (!isFinite(v0)) return ballisticArrive()
      pieces.push({ kind: 'spring', onset, target, x0, v0, omega, zeta })
      return pieceState(pieces[pieces.length - 1], dt)
    }
    // SMOOTH: velocity carries, so the REST TARGET is what gets solved - the
    // spring is aimed past the note by however much its own ringing needs.
    if (Math.abs(1 - b.P) < 1e-4) return ballisticArrive()
    const target = (y1 - b.P * y0 - b.Q * vin) / (1 - b.P)
    if (!isFinite(target) || Math.abs(target) > 1e3) return ballisticArrive()
    pieces.push({ kind: 'spring', onset, target, x0: y0 - target, v0: vin, omega, zeta })
    return pieceState(pieces[pieces.length - 1], dt)
  }

  // DRAG / ARRIVE.
  const rate = rateOf(settings)
  const expo = (target: number, r: number): State => {
    pieces.push({ kind: 'expo', onset, target, x0: y0 - target, rate: r })
    return pieceState(pieces[pieces.length - 1], dt)
  }
  const aimPast = (): State => {
    // An exponential only reaches its target at infinity, so aim it PAST the
    // note: the target that puts y(dt) exactly on the value.
    const decay = Math.exp(-rate * dt)
    if (1 - decay < 1e-9) return ballisticArrive()
    return expo((y1 - y0 * decay) / (1 - decay), rate)
  }
  if (!smooth) return aimPast()
  // SMOOTH: the opening velocity is pinned to the incoming one (target =
  // y0 + vin/r), which leaves only the RATE free. y(dt) is monotonic in r
  // between vin·dt (r→0) and 0 (r→∞), so bisect - and when the arrival is
  // outside that reachable band, say so by falling back to STRIKE rather than
  // faking it. First-order motion genuinely cannot always be both smooth and
  // on time.
  const reach = (r: number): number => y0 + (vin / r) * (1 - Math.exp(-r * dt)) - y1
  let lo = 0.02
  let hi = 400
  let flo = reach(lo)
  if (!(flo * reach(hi) < 0)) return aimPast()
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (reach(mid) * flo <= 0) hi = mid
    else {
      lo = mid
      flo = reach(mid)
    }
  }
  const solved = (lo + hi) / 2
  return expo(y0 + vin / solved, solved)
}

/** The whole trajectory, precomputed. Exported for the tests. */
export function buildPhysicsPieces(
  notes: readonly { beat: number; pitch: number }[],
  settings: PhysicsSettings,
): PhysicsPiece[] {
  const gates = physicsGates(notes)
  if (gates.length === 0) return [{ kind: 'hold', onset: -Infinity, value: PHYSICS_REST_VALUE }]

  // Before the first onset the lane simply IS its first value - the piece is at
  // rest, so a scrub into the pre-roll shows the phrase's starting pose rather
  // than a value falling in from nowhere.
  const pieces: PhysicsPiece[] = [{ kind: 'hold', onset: -Infinity, value: gates[0].value }]
  const solve = Math.round(settings.solve)
  const law = Math.round(settings.law)

  if (solve === PHYSICS_SOLVE_IMPULSE) {
    const g = gravityOf(settings)
    const omega = omegaOf(settings)
    const zeta = zetaOf(settings)
    const rate = rateOf(settings)
    let state: State = { y: gates[0].value, v: 0 }
    for (let i = 0; i < gates.length && pieces.length < MAX_PIECES; i++) {
      const gate = gates[i]
      const until = i + 1 < gates.length ? gates[i + 1].beat : Infinity
      if (law === PHYSICS_LAW_GRAVITY) {
        // The kick is exactly the energy needed to crest at the note's value
        // from where the object currently is: v = √(2g·Δh). Already above it?
        // Then the note asks for nothing and the fall continues - which is
        // what makes a descending phrase read as one long fall punctuated by
        // small hops rather than as a machine gun.
        const climb = Math.max(0, gate.value - state.y)
        state = { y: state.y, v: climb > 0 ? Math.sqrt(2 * g * climb) : state.v }
        state = emitBallistic(pieces, gate.beat, state, until, g, settings.bounce)
      } else if (law === PHYSICS_LAW_SPRING) {
        // A velocity kick toward the value, scaled by the spring's own speed so
        // the shove stays proportionate as FORCE moves.
        const v0 = state.v + (gate.value - state.y) * 2.6 * Math.sqrt(Math.max(0.05, settings.force))
        pieces.push({ kind: 'spring', onset: gate.beat, target: PHYSICS_REST_VALUE, x0: state.y - PHYSICS_REST_VALUE, v0, omega, zeta })
        state = pieceState(pieces[pieces.length - 1], Math.min(until - gate.beat, 1e6))
      } else {
        // Drag: a shove that the medium eats. y = y0 + (v0/r)(1 - e^-rt),
        // which is the expo piece with its target ahead of the start.
        const v0 = state.v + (gate.value - state.y) * 2.2
        const target = state.y + v0 / rate
        pieces.push({ kind: 'expo', onset: gate.beat, target, x0: state.y - target, rate })
        state = pieceState(pieces[pieces.length - 1], Math.min(until - gate.beat, 1e6))
      }
    }
    return pieces
  }

  // ARRIVE / APEX: one solved interval per pair of onsets, each seeded with the
  // state the previous one really held. After the last note the value rests
  // where it landed - the phrase is over, and a free-running tail would drift
  // the object away from a pose the user placed.
  let vin = 0
  for (let i = 0; i < gates.length - 1 && pieces.length < MAX_PIECES; i++) {
    const dt = gates[i + 1].beat - gates[i].beat
    if (!(dt > 1e-6)) continue
    const end = emitInterval(pieces, settings, gates[i].beat, gates[i].value, vin, gates[i + 1].value, dt)
    vin = isFinite(end.v) ? end.v : 0
  }
  const last = gates[gates.length - 1]
  pieces.push({ kind: 'hold', onset: last.beat, value: last.value })
  return pieces
}

/** The lane's value at `beat`: find the piece covering it, evaluate its closed
 *  form. Pieces are onset-sorted, so this is a binary search. */
export function evaluatePhysicsValue(pieces: readonly PhysicsPiece[], beat: number): number {
  if (pieces.length === 0) return PHYSICS_REST_VALUE
  let lo = 0
  let hi = pieces.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (pieces[mid].onset <= beat) lo = mid
    else hi = mid - 1
  }
  const piece = pieces[lo]
  const value = pieceState(piece, beat - piece.onset).y
  return isFinite(value) ? value : PHYSICS_REST_VALUE
}

/** The value as a transform on the chosen channel. Centered on 0.5 so the
 *  lane's middle row is the object's home placement. */
export function physicsTransform(value: number, settings: PhysicsSettings): Matrix4 {
  const offset = (value - PHYSICS_REST_VALUE) * settings.amount
  switch (Math.round(settings.target)) {
    case PHYSICS_TARGET_X:
      return new Matrix4().makeTranslation(offset, 0, 0)
    case PHYSICS_TARGET_Z:
      return new Matrix4().makeTranslation(0, 0, offset)
    case PHYSICS_TARGET_SIZE: {
      // Size is an EXPONENT, never a summand (the impactPulse rule): a swell
      // and its mirror-image squash stay exact reciprocals and nothing can
      // cross zero and invert the object's winding.
      const scale = Math.pow(2, offset)
      return new Matrix4().makeScale(scale, scale, scale)
    }
    case PHYSICS_TARGET_ROT_X:
      return new Matrix4().makeRotationX(MathUtils.degToRad(offset))
    case PHYSICS_TARGET_ROT_Y:
      return new Matrix4().makeRotationY(MathUtils.degToRad(offset))
    case PHYSICS_TARGET_ROT_Z:
      return new Matrix4().makeRotationZ(MathUtils.degToRad(offset))
    default:
      return new Matrix4().makeTranslation(0, offset, 0)
  }
}

const PHYSICS_PARAMS: ParamDef[] = [
  {
    key: 'law',
    label: 'Law',
    type: 'select',
    options: [
      { value: PHYSICS_LAW_GRAVITY, label: 'Gravity' },
      { value: PHYSICS_LAW_SPRING, label: 'Spring' },
      { value: PHYSICS_LAW_DRAG, label: 'Drag' },
    ],
    default: PHYSICS_LAW_GRAVITY,
  },
  {
    key: 'solve',
    label: 'Notes are',
    type: 'select',
    options: [
      { value: PHYSICS_SOLVE_ARRIVE, label: 'Arrive' },
      { value: PHYSICS_SOLVE_APEX, label: 'Apex' },
      { value: PHYSICS_SOLVE_IMPULSE, label: 'Impulse' },
    ],
    default: PHYSICS_SOLVE_ARRIVE,
  },
  {
    key: 'tune',
    label: 'Solve',
    type: 'select',
    options: [
      { value: PHYSICS_TUNE_STRIKE, label: 'Strike' },
      { value: PHYSICS_TUNE_SMOOTH, label: 'Smooth' },
    ],
    default: PHYSICS_TUNE_STRIKE,
  },
  {
    key: 'target',
    label: 'Drives',
    type: 'select',
    options: [
      { value: PHYSICS_TARGET_X, label: 'X' },
      { value: PHYSICS_TARGET_Y, label: 'Y (height)' },
      { value: PHYSICS_TARGET_Z, label: 'Z' },
      { value: PHYSICS_TARGET_SIZE, label: 'Size' },
      { value: PHYSICS_TARGET_ROT_X, label: 'Rotate X' },
      { value: PHYSICS_TARGET_ROT_Y, label: 'Rotate Y' },
      { value: PHYSICS_TARGET_ROT_Z, label: 'Rotate Z' },
    ],
    default: PHYSICS_TARGET_Y,
  },
  // One span knob for every channel: world units for X/Y/Z, degrees for the
  // rotations, octaves of scale for Size. The wide range is what lets one
  // param serve a 4-unit throw and a 360-degree tumble.
  { key: 'amount', label: 'Amount', min: -360, max: 360, step: 0.1, default: 4 },
  { key: 'force', label: 'Force', min: 0.05, max: 6, step: 0.05, default: 1.6 },
  { key: 'bounce', label: 'Bounce', min: 0, max: 0.98, step: 0.01, default: 0.7, showIf: 'solve=2' },
  { key: 'damp', label: 'Damping', min: 0.02, max: 1, step: 0.01, default: 0.25, showIf: 'law=1' },
]

/** Value rows spanning the automation pitch range top-down, labelled with the
 *  displacement they actually produce - the roll reads like the automation lane
 *  it borrows its encoding from, and repointing AMOUNT relabels every row. */
export function physicsMidiRows(settings: PhysicsSettings): MidiRowDef[] {
  const amount = settings.amount
  return Array.from({ length: AUTOMATION_PITCH_MAX - AUTOMATION_PITCH_MIN + 1 }, (_, index) => {
    const pitch = AUTOMATION_PITCH_MAX - index
    const offset = (pitchToValue(pitch, 0, 1) - PHYSICS_REST_VALUE) * amount
    return {
      pitch,
      label: `${offset >= 0 ? '+' : ''}${offset.toFixed(1)}`,
      emphasized: Math.abs(offset) < 1e-9,
    }
  })
}

export const physicsMover: MoverOrSplitterDefinition<PhysicsSettings> = {
  id: 'physics',
  label: 'Physics',
  kind: 'mover',
  identityColor: PHYSICS_COLOR,
  params: PHYSICS_PARAMS,
  midiRows: physicsMidiRows,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const pieces = buildPhysicsPieces(notes, settings)
    return {
      apply(visualCopy, { beat }) {
        const value = evaluatePhysicsValue(pieces, beat)
        return [{
          transform: visualCopy.transform.clone().multiply(physicsTransform(value, settings)),
          opacity: visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }]
      },
    }
  },
}
