'use client'

// Bespoke settings for an automation child track, following
// docs/instrument-panel-design-guide.md with Laser Sphere as the reference: full
// bleed in the chassis, no in-panel title (the tab rail already names the lane),
// washed with a hue-true dark shade of the lane's own color, and opening with a
// live window onto the lane before any control. The window's shape IS the lane's
// light: three stacked strokes of the same path, so emission exists only where the
// signal is - the same "no uniform halos" rule the guide's knobs follow.
//
// A lane's MODE is its first and largest decision - what its notes MEAN - so it
// is a segmented control at the top of the console instead of a value hidden in a
// dropdown. The window above it always draws what the chosen mode will actually
// do, computed by the engine's own samplers (`easeFraction`, `sampleNoiseLane`,
// `adsrGateGain`), so the picture cannot drift from the playback:
//   CURVE - the easing the lane rides between two value keyframes.
//   NOISE - the seeded wobble at this rate/smoothness/range; the dice redraw it.
//   BURST - the ADSR every note fires, its three stages grabbable on the curve.
//   CYCLE - the motion curve stretched between note onsets, plus its ghost
//           repeat so the seam is visible while shaping it.
//
// Burst and cycle modes are where the window is also an EDITOR: an envelope's shape
// is the thing being authored, so the handles ride the curve (the same
// interaction as EnvelopeUserInterface's pad) while the knobs below give the
// same four values fine, numeric control. Everything else keeps the guide's one
// vocabulary - knobs, no sliders, with ONE deliberate exception: AMOUNT, the
// lane's master gain, is a full-width fader under the mode's own controls. It
// belongs to the lane rather than to a mode, and a gain you ride deserves a
// long horizontal throw - the fill grows from its 100% detent, so attenuation
// and boost read at a glance. The curve and noise windows scale with it, so
// the picture above always shows the values the lane will actually emit.

