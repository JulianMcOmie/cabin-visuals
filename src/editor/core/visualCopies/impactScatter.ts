// Impact Scatter: a hit BLASTS the whole field apart, and the pieces drift home.
//
// ── Why this is not Meteor Impact ────────────────────────────────────────────
//
// Meteor Impact solves one impulse response and SUPERPOSES a copy of it per
// note. That is exact for a linear system and it is the right model for a
// rippling shockwave - but superposition can never compound. Two hits half a
// beat apart produce exactly twice one hit, forever, no matter how hard they
// land or what the field was already doing.
//
// This mover instead INTEGRATES THE TIMELINE. Each piece of the field is a
// particle with a real state (displacement, velocity) that is marched forward
// through the note list; a note does not paint a curve, it delivers an
// instantaneous VELOCITY KICK to whatever state the particle happens to be in.
// Everything that makes rapid fire interesting follows from that one change:
//
//   * MOMENTUM CARRIES. A hit landing on a piece that is already flying adds to
//     its velocity, so it goes further than either hit alone would have sent it.
//     Land one on a piece flying back inward and the two nearly cancel - the
//     piece stalls mid-air. The field's response depends on its history.
//   * THE NONLINEARITIES BITE HARDER WHEN IT IS LOUD. Quadratic drag scales with
//     speed squared and the leash stiffens with the cube of displacement, so a
//     doubled kick does NOT double the throw. Stacked hits escalate, then
//     visibly run into the material's limit instead of flying off to infinity.
//     A blast that compounds and then saturates is what makes a snare roll read
//     as one building gesture rather than N copies of a hit.
//   * PILEUP. On top of the physics, a piece that is already displaced takes the
//     next kick HARDER (`pileup`). This is the one deliberately unphysical term
//     in here, and it is what turns a fill from "loud" into "out of control".
//
// The return is the same integration running out: a spring pulls every piece
// back to exactly where it started, so the field always resolves to its
// composed layout. A long RECOVER plus an instantaneous kick is the whole feel
// the brief asks for - blown apart in a frame, drifting home over bars.
//
// ── Keeping it a pure function of the beat ───────────────────────────────────
//
// A stateful simulation and "paused = frozen frame" are only compatible if the
// state is a function of the playhead, so nothing here is stepped per frame.
// The trick is that the trajectory depends on the copy through very little:
//
//   * The copy's own THROW DIRECTION (radial + a deterministic per-copy lateral
//     axis + a spin axis), which is fixed for all time and costs no simulation.
//   * A scalar GAIN g from its distance to the impact center.
//   * A propagation DELAY, which is a pure time shift.
//
// So the motion collapses to three SCALAR channels - radial extension, lateral
// scatter, and spin - whose only copy-dependence is g. Resolve integrates those
// channels once for a small ladder of gains (`GAIN_BUCKETS`); apply() reads the
// two tables bracketing its own gain and interpolates. Every copy gets its
// exact delay and its own direction, and no per-copy state or cache exists.
//
// Between clusters of hits the field is at rest, and a system at rest has no
// history worth carrying - so the timeline is split at silences longer than the
// settle tail and each cluster is integrated over its own short window. That is
// what keeps a 6-minute song from needing a 6-minute table.

import { Matrix4, Vector3 } from 'three'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import { normalizedVelocity } from './motionBasis'

export const SCATTER_IMPACT_PITCH = 60
export const SCATTER_IMPLODE_PITCH = 61
export const SCATTER_SETTLE_PITCH = 62

/**
 * THREE knobs, because there are only three things you can hear.
 *
 * The physics underneath needs a dozen quantities (launch speed, spring period,
 * damping ratio, quadratic drag, leash, lateral share, tumble rate, front
 * speed…), but those are not independent DECISIONS - they are one gesture
 * described in engineering units. Exposing them all made the mover feel like a
 * simulation to be configured rather than an instrument to be played, so they
 * move together now, along the curves in `tune()`:
 *
 *   IMPACT  - how hard the hit throws. Scales the launch speed, and with it the
 *             leash and reach it needs to make that throw look intentional.
 *   RECOVER - how long until everything is back in place, IN BEATS. It is the
 *             actual observed return time, not a spring period, so "2" means
 *             two beats and you can match it to the music by ear.
 *   CHAOS   - orderly pulse → shrapnel. At 0 the field breathes out and back on
 *             one clean radial line; turning it up trades that for sideways
 *             scatter, tumble, swirl, springier settling, and harder pileup on
 *             stacked hits.
 *
 * Placement (`center*`) and the swirl plane are not feel - they are where the
 * hit came from - so they stay separate and out of the way.
 */
