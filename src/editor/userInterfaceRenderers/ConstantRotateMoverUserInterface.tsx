'use client'

// Bespoke settings surface for the Constant Rotate mover: a gyroscope hero —
// a wireframe cube continuously spinning at the ACTUAL per-axis speeds with
// one guide ring per active axis (each ring's dot travels at that axis' own
// rate), a periodic simulated RETURN sweep timed by returnBeats, tachometer
// speed dials per axis and a master multiplier. Basis params fall through to
// the generic ParameterList in a collapsible section.

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ChevronDown, RefreshCcw, RotateCcw } from 'lucide-react'
import { RETURN_PITCH, SIGNED_BASIS_ROWS } from '../core/visualCopies/motionBasis'
import { isNumberParam } from '../instruments/types'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const DEG = Math.PI / 180

const AXES = [
  { letter: 'X', color: '#e0685f' },
  { letter: 'Y', color: '#7dc37d' },
  { letter: 'Z', color: '#5fa8e0' },
] as const

function parameter(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((candidate) => candidate.definition.key === key)
}

function numericValue(bound: UserInterfaceParameter | undefined, fallback = 0): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

function useLiveRef<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg - 90) * DEG
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number) {
  if (to - from >= 359.9) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r}`
  }
  const [sx, sy] = polar(cx, cy, r, from)
  const [ex, ey] = polar(cx, cy, r, to)
  const large = to - from > 180 ? 1 : 0
  return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`
}

// --- Tachometer drag knob ---------------------------------------------------

function DialKnob({
  bound,
  label,
  unit = '',
  color = 'var(--accent)',
  digits = 2,
  size = 46,
  centerLetter,
}: {
  bound: UserInterfaceParameter
  label: string
  unit?: string
  color?: string
  digits?: number
  size?: number
  centerLetter?: string
}) {
  const definition = bound.definition
  const dragRef = useRef<{ y: number; value: number } | null>(null)
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null

  const value = bound.value
  const range = definition.max - definition.min
  const percent = range === 0 ? 0 : clamp((value - definition.min) / range, 0, 1)
  const sweep = percent * 270

  const commit = (raw: number) => {
    const snapped = definition.min + Math.round((raw - definition.min) / definition.step) * definition.step
    bound.setValue(clamp(Number(snapped.toFixed(8)), definition.min, definition.max))
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { y: event.clientY, value }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    commit(dragRef.current.value + ((dragRef.current.y - event.clientY) / 110) * range)
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
    event.preventDefault()
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1
    commit(value + direction * definition.step)
  }

  const c = size / 2
  const r = c - 4

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
        className="cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <svg width={size} height={size} aria-hidden="true">
          <path d={arcPath(c, c, r, -135, 135)} fill="none" stroke="var(--border)" strokeWidth="3" strokeLinecap="round" />
          {sweep > 0.5 && (
            <path d={arcPath(c, c, r, -135, -135 + sweep)} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
          )}
          <circle cx={c} cy={c} r={r - 6} fill="var(--bg-elevated)" stroke="var(--border-strong)" strokeWidth="1" />
          {centerLetter && (
            <text x={c} y={c + 3} textAnchor="middle" fontSize="9" fontWeight="700" fill={color}>{centerLetter}</text>
          )}
          <line
            x1={polar(c, c, r - 12, -135 + sweep)[0]}
            y1={polar(c, c, r - 12, -135 + sweep)[1]}
            x2={polar(c, c, r - 6, -135 + sweep)[0]}
            y2={polar(c, c, r - 6, -135 + sweep)[1]}
            stroke="var(--text-2)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="mt-0.5 flex max-w-full items-baseline gap-1">
        <span className="text-[8px] font-semibold tracking-[0.1em] text-[var(--text-muted)]">{label}</span>
        <span className="font-mono text-[8px] tabular-nums text-[var(--text-3)]">{value.toFixed(digits)}{unit}</span>
      </div>
    </div>
  )
}

// --- MIDI grammar legend (with the return-orientation row) ------------------

