'use client'

// Bespoke settings surface for the Translation Oscillator mover (definition id
// 'translationOscillator'). The waveform pad draws the mover's actual wave -
// (1 - cos(2π · cyclesPerBeat · t)) / 2, one trace per axis scaled by that
// axis' amplitude - and is directly manipulable: drag vertically for the
// distance multiplier, horizontally for cycles/beat. The basis matrix gets a
// bespoke 3×3 bipolar drag-cell grid, and the MIDI legend is generated from
// the mover's real row table (SIGNED_BASIS_ROWS + the return pitch).

import { useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { AudioWaveform, RotateCcw } from 'lucide-react'
import {
  RETURN_PITCH,
  SIGNED_BASIS_DIRECTIONS,
  SIGNED_BASIS_ROWS,
} from '../core/visualCopies/motionBasis'
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

const CYAN = '#2bd4e8'
const AXIS_COLORS = ['#f87171', '#4ade80', '#60a5fa'] as const
const AXIS_NAMES = ['X', 'Y', 'Z'] as const

/** The mover's exact wave shape: 0 at rest, out to the full extent and back. */
const wave = (beat: number, cyclesPerBeat: number) => (1 - Math.cos(beat * Math.max(0, cyclesPerBeat) * Math.PI * 2)) / 2

// ── Waveform pad ─────────────────────────────────────────────────────────────

const WAVE_W = 260
const WAVE_H = 104
const WAVE_PAD_X = 10
const WAVE_TOP = 12
const WAVE_BASE = 88
const WAVE_WINDOW_BEATS = 2

function WaveformPad({
  cycles,
  distance,
  axisDistances,
}: {
  cycles: UserInterfaceParameter
  distance: UserInterfaceParameter
  axisDistances: [number, number, number]
}) {
  const dotRef = useRef<SVGCircleElement>(null)
  const dragRef = useRef<{ x: number; y: number; cycles: number; distance: number } | null>(null)

  const cyclesValue = numericValue(cycles, 1)
  const distanceValue = numericValue(distance, 1)
  const amplitudes = axisDistances.map((axisDistance) => axisDistance * distanceValue)
  const maxAmplitude = Math.max(0.0001, ...amplitudes)
  const innerW = WAVE_W - WAVE_PAD_X * 2
  const innerH = WAVE_BASE - WAVE_TOP
  const toX = (beat: number) => WAVE_PAD_X + (beat / WAVE_WINDOW_BEATS) * innerW
  const toY = (normalized: number) => WAVE_BASE - normalized * innerH

  const samples = 240
  const tracePath = (amplitude: number) => {
    const scale = amplitude / maxAmplitude
    let path = ''
    for (let i = 0; i <= samples; i++) {
      const beat = (i / samples) * WAVE_WINDOW_BEATS
      path += `${i === 0 ? 'M' : 'L'}${toX(beat).toFixed(1)},${toY(wave(beat, cyclesValue) * scale).toFixed(1)}`
    }
    return path
  }

  // Live values for the raf phase dot - no re-subscription on param changes.
  const liveRef = useRef({ cyclesValue, toX, toY })
  liveRef.current = { cyclesValue, toX, toY }

  useEffect(() => {
    let raf = 0
    const started = performance.now()
    const tick = (now: number) => {
      const live = liveRef.current
      // Notional 90 BPM playback across the 2-beat window.
      const beat = (((now - started) / 1000) * 1.5) % WAVE_WINDOW_BEATS
      dotRef.current?.setAttribute('cx', live.toX(beat).toFixed(1))
      dotRef.current?.setAttribute('cy', live.toY(wave(beat, live.cyclesValue)).toFixed(1))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x: event.clientX, y: event.clientY, cycles: cyclesValue, distance: distanceValue }
  }
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const distanceDefinition = distance.definition
    if (isNumberParam(distanceDefinition)) {
      const range = distanceDefinition.max - distanceDefinition.min
      commitNumber(distance, drag.distance + ((drag.y - event.clientY) / 110) * range)
    }
    commitNumber(cycles, drag.cycles * Math.pow(2, (event.clientX - drag.x) / 130))
  }
  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div
      data-testid="oscillator-waveform-pad"
      className="relative border-y border-white/[0.07]"
      style={{ background: 'radial-gradient(circle at 70% 18%, rgba(43,212,232,0.10), rgba(7,9,14,0.97) 62%), linear-gradient(150deg, #0a1216, #07090e)' }}
    >
      <svg
        viewBox={`0 0 ${WAVE_W} ${WAVE_H}`}
        className="block h-auto w-full cursor-move touch-none"
        role="slider"
        tabIndex={0}
        aria-label="Oscillation waveform: drag vertically for distance multiplier, horizontally for cycles per beat"
        aria-valuetext={`${cyclesValue.toFixed(2)} cycles per beat, distance ×${distanceValue.toFixed(2)}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => { cycles.setValue(cycles.definition.default as number); distance.setValue(distance.definition.default as number) }}
        onKeyDown={(event: KeyboardEvent<SVGSVGElement>) => {
          if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
          event.preventDefault()
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            const cyclesDefinition = cycles.definition
            if (isNumberParam(cyclesDefinition)) commitNumber(cycles, cyclesValue + (event.key === 'ArrowRight' ? 1 : -1) * cyclesDefinition.step)
          } else {
            const distanceDefinition = distance.definition
            if (isNumberParam(distanceDefinition)) commitNumber(distance, distanceValue + (event.key === 'ArrowUp' ? 1 : -1) * distanceDefinition.step)
          }
        }}
      >
        {/* beat grid across the 2-beat window */}
        {[0, 0.5, 1, 1.5, 2].map((beat) => (
          <line
            key={beat}
            x1={toX(beat)} x2={toX(beat)} y1={WAVE_TOP - 4} y2={WAVE_BASE}
            stroke={Number.isInteger(beat) ? 'rgba(255,255,255,0.11)' : 'rgba(255,255,255,0.05)'} strokeWidth="1"
          />
        ))}
        <line x1={WAVE_PAD_X} x2={WAVE_W - WAVE_PAD_X} y1={WAVE_BASE} y2={WAVE_BASE} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
        <line x1={WAVE_PAD_X} x2={WAVE_W - WAVE_PAD_X} y1={WAVE_TOP} y2={WAVE_TOP} stroke="rgba(255,255,255,0.07)" strokeDasharray="3 4" strokeWidth="1" />

        {/* per-axis traces, largest amplitude reaching the top guide */}
        {[2, 1, 0].map((axis) => (
          amplitudes[axis] > 0.0001 && (
            <path
              key={axis}
              d={tracePath(amplitudes[axis])}
              fill="none"
              stroke={AXIS_COLORS[axis]}
              strokeWidth={amplitudes[axis] === maxAmplitude ? 1.6 : 1.1}
              strokeLinecap="round"
              opacity={amplitudes[axis] === maxAmplitude ? 0.95 : 0.55}
            />
          )
        ))}
        <circle ref={dotRef} cx={toX(0)} cy={toY(0)} r="3" fill="#c9f6fb" stroke="rgba(43,212,232,0.55)" strokeWidth="2.5" />

        <text x={WAVE_PAD_X} y={WAVE_H - 4} fill="rgba(255,255,255,0.30)" fontSize="7" fontFamily="monospace">beat 1</text>
        <text x={toX(1)} y={WAVE_H - 4} fill="rgba(255,255,255,0.30)" fontSize="7" fontFamily="monospace" textAnchor="middle">beat 2</text>
        <text x={WAVE_W - WAVE_PAD_X} y={WAVE_H - 4} fill="rgba(43,212,232,0.65)" fontSize="7" fontFamily="monospace" textAnchor="end">
          {cyclesValue.toFixed(2)} cyc/beat · ×{distanceValue.toFixed(2)}
        </text>
      </svg>
      <span className="pointer-events-none absolute right-1.5 top-1 font-mono text-[7px] text-white/25">drag ↕ amp · ↔ rate</span>
    </div>
  )
}

// ── Axis amplitude faders ────────────────────────────────────────────────────

function AxisFader({ bound, axis }: { bound: UserInterfaceParameter; axis: number }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null
  const value = bound.value
  const percent = clamp((value - definition.min) / (definition.max - definition.min), 0, 1)
  const color = AXIS_COLORS[axis]

  const setFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const normalized = 1 - clamp((event.clientY - rect.top) / rect.height, 0, 1)
    commitNumber(bound, definition.min + normalized * (definition.max - definition.min))
  }

  return (
    <div className="flex min-w-0 flex-col items-center gap-1">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={definition.label}
        aria-valuemin={definition.min}
        aria-valuemax={definition.max}
        aria-valuenow={value}
        title="Drag · double-click to reset"
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          setFromPointer(event)
        }}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromPointer(event) }}
        onDoubleClick={() => bound.setValue(definition.default)}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
          event.preventDefault()
          const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1
          commitNumber(bound, value + direction * definition.step)
        }}
        className="relative h-[72px] w-7 cursor-ns-resize touch-none overflow-hidden rounded-md border border-white/10 bg-[#090c13] shadow-[inset_0_0_12px_rgba(0,0,0,.5)] outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
      >
        <div
          className="absolute inset-x-0 bottom-0"
          style={{ height: `${percent * 100}%`, background: `linear-gradient(to top, ${color}55, ${color}22)`, borderTop: `2px solid ${color}` }}
        />
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-[8px] font-semibold tracking-[0.08em]" style={{ color }}>{AXIS_NAMES[axis]}</span>
        <span className="font-mono text-[8px] tabular-nums text-white/45">{value.toFixed(1)}</span>
      </div>
    </div>
  )
}

// ── Knobs ────────────────────────────────────────────────────────────────────

function OscKnob({
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
        className="relative h-12 w-12 cursor-ns-resize touch-none rounded-full outline-none ring-offset-2 ring-offset-[#0b0e15] focus-visible:ring-2 focus-visible:ring-cyan-400"
        style={{
          background: `conic-gradient(from 225deg, ${CYAN} 0deg ${percent * 270}deg, #242938 ${percent * 270}deg 270deg, transparent 270deg)`,
          boxShadow: '0 7px 13px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.13)',
        }}
      >
        <div className="absolute inset-1 rounded-full border border-white/10 bg-[radial-gradient(circle_at_38%_28%,#2c3b40,#141c1f_52%,#070b0c_78%)]" />
        <div className="absolute inset-0" style={{ transform: `rotate(${angle}deg)` }}>
          <span className="absolute left-1/2 top-[7px] h-3 w-[2px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,.65)]" />
        </div>
      </div>
      <div className="mt-1 flex max-w-full items-baseline gap-1">
        <span className="text-[8px] font-semibold tracking-[0.1em] text-white/38">{label}</span>
        <span className="font-mono text-[8px] tabular-nums text-cyan-200">{value.toFixed(2)}{suffix}</span>
      </div>
    </div>
  )
}

