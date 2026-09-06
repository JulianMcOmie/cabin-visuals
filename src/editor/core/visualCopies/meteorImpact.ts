// Meteor Impact: one note, one whole gesture.
//
// A shockwave leaves the impact center at a finite speed, so a copy standing
// far out does not move until the front actually reaches it - that propagation
// delay is what makes the room read as RIPPLING rather than pulsing in unison.
//
// ── Why this is an ODE and not a stack of easing curves ─────────────────────
//
// The naive way to build an impact is to multiply envelopes together: a rise
// curve times a decay curve times a sine. It always looks synthetic, because
// the product is not the solution of anything - its acceleration profile is
// whatever falls out of the algebra, phases are glued at seams, and the ring
// frequency is bolted on rather than emerging from the material.
//
// Real motion software (Apple's spring API, Framer Motion, Rive, After Effects'
// inertial bounce) instead solves the damped harmonic oscillator
//
//     x'' + 2*zeta*x' + x = f(s)          (time nondimensionalized by omega)
//
// and exposes zeta (damping ratio) and the natural period as the two knobs.
// zeta is the whole vocabulary of feel: 1.0 is critically damped (arrives and
// stops, no overshoot), ~0.6 is the expressive range good motion design lives
// in, ~0.25 is cartoon-bouncy. So this mover exposes exactly that, as `bounce`.
//
// Three things lift it past a stock spring:
//
//   * ONE continuous trajectory. The anticipation is not a separate eased
//     segment spliced onto the strike - it is a small NEGATIVE lobe in the
//     driving force, ahead of the main lobe. Anticipation, strike, overshoot,
//     and settle all fall out of a single integration, so every derivative is
//     continuous by construction and nothing has a seam to see.
//
//   * QUADRATIC DRAG (drag*|x'|x'), not just linear damping. Linear damping
//     decays every swing by the same ratio, which is the "mechanical" look.
//     Quadratic drag scales with speed squared, so it eats the big first
//     overshoot hard and then almost vanishes - giving the asymmetric "one
//     generous swing, then a long silky settle" that reads as weight and is
//     what animators draw by hand. It also makes the system nonlinear, which
//     is why the response is integrated rather than written in closed form.
//
//   * A FORCE WITH SHAPE. The strike is a gamma pulse (s/tau)^2 * e^(2(1-s/tau)),
//     whose value AND slope are zero at s = 0. The motion therefore leaves rest
//     with zero velocity, zero acceleration, and zero jerk: it blooms out of
//     stillness instead of being kicked, which is the difference between
//     "fluid" and "sudden".
//
// Two more principles from hand animation, applied per copy:
//
//   * OVERLAPPING ACTION - scale leads the translation (anticipatory squash)
//     and rotation lags it (follow-through). Nothing peaks at the same instant.
//   * DISPERSION - the front broadens as it travels. Near the center the hit is
//     violent and quick; far out the same gesture arrives stretched in time and
//     lower in frequency, a slow rolling swell rather than a small fast copy of
//     the snap. This is what makes the outer ring beautiful instead of busy.
//
// The response is integrated once per resolve into a normalized table, then
// sampled - so it stays a pure function of the playhead beat with no playback
// state, and scrub, playback, and export agree exactly.

import { Matrix4, Vector3 } from 'three'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import { midiVelocity } from '../../utils/midiVelocity'
import { METEOR_IMPACT_COLOR } from './identityColors'
import { smoothstep } from '../../utils/math'

// ── The held vortex ──────────────────────────────────────────────────────────
//
// A sustained note warps the space itself into an endless spiral flow. The
// trick to making a flow LOOP without a visible seam is to run it in LOG-RADIUS
// space: a copy's radius is rho * e^(L*phase), so one lap of the loop is a
// multiplication by a fixed ratio rather than an addition of a fixed distance.
// Scaling is self-similar - the pattern at 4x looks like the pattern at 1x - so
// recycling a copy from the outer edge back to the inner edge lands it somewhere
// the eye already accepts. This is the same conformal (log-spiral / Droste)
// construction behind infinite-zoom and warp-tunnel effects.
//
// Three details make it read as one continuous fluid rather than a cycle:
//
//   * Each copy's phase is seeded from its OWN radius, so copies wrap at
//     staggered moments instead of the whole field blinking at once.
//   * Rotation advances in proportion to the radial phase, so every copy traces
//     a true logarithmic spiral, and an axial shear term tilts that spiral into
//     a 3D funnel instead of a flat pinwheel.
//   * Opacity dips at the wrap boundary, so a copy dissolves as it leaves and
//     resolves as it re-enters - the handoff the eye never catches.
//
// The note's envelope rides the flow's SPEED, and position is the exact
// integral of that speed. So the vortex eases into motion and coasts to a stop,
// never jumping, and holding a note longer simply turns further. At zero phase
// the whole warp is exactly the identity, which is what lets it stack cleanly
// on top of an impact instead of fighting it.

