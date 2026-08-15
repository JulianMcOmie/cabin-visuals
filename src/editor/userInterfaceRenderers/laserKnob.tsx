'use client'

// The console knob of docs/instrument-panel-design-guide.md, extracted from
// LaserSphereUserInterface so every panel that adopts the guide turns the SAME
// knob. Plain numbers in, plain numbers out - callers bind it to whatever they
// have (a UserInterfaceParameter, an ADSR field on a track, a mover input).
//
// The value arc IS a laser: a near-white hot core drawn over a blurred accent
// copy of the same arc, so light exists only where the arc is lit - no uniform
// drop shadow around the knob (tried and reverted). A white-hot dot burns at the
// arc's tip, the beam's terminus. Interaction never brightens anything: the hand
// changes the parameter, the parameter changes the light.

import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { towardWhite } from './colorWheel'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** How much vertical travel covers the whole range, in pixels. */
const DRAG_TRAVEL = 140

/** The knob's default readout: integer-stepped params show no decimals, and a
 *  value too small for 2dp falls back to one significant digit rather than "0.00". */
export function formatKnobValue(value: number, step: number): string {
  if (step >= 1) return value.toFixed(0)
  if (value !== 0 && Math.abs(value) < 0.01) return value.toPrecision(1)
  return value.toFixed(2)
}

export function LaserKnob({
  value, min, max, step, defaultValue, curve = 1, label, ariaLabel, accent,
  large = false, bipolar = false, disabled = false, suffix, format, title, onChange,
}: {
  value: number
  min: number
  max: number
  step: number
  /** Where double-click sends it. */
  defaultValue: number
  /** Response curve, exactly as ParamSlider reads it (1 = linear). */
  curve?: number
  /** The short all-caps caption under the knob. */
  label: string
  /** Spoken name, when the caption is too terse to stand alone. */
  ariaLabel?: string
  accent: string
  /** The panel's primary param reads one step larger. */
  large?: boolean
  /**
   * For a SIGNED param whose zero is the middle of its travel (a spin rate that
   * can run either way). The arc grows out of 12 o'clock toward the value
   * instead of filling from 7 o'clock, so "off" is dark and the direction is
   * visible - a half-lit ring for zero reads as half ON, which is a lie.
   */
  bipolar?: boolean
  /**
   * The knob still SHOWS its value but no longer takes input - for a value the
   * panel derives from something else (an INT automation lane's row count), so
   * the reading stays visible instead of the control vanishing and the row
   * re-flowing. Say why in `title`.
   */
  disabled?: boolean
  /** Appended to the readout (e.g. 'b' for beats). */
  suffix?: string
  format?: (value: number) => string
  /** Overrides the default drag hint - what a disabled knob owes the user. */
  title?: string
  onChange: (value: number) => void
}) {
  const dragRef = useRef<{ y: number; norm: number } | null>(null)

  const range = max - min
  const norm = range === 0 ? 0 : clamp((value - min) / range, 0, 1)
  const percent = Math.pow(norm, 1 / curve)
  const angle = -135 + percent * 270
  // Where the lit span begins and ends, in degrees from the 225deg origin.
  const anchor = bipolar ? 0.5 : 0
  const litFrom = Math.min(percent, anchor) * 270
  const litTo = Math.max(percent, anchor) * 270
  const litArc = (color: string) =>
    `conic-gradient(from 225deg, transparent 0deg ${litFrom}deg, ${color} ${litFrom}deg ${litTo}deg, transparent ${litTo}deg 360deg)`

  const commitNorm = (t: number) => {
    const raw = min + Math.pow(clamp(t, 0, 1), curve) * range
    // Curved knobs round to 3 significant digits instead of the step grid: the
    // low end is the whole reason the curve exists, and stepping would erase it.
    const snapped = curve === 1
      ? min + Math.round((raw - min) / step) * step
      : raw === 0 ? 0 : Number(raw.toPrecision(3))
    onChange(clamp(Number(snapped.toFixed(8)), min, max))
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    event.preventDefault()
    // Capture can throw for exotic/synthetic pointers; the drag still works
    // through the move/up handlers on the element itself.
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
    dragRef.current = { y: event.clientY, norm: percent }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    commitNorm(dragRef.current.norm + (dragRef.current.y - event.clientY) / DRAG_TRAVEL)
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
    event.preventDefault()
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1
    // Never nudge less than one step: on a coarse stepped knob (a detent
    // selector spanning a handful of indices) 3% of the travel rounds back to
    // the value it started from and the arrows read as dead.
    const nudge = Math.max(0.03, range === 0 ? 0 : step / range)
    commitNorm(percent + direction * nudge)
  }

  return (
    <div className={`flex min-w-0 flex-col items-center ${disabled ? 'opacity-45' : ''}`}>
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel ?? label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-disabled={disabled || undefined}
        title={title ?? 'Drag vertically · double-click to reset'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => { if (!disabled) onChange(defaultValue) }}
        onKeyDown={onKeyDown}
        className={`relative ${large ? 'h-[52px] w-[52px]' : 'h-11 w-11'} ${disabled ? 'cursor-default' : 'cursor-ns-resize'} touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/50`}
      >
        {/* Emission is sold by exponential falloff: a wide soft accent bloom, a
            tight whiter bloom, then the white-hot core - all copies of the same
            arc, so light exists only where the arc is lit. */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: litArc(accent),
            filter: 'blur(6px)',
            transform: 'scale(1.16)',
            opacity: 0.9,
          }}
        />
        <div
          className="absolute inset-0 rounded-full"
          style={{ background: litArc(towardWhite(accent, 0.35)), filter: 'blur(1.5px)' }}
        />
        <div className="absolute inset-0 rounded-full" style={{ background: litArc(towardWhite(accent, 0.82)) }} />
        {/* The unlit remainder of the travel, so the arc reads as a fill in a
            ring rather than as a stray stroke. */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(from 225deg, rgba(255,255,255,0.08) 0deg ${litFrom}deg, transparent ${litFrom}deg ${litTo}deg, rgba(255,255,255,0.08) ${litTo}deg 270deg, transparent 270deg)`,
          }}
        />
        <div className="absolute inset-[3px] rounded-full border border-white/10 bg-[#14171f]" />
        <div className="absolute inset-0" style={{ transform: `rotate(${angle}deg)` }}>
          <span className="absolute left-1/2 top-[5px] h-2.5 w-[2px] -translate-x-1/2 rounded-full bg-white/90" />
          {/* The laser terminus: a white-hot point at the arc's tip. */}
          <span
            className="absolute left-1/2 top-[-1px] h-1 w-1 -translate-x-1/2 rounded-full bg-white"
            style={{ boxShadow: `0 0 5px 1.5px ${accent}` }}
          />
        </div>
      </div>
      {/* Omitted entirely when blank: a grid panel that labels its ROWS and
          COLUMNS instead has nothing to say per knob, and an empty caption
          would still cost a line of height on every one of them. */}
      {label !== '' && (
        <span className="mt-1 text-[8px] font-semibold tracking-[0.12em] text-white/40">{label}</span>
      )}
      <span className="font-mono text-[9px] tabular-nums text-white/70">
        {(format ?? ((v: number) => formatKnobValue(v, step)))(value)}{suffix}
      </span>
    </div>
  )
}