// ── Basis matrix ─────────────────────────────────────────────────────────────

/** One bipolar matrix cell: vertical drag over −1…1, bar splits at center. */
function BasisCell({ bound }: { bound: UserInterfaceParameter }) {
  const dragRef = useRef<{ y: number; value: number } | null>(null)
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null
  const value = bound.value
  const magnitude = clamp(Math.abs(value), 0, 1)
  const positive = value >= 0

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={definition.label}
      aria-valuemin={definition.min}
      aria-valuemax={definition.max}
      aria-valuenow={value}
      title={`${definition.label} · drag vertically · double-click to reset`}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        dragRef.current = { y: event.clientY, value }
      }}
      onPointerMove={(event) => {
        if (!dragRef.current) return
        commitNumber(bound, dragRef.current.value + ((dragRef.current.y - event.clientY) / 70) * (definition.max - definition.min))
      }}
      onPointerUp={(event) => {
        dragRef.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onDoubleClick={() => bound.setValue(definition.default)}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
        event.preventDefault()
        const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1
        commitNumber(bound, value + direction * definition.step)
      }}
      className="relative h-8 cursor-ns-resize touch-none overflow-hidden rounded border border-white/[0.08] bg-[#090c13] outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
    >
      <span className="absolute left-1/2 top-0 h-full w-px bg-white/10" />
      <span
        className="absolute top-0 h-full"
        style={
          positive
            ? { left: '50%', width: `${magnitude * 50}%`, background: 'rgba(43,212,232,0.35)' }
            : { right: '50%', width: `${magnitude * 50}%`, background: 'rgba(251,113,133,0.35)' }
        }
      />
      <span className="absolute inset-0 flex items-center justify-center font-mono text-[8px] tabular-nums text-white/70">
        {value.toFixed(2)}
      </span>
    </div>
  )
}

