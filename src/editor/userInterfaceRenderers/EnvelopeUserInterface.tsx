'use client'

import { useRef, type JSX, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { DEFAULT_ADSR } from '../core/visual/adsr'
import { ParamSlider } from './ParameterControl'

// Bespoke settings for an Envelope child track: the ADSR drawn as a real curve
// you grab. Three handles - attack (time), decay (time + sustain level), and
// release (time) - ride the curve itself; depth scales the whole curve's
// height so the plot always shows what the target will actually receive.
// Segments are straight lines on purpose: the evaluator (core/visual/adsr.ts)
// is piecewise-linear, and the picture should not promise curves it won't play.
// Purely presentational - every value flows through the passed props.

export interface EnvelopeAdsr { attackBeats: number; decayBeats: number; sustainLevel: number; releaseBeats: number }

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const snap = (value: number, step = 0.01) => Number((Math.round(value / step) * step).toFixed(4))

// Slider ranges (mirror the stock envelope sliders).
const ATTACK_MAX = 4
const DECAY_MAX = 8
const RELEASE_MAX = 8

// Plot geometry, in percent of the pad. Each stage gets a fixed lane so short
// attacks stay grabbable instead of collapsing against the left edge; the gap
// between the decay handle and the release lane reads as the sustain hold.
const AX0 = 4, AX1 = 28          // attack lane: 0..ATTACK_MAX beats
const DX0 = 28, DX1 = 62         // decay lane: 0..DECAY_MAX beats
const RS = 70                    // release lane start (gate lifts here)
const RX0 = 70, RX1 = 96         // release lane: 0..RELEASE_MAX beats
const Y_PEAK = 14, Y_BASE = 86   // level 1 (at full depth) .. level 0

/** One grabbable node on the curve: pointer capture, arrow nudges, double-click reset. */
function CurveHandle({ padRef, x, y, ariaLabel, ariaMin, ariaMax, ariaNow, ariaText, cursor, onDragTo, onNudge, onReset }: {
  padRef: RefObject<HTMLDivElement | null>
  x: number
  y: number
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
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const rect = padRef.current?.getBoundingClientRect()
    if (!rect) return
    onDragTo(
      ((event.clientX - rect.left) / rect.width) * 100,
      ((event.clientY - rect.top) / rect.height) * 100,
    )
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
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
      className="absolute z-10 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 touch-none select-none rounded-[2px] border border-[var(--border-strong)] bg-[var(--text-2)] outline-none transition-colors hover:bg-[var(--accent-hover)] focus-visible:border-[var(--accent)] focus-visible:bg-[var(--accent)]"
      style={{ left: `${x}%`, top: `${y}%`, cursor }}
    />
  )
}

export function EnvelopeUserInterface(props: {
  targetLabel: string            // e.g. "Opacity" or "Kaleidoscope · Segments"
  isOpacity: boolean
  adsr: EnvelopeAdsr
  depth: number
  peak: { value: number; min: number; max: number; step: number } | null  // null for opacity target
  onAdsr: (next: EnvelopeAdsr) => void
  onDepth: (v: number) => void
  onPeak: (v: number) => void
}): JSX.Element {
  const { targetLabel, isOpacity, adsr, depth, peak, onAdsr, onDepth, onPeak } = props
  const padRef = useRef<HTMLDivElement>(null)

  const depthSafe = Math.max(depth, 0.05) // keeps sustain drags invertible at tiny depths
  const ySpan = Y_BASE - Y_PEAK
  const yOf = (level: number) => Y_BASE - clamp(level, 0, 1) * depth * ySpan

  const ax = AX0 + (clamp(adsr.attackBeats, 0, ATTACK_MAX) / ATTACK_MAX) * (AX1 - AX0)
  const dx = DX0 + (clamp(adsr.decayBeats, 0, DECAY_MAX) / DECAY_MAX) * (DX1 - DX0)
  const rx = RX0 + (clamp(adsr.releaseBeats, 0, RELEASE_MAX) / RELEASE_MAX) * (RX1 - RX0)
  const yPeak = yOf(1)
  const ySus = yOf(adsr.sustainLevel)

  const curve = `M ${AX0} ${Y_BASE} L ${ax} ${yPeak} L ${dx} ${ySus} L ${RS} ${ySus} L ${rx} ${Y_BASE}`

  const setAttackFromX = (fx: number) =>
    onAdsr({ ...adsr, attackBeats: snap(clamp(((fx - AX0) / (AX1 - AX0)) * ATTACK_MAX, 0, ATTACK_MAX)) })
  const setDecaySustainFrom = (fx: number, fy: number) =>
    onAdsr({
      ...adsr,
      decayBeats: snap(clamp(((fx - DX0) / (DX1 - DX0)) * DECAY_MAX, 0, DECAY_MAX)),
      sustainLevel: snap(clamp((Y_BASE - fy) / (depthSafe * ySpan), 0, 1)),
    })
  const setReleaseFromX = (fx: number) =>
    onAdsr({ ...adsr, releaseBeats: snap(clamp(((fx - RX0) / (RX1 - RX0)) * RELEASE_MAX, 0, RELEASE_MAX)) })

  return (
    <section data-testid="envelope-user-interface" className="mb-3">
      <p className="text-[11px] text-zinc-500 mb-1">Envelope → {targetLabel}</p>
      <p className="text-[10px] text-[var(--text-muted)] mb-2">
        Notes on this lane gate the envelope. Pitch is ignored; velocity scales the peak.
      </p>

      {/* --- The curve --- */}
      <div
        ref={padRef}
        data-testid="envelope-adsr-pad"
        role="group"
        aria-label="ADSR envelope curve"
        className="relative h-[96px] select-none overflow-hidden rounded border border-[var(--border)] bg-[var(--bg-canvas)]"
      >
        <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {/* Peak guide: where "full on" lands after depth - it sinks as depth eases off. */}
          <line x1={AX0} y1={yPeak} x2={RX1} y2={yPeak} stroke="var(--border)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          {/* Gate-off mark: release always starts here, whatever decay is doing. */}
          <line x1={RS} y1={Y_PEAK - 4} x2={RS} y2={Y_BASE} stroke="var(--border-subtle)" strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          <line x1={AX0} y1={Y_BASE} x2={RX1} y2={Y_BASE} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <path d={`${curve} L ${AX0} ${Y_BASE} Z`} fill="var(--accent-muted)" opacity={0.16} />
          <path d={curve} fill="none" stroke="var(--accent-muted)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </svg>

        <CurveHandle
          padRef={padRef}
          x={ax}
          y={yPeak}
          ariaLabel="Attack"
          ariaMin={0}
          ariaMax={ATTACK_MAX}
          ariaNow={adsr.attackBeats}
          ariaText={`Attack ${adsr.attackBeats.toFixed(2)} beats`}
          cursor="ew-resize"
          onDragTo={(fx) => setAttackFromX(fx)}
          onNudge={(dx2) => { if (dx2 !== 0) onAdsr({ ...adsr, attackBeats: snap(clamp(adsr.attackBeats + dx2 * 0.05, 0, ATTACK_MAX)) }) }}
          onReset={() => onAdsr({ ...adsr, attackBeats: DEFAULT_ADSR.attackBeats })}
        />
        <CurveHandle
          padRef={padRef}
          x={dx}
          y={ySus}
          ariaLabel="Decay and sustain"
          ariaMin={0}
          ariaMax={DECAY_MAX}
          ariaNow={adsr.decayBeats}
          ariaText={`Decay ${adsr.decayBeats.toFixed(2)} beats, sustain ${adsr.sustainLevel.toFixed(2)}`}
          cursor="move"
          onDragTo={setDecaySustainFrom}
          onNudge={(dx2, dy2) => onAdsr({
            ...adsr,
            decayBeats: snap(clamp(adsr.decayBeats + dx2 * 0.05, 0, DECAY_MAX)),
            sustainLevel: snap(clamp(adsr.sustainLevel + dy2 * 0.02, 0, 1)),
          })}
          onReset={() => onAdsr({ ...adsr, decayBeats: DEFAULT_ADSR.decayBeats, sustainLevel: DEFAULT_ADSR.sustainLevel })}
        />
        <CurveHandle
          padRef={padRef}
          x={rx}
          y={Y_BASE}
          ariaLabel="Release"
          ariaMin={0}
          ariaMax={RELEASE_MAX}
          ariaNow={adsr.releaseBeats}
          ariaText={`Release ${adsr.releaseBeats.toFixed(2)} beats`}
          cursor="ew-resize"
          onDragTo={(fx) => setReleaseFromX(fx)}
          onNudge={(dx2) => { if (dx2 !== 0) onAdsr({ ...adsr, releaseBeats: snap(clamp(adsr.releaseBeats + dx2 * 0.05, 0, RELEASE_MAX)) }) }}
          onReset={() => onAdsr({ ...adsr, releaseBeats: DEFAULT_ADSR.releaseBeats })}
        />
      </div>

      {/* Beat-unit readouts, one per stage, sitting under their lanes. */}
      <div className="mb-3 mt-1 grid grid-cols-4 font-mono text-[9px] tabular-nums text-[var(--text-muted)]">
        <span>A {adsr.attackBeats.toFixed(2)}b</span>
        <span>D {adsr.decayBeats.toFixed(2)}b</span>
        <span className="text-center">S {adsr.sustainLevel.toFixed(2)}</span>
        <span className="text-right">R {adsr.releaseBeats.toFixed(2)}b</span>
      </div>

      {/* Depth scales the curve above; peak is the value the curve drives toward. */}
      <ParamSlider label="Depth" value={depth} min={0} max={1} step={0.01} onChange={onDepth} />
      {peak && (
        <ParamSlider label="Peak value" value={peak.value} min={peak.min} max={peak.max} step={peak.step} onChange={onPeak} />
      )}
      {isOpacity && (
        <p className="text-[9px] text-[var(--text-muted)]">
          Opacity target - the envelope is a pure 0-1 multiplier, so there is no peak value.
        </p>
      )}
    </section>
  )
}