export const METEOR_IMPACT_PITCH = 60
export const VORTEX_OUT_PITCH = 61
export const VORTEX_IN_PITCH = 62

export interface MeteorImpactSettings {
  centerX: number
  centerY: number
  centerZ: number
  /** Units the shockwave front travels per beat. Lower = a slower, wider ripple. */
  waveSpeed: number
  /** Peak outward distance at the center, before falloff and note velocity. */
  strength: number
  /** Distance at which the impact retains half its power. */
  reach: number
  /** How much the pulse broadens with distance. 0 = every copy runs the same
   *  timing; higher = the far ring swells slowly while the center snaps. */
  dispersion: number
  /** Natural period of the material. The "weight" knob - long feels massive. */
  responseBeats: number
  /** 0 = critically damped (no overshoot), 1 = loose and springy. Sets zeta. */
  bounce: number
  /** Speed-squared absorption. Eats the first big swing, leaves the settle silky. */
  drag: number
  /** Rise time of the driving force. Short = a crack, long = a shove. */
  strikeBeats: number
  /** Inward lean before the front lands, as a fraction of the strike force. */
  anticipation: number
  /** How far ahead of the front the lean begins. */
  leadBeats: number
  /** Volume-conserving stretch along the direction of travel, at peak speed. */
  stretch: number
  /** Overlapping action: scale leads by this, rotation lags by this. */
  overlapBeats: number
  /** Peak tumble about the axis perpendicular to travel. */
  tumbleDegrees: number
  /**
   * Tangential share of the throw, as a multiple of the radial distance. The
   * swirl is not an independent orbit: it is the sideways half of the SAME
   * impulse, so a copy that is thrown twice as far also slides twice as far
   * around, on exactly the same curve. 0 = a pure radial blast.
   */
  swirl: number
  /** 0 = X, 1 = Y, 2 = Z. */
  swirlAxis: number
  flashLightness: number
  flashSaturation: number
  flashHue: number
  /** Loops of the vortex per beat while a note is held at full velocity. */
  vortexRate: number
  /** Radius copies are recycled back to. */
  vortexInner: number
  /** Radius copies travel out to before recycling. */
  vortexOuter: number
  /** Revolutions per loop - turns the radial flow into a logarithmic spiral. */
  vortexTwist: number
  /** Extra revolutions per loop per unit along the axis: tilts the flat spiral
   *  into a 3D funnel, since near and far layers no longer turn together. */
  vortexShear: number
  /** 1 = fully conformal (copies grow with the flow, the true infinite-zoom
   *  illusion), 0 = copies hold their size and only their positions flow. */
  vortexGrow: number
  /** How far opacity dips at the wrap boundary to hide the recycle. */
  vortexFade: number
  /** Fraction of each loop spent fading in and out. */
  vortexFadeWidth: number
  /** Ease-in on the flow speed at note-on. */
  vortexAttack: number
  /** Ease-out on the flow speed at note-off. */
  vortexRelease: number
}

const SWIRL_AXES = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
const UP = new Vector3(0, 1, 0)
const SIDE = new Vector3(1, 0, 0)
const DEG = Math.PI / 180
const SAMPLES = 1536
const SUBSTEPS = 6

/**
 * The driving force, in nondimensional time. Negative lobe first (the material
 * leaning in toward the incoming mass), then the strike.
 *
 * The strike is a gamma pulse with k = 2: f(0) = 0 AND f'(0) = 0, so the
 * response leaves rest with zero velocity, acceleration, and jerk.
 */
function force(s: number, tau: number, lead: number, anticipation: number): number {
  if (s < 0) {
    if (s <= -lead || lead <= 0 || anticipation <= 0) return 0
    // A sin^2 lobe: zero value and zero slope at both ends, so the lean starts
    // and finishes without a kink, and hands off to the strike at exactly zero.
    const u = (s + lead) / lead
    return -anticipation * Math.sin(Math.PI * u) * Math.sin(Math.PI * u)
  }
  const ratio = s / tau
  return ratio * ratio * Math.exp(2 * (1 - ratio))
}

