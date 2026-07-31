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
//
// Burst mode is the one place the window is also an EDITOR: an envelope's shape
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
  DEFAULT_NOISE,
  easeFraction,
  sampleNoiseLane,
  type BurstConfig,
  type NoiseConfig,
} from '../core/visual/automation'
import { LaserKnob } from './laserKnob'
import { hexToHsv, hsvToHex, towardWhite, withAlpha } from './colorWheel'
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

// ── Segmented controls ──────────────────────────────────────────────────────

const MODE_OPTIONS: { value: AutomationMode; label: string; title: string }[] = [
  { value: 'curve', label: 'CURVE', title: 'Notes are value keyframes joined by a curve' },
  { value: 'noise', label: 'NOISE', title: 'Held notes gate a seeded random wobble around their value' },
  { value: 'burst', label: 'BURST', title: 'Each note fires an ADSR envelope toward its value' },
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
 *  bipolar arc. Drag anywhere on the rail; it snaps onto 100% when close;
 *  double-click resets. */
function AmountFader({ amount, accent, onAmount }: {
  amount: number
  accent: string
  onAmount: (amount: number) => void
}) {
  const railRef = useRef<HTMLDivElement>(null)
  const frac = clamp(amount / AUTOMATION_AMOUNT_MAX, 0, 1)
  const neutralFrac = DEFAULT_AUTOMATION_AMOUNT / AUTOMATION_AMOUNT_MAX
  const percent = Math.round(amount * 100)

  const valueFromX = (clientX: number) => {
    const rect = railRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return amount
    const t = clamp((clientX - rect.left) / rect.width, 0, 1)
    const value = snap(t * AUTOMATION_AMOUNT_MAX)
    // The detent: 100% catches the thumb, so neutral is easy to land exactly.
    return Math.abs(value - DEFAULT_AUTOMATION_AMOUNT) < 0.04 ? DEFAULT_AUTOMATION_AMOUNT : value
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
    const delta = (event.key === 'ArrowRight' ? 1 : -1) * 0.05
    onAmount(snap(clamp(amount + delta, 0, AUTOMATION_AMOUNT_MAX)))
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
      <span className="w-[30px] shrink-0 text-right font-mono text-[9px] tabular-nums text-white/70">{percent}%</span>
    </div>
  )
}

// ── The panel ───────────────────────────────────────────────────────────────

export function AutomationUserInterface({
  targetLabel, color, mode, interpolation, noise, burst, amount, onMode, onInterpolation, onNoise, onBurst, onAmount,
}: {
  /** What the lane drives - "Size", "Kaleidoscope · Segments". */
  targetLabel: string
  /** The lane's display color; every accent in the panel derives from it. */
  color: string
  mode: AutomationMode
  interpolation: InterpolationMode
  noise: NoiseConfig | undefined
  burst: BurstConfig | undefined
  /** The lane's output gain (Track.automationAmount, defaulted to 1). */
  amount: number
  onMode: (mode: AutomationMode) => void
  onInterpolation: (mode: InterpolationMode) => void
  onNoise: (noise: NoiseConfig) => void
  onBurst: (burst: BurstConfig) => void
  onAmount: (amount: number) => void
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
        <BurstWindow burst={burst} accent={accent} onBurst={onBurst} />
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
        <ModeSegmented mode={mode} accent={accent} onMode={onMode} />

        {/* Knob rows cluster from the left like Laser Sphere's; each mode's
            PRIMARY knob is pushed to the far right, where that panel's color
            pill sits. */}

        {mode === 'burst' && burst && (
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

        {/* What this lane does, in the mode it is in. */}
        <p className="text-[10px] leading-relaxed text-white/40">
          {mode === 'burst' ? (
            <>Every note fires this envelope on <span className="text-white/75">{targetLabel}</span>, starting from
              whatever value is underneath and heading for the note&apos;s own row. Velocity is the note&apos;s intensity;
              between bursts the lane lets go.</>
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