const BASIS_KEYS = [
  ['basisXX', 'basisXY', 'basisXZ'],
  ['basisYX', 'basisYY', 'basisYZ'],
  ['basisZX', 'basisZY', 'basisZZ'],
] as const

function BasisMatrix({ parameters }: { parameters: readonly UserInterfaceParameter[] }) {
  const cells = BASIS_KEYS.map((row) => row.map((key) => parameter(parameters, key)))
  if (cells.some((row) => row.some((cell) => !cell))) return null

  const resetIdentity = () => {
    for (const row of cells) for (const cell of row) cell!.setValue(cell!.definition.default)
  }

  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-1.5">
      <div className="mb-1 flex items-baseline justify-between px-0.5">
        <span className="text-[8px] font-semibold tracking-[0.1em] text-white/38">MOTION BASIS</span>
        <button
          onClick={resetIdentity}
          className="rounded border border-white/[0.07] bg-black/15 px-1.5 py-0.5 text-[7px] font-semibold tracking-[0.06em] text-white/32 transition-colors hover:border-cyan-300/25 hover:bg-cyan-500/10 hover:text-cyan-100"
        >
          IDENTITY
        </button>
      </div>
      <div className="grid grid-cols-[14px_1fr_1fr_1fr] items-center gap-1">
        <span />
        {AXIS_NAMES.map((name) => (
          <span key={name} className="text-center font-mono text-[7px] text-white/28">·{name.toLowerCase()}</span>
        ))}
        {cells.map((row, axis) => (
          <div key={AXIS_NAMES[axis]} className="contents">
            <span className="text-center font-mono text-[8px] font-bold" style={{ color: AXIS_COLORS[axis] }}>{AXIS_NAMES[axis]}</span>
            {row.map((cell) => <BasisCell key={cell!.definition.key} bound={cell!} />)}
          </div>
        ))}
      </div>
      <p className="mt-1 px-0.5 font-mono text-[7px] leading-tight text-white/22">each row = the world-space direction that basis axis oscillates along (auto-normalized)</p>
    </div>
  )
}