function MidiLegend() {
  return (
    <div className="flex flex-wrap items-center gap-1 px-2.5 pb-2 pt-0.5">
      <span className="mr-0.5 text-[7px] font-semibold tracking-[0.14em] text-[var(--text-muted)]">MIDI ROWS</span>
      {SIGNED_BASIS_ROWS.map((row) => {
        const axis = row.label.includes('X') ? 0 : row.label.includes('Y') ? 1 : 2
        const sign = row.label.trim().startsWith('+') ? '+' : '−'
        const { color, letter } = AXES[axis]
        return (
          <span
            key={row.pitch}
            title={`${row.label} · pitch ${row.pitch}`}
            className="rounded border px-1 py-0.5 font-mono text-[7px] leading-none"
            style={{ color, borderColor: `${color}44`, background: `${color}14` }}
          >
            {sign}{letter}
          </span>
        )
      })}
      <span
        title={`Return orientation · pitch ${RETURN_PITCH}`}
        className="rounded border px-1 py-0.5 font-mono text-[7px] leading-none"
        style={{ color: 'var(--accent)', borderColor: 'rgba(53,167,230,0.3)', background: 'rgba(53,167,230,0.08)' }}
      >
        RET
      </span>
    </div>
  )
}

// --- Fallback section for every param not explicitly placed -----------------

function AdvancedSection({ title, parameters }: { title: string; parameters: UserInterfaceParameter[] }) {
  const [open, setOpen] = useState(false)
  if (parameters.length === 0) return null
  return (
    <div className="border-t border-[var(--border)]">
      <button
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-2.5 py-2 text-[8px] font-semibold tracking-[0.14em] text-[var(--text-muted)] transition-colors hover:text-[var(--text-3)]"
      >
        <span>{title} · {parameters.length}</span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-2.5 pb-1">
          <ParameterList parameters={parameters} />
        </div>
      )}
    </div>
  )
}

// --- Hero: continuously spinning gyroscope ----------------------------------

const CUBE_VERTICES: [number, number, number][] = []
for (let i = 0; i < 8; i++) CUBE_VERTICES.push([(i & 1) * 2 - 1, ((i >> 1) & 1) * 2 - 1, ((i >> 2) & 1) * 2 - 1])
const CUBE_EDGES: [number, number][] = []
for (let a = 0; a < 8; a++) for (const bit of [1, 2, 4]) { const b = a | bit; if (b > a) CUBE_EDGES.push([a, b]) }

/** Object rotation (X→Y→Z) then a fixed 3/4 camera tilt; returns view-space xyz. */
function project(v: [number, number, number], rx: number, ry: number, rz: number): [number, number, number] {
  let [x, y, z] = v
  let c = Math.cos(rx); let s = Math.sin(rx); [y, z] = [y * c - z * s, y * s + z * c]
  c = Math.cos(ry); s = Math.sin(ry); [x, z] = [x * c + z * s, -x * s + z * c]
  c = Math.cos(rz); s = Math.sin(rz); [x, y] = [x * c - y * s, x * s + y * c]
  const cy = Math.cos(-0.55); const sy = Math.sin(-0.55); [x, z] = [x * cy + z * sy, -x * sy + z * cy]
  const cx = Math.cos(0.4); const sx = Math.sin(0.4); [y, z] = [y * cx - z * sx, y * sx + z * cx]
  return [x, y, z]
}

/** Point on the unit circle perpendicular to `axis`, at parameter angle phi. */
function ringPoint(axis: 0 | 1 | 2, phi: number): [number, number, number] {
  const c = Math.cos(phi)
  const s = Math.sin(phi)
  if (axis === 0) return [0, c, s]
  if (axis === 1) return [c, 0, s]
  return [c, s, 0]
}

const SIM_BEATS_PER_SECOND = 0.75 // slow preview clock so fast spins stay readable
const SPIN_BEATS = 7 // simulated held note length before a RETURN sweep
const MAX_TOTAL_DEG_PER_BEAT = 720