export interface ImpactScatterSettings {
  /**
   * 0 = a nudge, 1 = the room comes apart - and the knob goes to 1.1. Past 1 is
   * OVERDRIVE: deliberately more than the effect was designed for, so it has to
   * be pushed past a detent to get there. The last tenth roughly doubles the
   * launch speed again, which is the point - "100%" should already be violent,
   * and 110% should read as a decision.
   */
  impact: number
  /** Beats from the hit until the field has visibly settled home. */
  recoverBeats: number
  /** 0 = one clean radial pulse, 1 = shrapnel. */
  chaos: number
  /**
   * The SHAPE of the return: three named curves, borrowed wholesale from the
   * Colorizer's release shapes so the same word means the same thing in both
   * panels. Stored as -1 / 0 / +1 and read as a continuum, so an automation
   * lane can still sweep between them.
   *
   * SWELL (-1): the field hangs out at full displacement and only comes home at
   *  the end, in one smooth move. Low absorption, so nothing eats the excursion
   *  and the crest of the swing is what you watch.
   * EVEN (0): a straight, even decay home.
   * SPIKE (+1): most of the distance is recovered almost immediately and what is
   *  left becomes a long quiet tail. Heavy speed-squared absorption collapses
   *  the big excursion, then all but vanishes, leaving the slow linear settle -
   *  two timescales out of one impulse.
   */
  curve: number
  centerX: number
  centerY: number
  centerZ: number
}