// ── MIDI legend ──────────────────────────────────────────────────────────────

function MidiLegend() {
  const rows = [
    ...SIGNED_BASIS_ROWS.map((row) => ({ ...row, axis: SIGNED_BASIS_DIRECTIONS[row.pitch]?.axis })),
    { pitch: RETURN_PITCH, label: 'Return to origin', axis: undefined },
  ].sort((a, b) => a.pitch - b.pitch)
  return (
    <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5">
      {rows.map((row) => (
        <div key={row.pitch} className="flex items-center gap-1.5 rounded border border-white/[0.05] bg-black/20 px-1.5 py-[3px]">
          <span className="w-5 flex-shrink-0 text-center font-mono text-[8px] tabular-nums text-white/45">{row.pitch}</span>
          <span
            className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
            style={{ background: row.axis === undefined ? CYAN : AXIS_COLORS[row.axis] }}
          />
          <span className="truncate text-[8px] font-semibold tracking-[0.05em] text-white/55">{row.label}</span>
        </div>
      ))}
    </div>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

const PLACED_KEYS = new Set([
  'distanceX', 'distanceY', 'distanceZ', 'distance', 'cyclesPerBeat', 'returnBeats',
  ...BASIS_KEYS.flat(),
])

export const TranslationOscillatorUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const distanceX = parameter(parameters, 'distanceX')
  const distanceY = parameter(parameters, 'distanceY')
  const distanceZ = parameter(parameters, 'distanceZ')
  const distance = parameter(parameters, 'distance')
  const cyclesPerBeat = parameter(parameters, 'cyclesPerBeat')
  const returnBeats = parameter(parameters, 'returnBeats')

  if (!distanceX || !distanceY || !distanceZ || !distance || !cyclesPerBeat || !returnBeats) {
    return <ParameterList parameters={parameters} />
  }

  const unplaced = parameters.filter((bound) => !PLACED_KEYS.has(bound.definition.key))

  const resetAll = () => {
    for (const bound of parameters) bound.setValue(bound.definition.default)
  }

  return (
    <section
      data-testid="translation-oscillator-user-interface"
      className="-mx-1 overflow-hidden rounded-xl border border-white/[0.09] bg-[#0b0e15] text-white shadow-[0_18px_42px_rgba(0,0,0,.34)]"
    >
      <header className="flex h-10 items-center justify-between px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-cyan-300/25 bg-cyan-500/15 text-cyan-200">
            <AudioWaveform size={13} strokeWidth={1.75} />
          </div>
          <span className="truncate text-[10px] font-bold uppercase tracking-[0.13em] text-white/85">Translation Osc</span>
          <span className="truncate font-mono text-[8px] text-cyan-200/60">{numericValue(cyclesPerBeat, 1).toFixed(2)} cyc/beat</span>
        </div>
        <button
          aria-label="Reset all Translation Oscillator parameters"
          title="Reset all"
          onClick={resetAll}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-white/35 transition-colors hover:bg-white/[0.08] hover:text-white/70"
        >
          <RotateCcw size={12} />
        </button>
      </header>

      <WaveformPad
        cycles={cyclesPerBeat}
        distance={distance}
        axisDistances={[numericValue(distanceX, 1), numericValue(distanceY, 1), numericValue(distanceZ, 1)]}
      />

      <div className="space-y-2 p-2">
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <div className="flex items-end gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.025] px-2 py-1.5">
            <AxisFader bound={distanceX} axis={0} />
            <AxisFader bound={distanceY} axis={1} />
            <AxisFader bound={distanceZ} axis={2} />
          </div>
          <div className="flex flex-col justify-center gap-1 rounded-lg border border-white/[0.07] bg-white/[0.025] px-1.5 py-1">
            <div className="grid grid-cols-3 gap-1">
              <OscKnob parameter={cyclesPerBeat} label="RATE" />
              <OscKnob parameter={distance} label="DIST" suffix="×" />
              <OscKnob parameter={returnBeats} label="RET" suffix="b" />
            </div>
          </div>
        </div>

        <BasisMatrix parameters={parameters} />

        <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-1.5">
          <span className="px-0.5 text-[8px] font-semibold tracking-[0.1em] text-white/38">MIDI ROWS · held notes oscillate</span>
          <MidiLegend />
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