function ConstantRotateHero({
  speeds,
  mult,
  returnBeats,
}: {
  speeds: [number, number, number]
  mult: number
  returnBeats: number
}) {
  const live = useLiveRef({ speeds, mult, returnBeats })
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const sim = { mode: 'spin' as 'spin' | 'return', modeStart: 0, snap: [0, 0, 0] as [number, number, number] }
    let beat = 0
    let last = performance.now()
    let raf = 0

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      beat += dt * SIM_BEATS_PER_SECOND

      const { speeds, mult, returnBeats } = live.current
      const total = (Math.abs(speeds[0]) + Math.abs(speeds[1]) + Math.abs(speeds[2])) * Math.abs(mult)
      const damp = total > MAX_TOTAL_DEG_PER_BEAT ? MAX_TOTAL_DEG_PER_BEAT / total : 1
      const rates = speeds.map((speed) => speed * mult * damp) as [number, number, number]
      const spinning = total > 0.001

      const beatInMode = beat - sim.modeStart
      let angles: [number, number, number] = [0, 0, 0]
      if (sim.mode === 'spin') {
        angles = rates.map((rate) => rate * beatInMode) as [number, number, number]
        if (spinning && beatInMode >= SPIN_BEATS) {
          sim.snap = angles.map((angle) => {
            const wrapped = ((angle % 360) + 360) % 360
            return wrapped > 180 ? wrapped - 360 : wrapped
          }) as [number, number, number]
          sim.mode = 'return'
          sim.modeStart = beat
        }
      } else {
        const progress = clamp(beatInMode / Math.max(returnBeats, 0.0001), 0, 1)
        angles = sim.snap.map((angle) => angle * (1 - progress)) as [number, number, number]
        if (progress >= 1) {
          sim.mode = 'spin'
          sim.modeStart = beat
        }
      }

      // -- paint --
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (w === 0 || h === 0) return
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const cx = w / 2
      const cy = h / 2 + 2
      const scale = Math.min(h * 0.24, 40)

      // guide rings: one per active axis, dot moving at that axis' own rate
      for (const axis of [0, 1, 2] as const) {
        if (Math.abs(rates[axis]) < 0.5) continue
        const { color } = AXES[axis]
        ctx.strokeStyle = `${color}42`
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let i = 0; i <= 48; i++) {
          const p = project(ringPoint(axis, (i / 48) * Math.PI * 2), 0, 0, 0)
          const px = cx + p[0] * scale * 1.62
          const py = cy - p[1] * scale * 1.62
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.stroke()
        const dot = project(ringPoint(axis, angles[axis] * DEG), 0, 0, 0)
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(cx + dot[0] * scale * 1.62, cy - dot[1] * scale * 1.62, 2.2, 0, Math.PI * 2)
        ctx.fill()
      }

      // cube wireframe, depth-shaded
      const rotated = CUBE_VERTICES.map((v) => project(v, angles[0] * DEG, angles[1] * DEG, angles[2] * DEG))
      for (const [a, b] of CUBE_EDGES) {
        const va = rotated[a]
        const vb = rotated[b]
        const depth = (va[2] + vb[2]) / 2
        const alpha = 0.28 + clamp((depth + 1.75) / 3.5, 0, 1) * 0.62
        const pa = 3.4 / (3.4 - va[2] * 0.35)
        const pb = 3.4 / (3.4 - vb[2] * 0.35)
        ctx.strokeStyle = `rgba(198, 199, 205, ${alpha.toFixed(3)})`
        ctx.lineWidth = depth > 0 ? 1.5 : 1
        ctx.beginPath()
        ctx.moveTo(cx + va[0] * scale * pa, cy - va[1] * scale * pa)
        ctx.lineTo(cx + vb[0] * scale * pb, cy - vb[1] * scale * pb)
        ctx.stroke()
      }

      // readouts
      ctx.font = '8px ui-monospace, SFMono-Regular, monospace'
      ctx.textAlign = 'left'
      if (!spinning) {
        ctx.fillStyle = 'rgba(255,255,255,0.32)'
        ctx.fillText('ALL SPEEDS ZERO — NO MOTION', 8, 12)
      } else if (sim.mode === 'return') {
        ctx.fillStyle = 'rgba(53,167,230,0.9)'
        ctx.fillText(`RETURN · ${Math.max(returnBeats, 0.05).toFixed(2)} BEATS`, 8, 12)
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.32)'
        ctx.fillText(`${Math.round(total * damp)}°/BEAT TOTAL`, 8, 12)
      }
      if (damp < 1) {
        ctx.textAlign = 'right'
        ctx.fillStyle = 'rgba(255,255,255,0.24)'
        ctx.fillText('PREVIEW DAMPED', w - 8, 12)
      }
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [live])

  return (
    <div
      data-testid="constant-rotate-live-preview"
      className="relative h-[148px] overflow-hidden border-y border-[var(--border)]"
      style={{ background: 'radial-gradient(circle at 50% 42%, rgba(53,167,230,0.10), rgba(9,10,14,0.97) 68%), linear-gradient(150deg, #10131a, #090a0e)' }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.07) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          maskImage: 'linear-gradient(to bottom, transparent, black 40%, black)',
        }}
      />
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  )
}