/** The physics quantities the integration actually runs on. */
interface Tuning {
  /** Launch speed at the impact point, in units per beat. */
  blastSpeed: number
  /** Distance at which a hit retains half its power. */
  reach: number
  /** Units the blast front travels per beat, so far pieces leave late. */
  waveSpeed: number
  /** Sideways share of the throw, on each copy's own lateral axis. */
  scatter: number
  /** Extra kick a piece takes when it is ALREADY displaced. */
  pileup: number
  /** Bias of the throw along world +Y. */
  lift: number
  /** Spring period back home, in beats. */
  settleBeats: number
  /** 0 = critically damped, 1 = loose and overshooting. */
  bounce: number
  /** Speed-squared absorption. */
  drag: number
  /** Displacement at which the material fights back hard (cubic) - what bounds
   *  compounding, so stacked hits saturate instead of exiting the scene. */
  leash: number
  /** Volume-conserving stretch along the direction of travel, at full speed. */
  stretch: number
  /** Tangential share of the throw, as a multiple of the radial distance. */
  swirl: number
  /** Angular launch, degrees per beat, about each copy's own tumble axis. */
  spinKick: number
  /** Period of the unwind back to the original orientation, in beats. */
  unwindBeats: number
  /** 0 = the orientation unwinds and stops, 1 = it wobbles past home. */
  spinBounce: number
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

/**
 * Macros → physics. Every curve here is a tuning decision, not a formula:
 * the exponents put the interesting half of each range under the middle of the
 * knob's travel, and the constants are the values that survived looking at it.
 */
/** The three return shapes, matching the Colorizer's release-curve vocabulary.
 *  Signed so `tune()` can keep reading CURVE as a continuum. */
export const CURVE_SWELL = -1
export const CURVE_EVEN = 0
export const CURVE_SPIKE = 1

/** Where the knob catches, and the top of its overdrive travel. */
export const IMPACT_DETENT = 1
export const IMPACT_MAX = 1.1

export function tune(settings: ImpactScatterSettings): Tuning {
  const impact = clamp01(settings.impact)
  // Past the detent. The overdrive is a separate term rather than more of the
  // same curve, so the last tenth of travel is felt as its own event.
  const over = clamp01((Math.min(IMPACT_MAX, settings.impact) - IMPACT_DETENT) / (IMPACT_MAX - IMPACT_DETENT))
  const chaos = clamp01(settings.chaos)
  const recover = Math.max(0.1, settings.recoverBeats)
  const curve = Math.max(-1, Math.min(1, settings.curve))
  const gentle = Math.max(0, -curve)
  const punch = Math.max(0, curve)
  // A big hit has to reach further and be allowed to travel further, or it just
  // looks like the same blast with the gain up.
  const reach = 5 + 9 * impact + 9 * over
  // Speed-squared absorption is the whole CURVE knob. High drag eats the big
  // excursion in a few frames and then all but vanishes, which is the fast
  // recovery plus long tail of a percussive hit; low drag lets the swing hold
  // its crest and come home in one smooth move.
  const drag = 0.85 - 0.7 * gentle + 1.7 * punch
  return {
    // Steep on purpose (x^2.6): the bottom of the knob stays usable for a
    // nudge while the top half escalates hard, so 100% is already violent -
    // and the overdrive term more than doubles the launch speed again past the
    // detent.
    blastSpeed: (1.5 + 78 * Math.pow(impact, 2.6) + 95 * over)
      // Heavy absorption would otherwise make percussive hits travel a quarter
      // as far, and a gentle one twice as far - CURVE would read as a volume
      // knob and IMPACT would stop meaning anything. These two factors are
      // fitted against measured peak throw so the DISTANCE holds and only the
      // SHAPE changes.
      // The punch DRAG above is part of the same fit, and it is the term to
      // reach for first: drag is quadratic in speed, so raising the launch speed
      // costs the percussive shape ~4x more than the others and peak throw
      // saturates hard (measured: peak grows as speed^0.2 at SPIKE). Compensating
      // with this multiplier alone needs absurd values - retune the drag.
      * (1 + 3.4 * Math.pow(punch, 1.35)) * (1 - 0.5 * Math.pow(gentle, 0.85)),
    reach,
    // Tied to reach so the front always crosses the affected field in about the
    // same musical time - the ripple reads the same at every size.
    waveSpeed: reach * 3,
    scatter: 1.5 * Math.pow(chaos, 1.2),
    pileup: 0.2 + chaos,
    lift: 0.22,
    // Measured, not assumed. RECOVER promises a time, so the spring period has
    // to absorb whatever the CURVE shape does to the settling time: a gentle
    // return crosses home sooner in period-terms, a percussive one drags a tail
    // behind it. These two factors are fitted to hold "within 2% of home by
    // RECOVER beats" across the whole curve range (see the calibration test).
    settleBeats: recover * (1.15 + 0.3 * gentle - 0.42 * punch),
    // A gentler shape also wants a looser spring so the crest is broad; a
    // percussive one wants to arrive and stop.
    bounce: clamp01(0.12 + 0.45 * chaos + 0.22 * punch),
    drag,
    leash: 1.8 + 10 * impact + 13 * over,
    stretch: 0.5,
    swirl: 0.08 + 0.5 * chaos,
    spinKick: 40 + 900 * Math.pow(chaos, 1.3),
    // The tumble deliberately unwinds slower than the translation settles, so
    // orientation is still quietly resolving after the positions have landed.
    unwindBeats: recover * 2,
    spinBounce: 0.1 + 0.3 * chaos,
  }
}

/** The plane the blast swirls in. Fixed face-on (about Z) until there is a
 *  reason to expose it again. */
const FACE_ON_AXIS = new Vector3(0, 0, 1)
const UP = new Vector3(0, 1, 0)
const SIDE = new Vector3(1, 0, 0)
const DEG = Math.PI / 180

// Heat is kinetic energy, and how much of it shows is the mover's character
// rather than a decision: a flying piece runs hot and white, a settling one
// cools. Fixed so the three knobs stay about MOTION.
const FLASH_LIGHTNESS = 0.18
const FLASH_SATURATION = 0.1
const FLASH_HUE = 0.02

/** Gains sampled by the channel tables: 0, 1/8 … 1. apply() interpolates between
 *  neighbours, so the quantization is invisible - gain varies smoothly with
 *  distance and adjacent rungs differ by an eighth of an already-soft falloff. */
const GAIN_BUCKETS = 9
const SAMPLES_PER_BEAT = 32
/** Table samples per channel per gain bucket, summed over clusters. Long dense
 *  passages trade resolution for memory rather than growing without bound. */
const MAX_TOTAL_SAMPLES = 12000
const MIN_SAMPLES_PER_BEAT = 6
/** Longest tail worth integrating; a spring this slack has stopped reading as
 *  motion long before it is arithmetically zero. */
const MAX_TAIL_BEATS = 48
/** Guard rails so a pathological settings combination can never produce NaN
 *  geometry: the leash makes these unreachable in practice. */
const MAX_EXTENSION = 24
const MAX_SPEED = 400

/** One note's effect on one channel: a velocity kick, or a request to damp. */
interface ChannelEvent {
  beat: number
  /** Added to the channel's velocity (before pileup). */
  kick: number
  /** 0 = none; 1 = fully snap this channel back to rest. */
  damp: number
}

interface ChannelConfig {
  /** Natural frequency, radians per beat. */
  omega: number
  /** Damping ratio. */
  zeta: number
  /** Quadratic drag, nondimensionalized by omega and `leash` so it stays
   *  comparable to 1 whatever units the scene works in. */
  drag: number
  /** Displacement scale at which the cubic containment matches the spring. */
  leash: number
  pileup: number
}

/** A sampled scalar trajectory: displacement and its rate, in channel units. */
interface Channel {
  position: Float32Array
  velocity: Float32Array
}

interface Cluster {
  /** Beat of sample 0. */
  start: number
  /** Beats per sample. */
  step: number
  /** Beat of the last sample. */
  end: number
  /** One entry per gain bucket, in ascending gain order. */
  buckets: { radial: Channel; lateral: Channel; spin: Channel }[]
}

/**
 * March one scalar channel through its events with RK4.
 *
 * x'' = -omega^2 (x + x^3/leash^2) - 2 zeta omega x' - (drag omega / leash)|x'|x'
 *
 * Integration stops exactly on each event beat so a kick lands at the same
 * instant regardless of the sample grid - two hits a 64th note apart stay two
 * hits, and moving the sample rate never moves the music.
 */
function integrateChannel(
  events: readonly ChannelEvent[],
  config: ChannelConfig,
  start: number,
  step: number,
  samples: number,
): Channel {
  const position = new Float32Array(samples)
  const velocity = new Float32Array(samples)
  const stiffness = config.omega * config.omega
  const leashSquared = config.leash * config.leash
  const linear = 2 * config.zeta * config.omega
  const quadratic = (config.drag * config.omega) / config.leash

  const accel = (x: number, v: number) =>
    -stiffness * (x + (x * x * x) / leashSquared)
    - linear * v
    - quadratic * Math.abs(v) * v

  // Substeps are chosen from the stiffest term the state can reach, so one
  // fixed rule is accurate for a 0.2-beat snap and an 8-beat swell alike.
  const substeps = Math.min(32, Math.max(2, Math.ceil((step * config.omega * 3) / 0.05)))

  let x = 0
  let v = 0
  let beat = start
  let next = 0

  const advance = (to: number) => {
    const total = to - beat
    if (total <= 1e-12) { beat = to; return }
    // Never step coarser than one substep, and land exactly on `to` so an event
    // beat is hit dead on rather than at the nearest grid point.
    const pieces = Math.max(1, Math.ceil(total / (step / substeps)))
    const h = total / pieces
    for (let piece = 0; piece < pieces; piece++) {
      const k1x = v
      const k1v = accel(x, v)
      const k2x = v + (h / 2) * k1v
      const k2v = accel(x + (h / 2) * k1x, v + (h / 2) * k1v)
      const k3x = v + (h / 2) * k2v
      const k3v = accel(x + (h / 2) * k2x, v + (h / 2) * k2v)
      const k4x = v + h * k3v
      const k4v = accel(x + h * k3x, v + h * k3v)
      x += (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x)
      v += (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v)
      if (!Number.isFinite(x) || !Number.isFinite(v)) { x = 0; v = 0 }
      x = Math.max(-MAX_EXTENSION * config.leash, Math.min(MAX_EXTENSION * config.leash, x))
      v = Math.max(-MAX_SPEED * config.leash, Math.min(MAX_SPEED * config.leash, v))
    }
    beat = to
  }

  for (let i = 0; i < samples; i++) {
    const target = start + i * step
    while (next < events.length && events[next].beat <= target + 1e-12) {
      advance(events[next].beat)
      // Pileup reads the state the kick is landing ON - the whole point of
      // integrating rather than superposing. Capped so a long roll escalates
      // toward a limit instead of running away.
      const excited = Math.min(3, Math.abs(x) / config.leash)
      v += events[next].kick * (1 + config.pileup * excited)
      if (events[next].damp > 0) {
        const keep = 1 - Math.min(1, events[next].damp)
        x *= keep
        v *= keep
      }
      next++
    }
    advance(target)
    position[i] = x
    velocity[i] = v
  }
  return { position, velocity }
}

/** Linear read of a channel table; outside the window the field is at rest. */
function sampleChannel(channel: Channel, cluster: Cluster, beat: number): [number, number] {
  if (beat <= cluster.start || beat >= cluster.end) return [0, 0]
  const u = (beat - cluster.start) / cluster.step
  const i = Math.floor(u)
  const frac = u - i
  return [
    channel.position[i] + (channel.position[i + 1] - channel.position[i]) * frac,
    channel.velocity[i] + (channel.velocity[i + 1] - channel.velocity[i]) * frac,
  ]
}

/** Deterministic hash in [0,1) - the seeded-randomness rule, no Math.random. */
function hash(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

interface Strike {
  beat: number
  power: number
  /** +1 = blast outward, -1 = implode, 0 = a settle request. */
  direction: number
  /** Fraction of the state a settle note removes. */
  damp: number
  /** ±1, alternating between strikes, applied to the lateral and spin channels
   *  so consecutive hits throw the field sideways in OPPOSITE senses. Without
   *  it a roll scatters the same way every time and reads as a repeat; with it
   *  the field churns. */
  parity: number
}

export const impactScatterMover: MoverOrSplitterDefinition<ImpactScatterSettings> = {
  id: 'impactScatter',
  label: 'Impact Scatter',
  kind: 'mover',
  params: [
    { key: 'impact', label: 'Impact', min: 0, max: IMPACT_MAX, step: 0.01, default: 0.6 },
    { key: 'recoverBeats', label: 'Recover (beats)', min: 0.25, max: 8, step: 0.05, default: 2 },
    { key: 'chaos', label: 'Chaos', min: 0, max: 1, step: 0.01, default: 0.45 },
    {
      key: 'curve',
      label: 'Curve',
      type: 'select',
      // Ordered as the bipolar knob it replaces turned: holds-out on the left,
      // collapses-fast on the right.
      options: [
        { value: CURVE_SWELL, label: 'Swell' },
        { value: CURVE_EVEN, label: 'Even' },
        { value: CURVE_SPIKE, label: 'Spike' },
      ],
      default: CURVE_EVEN,
    },
    { key: 'centerX', label: 'Center X', min: -20, max: 20, step: 0.1, default: 0 },
    { key: 'centerY', label: 'Center Y', min: -20, max: 20, step: 0.1, default: 0 },
    { key: 'centerZ', label: 'Center Z', min: -20, max: 20, step: 0.1, default: 0 },
  ],
  midiRows: () => [
    { pitch: SCATTER_SETTLE_PITCH, label: 'Snap home (damp)' },
    { pitch: SCATTER_IMPLODE_PITCH, label: 'Implode (pull in)' },
    { pitch: SCATTER_IMPACT_PITCH, label: 'Impact (blast out)', emphasized: true },
  ],
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const tuning = tune(settings)
    const center = new Vector3(settings.centerX, settings.centerY, settings.centerZ)
    const omega = (2 * Math.PI) / Math.max(0.05, tuning.settleBeats)
    // bounce 0 -> critically damped, bounce 1 -> zeta 0.15 (loose and ringing).
    const zeta = 1 - 0.85 * clamp01(tuning.bounce)
    const leash = Math.max(0.1, tuning.leash)
    const drag = Math.max(0, tuning.drag)
    const pileup = Math.max(0, tuning.pileup)
    const spinOmega = (2 * Math.PI) / Math.max(0.05, tuning.unwindBeats)
    const spinZeta = 1 - 0.85 * clamp01(tuning.spinBounce)
    const reach = Math.max(0.0001, tuning.reach)
    const frontSpeed = Math.max(0.0001, tuning.waveSpeed)
    // Face-on for now: the swirl plane was a knob nobody needed to reach for.
    const swirlAxis = FACE_ON_AXIS

    const linearConfig = (extra: Partial<ChannelConfig> = {}): ChannelConfig =>
      ({ omega, zeta, drag, leash, pileup, ...extra })
    // The tumble is a linear damped spring in degrees: no drag (a silky unwind
    // is the point) and a leash loose enough to be effectively absent until a
    // roll has spun a piece several turns.
    const spinConfig: ChannelConfig = {
      omega: spinOmega, zeta: spinZeta, drag: 0, leash: 2000, pileup,
    }

    // Strikes, in beat order. A note whose onset falls outside its own block is
    // not playing; ringing PAST the block end is kept deliberately - a physical
    // field does not stop mid-flight because a block ended.
    const strikes: Strike[] = notes
      .filter((note: ResolvedNote) =>
        (note.pitch === SCATTER_IMPACT_PITCH
          || note.pitch === SCATTER_IMPLODE_PITCH
          || note.pitch === SCATTER_SETTLE_PITCH)
        && note.beat >= note.blockStartBeat && note.beat < note.blockEndBeat)
      .map((note) => ({
        beat: note.beat,
        power: normalizedVelocity(note.velocity),
        direction: note.pitch === SCATTER_IMPACT_PITCH ? 1 : note.pitch === SCATTER_IMPLODE_PITCH ? -1 : 0,
        damp: note.pitch === SCATTER_SETTLE_PITCH ? normalizedVelocity(note.velocity) : 0,
        parity: 1,
      }))
      .sort((a, b) => a.beat - b.beat)

    // How long after the last kick the field is still visibly moving. Both
    // springs decay as e^(-zeta*omega*t); 4.6 time constants is ~1%.
    const tail = Math.min(
      MAX_TAIL_BEATS,
      Math.max(
        4.6 / Math.max(0.05, zeta * omega),
        4.6 / Math.max(0.05, spinZeta * spinOmega),
      ),
    )

    // Split at silences longer than the tail: across such a gap the field is at
    // rest, so the two sides cannot influence each other and each gets its own
    // short window. Rapid fire always lands inside ONE cluster, which is
    // exactly where compounding has to be exact.
    const groups: Strike[][] = []
    for (const strike of strikes) {
      const current = groups[groups.length - 1]
      if (!current || strike.beat - current[current.length - 1].beat > tail) groups.push([strike])
      else current.push(strike)
    }
    // Parity is numbered WITHIN a cluster, so a burst looks the same however
    // many hits happened bars earlier - the field was at rest in between, and
    // nothing that far back should be able to flip which way it scatters.
    for (const group of groups) {
      group.forEach((strike, index) => { strike.parity = index % 2 === 0 ? 1 : -1 })
    }

    const totalSpan = groups.reduce(
      (sum, group) => sum + (group[group.length - 1].beat - group[0].beat) + tail,
      0,
    )
    const rate = totalSpan > 0
      ? Math.max(MIN_SAMPLES_PER_BEAT, Math.min(SAMPLES_PER_BEAT, MAX_TOTAL_SAMPLES / totalSpan))
      : SAMPLES_PER_BEAT

    const clusters: Cluster[] = groups.map((group) => {
      const first = group[0].beat
      const last = group[group.length - 1].beat
      const start = first - 1 / rate
      const step = 1 / rate
      const samples = Math.max(2, Math.round((last + tail - start) * rate) + 1)
      const buckets = Array.from({ length: GAIN_BUCKETS }, (_, bucket) => {
        const gain = bucket / (GAIN_BUCKETS - 1)
        const kicks = (scale: number, alternate: boolean): ChannelEvent[] => group.map((strike) => ({
          beat: strike.beat,
          kick: strike.direction * (alternate ? strike.parity : 1) * strike.power * gain * scale,
          damp: strike.damp,
        }))
        return {
          radial: integrateChannel(
            kicks(tuning.blastSpeed, false), linearConfig(), start, step, samples,
          ),
          lateral: integrateChannel(
            kicks(tuning.blastSpeed * Math.max(0, tuning.scatter), true), linearConfig(), start, step, samples,
          ),
          // Tumble ignores implode/blast sign: a hit spins a piece either way.
          spin: integrateChannel(
            group.map((strike) => ({
              beat: strike.beat,
              kick: (strike.direction === 0 ? 0 : 1) * strike.parity * strike.power * gain * tuning.spinKick,
              damp: strike.damp,
            })),
            spinConfig, start, step, samples,
          ),
        }
      })
      return { start, step, end: start + (samples - 1) * step, buckets }
    })

    const speedScale = Math.max(0.0001, Math.abs(tuning.blastSpeed))

    return {
      apply(visualCopy, { beat, index, placementTransform }) {
        const placed = placementTransform
          ? placementTransform.clone().multiply(visualCopy.transform)
          : visualCopy.transform
        const home = new Vector3().setFromMatrixPosition(placed)
        const radial = home.clone().sub(center)
        const distance = radial.length()
        // Energy spreading over an expanding front: full at the impact point,
        // half at `reach`, never a hard edge.
        const gain = 1 / (1 + (distance / reach) * (distance / reach))
        // The front takes time to arrive, so the near field is already flying
        // while the far field has not been told yet.
        const local = beat - distance / frontSpeed

        // Read the two gain rungs bracketing this copy and blend.
        const rung = gain * (GAIN_BUCKETS - 1)
        const lower = Math.max(0, Math.min(GAIN_BUCKETS - 2, Math.floor(rung)))
        const blend = Math.max(0, Math.min(1, rung - lower))

        let extension = 0
        let extensionRate = 0
        let lateral = 0
        let lateralRate = 0
        let spin = 0
        for (const cluster of clusters) {
          if (local <= cluster.start || local >= cluster.end) continue
          const near = cluster.buckets[lower]
          const far = cluster.buckets[lower + 1]
          const [nearRadial, nearRadialRate] = sampleChannel(near.radial, cluster, local)
          const [farRadial, farRadialRate] = sampleChannel(far.radial, cluster, local)
          const [nearLateral, nearLateralRate] = sampleChannel(near.lateral, cluster, local)
          const [farLateral, farLateralRate] = sampleChannel(far.lateral, cluster, local)
          // Only the tumble ANGLE is needed; its rate does not feed the look.
          const [nearSpin] = sampleChannel(near.spin, cluster, local)
          const [farSpin] = sampleChannel(far.spin, cluster, local)
          extension += nearRadial + (farRadial - nearRadial) * blend
          extensionRate += nearRadialRate + (farRadialRate - nearRadialRate) * blend
          lateral += nearLateral + (farLateral - nearLateral) * blend
          lateralRate += nearLateralRate + (farLateralRate - nearLateralRate) * blend
          spin += nearSpin + (farSpin - nearSpin) * blend
        }

        const moving = Math.abs(extension) > 1e-6 || Math.abs(lateral) > 1e-6
          || Math.abs(spin) > 1e-6 || Math.abs(extensionRate) > 1e-6 || Math.abs(lateralRate) > 1e-6
        if (!moving) {
          return [{
            transform: visualCopy.transform.clone(),
            opacity: visualCopy.opacity,
            colorShift: { ...visualCopy.colorShift },
          }]
        }

        // ── This copy's fixed throw frame ───────────────────────────────────
        // Seeded from the home position AND the copy index, so two copies that
        // share a position (a splitter stack) still scatter apart, and the
        // whole frame is a pure function of structure - no state, no clock.
        const seed = home.x * 12.9898 + home.y * 78.233 + home.z * 37.719 + index * 4.271
        const outward = distance > 1e-6
          ? radial.clone().divideScalar(distance)
          : new Vector3(
            hash(seed) * 2 - 1,
            hash(seed + 1.7) * 2 - 1,
            hash(seed + 3.3) * 2 - 1,
          ).normalize()
        if (tuning.lift !== 0) {
          outward.addScaledVector(UP, tuning.lift)
          if (outward.lengthSq() < 1e-8) outward.copy(UP)
          outward.normalize()
        }
        // A perpendicular pair, then the copy's lateral axis at a hashed angle
        // within that plane: every piece is spat off in its own direction while
        // the field as a whole still expands.
        const firstPerpendicular = new Vector3().crossVectors(outward, UP)
        if (firstPerpendicular.lengthSq() < 1e-8) firstPerpendicular.crossVectors(outward, SIDE)
        firstPerpendicular.normalize()
        const secondPerpendicular = new Vector3().crossVectors(outward, firstPerpendicular).normalize()
        const lateralAngle = hash(seed + 9.13) * Math.PI * 2
        const lateralAxis = firstPerpendicular.clone().multiplyScalar(Math.cos(lateralAngle))
          .addScaledVector(secondPerpendicular, Math.sin(lateralAngle))
        // Tumble about a hashed axis, tilted off the throw so pieces do not all
        // cartwheel in the same plane.
        const spinAxis = new Vector3(
          hash(seed + 21.4) * 2 - 1,
          hash(seed + 33.2) * 2 - 1,
          hash(seed + 47.9) * 2 - 1,
        )
        if (spinAxis.lengthSq() < 1e-8) spinAxis.copy(lateralAxis)
        spinAxis.normalize()

        const offset = outward.clone().multiplyScalar(extension)
          .addScaledVector(lateralAxis, lateral)
        const travel = outward.clone().multiplyScalar(extensionRate)
          .addScaledVector(lateralAxis, lateralRate)
        const speed = travel.length()

        const pivot = new Matrix4().makeTranslation(home.x, home.y, home.z)
        const unpivot = new Matrix4().makeTranslation(-home.x, -home.y, -home.z)

        // Squash & stretch on SPEED, not displacement: real stretch peaks
        // mid-flight, and reading it off position is the usual tell. Volume
        // conserving, so a piece thins across travel as it elongates along it.
        let stretchMatrix = new Matrix4()
        if (tuning.stretch !== 0 && speed > 1e-6) {
          const direction = travel.clone().divideScalar(speed)
          const along = Math.max(0.05, 1 + tuning.stretch * Math.tanh(speed / speedScale))
          const across = 1 / Math.sqrt(along)
          let sideA = new Vector3().crossVectors(direction, UP)
          if (sideA.lengthSq() < 1e-8) sideA = new Vector3().crossVectors(direction, SIDE)
          sideA.normalize()
          const sideB = new Vector3().crossVectors(direction, sideA).normalize()
          const basis = new Matrix4().makeBasis(direction, sideA, sideB)
          stretchMatrix = pivot.clone()
            .multiply(basis)
            .multiply(new Matrix4().makeScale(along, across, across))
            .multiply(basis.clone().transpose())
            .multiply(unpivot)
        }

        const tumble = pivot.clone()
          .multiply(new Matrix4().makeRotationAxis(spinAxis, spin * DEG))
          .multiply(unpivot)

        // The swirl is the tangential COMPONENT of the same throw, not a
        // separate orbit: arc length is a fixed multiple of the distance
        // travelled, on the same signal at the same instant, so each piece
        // traces one curve. Dividing arc by a softened radius keeps rings
        // coherent - the far ring sweeps the same distance through a smaller
        // angle, instead of smearing past the near one.
        const swirl = new Matrix4().makeTranslation(center.x, center.y, center.z)
          .multiply(new Matrix4().makeRotationAxis(
            swirlAxis,
            (tuning.swirl * extension) / Math.sqrt(distance * distance + 1),
          ))
          .multiply(new Matrix4().makeTranslation(-center.x, -center.y, -center.z))

        // WORLD composition, right-to-left as the piece experiences it: deform
        // in place, tumble in place, get thrown, then be carried around the
        // impact axis by the swirl.
        const worldDelta = swirl
          .multiply(new Matrix4().makeTranslation(offset.x, offset.y, offset.z))
          .multiply(tumble)
          .multiply(stretchMatrix)

        // Conjugating by placement turns the world-space delta back into the
        // VisualCopy space the renderer expects (identical to forceFieldPush).
        const transform = placementTransform
          ? placementTransform.clone().invert()
            .multiply(worldDelta)
            .multiply(placementTransform)
            .multiply(visualCopy.transform.clone())
          : worldDelta.multiply(visualCopy.transform.clone())

        // Heat tracks kinetic energy, so the flash blooms while a piece is
        // flying and fades as it settles - never a separate arbitrary curve.
        const heat = Math.min(1, (speed / speedScale) * (speed / speedScale))
        return [{
          transform,
          opacity: visualCopy.opacity,
          colorShift: {
            ...visualCopy.colorShift,
            hue: visualCopy.colorShift.hue + FLASH_HUE * heat,
            saturation: visualCopy.colorShift.saturation + FLASH_SATURATION * heat,
            lightness: visualCopy.colorShift.lightness + FLASH_LIGHTNESS * heat,
          },
        }]
      },
    }
  },
}
