'use client'

// Bespoke settings surface for the Burst mover (definition id 'burst').
// Reads the mover's real easing curves (BURST_EASINGS) and MIDI vocabulary
// (BURST_DIRECTIONS) so the panel can never drift from the engine: the curve
// preview draws the exact eased time-warp the mover evaluates, and the axis
// pad + compass legend are generated from the pitch table itself.

import { useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { RotateCcw, Zap } from 'lucide-react'
import { BURST_DIRECTIONS, BURST_EASINGS } from '../core/visualCopies/library'
import { isNumberParam } from '../instruments/types'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function parameter(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((candidate) => candidate.definition.key === key)
}

function numericValue(bound: UserInterfaceParameter | undefined, fallback = 0): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

/** Snap + clamp a raw number into a numeric param's grid before committing. */
function commitNumber(bound: UserInterfaceParameter, raw: number) {
  const definition = bound.definition
  if (!isNumberParam(definition)) return
  const snapped = definition.min + Math.round((raw - definition.min) / definition.step) * definition.step
  bound.setValue(clamp(Number(snapped.toFixed(8)), definition.min, definition.max))
}

const AMBER = '#f5a623'

// ── Easing selector ──────────────────────────────────────────────────────────

/** Tiny glyph of one easing family (sharpness 1) for the segmented selector. */
function EasingGlyph({ easingIndex }: { easingIndex: number }) {
  const { ease } = BURST_EASINGS[easingIndex] ?? BURST_EASINGS[0]
  const samples = 28
  let vMin = 0
  let vMax = 1
  const values: number[] = []
  for (let i = 0; i <= samples; i++) {
    const v = ease(i / samples)
    values.push(v)
    vMin = Math.min(vMin, v)
    vMax = Math.max(vMax, v)
  }
  const span = Math.max(0.0001, vMax - vMin)
  const points = values
    .map((v, i) => `${((i / samples) * 22 + 1).toFixed(1)},${(13 - ((v - vMin) / span) * 12).toFixed(1)}`)
    .join(' ')
  return (
    <svg aria-hidden="true" viewBox="0 0 24 14" className="h-3.5 w-6">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function EasingSelector({ bound }: { bound: UserInterfaceParameter }) {
  const definition = bound.definition
  if (definition.type !== 'select') return null
  const selected = typeof bound.value === 'number' ? Math.round(bound.value) : definition.default
  return (
    <div className="grid grid-cols-6 gap-1 border-t border-white/[0.06] px-2 py-1.5">
      {definition.options.map((option) => {
        const active = option.value === selected
        return (
          <button
            key={option.value}
            data-testid={`burst-easing-${option.label.toLowerCase()}`}
            aria-label={`${option.label} easing`}
            aria-pressed={active}
            onClick={() => bound.setValue(option.value)}
            className={`flex min-w-0 flex-col items-center gap-0.5 rounded-md border py-1 transition-colors ${active
              ? 'border-amber-300/40 bg-amber-500/15 text-amber-200'
              : 'border-white/[0.07] bg-white/[0.025] text-white/30 hover:bg-white/[0.06] hover:text-white/65'}`}
          >
            <EasingGlyph easingIndex={option.value} />
            <span className="max-w-full truncate text-[6px] font-semibold tracking-[0.06em]">{option.label.toUpperCase()}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── Live curve preview ───────────────────────────────────────────────────────

const CURVE_W = 260
const CURVE_H = 92
const CURVE_PAD_X = 10
const CURVE_PAD_TOP = 10
const CURVE_PAD_BOTTOM = 16

/** Draws the exact eased time-warp the mover evaluates -
 *  ease(progress ^ (1 / sharpness)) - plus a looping flight marker. */
function CurvePreview({
  easingIndex,
  sharpness,
  burstBeats,
}: {
  easingIndex: number
  sharpness: number
  burstBeats: number
}) {
  const markerRef = useRef<SVGCircleElement>(null)
  const cursorRef = useRef<SVGLineElement>(null)

  const { ease, label } = BURST_EASINGS[easingIndex] ?? BURST_EASINGS[0]
  const warp = Math.max(0.0001, sharpness)
  const samples = 110
  const values: number[] = []
  let vMin = 0
  let vMax = 1
  for (let i = 0; i <= samples; i++) {
    const v = ease(Math.pow(i / samples, 1 / warp))
    values.push(v)
    vMin = Math.min(vMin, v)
    vMax = Math.max(vMax, v)
  }
  const pad = (vMax - vMin) * 0.08
  vMin -= pad
  vMax += pad
  const innerW = CURVE_W - CURVE_PAD_X * 2
  const innerH = CURVE_H - CURVE_PAD_TOP - CURVE_PAD_BOTTOM
  const toX = (t: number) => CURVE_PAD_X + t * innerW
  const toY = (v: number) => CURVE_PAD_TOP + ((vMax - v) / Math.max(0.0001, vMax - vMin)) * innerH
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i / samples).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')

  // The looping marker reads live values from a ref so the raf loop never
  // needs re-subscribing as params change under the pointer.
  const liveRef = useRef({ ease, warp, burstBeats, toX, toY })
  liveRef.current = { ease, warp, burstBeats, toX, toY }

  useEffect(() => {
    let raf = 0
    const started = performance.now()
    const tick = (now: number) => {
      const live = liveRef.current
      // Notional 120 BPM playback: burstBeats beats of flight, then a rest.
      const flight = clamp(live.burstBeats * 0.5, 0.3, 4)
      const total = flight + 0.5
      const progress = Math.min(1, (((now - started) / 1000) % total) / flight)
      const value = live.ease(Math.pow(progress, 1 / live.warp))
      markerRef.current?.setAttribute('cx', live.toX(progress).toFixed(1))
      markerRef.current?.setAttribute('cy', live.toY(value).toFixed(1))
      cursorRef.current?.setAttribute('x1', live.toX(progress).toFixed(1))
      cursorRef.current?.setAttribute('x2', live.toX(progress).toFixed(1))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div
      data-testid="burst-curve-preview"
      className="relative border-y border-white/[0.07]"
      style={{ background: 'radial-gradient(circle at 24% 20%, rgba(245,166,35,0.10), rgba(7,9,14,0.97) 62%), linear-gradient(150deg, #12100a, #07090e)' }}
    >
      <svg viewBox={`0 0 ${CURVE_W} ${CURVE_H}`} className="block h-auto w-full" role="img" aria-label={`${label} burst curve preview`}>
        {/* landing line (eased value 1) and launch line (0) */}
        <line x1={CURVE_PAD_X} x2={CURVE_W - CURVE_PAD_X} y1={toY(1)} y2={toY(1)} stroke="rgba(255,255,255,0.16)" strokeDasharray="3 4" strokeWidth="1" />
        <line x1={CURVE_PAD_X} x2={CURVE_W - CURVE_PAD_X} y1={toY(0)} y2={toY(0)} stroke="rgba(255,255,255,0.09)" strokeWidth="1" />
        <line ref={cursorRef} y1={CURVE_PAD_TOP} y2={CURVE_H - CURVE_PAD_BOTTOM} x1={toX(0)} x2={toX(0)} stroke="rgba(245,166,35,0.14)" strokeWidth="1" />
        <path d={path} fill="none" stroke="rgba(245,166,35,0.28)" strokeWidth="4" strokeLinecap="round" />
        <path d={path} fill="none" stroke={AMBER} strokeWidth="1.5" strokeLinecap="round" />
        <circle ref={markerRef} cx={toX(0)} cy={toY(0)} r="3.2" fill="#ffe1a6" stroke="rgba(245,166,35,0.55)" strokeWidth="2.5" />
        <text x={CURVE_PAD_X} y={CURVE_H - 4} fill="rgba(255,255,255,0.30)" fontSize="7" fontFamily="monospace">0</text>
        <text x={CURVE_W - CURVE_PAD_X} y={CURVE_H - 4} fill="rgba(255,255,255,0.30)" fontSize="7" fontFamily="monospace" textAnchor="end">{burstBeats.toFixed(2)} beats</text>
        <text x={CURVE_W - CURVE_PAD_X} y={toY(1) - 3} fill="rgba(245,166,35,0.55)" fontSize="7" fontFamily="monospace" textAnchor="end">landed</text>
      </svg>
    </div>
  )
}

// ── Knobs ────────────────────────────────────────────────────────────────────

function BurstKnob({
  parameter: bound,
  label,
  suffix = '',
}: {
  parameter: UserInterfaceParameter
  label: string
  suffix?: string
}) {
  const definition = bound.definition
  const dragRef = useRef<{ y: number; value: number } | null>(null)
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null

  const value = bound.value
  const range = definition.max - definition.min
  const percent = range === 0 ? 0 : clamp((value - definition.min) / range, 0, 1)
  const angle = -135 + percent * 270

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { y: event.clientY, value }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    commitNumber(bound, dragRef.current.value + ((dragRef.current.y - event.clientY) / 100) * range)
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
    event.preventDefault()
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1
    commitNumber(bound, value + direction * definition.step)
  }

  return (
    <div className="flex min-w-0 flex-col items-center py-1">
      <div
        role="slider"
        tabIndex={0}
        aria-label={definition.label}
        aria-valuemin={definition.min}
        aria-valuemax={definition.max}
        aria-valuenow={value}
        title="Drag vertically · double-click to reset"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => bound.setValue(definition.default)}
        onKeyDown={onKeyDown}
        className="relative h-12 w-12 cursor-ns-resize touch-none rounded-full outline-none ring-offset-2 ring-offset-[#0b0e15] focus-visible:ring-2 focus-visible:ring-amber-400"
        style={{
          background: `conic-gradient(from 225deg, ${AMBER} 0deg ${percent * 270}deg, #242938 ${percent * 270}deg 270deg, transparent 270deg)`,
          boxShadow: '0 7px 13px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.13)',
        }}
      >
        <div className="absolute inset-1 rounded-full border border-white/10 bg-[radial-gradient(circle_at_38%_28%,#403a2c,#1c1a14_52%,#0b0a07_78%)]" />
        <div className="absolute inset-0" style={{ transform: `rotate(${angle}deg)` }}>
          <span className="absolute left-1/2 top-[7px] h-3 w-[2px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,.65)]" />
        </div>
      </div>
      <div className="mt-1 flex max-w-full items-baseline gap-1">
        <span className="text-[8px] font-semibold tracking-[0.1em] text-white/38">{label}</span>
        <span className="font-mono text-[8px] tabular-nums text-amber-200">{value.toFixed(2)}{suffix}</span>
      </div>
    </div>
  )
}

// ── Axis pad ─────────────────────────────────────────────────────────────────

const PAD_W = 260
const PAD_H = 150
const PAD_CX = 130
const PAD_CY = 72
const PAD_MAX_LEN = 54

/** Screen-space isometric directions for engine axes X, Y, Z. */
const AXIS_SCREEN = [
  { x: 0.92, y: 0.34 },
  { x: 0, y: -1 },
  { x: -0.92, y: 0.34 },
] as const
const AXIS_COLORS = ['#f87171', '#4ade80', '#60a5fa'] as const
const AXIS_NAMES = ['X', 'Y', 'Z'] as const

/** Isometric axis star: six burst directions, arrow length = per-axis distance.
 *  Drag either tip of an axis to set that axis' distance. */
function AxisPad({ axes }: { axes: [UserInterfaceParameter, UserInterfaceParameter, UserInterfaceParameter] }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ axis: number; sign: 1 | -1 } | null>(null)

  const setFromPointer = (event: ReactPointerEvent<SVGElement>) => {
    const drag = dragRef.current
    const rect = svgRef.current?.getBoundingClientRect()
    if (!drag || !rect) return
    const sx = ((event.clientX - rect.left) / rect.width) * PAD_W
    const sy = ((event.clientY - rect.top) / rect.height) * PAD_H
    const unit = AXIS_SCREEN[drag.axis]
    const projection = ((sx - PAD_CX) * unit.x + (sy - PAD_CY) * unit.y) * drag.sign
    const bound = axes[drag.axis]
    const definition = bound.definition
    if (!isNumberParam(definition)) return
    commitNumber(bound, (clamp(projection, 0, PAD_MAX_LEN) / PAD_MAX_LEN) * (definition.max - definition.min) + definition.min)
  }

  return (
    <svg
      ref={svgRef}
      data-testid="burst-axis-pad"
      viewBox={`0 0 ${PAD_W} ${PAD_H}`}
      className="block h-auto w-full touch-none rounded-md border border-white/10 bg-[#090c13] shadow-[inset_0_0_20px_rgba(0,0,0,.58)]"
      role="group"
      aria-label="Burst per-axis distances"
    >
      <circle cx={PAD_CX} cy={PAD_CY} r={PAD_MAX_LEN} fill="none" stroke="rgba(255,255,255,0.05)" />
      <circle cx={PAD_CX} cy={PAD_CY} r={PAD_MAX_LEN / 2} fill="none" stroke="rgba(255,255,255,0.04)" />
      {axes.map((bound, axis) => {
        const definition = bound.definition
        if (!isNumberParam(definition) || typeof bound.value !== 'number') return null
        const value = bound.value
        const range = Math.max(0.0001, definition.max - definition.min)
        const length = clamp(((value - definition.min) / range) * PAD_MAX_LEN, 0, PAD_MAX_LEN)
        const unit = AXIS_SCREEN[axis]
        const color = AXIS_COLORS[axis]
        return (
          <g key={definition.key}>
            {/* faint full-length guide */}
            <line
              x1={PAD_CX - unit.x * PAD_MAX_LEN} y1={PAD_CY - unit.y * PAD_MAX_LEN}
              x2={PAD_CX + unit.x * PAD_MAX_LEN} y2={PAD_CY + unit.y * PAD_MAX_LEN}
              stroke="rgba(255,255,255,0.06)" strokeWidth="1"
            />
            {([1, -1] as const).map((sign) => {
              const tipX = PAD_CX + unit.x * sign * Math.max(length, 4)
              const tipY = PAD_CY + unit.y * sign * Math.max(length, 4)
              return (
                <g key={sign}>
                  <line
                    x1={PAD_CX} y1={PAD_CY} x2={PAD_CX + unit.x * sign * length} y2={PAD_CY + unit.y * sign * length}
                    stroke={color} strokeWidth="2" strokeLinecap="round" opacity={length < 1 ? 0.25 : 0.85}
                  />
                  <circle
                    cx={tipX} cy={tipY} r="4.5"
                    fill={length < 1 ? '#090c13' : color} stroke={color} strokeWidth="1.5"
                    className="cursor-grab focus:outline-none"
                    role="slider"
                    tabIndex={0}
                    aria-label={`${definition.label} (${sign > 0 ? '+' : '−'}${AXIS_NAMES[axis]} tip)`}
                    aria-valuemin={definition.min}
                    aria-valuemax={definition.max}
                    aria-valuenow={value}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      dragRef.current = { axis, sign }
                      ;(event.currentTarget as SVGCircleElement).setPointerCapture(event.pointerId)
                    }}
                    onPointerMove={(event) => { if (dragRef.current?.axis === axis) setFromPointer(event) }}
                    onPointerUp={(event) => {
                      dragRef.current = null
                      const target = event.currentTarget as SVGCircleElement
                      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
                    }}
                    onDoubleClick={() => bound.setValue(definition.default)}
                    onKeyDown={(event) => {
                      if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
                      event.preventDefault()
                      const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1
                      commitNumber(bound, value + direction * definition.step)
                    }}
                  />
                </g>
              )
            })}
            <text
              x={PAD_CX + unit.x * (Math.max(length, 4) + 14)}
              y={PAD_CY + unit.y * (Math.max(length, 4) + 14) + 2.5}
              fill={color} fontSize="8" fontFamily="monospace" textAnchor="middle" opacity="0.9"
            >
              {AXIS_NAMES[axis]} {value.toFixed(1)}
            </text>
          </g>
        )
      })}
      <circle cx={PAD_CX} cy={PAD_CY} r="2.4" fill="#ffe1a6" />
    </svg>
  )
}

// ── MIDI compass legend ──────────────────────────────────────────────────────

const DIRECTION_NAMES: Record<string, string> = {
  '0,1': 'Right', '0,-1': 'Left',
  '1,1': 'Up', '1,-1': 'Down',
  '2,1': 'Forward', '2,-1': 'Back',
}

function MidiCompass() {
  const rows = Object.entries(BURST_DIRECTIONS)
    .map(([pitch, direction]) => ({ pitch: Number(pitch), ...direction }))
    .sort((a, b) => a.pitch - b.pitch)
  return (
    <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5">
      {rows.map((row) => (
        <div key={row.pitch} className="flex items-center gap-1.5 rounded border border-white/[0.05] bg-black/20 px-1.5 py-[3px]">
          <span className="w-5 flex-shrink-0 text-center font-mono text-[8px] tabular-nums text-white/45">{row.pitch}</span>
          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: AXIS_COLORS[row.axis] }} />
          <span className="truncate text-[8px] font-semibold tracking-[0.05em] text-white/55">
            {DIRECTION_NAMES[`${row.axis},${row.sign}`]} ({row.sign > 0 ? '+' : '−'}{AXIS_NAMES[row.axis]})
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

const PLACED_KEYS = new Set(['burstBeats', 'easing', 'sharpness', 'distanceX', 'distanceY', 'distanceZ', 'distance'])

export const BurstMoverUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const burstBeats = parameter(parameters, 'burstBeats')
  const easing = parameter(parameters, 'easing')
  const sharpness = parameter(parameters, 'sharpness')
  const distanceX = parameter(parameters, 'distanceX')
  const distanceY = parameter(parameters, 'distanceY')
  const distanceZ = parameter(parameters, 'distanceZ')
  const distance = parameter(parameters, 'distance')

  if (!burstBeats || !easing || !sharpness || !distanceX || !distanceY || !distanceZ || !distance) {
    return <ParameterList parameters={parameters} />
  }

  const unplaced = parameters.filter((bound) => !PLACED_KEYS.has(bound.definition.key))
  const easingIndex = typeof easing.value === 'number' ? Math.round(easing.value) : 0
  const easingLabel = (BURST_EASINGS[easingIndex] ?? BURST_EASINGS[0]).label

  const resetAll = () => {
    for (const bound of parameters) bound.setValue(bound.definition.default)
  }

  return (
    <section
      data-testid="burst-user-interface"
      className="-mx-1 overflow-hidden rounded-xl border border-white/[0.09] bg-[#0b0e15] text-white shadow-[0_18px_42px_rgba(0,0,0,.34)]"
    >
      <header className="flex h-10 items-center justify-between px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-amber-300/25 bg-amber-500/15 text-amber-200">
            <Zap size={13} strokeWidth={1.75} />
          </div>
          <span className="truncate text-[10px] font-bold uppercase tracking-[0.13em] text-white/85">Burst</span>
          <span className="truncate font-mono text-[8px] text-amber-200/60">{easingLabel.toLowerCase()} · {numericValue(burstBeats, 1).toFixed(2)}b</span>
        </div>
        <button
          aria-label="Reset all Burst parameters"
          title="Reset all"
          onClick={resetAll}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-white/35 transition-colors hover:bg-white/[0.08] hover:text-white/70"
        >
          <RotateCcw size={12} />
        </button>
      </header>

      <EasingSelector bound={easing} />

      <CurvePreview
        easingIndex={easingIndex}
        sharpness={numericValue(sharpness, 1)}
        burstBeats={numericValue(burstBeats, 1)}
      />

      <div className="space-y-2 p-2">
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-white/[0.07] bg-white/[0.025] px-1.5 py-1">
          <BurstKnob parameter={burstBeats} label="BEATS" suffix="b" />
          <BurstKnob parameter={sharpness} label="SHARP" />
          <BurstKnob parameter={distance} label="DIST" suffix="×" />
        </div>

        <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-1.5">
          <div className="mb-1 flex items-baseline justify-between px-0.5">
            <span className="text-[8px] font-semibold tracking-[0.1em] text-white/38">STEP DISTANCES</span>
            <span className="font-mono text-[7px] text-white/28">drag arrow tips · dbl-click resets</span>
          </div>
          <AxisPad axes={[distanceX, distanceY, distanceZ]} />
          <MidiCompass />
        </div>

        {unplaced.length > 0 && (
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-2">
            <ParameterList parameters={unplaced} />
          </div>
        )}
      </div>
    </section>
  )
}