// --- Panel ------------------------------------------------------------------

const PLACED_KEYS = new Set(['speedX', 'speedY', 'speedZ', 'speed', 'returnBeats'])

export const ConstantRotateMoverUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const speedX = parameter(parameters, 'speedX')
  const speedY = parameter(parameters, 'speedY')
  const speedZ = parameter(parameters, 'speedZ')
  const speed = parameter(parameters, 'speed')
  const returnBeats = parameter(parameters, 'returnBeats')

  if (!speedX || !speedY || !speedZ || !speed || !returnBeats) {
    return <ParameterList parameters={parameters} />
  }

  const leftover = parameters.filter((bound) => !PLACED_KEYS.has(bound.definition.key))
  const resetAll = () => { for (const bound of parameters) bound.setValue(bound.definition.default) }

  return (
    <section
      data-testid="constant-rotate-user-interface"
      className="-mx-1 overflow-hidden rounded-xl border border-[var(--border)] bg-[#0d0f14] text-[var(--text-2)] shadow-[0_16px_38px_rgba(0,0,0,.32)]"
    >
      <header className="flex h-10 items-center justify-between px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border"
            style={{ borderColor: 'rgba(53,167,230,0.28)', background: 'rgba(53,167,230,0.09)', color: 'var(--accent)' }}
          >
            <RefreshCcw size={13} strokeWidth={1.8} />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[10px] font-bold uppercase tracking-[0.13em]">Constant Rotate</div>
            <div className="truncate text-[7px] tracking-[0.14em] text-[var(--text-muted)]">SPINS IN PLACE · WHILE NOTES HOLD</div>
          </div>
        </div>
        <button
          aria-label="Reset all Constant Rotate parameters"
          title="Reset all"
          onClick={resetAll}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] bg-white/[0.02] text-[var(--text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--text-3)]"
        >
          <RotateCcw size={12} />
        </button>
      </header>

      <ConstantRotateHero
        speeds={[numericValue(speedX, 90), numericValue(speedY, 90), numericValue(speedZ, 90)]}
        mult={numericValue(speed, 1)}
        returnBeats={numericValue(returnBeats, 1)}
      />

      <div className="space-y-2 p-2">
        <div className="rounded-lg border border-[var(--border)] bg-white/[0.02] px-1.5 py-0.5">
          <div className="pt-1 text-center text-[7px] font-semibold tracking-[0.14em] text-[var(--text-muted)]">SPEED PER AXIS (°/BEAT)</div>
          <div className="grid grid-cols-3 gap-1">
            <DialKnob bound={speedX} label="X" color={AXES[0].color} centerLetter="X" digits={0} unit="°" />
            <DialKnob bound={speedY} label="Y" color={AXES[1].color} centerLetter="Y" digits={0} unit="°" />
            <DialKnob bound={speedZ} label="Z" color={AXES[2].color} centerLetter="Z" digits={0} unit="°" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-lg border border-[var(--border)] bg-white/[0.02] px-1.5 py-0.5">
          <DialKnob bound={speed} label="SPEED" unit="×" size={52} />
          <DialKnob bound={returnBeats} label="RETURN" unit="b" size={52} />
        </div>
      </div>

      <MidiLegend />
      <AdvancedSection title="ROTATION BASIS" parameters={leftover} />
    </section>
  )
}