interface Response {
  /** Displacement, normalized to peak 1. */
  position: Float64Array
  /** Velocity, normalized to peak 1. */
  velocity: Float64Array
  /** Nondimensional time of sample 0 (negative - the anticipation window). */
  start: number
  /** Nondimensional time per sample. */
  step: number
  /** Nondimensional time of the last sample. */
  end: number
}

/**
 * Integrate x'' + 2*zeta*x' + drag*|x'|x' + x = f(s) with RK4 and normalize.
 *
 * Nondimensionalizing by omega is what keeps this well-conditioned: every
 * quantity is O(1) regardless of how the period is dialed, so one fixed step
 * count is accurate for a heavy 8-beat swell and a 0.1-beat snap alike.
 *
 * The drag term makes the system nonlinear, so the SHAPE technically depends on
 * force magnitude. Normalizing afterwards and scaling per copy linearly is the
 * deliberate simplification: one table serves every copy, and the character of
 * the curve is owned by the settings rather than by how hard a note was hit.
 */
function integrateResponse(zeta: number, drag: number, tau: number, lead: number, anticipation: number): Response {
  const start = -lead
  const end = Math.max(10 / Math.max(zeta, 0.12), 6 * Math.PI, tau * 8)
  const step = (end - start) / (SAMPLES - 1)
  const h = step / SUBSTEPS
  const position = new Float64Array(SAMPLES)
  const velocity = new Float64Array(SAMPLES)

  const accel = (s: number, x: number, v: number) =>
    force(s, tau, lead, anticipation) - 2 * zeta * v - drag * Math.abs(v) * v - x

  let x = 0
  let v = 0
  let peakPosition = 1e-9
  let peakVelocity = 1e-9
  for (let i = 1; i < SAMPLES; i++) {
    let s = start + (i - 1) * step
    for (let sub = 0; sub < SUBSTEPS; sub++) {
      const k1x = v
      const k1v = accel(s, x, v)
      const k2x = v + (h / 2) * k1v
      const k2v = accel(s + h / 2, x + (h / 2) * k1x, v + (h / 2) * k1v)
      const k3x = v + (h / 2) * k2v
      const k3v = accel(s + h / 2, x + (h / 2) * k2x, v + (h / 2) * k2v)
      const k4x = v + h * k3v
      const k4v = accel(s + h, x + h * k3x, v + h * k3v)
      x += (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x)
      v += (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v)
      s += h
    }
    position[i] = x
    velocity[i] = v
    peakPosition = Math.max(peakPosition, Math.abs(x))
    peakVelocity = Math.max(peakVelocity, Math.abs(v))
  }
  for (let i = 0; i < SAMPLES; i++) {
    position[i] /= peakPosition
    velocity[i] /= peakVelocity
  }
  return { position, velocity, start, step, end }
}

/** Linear read of the table. Outside its window the material is at rest. */
function sample(table: Float64Array, response: Response, s: number): number {
  if (s <= response.start || s >= response.end) return 0
  const u = (s - response.start) / response.step
  const i = Math.floor(u)
  const frac = u - i
  return table[i] + (table[i + 1] - table[i]) * frac
}

/** Integral of smoothstep over [0, u]. */
function smoothstepIntegral(u: number): number {
  const x = Math.max(0, Math.min(1, u))
  return x * x * x - (x * x * x * x) / 2
}

/** The held note's envelope, applied to the vortex's SPEED. */
function holdGate(beat: number, start: number, end: number, attack: number, release: number): number {
  if (beat <= start) return 0
  // A note shorter than the attack never reaches full speed, and releases from
  // whatever it did reach - so short taps nudge the flow and long holds spin it.
  const peak = attack > 0 ? smoothstep((end - start) / attack) : 1
  if (beat < end) return attack > 0 ? smoothstep((beat - start) / attack) : 1
  if (release <= 0) return 0
  return peak * (1 - smoothstep((beat - end) / release))
}

/**
 * Exact integral of holdGate: the flow's POSITION.
 *
 * Easing the speed and integrating it - rather than easing the position - is
 * what makes the vortex feel like a mass being spun up. Position stays
 * continuous through note-on and note-off no matter when they land, so the
 * flow can only ever change how fast it turns, never where it is.
 */