import { useRef, type JSX, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { Dices } from 'lucide-react'
import {
  AUTOMATION_AMOUNT_MAX,
  DEFAULT_AUTOMATION_AMOUNT,
  DEFAULT_BURST,
  DEFAULT_BURST_BEZIER,
  DEFAULT_BURST_SPRING,
  DEFAULT_CYCLE,
  DEFAULT_NOISE,
  bezierY,
  burstGateGain,
  cycleShapeY,
  easeFraction,
  sampleNoiseLane,
  type BurstConfig,
  type BurstShape,
  type CycleConfig,
  type NoiseConfig,
} from '../core/visual/automation'
import { LaserKnob } from './laserKnob'
import { hexToHsv, hsvToHex, towardWhite, withAlpha } from './colorWheel'
import { AUTOMATION_MAX_ROWS, type AutomationRange, type AutomationSpreadCurve } from '../core/trackTypes'
import type { AutomationMode, InterpolationMode } from '../types'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const snap = (value: number, step = 0.01) => Number((Math.round(value / step) * step).toFixed(4))

/** The panel's color math is hex-only (shade / alpha / white-hot). A lane wearing
 *  an exotic CSS color falls back to the theme violet instead of emitting
 *  nonsense like `oklch(...)ff`. */
const FALLBACK_ACCENT = '#a78bfa'
const hexAccent = (color: string) => (/^#[0-9a-fA-F]{6}$/.test(color) ? color : FALLBACK_ACCENT)

// ── Plot geometry (percent of the window, shared by all three modes) ─────────

const Y_PEAK = 16
const Y_BASE = 84
const Y_SPAN = Y_BASE - Y_PEAK
/** Curve/noise plots run the full width; the burst lanes below inset a little. */
const PX0 = 5
const PX1 = 95
// Burst stage lanes. Each stage gets a fixed lane so a short attack stays
// grabbable instead of collapsing against the left edge, and the gap between the
// decay handle and the release lane reads as the sustain hold. (Same split as
// EnvelopeUserInterface, which this panel's pad is the accent-lit sibling of.)
const AX0 = 6, AX1 = 30          // attack lane: 0..ATTACK_MAX beats
const DX0 = 30, DX1 = 62         // decay lane: 0..DECAY_MAX beats
const RS = 70                    // release lane start (the gate lifts here)
const RX0 = 70, RX1 = 94         // release lane: 0..RELEASE_MAX beats

const ATTACK_MAX = 4
const DECAY_MAX = 8
const RELEASE_MAX = 8
/** Beats of noise the window shows at once. */
const NOISE_WINDOW_BEATS = 4

const INTERP_OPTIONS: { value: InterpolationMode; label: string }[] = [
  { value: 'step', label: 'Step' },
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'Ease In' },
  { value: 'ease-out', label: 'Ease Out' },
  { value: 'ease-in-out', label: 'Ease In-Out' },
  { value: 'smooth-step', label: 'Smooth Step' },
  { value: 'exponential', label: 'Exponential' },
]

/** The path an easing traces from a low keyframe to a high one, in plot space.
 *  Step is its own shape - it HOLDS the old value, then jumps at the keyframe.
 *  `yPeak` is where the high keyframe lands - the amount fader lowers it, so
 *  the plot shows the scaled travel against the dashed full-range line. */
function easePath(mode: InterpolationMode, x0: number, x1: number, steps = 40, yPeak = Y_PEAK): string {
  if (mode === 'step') return `M ${x0} ${Y_BASE} L ${x1} ${Y_BASE} L ${x1} ${yPeak}`
  let d = `M ${x0} ${Y_BASE}`
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const x = x0 + (x1 - x0) * t
    const y = Y_BASE - easeFraction(t, mode) * (Y_BASE - yPeak)
    d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`
  }
  return d
}

/** The seeded wobble the engine will actually play, plotted over a few beats. A
 *  synthetic 0..1 param held by one long gate: the deviation formula then spans
 *  the whole window height at range 1, so the picture is the real signal.
 *  `amount` scales the gate's center and the deviation exactly the way
 *  resolve.ts does, so the fader moves this plot the way it moves playback. */
function noisePath(cfg: NoiseConfig, amount: number, steps = 200): string {
  const scaled = amount === 1 ? cfg : { ...cfg, range: cfg.range * amount }
  const gates = [{ beat: 0, endBeat: NOISE_WINDOW_BEATS, center: clamp(0.5 * amount, 0, 1), amp: 1 }]
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const value = sampleNoiseLane(scaled, gates, t * NOISE_WINDOW_BEATS, 0, 1)
    const x = PX0 + (PX1 - PX0) * t
    const y = Y_BASE - clamp(value, 0, 1) * Y_SPAN
    d += `${i === 0 ? 'M' : ' L'} ${x.toFixed(2)} ${y.toFixed(2)}`
  }
  return d
}

// ── The window ──────────────────────────────────────────────────────────────

/** The lane's light lives along the plotted path: three stacked strokes of the
 *  same geometry (wide and dim, medium, thin and white-hot) rather than a blur
 *  filter, which a stretched viewBox would smear anisotropically. */
function GlowPath({ d, accent, area = false }: { d: string; accent: string; area?: boolean }) {
  return (
    <>
      {area && <path d={`${d} L ${PX1} ${Y_BASE} Z`} fill={withAlpha(accent, 0.1)} stroke="none" />}
      <path d={d} fill="none" stroke={accent} strokeWidth={6} strokeOpacity={0.16} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <path d={d} fill="none" stroke={accent} strokeWidth={2.5} strokeOpacity={0.45} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <path d={d} fill="none" stroke={towardWhite(accent, 0.7)} strokeWidth={1.25} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </>
  )
}

/** The window frame: full-bleed, square-shouldered, near-black like the guide's
 *  live preview, with the plot stretched across it. */
function LaneWindow({ children, testId, title }: { children: JSX.Element; testId: string; title?: string }) {
  return (
    <div
      data-testid={testId}
      title={title}
      className="relative h-[120px] select-none overflow-hidden rounded-t-[9px] border-b border-white/[0.06] bg-[#05070c]"
    >
      {children}
    </div>
  )
}

/** One grabbable node on the burst curve: pointer capture, arrow nudges,
 *  double-click reset. */
function CurveHandle({ padRef, x, y, accent, ariaLabel, ariaMin, ariaMax, ariaNow, ariaText, cursor, onDragTo, onNudge, onReset }: {
  padRef: RefObject<HTMLDivElement | null>
  x: number
  y: number
  accent: string
  ariaLabel: string
  ariaMin: number
  ariaMax: number
  ariaNow: number
  ariaText: string
  cursor: string
  onDragTo: (fx: number, fy: number) => void
  onNudge: (dx: number, dy: number) => void
  onReset: () => void
}) {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const rect = padRef.current?.getBoundingClientRect()
    if (!rect) return
    onDragTo(((event.clientX - rect.left) / rect.width) * 100, ((event.clientY - rect.top) / rect.height) * 100)
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'ArrowLeft') onNudge(-1, 0)
    else if (event.key === 'ArrowRight') onNudge(1, 0)
    else if (event.key === 'ArrowUp') onNudge(0, 1)
    else onNudge(0, -1)
  }
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={ariaMin}
      aria-valuemax={ariaMax}
      aria-valuenow={ariaNow}
      aria-valuetext={ariaText}
      title={`${ariaLabel} · drag · double-click to reset`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className="absolute z-10 h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 touch-none select-none rounded-full border border-white/70 outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      style={{ left: `${x}%`, top: `${y}%`, cursor, background: towardWhite(accent, 0.55), boxShadow: `0 0 6px 1px ${withAlpha(accent, 0.8)}` }}
    />
  )
}

/** The burst window: the ADSR each note fires, height-scaled by intensity so the
 *  plot always shows what the target will actually receive, with the three stages
 *  grabbable on the curve itself. Segments are straight lines on purpose - the
 *  evaluator (core/visual/adsr.ts) is piecewise-linear and the picture must not
 *  promise curves it will not play. */
function BurstWindow({ burst, accent, onBurst }: {
  burst: BurstConfig
  accent: string
  onBurst: (next: BurstConfig) => void
}) {
  const padRef = useRef<HTMLDivElement>(null)
  const intensitySafe = Math.max(burst.intensity, 0.05) // keeps sustain drags invertible
  const yOf = (level: number) => Y_BASE - clamp(level, 0, 1) * burst.intensity * Y_SPAN

  const ax = AX0 + (clamp(burst.attackBeats, 0, ATTACK_MAX) / ATTACK_MAX) * (AX1 - AX0)
  const dx = DX0 + (clamp(burst.decayBeats, 0, DECAY_MAX) / DECAY_MAX) * (DX1 - DX0)
  const rx = RX0 + (clamp(burst.releaseBeats, 0, RELEASE_MAX) / RELEASE_MAX) * (RX1 - RX0)
  const yPeak = yOf(1)
  const ySustain = yOf(burst.sustainLevel)
  const curve = `M ${AX0} ${Y_BASE} L ${ax} ${yPeak} L ${dx} ${ySustain} L ${RS} ${ySustain} L ${rx} ${Y_BASE}`

  return (
    <LaneWindow testId="automation-burst-pad">
      <div ref={padRef} role="group" aria-label="Burst envelope curve" className="absolute inset-0">
        <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {/* Where "full on" lands after intensity - it sinks as intensity eases off. */}
          <line x1={AX0} y1={yPeak} x2={RX1} y2={yPeak} stroke="rgba(255,255,255,0.12)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          {/* The gate lifts here: release always starts at this mark, whatever decay does. */}
          <line x1={RS} y1={Y_PEAK - 6} x2={RS} y2={Y_BASE} stroke="rgba(255,255,255,0.10)" strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          <line x1={AX0} y1={Y_BASE} x2={RX1} y2={Y_BASE} stroke="rgba(255,255,255,0.14)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <path d={`${curve} L ${AX0} ${Y_BASE} Z`} fill={withAlpha(accent, 0.12)} stroke="none" />
          <GlowPath d={curve} accent={accent} />
        </svg>
        <CurveHandle
          padRef={padRef} x={ax} y={yPeak} accent={accent}
          ariaLabel="Attack" ariaMin={0} ariaMax={ATTACK_MAX} ariaNow={burst.attackBeats}
          ariaText={`Attack ${burst.attackBeats.toFixed(2)} beats`} cursor="ew-resize"
          onDragTo={(fx) => onBurst({ ...burst, attackBeats: snap(clamp(((fx - AX0) / (AX1 - AX0)) * ATTACK_MAX, 0, ATTACK_MAX)) })}
          onNudge={(dx2) => { if (dx2 !== 0) onBurst({ ...burst, attackBeats: snap(clamp(burst.attackBeats + dx2 * 0.05, 0, ATTACK_MAX)) }) }}
          onReset={() => onBurst({ ...burst, attackBeats: DEFAULT_BURST.attackBeats })}
        />
        <CurveHandle
          padRef={padRef} x={dx} y={ySustain} accent={accent}
          ariaLabel="Decay and sustain" ariaMin={0} ariaMax={DECAY_MAX} ariaNow={burst.decayBeats}
          ariaText={`Decay ${burst.decayBeats.toFixed(2)} beats, sustain ${burst.sustainLevel.toFixed(2)}`} cursor="move"
          onDragTo={(fx, fy) => onBurst({
            ...burst,
            decayBeats: snap(clamp(((fx - DX0) / (DX1 - DX0)) * DECAY_MAX, 0, DECAY_MAX)),
            sustainLevel: snap(clamp((Y_BASE - fy) / (intensitySafe * Y_SPAN), 0, 1)),
          })}
          onNudge={(dx2, dy2) => onBurst({
            ...burst,
            decayBeats: snap(clamp(burst.decayBeats + dx2 * 0.05, 0, DECAY_MAX)),
            sustainLevel: snap(clamp(burst.sustainLevel + dy2 * 0.02, 0, 1)),
          })}
          onReset={() => onBurst({ ...burst, decayBeats: DEFAULT_BURST.decayBeats, sustainLevel: DEFAULT_BURST.sustainLevel })}
        />
        <CurveHandle
          padRef={padRef} x={rx} y={Y_BASE} accent={accent}
          ariaLabel="Release" ariaMin={0} ariaMax={RELEASE_MAX} ariaNow={burst.releaseBeats}
          ariaText={`Release ${burst.releaseBeats.toFixed(2)} beats`} cursor="ew-resize"
          onDragTo={(fx) => onBurst({ ...burst, releaseBeats: snap(clamp(((fx - RX0) / (RX1 - RX0)) * RELEASE_MAX, 0, RELEASE_MAX)) })}
          onNudge={(dx2) => { if (dx2 !== 0) onBurst({ ...burst, releaseBeats: snap(clamp(burst.releaseBeats + dx2 * 0.05, 0, RELEASE_MAX)) }) }}
          onReset={() => onBurst({ ...burst, releaseBeats: DEFAULT_BURST.releaseBeats })}
        />
      </div>
    </LaneWindow>
  )
}

// ── Shaped burst windows ────────────────────────────────────────────────────
// Overshoot headroom: level 1 sits below the top so a bezier Y past 1 or a
// spring's ring has room to draw. Shared by both shaped windows.
const OS_SPAN = Y_SPAN * 0.62
const yLevel = (level: number) => Y_BASE - level * OS_SPAN

/** The bezier shape as an EDITOR: the unit rise curve with both control points
 *  grabbable (Y past the dashed full-line overshoots). The fall plays this
 *  same curve back, so one picture describes the whole burst. */
function BezierBurstWindow({ burst, accent, onBurst }: {
  burst: BurstConfig
  accent: string
  onBurst: (next: BurstConfig) => void
}) {
  const padRef = useRef<HTMLDivElement>(null)
  const bez = burst.bezier ?? DEFAULT_BURST_BEZIER
  const X0 = 8
  const X1 = 92
  const xOf = (u: number) => X0 + u * (X1 - X0)

  const steps = 56
  let path = `M ${xOf(0)} ${yLevel(0)}`
  for (let i = 1; i <= steps; i++) {
    const u = i / steps
    path += ` L ${xOf(u)} ${yLevel(bezierY(bez.x1, bez.y1, bez.x2, bez.y2, u))}`
  }

  const p1x = xOf(clamp(bez.x1, 0, 1))
  const p1y = yLevel(bez.y1)
  const p2x = xOf(clamp(bez.x2, 0, 1))
  const p2y = yLevel(bez.y2)
  const setPoint = (key: 'x1' | 'y1' | 'x2' | 'y2', value: number) =>
    onBurst({ ...burst, bezier: { ...bez, [key]: value } })
  const fromPad = (fx: number, fy: number): [number, number] => [
    snap(clamp((fx - X0) / (X1 - X0), 0, 1)),
    snap(clamp((Y_BASE - fy) / OS_SPAN, -0.5, 1.7)),
  ]

  return (
    <LaneWindow testId="automation-burst-bezier-pad" title="The rise curve each note fires; the fall plays it back. Drag the control points - Y past the dashed line overshoots.">
      <div ref={padRef} role="group" aria-label="Bezier burst curve" className="absolute inset-0">
        <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <line x1={X0} y1={yLevel(1)} x2={X1} y2={yLevel(1)} stroke="rgba(255,255,255,0.12)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <line x1={X0} y1={Y_BASE} x2={X1} y2={Y_BASE} stroke="rgba(255,255,255,0.14)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {/* Control arms, the way every curve tool draws them. */}
          <line x1={xOf(0)} y1={yLevel(0)} x2={p1x} y2={p1y} stroke={withAlpha(accent, 0.35)} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <line x1={xOf(1)} y1={yLevel(1)} x2={p2x} y2={p2y} stroke={withAlpha(accent, 0.35)} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <GlowPath d={path} accent={accent} />
        </svg>
        <CurveHandle
          padRef={padRef} x={p1x} y={p1y} accent={accent}
          ariaLabel="First control point" ariaMin={0} ariaMax={1} ariaNow={bez.x1}
          ariaText={`Control 1 at ${bez.x1.toFixed(2)}, ${bez.y1.toFixed(2)}`} cursor="move"
          onDragTo={(fx, fy) => { const [x, y] = fromPad(fx, fy); onBurst({ ...burst, bezier: { ...bez, x1: x, y1: y } }) }}
          onNudge={(dx2, dy2) => onBurst({ ...burst, bezier: { ...bez, x1: snap(clamp(bez.x1 + dx2 * 0.02, 0, 1)), y1: snap(clamp(bez.y1 + dy2 * 0.02, -0.5, 1.7)) } })}
          onReset={() => setPoint('x1', DEFAULT_BURST_BEZIER.x1)}
        />
        <CurveHandle
          padRef={padRef} x={p2x} y={p2y} accent={accent}
          ariaLabel="Second control point" ariaMin={0} ariaMax={1} ariaNow={bez.x2}
          ariaText={`Control 2 at ${bez.x2.toFixed(2)}, ${bez.y2.toFixed(2)}`} cursor="move"
          onDragTo={(fx, fy) => { const [x, y] = fromPad(fx, fy); onBurst({ ...burst, bezier: { ...bez, x2: x, y2: y } }) }}
          onNudge={(dx2, dy2) => onBurst({ ...burst, bezier: { ...bez, x2: snap(clamp(bez.x2 + dx2 * 0.02, 0, 1)), y2: snap(clamp(bez.y2 + dy2 * 0.02, -0.5, 1.7)) } })}
          onReset={() => setPoint('x2', DEFAULT_BURST_BEZIER.x2)}
        />
      </div>
    </LaneWindow>
  )
}

/** The spring shape as a PLOT: a demo note held two beats through the real
 *  evaluator, so the ring, the settle and the velocity-carrying release are
 *  exactly what the lane will play. The knobs below are the editor. */
function SpringBurstWindow({ burst, accent }: {
  burst: BurstConfig
  accent: string
}) {
  const X0 = 5
  const X1 = 95
  const demo = { beat: 0, durationBeats: 2, velocity: 1, value: 1 }
  const span = 4.5
  const steps = 110
  let path = `M ${X0} ${yLevel(0)}`
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * span
    const gain = burstGateGain(demo, t, { ...burst, shape: 'spring' })
    path += ` L ${X0 + (i / steps) * (X1 - X0)} ${yLevel(gain)}`
  }
  const releaseX = X0 + (demo.durationBeats / span) * (X1 - X0)

  return (
    <LaneWindow testId="automation-burst-spring-plot" title="A two-beat note through this spring - ring, settle, and the velocity-carrying release">
      <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <line x1={X0} y1={yLevel(1)} x2={X1} y2={yLevel(1)} stroke="rgba(255,255,255,0.12)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        <line x1={releaseX} y1={Y_PEAK - 6} x2={releaseX} y2={Y_BASE} stroke="rgba(255,255,255,0.10)" strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
        <line x1={X0} y1={Y_BASE} x2={X1} y2={Y_BASE} stroke="rgba(255,255,255,0.14)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <GlowPath d={path} accent={accent} />
      </svg>
    </LaneWindow>
  )
}

// ── Cycle window ────────────────────────────────────────────────────────────
// One cycle of the wave as an EDITOR: the endpoints' heights ride the onset
// lines (whether the wave is seamless is exactly whether they match - there is
// no separate continuity switch), the control points are free, and a fainter
// SECOND cycle over a shorter span shows the next onset pair - so the seam,
// and any snap the user's curve makes across it, is visible while dragging.
// Its own overshoot headroom (larger than the burst windows'): the SPIKE
// preset parks a control point near y = 2.25.
const CY_SPAN = 33
const CY_CTRL_MAX = 2.4
const cyLevel = (level: number) => Y_BASE - level * CY_SPAN
/** The edited cycle spans onset CX0 → CXM; the ghost repeat CXM → CX1 is
 *  deliberately NARROWER - cycles stretch to the phrasing, and unequal spans
 *  say so. */
const CX0 = 6, CXM = 56, CX1 = 94

/** One cycle of the shape as an SVG path over [x0, x1]. `yBase`/`span` scale
 *  the heights, so the preset thumbnails can reuse it at their own size. */
function cyclePath(cfg: CycleConfig, x0: number, x1: number, yBase = Y_BASE, span = CY_SPAN, steps = 48): string {
  let d = `M ${x0.toFixed(2)} ${(yBase - cfg.y0 * span).toFixed(2)}`
  for (let i = 1; i <= steps; i++) {
    const u = i / steps
    d += ` L ${(x0 + (x1 - x0) * u).toFixed(2)} ${(yBase - cycleShapeY(cfg, u) * span).toFixed(2)}`
  }
  return d
}

function CycleWindow({ cycle, accent, onCycle }: {
  cycle: CycleConfig
  accent: string
  onCycle: (next: CycleConfig) => void
}) {
  const padRef = useRef<HTMLDivElement>(null)
  const levelFromY = (fy: number) => (Y_BASE - fy) / CY_SPAN
  const xOf = (u: number) => CX0 + clamp(u, 0, 1) * (CXM - CX0)
  const uFromX = (fx: number) => clamp((fx - CX0) / (CXM - CX0), 0, 1)

  const p1x = xOf(cycle.x1)
  const p1y = cyLevel(clamp(cycle.y1, -0.5, CY_CTRL_MAX))
  const p2x = xOf(cycle.x2)
  const p2y = cyLevel(clamp(cycle.y2, -0.5, CY_CTRL_MAX))
  // In noteSpan mode the next cycle starts at the next NOTE, not where this
  // one ends - the ghost slides right and the empty stretch is the inert gap.
  const ghostX0 = cycle.noteSpan ? CXM + 8 : CXM

  return (
    <LaneWindow testId="automation-cycle-pad" title="One cycle between two note onsets - the fainter repeat shows the seam. Drag the endpoints' heights and the control points; matching endpoints make the wave seamless.">
      <div ref={padRef} role="group" aria-label="Cycle motion curve" className="absolute inset-0">
        <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {/* The note's row: the cycle's high lands here (its low, inverted). */}
          <line x1={CX0} y1={cyLevel(1)} x2={CX1} y2={cyLevel(1)} stroke="rgba(255,255,255,0.12)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <line x1={CX0} y1={Y_BASE} x2={CX1} y2={Y_BASE} stroke="rgba(255,255,255,0.14)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {/* The boundaries of each cycle (onsets; note ends in noteSpan mode). */}
          {[CX0, ghostX0, CX1].map((x) => (
            <line key={x} x1={x} y1={Y_PEAK - 8} x2={x} y2={Y_BASE} stroke="rgba(255,255,255,0.10)" strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          ))}
          {/* Control arms, the way every curve tool draws them. */}
          <line x1={CX0} y1={cyLevel(cycle.y0)} x2={p1x} y2={p1y} stroke={withAlpha(accent, 0.35)} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <line x1={CXM} y1={cyLevel(cycle.y3)} x2={p2x} y2={p2y} stroke={withAlpha(accent, 0.35)} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {/* The next cycle's repeat: where the seam (or gap) lands is visible, not imagined. */}
          <path d={cyclePath(cycle, ghostX0, CX1)} fill="none" stroke={withAlpha(accent, 0.3)} strokeWidth={1.25} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <GlowPath d={cyclePath(cycle, CX0, CXM)} accent={accent} />
        </svg>
        <CurveHandle
          padRef={padRef} x={CX0} y={cyLevel(cycle.y0)} accent={accent}
          ariaLabel="Cycle start height" ariaMin={0} ariaMax={1} ariaNow={cycle.y0}
          ariaText={`Starts at ${cycle.y0.toFixed(2)}`} cursor="ns-resize"
          onDragTo={(_fx, fy) => onCycle({ ...cycle, y0: snap(clamp(levelFromY(fy), 0, 1)) })}
          onNudge={(_dx, dy) => onCycle({ ...cycle, y0: snap(clamp(cycle.y0 + dy * 0.02, 0, 1)) })}
          onReset={() => onCycle({ ...cycle, y0: DEFAULT_CYCLE.y0 })}
        />
        <CurveHandle
          padRef={padRef} x={CXM} y={cyLevel(cycle.y3)} accent={accent}
          ariaLabel="Cycle end height" ariaMin={0} ariaMax={1} ariaNow={cycle.y3}
          ariaText={`Ends at ${cycle.y3.toFixed(2)}`} cursor="ns-resize"
          onDragTo={(_fx, fy) => onCycle({ ...cycle, y3: snap(clamp(levelFromY(fy), 0, 1)) })}
          onNudge={(_dx, dy) => onCycle({ ...cycle, y3: snap(clamp(cycle.y3 + dy * 0.02, 0, 1)) })}
          onReset={() => onCycle({ ...cycle, y3: DEFAULT_CYCLE.y3 })}
        />
        <CurveHandle
          padRef={padRef} x={p1x} y={p1y} accent={accent}
          ariaLabel="First control point" ariaMin={0} ariaMax={1} ariaNow={cycle.x1}
          ariaText={`Control 1 at ${cycle.x1.toFixed(2)}, ${cycle.y1.toFixed(2)}`} cursor="move"
          onDragTo={(fx, fy) => onCycle({ ...cycle, x1: snap(uFromX(fx)), y1: snap(clamp(levelFromY(fy), -0.5, CY_CTRL_MAX)) })}
          onNudge={(dx, dy) => onCycle({ ...cycle, x1: snap(clamp(cycle.x1 + dx * 0.02, 0, 1)), y1: snap(clamp(cycle.y1 + dy * 0.02, -0.5, CY_CTRL_MAX)) })}
          onReset={() => onCycle({ ...cycle, x1: DEFAULT_CYCLE.x1, y1: DEFAULT_CYCLE.y1 })}
        />
        <CurveHandle
          padRef={padRef} x={p2x} y={p2y} accent={accent}
          ariaLabel="Second control point" ariaMin={0} ariaMax={1} ariaNow={cycle.x2}
          ariaText={`Control 2 at ${cycle.x2.toFixed(2)}, ${cycle.y2.toFixed(2)}`} cursor="move"
          onDragTo={(fx, fy) => onCycle({ ...cycle, x2: snap(uFromX(fx)), y2: snap(clamp(levelFromY(fy), -0.5, CY_CTRL_MAX)) })}
          onNudge={(dx, dy) => onCycle({ ...cycle, x2: snap(clamp(cycle.x2 + dx * 0.02, 0, 1)), y2: snap(clamp(cycle.y2 + dy * 0.02, -0.5, CY_CTRL_MAX)) })}
          onReset={() => onCycle({ ...cycle, x2: DEFAULT_CYCLE.x2, y2: DEFAULT_CYCLE.y2 })}
        />
      </div>
    </LaneWindow>
  )
}

/** The classic wave shapes as one-click starting points; each loads the editor
 *  with its control points (polarity and bounds stay put). Matching is by the
 *  shape fields, so the row also SHOWS which classic the current curve is. */
const CYCLE_PRESETS: { id: string; label: string; title: string; shape: Pick<CycleConfig, 'y0' | 'x1' | 'y1' | 'x2' | 'y2' | 'y3'> }[] = [
  { id: 'swell', label: 'SWELL', title: 'A seamless rise and fall that peaks on the note', shape: { y0: DEFAULT_CYCLE.y0, x1: DEFAULT_CYCLE.x1, y1: DEFAULT_CYCLE.y1, x2: DEFAULT_CYCLE.x2, y2: DEFAULT_CYCLE.y2, y3: DEFAULT_CYCLE.y3 } },
  { id: 'ramp', label: 'RAMP', title: 'A saw: climbs to the note, snaps back at the next onset', shape: { y0: 0, x1: 1 / 3, y1: 1 / 3, x2: 2 / 3, y2: 2 / 3, y3: 1 } },
  { id: 'fall', label: 'FALL', title: 'Starts on the note and slides away until the next onset', shape: { y0: 1, x1: 1 / 3, y1: 2 / 3, x2: 2 / 3, y2: 1 / 3, y3: 0 } },
  { id: 'spike', label: 'SPIKE', title: 'A percussive hit on the onset, decaying across the span', shape: { y0: 0, x1: 0.1, y1: 2.25, x2: 0.35, y2: 0.1, y3: 0 } },
]

function CyclePresetRow({ cycle, accent, onCycle }: {
  cycle: CycleConfig
  accent: string
  onCycle: (next: CycleConfig) => void
}) {
  const matches = (shape: (typeof CYCLE_PRESETS)[number]['shape']) =>
    (Object.keys(shape) as (keyof typeof shape)[]).every((k) => Math.abs(cycle[k] - shape[k]) < 0.005)
  return (
    <div
      role="radiogroup"
      aria-label="Cycle shape preset"
      data-testid="automation-cycle-presets"
      className="flex gap-[2px] rounded-[7px] border border-white/[0.07] bg-black/30 p-[2px]"
    >
      {CYCLE_PRESETS.map((preset) => {
        const active = matches(preset.shape)
        return (
          <button
            key={preset.id}
            role="radio"
            aria-checked={active}
            aria-label={preset.label}
            title={preset.title}
            onClick={() => onCycle({ ...cycle, ...preset.shape })}
            className={`h-7 min-w-0 flex-1 cursor-pointer rounded-[5px] px-[3px] transition-colors ${
              active ? '' : 'hover:bg-white/[0.04]'
            }`}
            style={active ? { background: withAlpha(accent, 0.2) } : undefined}
          >
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className="h-full w-full">
              <path
                d={cyclePath({ ...preset.shape }, 8, 92, 86, 62, 24)}
                fill="none"
                stroke={active ? towardWhite(accent, 0.6) : 'rgba(255,255,255,0.35)'}
                strokeWidth={active ? 1.75 : 1.25}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </button>
        )
      })}
    </div>
  )
}

const SHAPE_OPTIONS: { value: BurstShape; label: string; title: string }[] = [
  { value: 'adsr', label: 'ADSR', title: 'The classic piecewise envelope: attack, decay, sustain, release' },
  { value: 'bezier', label: 'BEZIER', title: 'A user cubic-bezier rise and fall - control Ys past 1 overshoot' },
  { value: 'spring', label: 'SPRING', title: 'A damped-spring simulation: stiffness, damping, mass - it rings' },
]

/** Which envelope the bursts ride. Picking a shape seeds its config so the
 *  window has something honest to draw immediately. */
function ShapeSegmented({ burst, accent, onBurst }: {
  burst: BurstConfig
  accent: string
  onBurst: (next: BurstConfig) => void
}) {
  const shape: BurstShape = burst.shape ?? 'adsr'
  return (
    <div
      role="tablist"
      aria-label="Burst envelope shape"
      data-testid="automation-burst-shape-segmented"
      className="flex gap-[2px] rounded-[7px] border border-white/[0.07] bg-black/30 p-[2px]"
    >
      {SHAPE_OPTIONS.map((option) => {
        const active = option.value === shape
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            title={option.title}
            onClick={() => onBurst({
              ...burst,
              shape: option.value,
              bezier: option.value === 'bezier' ? burst.bezier ?? { ...DEFAULT_BURST_BEZIER } : burst.bezier,
              spring: option.value === 'spring' ? burst.spring ?? { ...DEFAULT_BURST_SPRING } : burst.spring,
            })}
            className={`h-[22px] flex-1 cursor-pointer rounded-[5px] text-[9px] font-semibold tracking-[0.1em] transition-colors ${
              active ? '' : 'text-white/40 hover:bg-white/[0.04] hover:text-white/70'
            }`}
            style={active
              ? { background: withAlpha(accent, 0.22), color: towardWhite(accent, 0.6) }
              : undefined}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Segmented controls ──────────────────────────────────────────────────────

const MODE_OPTIONS: { value: AutomationMode; label: string; title: string }[] = [
  { value: 'curve', label: 'CURVE', title: 'Notes are value keyframes joined by a curve' },
  { value: 'noise', label: 'NOISE', title: 'Held notes gate a seeded random wobble around their value' },
  { value: 'burst', label: 'BURST', title: 'Each note fires an ADSR envelope toward its value' },
  { value: 'cycle', label: 'CYCLE', title: 'A motion curve plays once between each pair of note onsets' },
]

/** The console's segmented control: one lit segment on a recessed track. The
 *  active segment wears the lane's accent as light (tinted fill + hot label),
 *  never a second border - depth stays reserved for the window above. */
function ModeSegmented({ mode, accent, onMode }: {
  mode: AutomationMode
  accent: string
  onMode: (mode: AutomationMode) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="Automation mode"
      data-testid="automation-mode-segmented"
      className="flex gap-[2px] rounded-[7px] border border-white/[0.07] bg-black/30 p-[2px]"
    >
      {MODE_OPTIONS.map((option) => {
        const active = option.value === mode
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            title={option.title}
            onClick={() => onMode(option.value)}
            className={`h-[22px] flex-1 cursor-pointer rounded-[5px] text-[9px] font-semibold tracking-[0.1em] transition-colors ${
              active ? '' : 'text-white/40 hover:bg-white/[0.04] hover:text-white/70'
            }`}
            style={active
              ? { background: withAlpha(accent, 0.22), color: towardWhite(accent, 0.6) }
              : undefined}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** The curve picker: every easing as its own shape, so the choice is made by
 *  looking rather than by reading a dropdown's option names. */
function CurveSegmented({ interpolation, accent, onInterpolation }: {
  interpolation: InterpolationMode
  accent: string
  onInterpolation: (mode: InterpolationMode) => void
}) {
  const active = INTERP_OPTIONS.find((option) => option.value === interpolation) ?? INTERP_OPTIONS[1]
  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Interpolation curve"
        data-testid="automation-curve-segmented"
        className="flex gap-[2px] rounded-[7px] border border-white/[0.07] bg-black/30 p-[2px]"
      >
        {INTERP_OPTIONS.map((option) => {
          const selected = option.value === interpolation
          return (
            <button
              key={option.value}
              role="radio"
              aria-checked={selected}
              aria-label={option.label}
              title={option.label}
              onClick={() => onInterpolation(option.value)}
              className={`h-7 min-w-0 flex-1 cursor-pointer rounded-[5px] px-[3px] transition-colors ${
                selected ? '' : 'hover:bg-white/[0.04]'
              }`}
              style={selected ? { background: withAlpha(accent, 0.2) } : undefined}
            >
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className="h-full w-full">
                <path
                  d={easePath(option.value, 8, 92, 20)}
                  fill="none"
                  stroke={selected ? towardWhite(accent, 0.6) : 'rgba(255,255,255,0.35)'}
                  strokeWidth={selected ? 1.75 : 1.25}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </button>
          )
        })}
      </div>
      <p className="mt-1.5 text-center text-[9px] font-semibold tracking-[0.1em] text-white/40">{active.label.toUpperCase()}</p>
    </div>
  )
}

// ── The amount fader ────────────────────────────────────────────────────────

/** AMOUNT: the lane's master gain, the panel's one horizontal control (see the
 *  header comment for why it breaks the knob vocabulary). Neutral is a 100%
 *  detent at the rail's center; the lit fill grows FROM that mark, so pulling
 *  the lane down reads as light retreating toward the detent and boosting as
 *  light past it - the same "never half-lit for neutral" rule as LaserKnob's
 *  bipolar arc. The rail is a split taper around that detent: the left half
 *  spans 0-100% and the right half 100%-AUTOMATION_AMOUNT_MAX, so raising the
 *  ceiling doesn't crush the everyday attenuation range into a sliver (a
 *  linear 0-10x rail would park neutral at 10% of the throw). Drag anywhere
 *  on the rail; it snaps onto 100% when close; double-click resets. */
function AmountFader({ amount, accent, onAmount }: {
  amount: number
  accent: string
  onAmount: (amount: number) => void
}) {
  const railRef = useRef<HTMLDivElement>(null)
  const neutralFrac = 0.5
  const boostSpan = AUTOMATION_AMOUNT_MAX - DEFAULT_AUTOMATION_AMOUNT
  const frac = amount <= DEFAULT_AUTOMATION_AMOUNT
    ? clamp(amount / DEFAULT_AUTOMATION_AMOUNT, 0, 1) * neutralFrac
    : neutralFrac + clamp((amount - DEFAULT_AUTOMATION_AMOUNT) / boostSpan, 0, 1) * (1 - neutralFrac)
  const percent = Math.round(amount * 100)

  const valueFromFrac = (t: number) => t <= neutralFrac
    ? (t / neutralFrac) * DEFAULT_AUTOMATION_AMOUNT
    : DEFAULT_AUTOMATION_AMOUNT + ((t - neutralFrac) / (1 - neutralFrac)) * boostSpan
  const valueFromX = (clientX: number) => {
    const rect = railRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return amount
    const t = clamp((clientX - rect.left) / rect.width, 0, 1)
    // The detent catches in RAIL space (a fixed slice of the throw), not value
    // space - the boost half covers 9x per rail, so a value-space window there
    // would be sub-pixel.
    if (Math.abs(t - neutralFrac) < 0.02) return DEFAULT_AUTOMATION_AMOUNT
    return snap(valueFromFrac(t))
  }
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
    onAmount(valueFromX(event.clientX))
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    onAmount(valueFromX(event.clientX))
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    // Nudge in RAIL space so a keypress moves the thumb the same distance on
    // both sides of the detent (in value space that's finer below 100% than
    // above, matching the split taper).
    const nextFrac = clamp(frac + (event.key === 'ArrowRight' ? 1 : -1) * 0.025, 0, 1)
    onAmount(snap(valueFromFrac(nextFrac)))
  }

  const fillLeft = Math.min(frac, neutralFrac)
  const fillWidth = Math.abs(frac - neutralFrac)
  return (
    <div className="flex items-center gap-2.5" data-testid="automation-amount-row">
      <span className="w-[44px] shrink-0 text-[8px] font-semibold tracking-[0.12em] text-white/40">AMOUNT</span>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Amount: scales every value this lane produces"
        aria-valuemin={0}
        aria-valuemax={AUTOMATION_AMOUNT_MAX}
        aria-valuenow={amount}
        aria-valuetext={`${percent}%`}
        title="Amount · multiplies the whole lane · drag · double-click for 100%"
        data-testid="automation-amount-fader"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => onAmount(DEFAULT_AUTOMATION_AMOUNT)}
        onKeyDown={onKeyDown}
        className="relative h-4 min-w-0 flex-1 cursor-ew-resize touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-white/50"
      >
        {/* The recessed rail, in the segmented controls' chassis language. */}
        <div ref={railRef} className="absolute inset-x-0 top-1/2 h-[5px] -translate-y-1/2 rounded-full border border-white/[0.07] bg-black/30" />
        {/* Lit fill from the neutral detent to the thumb. */}
        <div
          className="absolute top-1/2 h-[5px] -translate-y-1/2 rounded-full"
          style={{
            left: `${fillLeft * 100}%`,
            width: `${fillWidth * 100}%`,
            background: withAlpha(accent, 0.4),
            boxShadow: `0 0 8px ${withAlpha(accent, 0.35)}`,
          }}
        />
        {/* The 100% detent mark. */}
        <span
          className="absolute top-1/2 h-[9px] w-[1.5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/25"
          style={{ left: `${neutralFrac * 100}%` }}
        />
        <span
          className="absolute top-1/2 h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70"
          style={{ left: `${frac * 100}%`, background: towardWhite(accent, 0.55), boxShadow: `0 0 6px 1px ${withAlpha(accent, 0.8)}` }}
        />
      </div>
      <span className="w-[34px] shrink-0 text-right font-mono text-[9px] tabular-nums text-white/70">{percent}%</span>
    </div>
  )
}

// ── The panel ───────────────────────────────────────────────────────────────

const SPREAD_OPTIONS: { value: AutomationSpreadCurve; label: string; title: string }[] = [
  { value: 'linear', label: 'LIN', title: 'Rows spread evenly across the range' },
  { value: 'fineLow', label: 'LOW', title: 'Finer resolution near the minimum' },
  { value: 'fineHigh', label: 'HIGH', title: 'Finer resolution near the maximum' },
  { value: 'sCurve', label: 'S', title: 'Finer at both ends, coarser through the middle' },
]

/** The lane's row-spread console: value sub-range, row count, integer snap and
 *  the spread curve. Emits a NORMALIZED config - defaults collapse to absence,
 *  so an untouched lane stays on the frozen historical mapping. */
function RangeConsole({ bounds, range, accent, onRange }: {
  bounds: { min: number; max: number }
  range: AutomationRange | undefined
  accent: string
  onRange: (range: AutomationRange | undefined) => void
}) {
  const lo = range?.min ?? bounds.min
  const hi = range?.max ?? bounds.max
  const rows = range?.rows ?? AUTOMATION_MAX_ROWS
  const integer = range?.integer ?? false
  const curve = range?.curve ?? 'linear'
  const step = integer ? 1 : Math.max(0.01, Number(((bounds.max - bounds.min) / 200).toPrecision(2)))

  const emit = (next: AutomationRange) => {
    const cleaned: AutomationRange = {}
    if (next.min !== undefined && Math.abs(next.min - bounds.min) > 1e-9) cleaned.min = next.min
    if (next.max !== undefined && Math.abs(next.max - bounds.max) > 1e-9) cleaned.max = next.max
    if (next.rows && Math.round(next.rows) !== AUTOMATION_MAX_ROWS) cleaned.rows = Math.round(next.rows)
    if (next.integer) cleaned.integer = true
    if (next.curve && next.curve !== 'linear') cleaned.curve = next.curve
    onRange(Object.keys(cleaned).length ? cleaned : undefined)
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-black/20 p-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-white/35">Rows · Range</span>
        <button
          onClick={() => emit({ min: lo, max: hi, rows, integer: !integer, curve })}
          aria-pressed={integer}
          title="Snap every row's value to a whole number"
          className={`h-[18px] rounded-full px-2 font-mono text-[8px] font-semibold tracking-[0.1em] transition-colors cursor-pointer ${
            integer ? '' : 'border border-white/10 text-white/40 hover:text-white/70'
          }`}
          style={integer ? { background: withAlpha(accent, 0.25), color: towardWhite(accent, 0.6) } : undefined}
        >
          INT
        </button>
      </div>
      <div className="flex items-end gap-4">
        <LaserKnob
          value={lo} min={bounds.min} max={bounds.max} step={step} defaultValue={bounds.min}
          label="MIN" ariaLabel="Bottom row's value" accent={accent}
          onChange={(v) => emit({ min: Math.min(v, hi), max: hi, rows, integer, curve })}
        />
        <LaserKnob
          value={hi} min={bounds.min} max={bounds.max} step={step} defaultValue={bounds.max}
          label="MAX" ariaLabel="Top row's value" accent={accent}
          onChange={(v) => emit({ min: lo, max: Math.max(v, lo), rows, integer, curve })}
        />
        <LaserKnob
          value={rows} min={2} max={AUTOMATION_MAX_ROWS} step={1} defaultValue={AUTOMATION_MAX_ROWS}
          label="ROWS" ariaLabel="Number of rows" accent={accent}
          onChange={(v) => emit({ min: lo, max: hi, rows: v, integer, curve })}
        />
        <div
          role="radiogroup"
          aria-label="Row spread curve"
          className="ml-auto flex gap-[2px] rounded-[7px] border border-white/[0.07] bg-black/30 p-[2px]"
        >
          {SPREAD_OPTIONS.map((option) => {
            const active = option.value === curve
            return (
              <button
                key={option.value}
                role="radio"
                aria-checked={active}
                title={option.title}
                onClick={() => emit({ min: lo, max: hi, rows, integer, curve: option.value })}
                className={`h-[20px] cursor-pointer rounded-[5px] px-1.5 text-[8px] font-semibold tracking-[0.08em] transition-colors ${
                  active ? '' : 'text-white/40 hover:bg-white/[0.04] hover:text-white/70'
                }`}
                style={active ? { background: withAlpha(accent, 0.22), color: towardWhite(accent, 0.6) } : undefined}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function AutomationUserInterface({
  targetLabel, targetKey, targetOptions, onTarget, color, mode, interpolation, noise, burst, cycle, amount, paramBounds, range, onMode, onInterpolation, onNoise, onBurst, onCycle, onAmount, onRange,
}: {
  /** What the lane drives - "Size", "Kaleidoscope · Segments". */
  targetLabel: string
  /** The lane's targetParam key (fx-namespaced for effect settings). */
  targetKey?: string
  /** Every param this lane could drive instead; siblings' targets arrive
   *  disabled. Empty/absent hides the picker row. */
  targetOptions?: { key: string; label: string; disabled: boolean }[]
  onTarget?: (key: string, label: string) => void
  /** The lane's display color; every accent in the panel derives from it. */
  color: string
  mode: AutomationMode
  interpolation: InterpolationMode
  noise: NoiseConfig | undefined
  burst: BurstConfig | undefined
  cycle: CycleConfig | undefined
  /** The lane's output gain (Track.automationAmount, defaulted to 1). */
  amount: number
  onMode: (mode: AutomationMode) => void
  onInterpolation: (mode: InterpolationMode) => void
  onNoise: (noise: NoiseConfig) => void
  onBurst: (burst: BurstConfig) => void
  onCycle: (cycle: CycleConfig) => void
  onAmount: (amount: number) => void
  /** The target param's own bounds; null hides the row-spread console (the
   *  lane's target could not be resolved to a numeric param). */
  paramBounds: { min: number; max: number } | null
  range: AutomationRange | undefined
  onRange: (range: AutomationRange | undefined) => void
}): JSX.Element {
  const accent = hexAccent(color)
  const accentHsv = hexToHsv(accent)
  // A hue-true DARK SHADE, not an alpha tint: low-alpha color over the panel's
  // mid-gray mixes into mud, while the hue kept at low value stays alive.
  const shade = hsvToHex(accentHsv.h, Math.min(accentHsv.s, 0.5), 0.075)
  // Where a full-height note lands after the amount fader. Boosts past 100%
  // pin at the top - that IS the clamp the engine applies, not a plot limit.
  const yAmountPeak = Y_BASE - clamp(amount, 0, 1) * Y_SPAN

  return (
    // The lane fills its chassis: cancel the settings container's p-3 so the
    // shade wash runs to the frame, and round the section itself to sit inside
    // the card's 10px border.
    <section data-testid="automation-user-interface" className="-m-3 rounded-[9px]" style={{ background: shade }}>
      {mode === 'burst' && burst ? (
        (burst.shape ?? 'adsr') === 'bezier'
          ? <BezierBurstWindow burst={burst} accent={accent} onBurst={onBurst} />
          : (burst.shape ?? 'adsr') === 'spring'
            ? <SpringBurstWindow burst={burst} accent={accent} />
            : <BurstWindow burst={burst} accent={accent} onBurst={onBurst} />
      ) : mode === 'cycle' && cycle ? (
        <CycleWindow cycle={cycle} accent={accent} onCycle={onCycle} />
      ) : mode === 'noise' && noise ? (
        <LaneWindow testId="automation-noise-plot" title={`${NOISE_WINDOW_BEATS} beats of this seed`}>
          <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            {/* The note's own value: the wobble happens AROUND this line (the
                amount fader pulls the center down and the wobble in with it). */}
            <line x1={PX0} y1={Y_BASE - clamp(0.5 * amount, 0, 1) * Y_SPAN} x2={PX1} y2={Y_BASE - clamp(0.5 * amount, 0, 1) * Y_SPAN} stroke="rgba(255,255,255,0.12)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            <GlowPath d={noisePath(noise, amount)} accent={accent} />
          </svg>
        </LaneWindow>
      ) : (
        <LaneWindow testId="automation-curve-plot" title="How the lane travels from one keyframe to the next">
          <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            <line x1={PX0} y1={Y_BASE} x2={PX1} y2={Y_BASE} stroke="rgba(255,255,255,0.14)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <line x1={PX0} y1={Y_PEAK} x2={PX1} y2={Y_PEAK} stroke="rgba(255,255,255,0.12)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            <GlowPath d={easePath(interpolation, PX0, PX1, 40, yAmountPeak)} accent={accent} area />
            {/* The two keyframes the curve runs between. */}
            <circle cx={PX0} cy={Y_BASE} r={1.6} fill={towardWhite(accent, 0.7)} />
            <circle cx={PX1} cy={yAmountPeak} r={1.6} fill={towardWhite(accent, 0.7)} />
          </svg>
        </LaneWindow>
      )}

      <div
        className="flex flex-col gap-2.5 px-3 pb-3 pt-2.5"
        // The window's light spilling through the seam onto the console - the
        // room is lit by the lane, not painted.
        style={{ background: `radial-gradient(58% 30px at 50% 0, ${withAlpha(accent, 0.14)}, transparent)` }}
      >
        {/* What the lane drives - retargetable in place. The current target
            rides the list even when unresolvable, so the select never lies. */}
        {targetOptions && targetOptions.length > 0 && onTarget && (
          <div className="flex items-center gap-2.5" data-testid="automation-target-row">
            <span className="w-[44px] shrink-0 text-[8px] font-semibold tracking-[0.12em] text-white/40">TARGET</span>
            <select
              value={targetKey ?? ''}
              aria-label="Which parameter this lane drives"
              onChange={(e) => {
                const option = targetOptions.find((o) => o.key === e.target.value)
                if (option && !option.disabled) onTarget(option.key, option.label)
              }}
              className="h-6 min-w-0 flex-1 cursor-pointer rounded-[5px] border border-white/[0.07] bg-black/30 px-1.5 text-[11px] text-white/70 outline-none"
            >
              {targetKey !== undefined && !targetOptions.some((o) => o.key === targetKey) && (
                <option value={targetKey} disabled>{targetLabel}</option>
              )}
              {targetOptions.map((o) => (
                <option key={o.key} value={o.key} disabled={o.disabled}>{o.label}</option>
              ))}
            </select>
          </div>
        )}

        <ModeSegmented mode={mode} accent={accent} onMode={onMode} />

        {/* Knob rows cluster from the left like Laser Sphere's; each mode's
            PRIMARY knob is pushed to the far right, where that panel's color
            pill sits. */}

        {mode === 'burst' && burst && (
          <ShapeSegmented burst={burst} accent={accent} onBurst={onBurst} />
        )}

        {mode === 'burst' && burst && (burst.shape ?? 'adsr') === 'bezier' && (
          <div className="flex items-end gap-4">
            <LaserKnob
              value={(burst.bezier ?? DEFAULT_BURST_BEZIER).riseBeats} min={0.02} max={4} step={0.01} defaultValue={DEFAULT_BURST_BEZIER.riseBeats}
              label="RISE" ariaLabel="Rise beats" accent={accent} suffix="b"
              onChange={(v) => onBurst({ ...burst, bezier: { ...(burst.bezier ?? DEFAULT_BURST_BEZIER), riseBeats: v } })}
            />
            <LaserKnob
              value={(burst.bezier ?? DEFAULT_BURST_BEZIER).fallBeats} min={0.02} max={8} step={0.01} defaultValue={DEFAULT_BURST_BEZIER.fallBeats}
              label="FALL" ariaLabel="Fall beats" accent={accent} suffix="b"
              onChange={(v) => onBurst({ ...burst, bezier: { ...(burst.bezier ?? DEFAULT_BURST_BEZIER), fallBeats: v } })}
            />
            <div className="ml-auto">
              <LaserKnob
                value={burst.intensity} min={0} max={1} step={0.01} defaultValue={DEFAULT_BURST.intensity}
                label="AMT" ariaLabel="Intensity" accent={accent} large
                onChange={(v) => onBurst({ ...burst, intensity: v })}
              />
            </div>
          </div>
        )}

        {mode === 'burst' && burst && (burst.shape ?? 'adsr') === 'spring' && (
          <div className="flex items-end gap-4">
            <LaserKnob
              value={(burst.spring ?? DEFAULT_BURST_SPRING).stiffness} min={10} max={600} step={1} defaultValue={DEFAULT_BURST_SPRING.stiffness} curve={2}
              label="STIFF" ariaLabel="Spring stiffness" accent={accent}
              onChange={(v) => onBurst({ ...burst, spring: { ...(burst.spring ?? DEFAULT_BURST_SPRING), stiffness: v } })}
            />
            <LaserKnob
              value={(burst.spring ?? DEFAULT_BURST_SPRING).damping} min={1} max={80} step={0.5} defaultValue={DEFAULT_BURST_SPRING.damping}
              label="DAMP" ariaLabel="Spring damping" accent={accent}
              onChange={(v) => onBurst({ ...burst, spring: { ...(burst.spring ?? DEFAULT_BURST_SPRING), damping: v } })}
            />
            <LaserKnob
              value={(burst.spring ?? DEFAULT_BURST_SPRING).mass} min={0.1} max={5} step={0.05} defaultValue={DEFAULT_BURST_SPRING.mass}
              label="MASS" ariaLabel="Spring mass" accent={accent}
              onChange={(v) => onBurst({ ...burst, spring: { ...(burst.spring ?? DEFAULT_BURST_SPRING), mass: v } })}
            />
            <div className="ml-auto">
              <LaserKnob
                value={burst.intensity} min={0} max={1} step={0.01} defaultValue={DEFAULT_BURST.intensity}
                label="AMT" ariaLabel="Intensity" accent={accent} large
                onChange={(v) => onBurst({ ...burst, intensity: v })}
              />
            </div>
          </div>
        )}

        {mode === 'burst' && burst && (burst.shape ?? 'adsr') === 'adsr' && (
          <div className="flex items-end gap-4">
            <LaserKnob
              value={burst.attackBeats} min={0} max={ATTACK_MAX} step={0.01} defaultValue={DEFAULT_BURST.attackBeats}
              label="ATK" ariaLabel="Attack beats" accent={accent} suffix="b"
              onChange={(v) => onBurst({ ...burst, attackBeats: v })}
            />
            <LaserKnob
              value={burst.decayBeats} min={0} max={DECAY_MAX} step={0.01} defaultValue={DEFAULT_BURST.decayBeats}
              label="DEC" ariaLabel="Decay beats" accent={accent} suffix="b"
              onChange={(v) => onBurst({ ...burst, decayBeats: v })}
            />
            <LaserKnob
              value={burst.sustainLevel} min={0} max={1} step={0.01} defaultValue={DEFAULT_BURST.sustainLevel}
              label="SUS" ariaLabel="Sustain level" accent={accent}
              onChange={(v) => onBurst({ ...burst, sustainLevel: v })}
            />
            <LaserKnob
              value={burst.releaseBeats} min={0} max={RELEASE_MAX} step={0.01} defaultValue={DEFAULT_BURST.releaseBeats}
              label="REL" ariaLabel="Release beats" accent={accent} suffix="b"
              onChange={(v) => onBurst({ ...burst, releaseBeats: v })}
            />
            {/* Intensity is the lane's primary param - how far every burst gets. */}
            <div className="ml-auto">
              <LaserKnob
                value={burst.intensity} min={0} max={1} step={0.01} defaultValue={DEFAULT_BURST.intensity}
                label="AMT" ariaLabel="Intensity" accent={accent} large
                onChange={(v) => onBurst({ ...burst, intensity: v })}
              />
            </div>
          </div>
        )}

        {mode === 'cycle' && cycle && (() => {
          // The resting-bound knob speaks param units; an unresolvable target
          // falls back to a unit range (same fallback the engine samples with).
          const kmin = paramBounds?.min ?? 0
          const kmax = paramBounds?.max ?? 1
          const step = Math.max(0.01, Number(((kmax - kmin) / 200).toPrecision(2)))
          const invert = cycle.invert ?? false
          return (
            <>
              <CyclePresetRow cycle={cycle} accent={accent} onCycle={onCycle} />
              <div className="flex items-end gap-4">
                <button
                  onClick={() => onCycle({ ...cycle, invert: !invert })}
                  aria-pressed={invert}
                  title="Flip which bound the notes own: normally a note is the cycle's high over the floor; inverted it is the low under a constant ceiling"
                  data-testid="automation-cycle-invert"
                  className={`mb-4 h-[22px] rounded-full px-2.5 font-mono text-[8px] font-semibold tracking-[0.1em] transition-colors cursor-pointer ${
                    invert ? '' : 'border border-white/10 text-white/40 hover:text-white/70'
                  }`}
                  style={invert ? { background: withAlpha(accent, 0.25), color: towardWhite(accent, 0.6) } : undefined}
                >
                  INVERT
                </button>
                <button
                  onClick={() => onCycle({ ...cycle, noteSpan: !cycle.noteSpan })}
                  aria-pressed={!!cycle.noteSpan}
                  title="End each cycle at its note's end instead of stretching to the next onset - duration matters, a lone note cycles, and the gap after a note lets go"
                  data-testid="automation-cycle-notespan"
                  className={`mb-4 h-[22px] rounded-full px-2.5 font-mono text-[8px] font-semibold tracking-[0.1em] transition-colors cursor-pointer ${
                    cycle.noteSpan ? '' : 'border border-white/10 text-white/40 hover:text-white/70'
                  }`}
                  style={cycle.noteSpan ? { background: withAlpha(accent, 0.25), color: towardWhite(accent, 0.6) } : undefined}
                >
                  NOTE END
                </button>
                {/* The bound the notes do NOT own - the cycle rests here. */}
                <div className="ml-auto">
                  {invert ? (
                    <LaserKnob
                      value={clamp(cycle.ceiling ?? kmax, kmin, kmax)} min={kmin} max={kmax} step={step} defaultValue={kmax}
                      label="CEIL" ariaLabel="Ceiling: the constant high the cycle reaches; notes set its lows" accent={accent} large
                      onChange={(v) => onCycle({ ...cycle, ceiling: v })}
                    />
                  ) : (
                    <LaserKnob
                      value={clamp(cycle.floor ?? 0, kmin, kmax)} min={kmin} max={kmax} step={step} defaultValue={clamp(0, kmin, kmax)}
                      label="FLOOR" ariaLabel="Floor: the value the cycle rests on; notes set its peaks" accent={accent} large
                      onChange={(v) => onCycle({ ...cycle, floor: v })}
                    />
                  )}
                </div>
              </div>
            </>
          )
        })()}

        {mode === 'noise' && noise && (
          <div className="flex items-end gap-4">
            <LaserKnob
              value={noise.rate} min={0.5} max={16} step={0.5} defaultValue={DEFAULT_NOISE.rate}
              label="RATE" ariaLabel="Wiggles per beat" accent={accent}
              onChange={(v) => onNoise({ ...noise, rate: v })}
            />
            <LaserKnob
              value={noise.smoothness} min={0} max={1} step={0.05} defaultValue={DEFAULT_NOISE.smoothness}
              label="SMOOTH" ariaLabel="Smoothness: 0 is stepped chaos, 1 is smooth wandering" accent={accent}
              onChange={(v) => onNoise({ ...noise, smoothness: v })}
            />
            <div className="ml-auto flex items-end gap-2">
              <LaserKnob
                value={noise.range} min={0} max={1} step={0.05} defaultValue={DEFAULT_NOISE.range}
                label="RANGE" ariaLabel="Deviation around the note's value" accent={accent} large
                onChange={(v) => onNoise({ ...noise, range: v })}
              />
              <button
              onClick={() => onNoise({ ...noise, seed: Math.floor(Math.random() * 1e9) })}
              title="Re-roll the noise (a new random take; each take replays identically)"
              aria-label="Re-roll the noise seed"
              data-testid="automation-noise-reroll"
              className="mb-4 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white/80"
            >
                <Dices size={13} />
              </button>
            </div>
          </div>
        )}

        {mode === 'curve' && (
          <CurveSegmented interpolation={interpolation} accent={accent} onInterpolation={onInterpolation} />
        )}

        {/* The lane's master gain, below whichever mode console is up: it
            belongs to the lane, not the mode, so it keeps one seat. */}
        <AmountFader amount={amount} accent={accent} onAmount={onAmount} />

        {/* How the rows spread onto the value range - shared by every mode
            (pitch encodes value in all three). */}
        {paramBounds && (
          <RangeConsole bounds={paramBounds} range={range} accent={accent} onRange={onRange} />
        )}

        {/* What this lane does, in the mode it is in. */}
        <p className="text-[10px] leading-relaxed text-white/40">
          {mode === 'burst' ? (
            <>Every note fires this envelope on <span className="text-white/75">{targetLabel}</span>, starting from
              whatever value is underneath and heading for the note&apos;s own row. Velocity is the note&apos;s intensity;
              between bursts the lane lets go.</>
          ) : mode === 'cycle' ? (
            <>
              {cycle?.noteSpan ? (
                <>The curve plays once over each note on <span className="text-white/75">{targetLabel}</span>, onset
                  to note end; in the gap after a note the lane lets go. </>
              ) : (
                <>The curve plays once between each pair of note onsets on <span className="text-white/75">{targetLabel}</span>,
                  stretched to fit; outside the onsets the lane lets go. </>
              )}
              {cycle?.invert ? (
                <>The note&apos;s row is the cycle&apos;s LOW; its high part holds the ceiling.</>
              ) : (
                <>The note&apos;s row is the cycle&apos;s peak; it rests on the floor. Matching endpoint heights make
                  the wave seamless.</>
              )}
            </>
          ) : mode === 'noise' ? (
            <>While a note is held, <span className="text-white/75">{targetLabel}</span> wanders around the note&apos;s
              row; between notes the lane lets go. The seed is fixed per take, so scrubbing and export replay the
              exact same wobble.</>
          ) : (
            <>Each note is a keyframe on <span className="text-white/75">{targetLabel}</span> - its row is the value,
              its position the time. {interpolation === 'step' ? 'Step holds each value until the next.' : 'The curve glides between them.'}</>
          )}
        </p>
      </div>
    </section>
  )
}