function holdPhase(beat: number, start: number, end: number, attack: number, release: number): number {
  if (beat <= start) return 0
  const riseEnd = attack > 0 ? Math.min(start + attack, end) : start
  let total = attack > 0 ? attack * smoothstepIntegral((Math.min(beat, riseEnd) - start) / attack) : 0
  if (beat <= riseEnd) return total
  total += Math.min(beat, end) - riseEnd
  if (beat <= end || release <= 0) return total
  const peak = attack > 0 ? smoothstep((end - start) / attack) : 1
  const v = Math.min(1, (beat - end) / release)
  return total + peak * release * (v - smoothstepIntegral(v))
}

export const meteorImpactMover: MoverOrSplitterDefinition<MeteorImpactSettings> = {
  id: 'meteorImpact',
  label: 'Meteor Impact',
  kind: 'mover',
  identityColor: METEOR_IMPACT_COLOR,
  params: [
    { key: 'centerX', label: 'Center X', min: -20, max: 20, step: 0.1, default: 0 },
    { key: 'centerY', label: 'Center Y', min: -20, max: 20, step: 0.1, default: 0 },
    { key: 'centerZ', label: 'Center Z', min: -20, max: 20, step: 0.1, default: 0 },
    { key: 'waveSpeed', label: 'Wave speed (units/beat)', min: 0.25, max: 40, step: 0.25, default: 7 },
    { key: 'strength', label: 'Impact distance', min: 0, max: 10, step: 0.05, default: 1.5 },
    { key: 'reach', label: 'Half-power radius', min: 0.5, max: 40, step: 0.5, default: 9 },
    { key: 'dispersion', label: 'Wave spread', min: 0, max: 3, step: 0.05, default: 0.9 },
    { key: 'responseBeats', label: 'Weight (period, beats)', min: 0.1, max: 8, step: 0.05, default: 1.3 },
    { key: 'bounce', label: 'Bounce', min: 0, max: 1, step: 0.01, default: 0.45 },
    { key: 'drag', label: 'Absorption', min: 0, max: 2, step: 0.01, default: 0.4 },
    { key: 'strikeBeats', label: 'Strike rise (beats)', min: 0.01, max: 2, step: 0.01, default: 0.13 },
    { key: 'anticipation', label: 'Anticipation pull', min: 0, max: 1, step: 0.01, default: 0.18 },
    { key: 'leadBeats', label: 'Anticipation lead (beats)', min: 0, max: 4, step: 0.05, default: 0.5 },
    { key: 'stretch', label: 'Squash & stretch', min: 0, max: 1.5, step: 0.01, default: 0.4 },
    { key: 'overlapBeats', label: 'Overlap (beats)', min: 0, max: 1, step: 0.01, default: 0.07 },
    { key: 'tumbleDegrees', label: 'Tumble (°)', min: -360, max: 360, step: 1, default: 28 },
    { key: 'swirl', label: 'Swirl (× throw)', min: -2, max: 2, step: 0.01, default: 0.35 },
    {
      key: 'swirlAxis',
      label: 'Swirl axis',
      type: 'select',
      options: [
        { value: 2, label: 'Z (face-on impact)' },
        { value: 1, label: 'Y (ground impact)' },
        { value: 0, label: 'X' },
      ],
      default: 2,
    },
    { key: 'flashLightness', label: 'Flash lightness', min: -1, max: 1, step: 0.01, default: 0.22 },
    { key: 'flashSaturation', label: 'Flash saturation', min: -1, max: 1, step: 0.01, default: 0.16 },
    { key: 'flashHue', label: 'Flash hue shift', min: -1, max: 1, step: 0.01, default: 0.04 },
    { key: 'vortexRate', label: 'Vortex speed (loops/beat)', min: 0, max: 2, step: 0.01, default: 0.22 },
    { key: 'vortexInner', label: 'Vortex inner radius', min: 0.05, max: 20, step: 0.05, default: 0.6 },
    { key: 'vortexOuter', label: 'Vortex outer radius', min: 0.1, max: 40, step: 0.1, default: 7 },
    { key: 'vortexTwist', label: 'Vortex twist (turns/loop)', min: -3, max: 3, step: 0.01, default: 0.4 },
    { key: 'vortexShear', label: 'Vortex funnel (turns/loop/unit)', min: -1, max: 1, step: 0.01, default: 0.06 },
    { key: 'vortexGrow', label: 'Vortex growth', min: 0, max: 1, step: 0.01, default: 0.25 },
    { key: 'vortexFade', label: 'Vortex wrap fade', min: 0, max: 1, step: 0.01, default: 0.9 },
    { key: 'vortexFadeWidth', label: 'Vortex fade width', min: 0.02, max: 0.5, step: 0.01, default: 0.16 },
    { key: 'vortexAttack', label: 'Vortex spin-up (beats)', min: 0, max: 8, step: 0.05, default: 0.9 },
    { key: 'vortexRelease', label: 'Vortex spin-down (beats)', min: 0, max: 12, step: 0.05, default: 2 },
  ],
  midiRows: () => [
    { pitch: VORTEX_IN_PITCH, label: 'Vortex inward (hold)' },
    { pitch: VORTEX_OUT_PITCH, label: 'Vortex outward (hold)' },
    { pitch: METEOR_IMPACT_PITCH, label: 'Impact', emphasized: true },
  ],
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const center = new Vector3(settings.centerX, settings.centerY, settings.centerZ)
    // Natural frequency in radians per beat; everything below runs in the
    // dimensionless time s = omega * beats.
    const omega = (2 * Math.PI) / Math.max(0.01, settings.responseBeats)
    // bounce 0 -> critically damped; bounce 1 -> zeta 0.12, loose and ringing.
    const zeta = 1 - 0.88 * Math.max(0, Math.min(1, settings.bounce))
    const lead = Math.max(0, settings.leadBeats) * omega
    const tau = Math.max(0.001, settings.strikeBeats) * omega
    const response = integrateResponse(
      zeta,
      Math.max(0, settings.drag),
      tau,
      lead,
      Math.max(0, settings.anticipation),
    )
    const speed = Math.max(0.0001, settings.waveSpeed)
    const reach = Math.max(0.0001, settings.reach)
    const dispersion = Math.max(0, settings.dispersion)
    const overlap = settings.overlapBeats * omega
    const swirlAxis = SWIRL_AXES[settings.swirlAxis] ?? SWIRL_AXES[2]
    const impacts = notes
      .filter((note: ResolvedNote) => note.pitch === METEOR_IMPACT_PITCH)
      .map((note) => ({ beat: note.beat, power: midiVelocity(note.velocity) }))
    // ONE band shared by every copy - this is what makes the field churn. A
    // copy that reaches the outer radius recycles to the inner radius, so it
    // reappears INSIDE copies it used to be outside of, and rings continuously
    // trade places. (Giving each copy its own band around its start radius
    // preserves the ordering forever, which reads as a zoom, not a vortex.)
    const vortexInner = Math.max(0.01, settings.vortexInner)
    const loopSpan = Math.log(Math.max(vortexInner * 1.05, settings.vortexOuter) / vortexInner)
    const vortexAttack = Math.max(0, settings.vortexAttack)
    const vortexRelease = Math.max(0, settings.vortexRelease)
    const vortexFadeWidth = Math.max(0.02, settings.vortexFadeWidth)
    const holds = notes
      .filter((note: ResolvedNote) =>
        note.pitch === VORTEX_OUT_PITCH || note.pitch === VORTEX_IN_PITCH)
      .map((note) => ({
        start: note.beat,
        end: note.beat + Math.max(0, note.durationBeats),
        // Opposed holds subtract, so an inward note under an outward one stalls
        // the flow rather than fighting it - the phase just stops advancing.
        direction: note.pitch === VORTEX_OUT_PITCH ? 1 : -1,
        power: midiVelocity(note.velocity),
      }))

    return {
      apply(visualCopy, { beat, placementTransform }) {
        const placed = placementTransform
          ? placementTransform.clone().multiply(visualCopy.transform)
          : visualCopy.transform
        const position = new Vector3().setFromMatrixPosition(placed)
        const radial = position.clone().sub(center)
        const distance = radial.length()
        // Energy spreading over an expanding front: full power at the strike
        // point, half at `reach`, and never a hard edge.
        const falloff = 1 / (1 + (distance / reach) * (distance / reach))
        const arrival = distance / speed
        // Dispersion: the front broadens as it travels, so the far ring runs
        // the same trajectory stretched in time and lowered in frequency.
        const spread = 1 + dispersion * (distance / reach)

        let displacement = 0
        let stretchSignal = 0
        let tumbleSignal = 0
        let heat = 0
        for (const impact of impacts) {
          const s = ((beat - impact.beat - arrival) * omega) / spread
          if (s <= response.start || s >= response.end) continue
          const gain = impact.power * falloff
          const velocity = sample(response.velocity, response, s)
          displacement += gain * sample(response.position, response, s)
          // Overlapping action: squash reads slightly ahead of the translation,
          // the tumble trails it. Peaks never land on the same frame.
          stretchSignal += gain * sample(response.velocity, response, s + overlap)
          tumbleSignal += gain * sample(response.position, response, s - overlap)
          // Heat tracks kinetic energy, so the glow blooms while the copy is
          // flying and fades as it settles - never a separate arbitrary curve.
          heat += gain * velocity * velocity
        }

        // ── Vortex ──────────────────────────────────────────────────────────
        // `loops` is the flow's position in laps: the integral of the eased
        // speed, summed over every held note.
        let loops = 0
        let flowGate = 0
        for (const hold of holds) {
          loops += hold.direction * hold.power * settings.vortexRate
            * holdPhase(beat, hold.start, hold.end, vortexAttack, vortexRelease)
          flowGate += holdGate(beat, hold.start, hold.end, vortexAttack, vortexRelease)
        }
        flowGate = Math.min(1, flowGate)

        // Split the copy's offset into its component along the vortex axis and
        // its distance from that axis: the flow spirals in the plane and shears
        // along the axis.
        const axial = radial.dot(swirlAxis)
        const planarRadius = Math.sqrt(Math.max(0, distance * distance - axial * axial))
        let flowScale = 1
        let flowSpin = 0
        let flowFade = 1
        if (planarRadius > 1e-4 && (Math.abs(loops) > 1e-9 || flowGate > 1e-9)) {
          // Where this copy sits in the shared band, in laps. Copies enter the
          // loop at different phases purely because they start at different
          // radii, so they wrap one after another rather than all at once.
          const seed = Math.log(planarRadius / vortexInner) / loopSpan
          const travelled = seed + loops
          const phase = travelled - Math.floor(travelled)
          // Copies that start outside the band would have to jump to join it.
          // `flowGate` ramps that fold in, so instead of snapping they get drawn
          // into the vortex as it spins up, and released as it winds down.
          // Copies already inside the band have floor(seed) = 0 and ignore this
          // term entirely, which keeps zero flow exactly the identity.
          flowScale = Math.exp(
            loopSpan * (phase - seed) + (1 - flowGate) * loopSpan * Math.floor(seed),
          )
          // Rotation proportional to radial phase = a logarithmic spiral; the
          // axial term makes layers turn at different rates, which is what
          // gives the funnel its depth instead of a flat pinwheel.
          flowSpin = (settings.vortexTwist + settings.vortexShear * axial) * loops * 2 * Math.PI
          const edge = Math.min(phase, 1 - phase) / vortexFadeWidth
          flowFade = 1 - settings.vortexFade * flowGate * (1 - smoothstep(edge))
        }
        const vortexActive = Math.abs(flowScale - 1) > 1e-9
          || Math.abs(flowSpin) > 1e-9
          || flowFade < 1 - 1e-9

        if (
          !vortexActive
          && Math.abs(displacement) < 1e-9
          && Math.abs(stretchSignal) < 1e-9
          && Math.abs(tumbleSignal) < 1e-9
          && heat < 1e-9
        ) {
          return [{
            transform: visualCopy.transform.clone(),
            opacity: visualCopy.opacity,
            colorShift: { ...visualCopy.colorShift },
          }]
        }

        const direction = distance > 1e-6
          ? radial.clone().divideScalar(distance)
          : new Vector3(0, 1, 0)
        // Perpendicular to travel: the axis debris tumbles about as it is thrown.
        const tumbleAxis = new Vector3().crossVectors(direction, UP)
        if (tumbleAxis.lengthSq() < 1e-8) tumbleAxis.crossVectors(direction, SIDE)
        tumbleAxis.normalize()

        const offset = direction.clone().multiplyScalar(displacement * settings.strength)
        const pivot = new Matrix4().makeTranslation(position.x, position.y, position.z)
        const unpivot = new Matrix4().makeTranslation(-position.x, -position.y, -position.z)

        // Squash & stretch, volume conserving: elongate along travel while
        // thinning across it. Driven by SPEED, not position - real stretch peaks
        // mid-flight, and reading it off displacement is the usual tell.
        const along = Math.max(0.05, 1 + settings.stretch * stretchSignal)
        const across = 1 / Math.sqrt(along)
        const perpendicular = new Vector3().crossVectors(direction, tumbleAxis).normalize()
        const basis = new Matrix4().makeBasis(direction, tumbleAxis, perpendicular)
        const stretch = pivot.clone()
          .multiply(basis)
          .multiply(new Matrix4().makeScale(along, across, across))
          .multiply(basis.clone().transpose())
          .multiply(unpivot)

        const tumble = pivot.clone()
          .multiply(new Matrix4().makeRotationAxis(
            tumbleAxis,
            settings.tumbleDegrees * DEG * tumbleSignal,
          ))
          .multiply(unpivot)

        // The swirl is the tangential COMPONENT of the throw, not a separate
        // gesture: its arc length is a fixed multiple of the radial distance
        // travelled, on the same signal at the same instant. So the two combine
        // into one impulse aimed slightly off-radial, and every copy traces a
        // single spiral rather than sliding sideways on its own schedule.
        // Dividing arc by radius keeps rings coherent - the outer ring sweeps
        // the same distance as the inner one, through a smaller angle, which is
        // what stops a big swirl from smearing the far ring past the near one.
        const swirlArc = settings.swirl * displacement * settings.strength
        const swirl = new Matrix4().makeTranslation(center.x, center.y, center.z)
          .multiply(new Matrix4().makeRotationAxis(
            swirlAxis,
            // Softened radius: a copy sitting on the impact point would need an
            // unbounded angle to cover any arc at all.
            swirlArc / Math.sqrt(distance * distance + 1),
          ))
          .multiply(new Matrix4().makeTranslation(-center.x, -center.y, -center.z))

        // The vortex is a warp of the SPACE, so it wraps everything else: a
        // conformal dilation about the center composed with the spiral's
        // rotation. Anything the impact did is carried along by the flow.
        const vortex = new Matrix4().makeTranslation(center.x, center.y, center.z)
          .multiply(new Matrix4().makeRotationAxis(swirlAxis, flowSpin))
          .multiply(new Matrix4().makeScale(flowScale, flowScale, flowScale))
          .multiply(new Matrix4().makeTranslation(-center.x, -center.y, -center.z))
        // A fully conformal flow grows copies by the same factor it moves them,
        // which sells the infinite zoom but can get large. Pre-scaling about the
        // copy's own center by k^(grow-1) leaves it at k^grow overall, so growth
        // dials from "space and contents together" to "positions only".
        const sizeCorrection = new Matrix4().makeScale(1, 1, 1)
        if (settings.vortexGrow < 1 - 1e-9 && Math.abs(flowScale - 1) > 1e-9) {
          const correction = Math.pow(flowScale, settings.vortexGrow - 1)
          sizeCorrection.copy(pivot)
            .multiply(new Matrix4().makeScale(correction, correction, correction))
            .multiply(unpivot)
        }

        // WORLD composition, applied right-to-left as the copy experiences it:
        // deform in place, tip over in place, get thrown outward, then the whole
        // displaced copy is carried around the impact axis by the swirl.
        const worldDelta = vortex
          .multiply(sizeCorrection)
          .multiply(swirl)
          .multiply(new Matrix4().makeTranslation(offset.x, offset.y, offset.z))
          .multiply(tumble)
          .multiply(stretch)

        // Conjugating by placement turns the world-space delta back into the
        // VisualCopy space the renderer expects (identical to forceFieldPush).
        const transform = placementTransform
          ? placementTransform.clone().invert()
            .multiply(worldDelta)
            .multiply(placementTransform)
            .multiply(visualCopy.transform.clone())
          : worldDelta.multiply(visualCopy.transform.clone())

        return [{
          transform,
          opacity: visualCopy.opacity * flowFade,
          colorShift: {
            ...visualCopy.colorShift,
            hue: visualCopy.colorShift.hue + settings.flashHue * heat,
            saturation: visualCopy.colorShift.saturation + settings.flashSaturation * heat,
            lightness: visualCopy.colorShift.lightness + settings.flashLightness * heat,
          },
        }]
      },
    }
  },
}
