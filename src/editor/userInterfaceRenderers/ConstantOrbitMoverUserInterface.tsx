'use client'

// Bespoke settings surface for the Constant Orbit mover: a live 3D orbit
// stage — the object circles the pivot along the true composed X→Y→Z
// rotation at the ACTUAL per-axis speeds, tracing a fading Lissajous-like
// trail around per-axis orbit rings, with a periodic simulated RETURN sweep
// timed by returnBeats. Pivot placement is direct-manipulation (XY pad + Z
// dial); speeds are tachometer dials. Basis params fall through to the
// generic ParameterList in a collapsible section.

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ChevronDown, RotateCcw, Satellite } from 'lucide-react'
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

// --- Pivot XY pad -----------------------------------------------------------

function PivotPad({ x, y }: { x: UserInterfaceParameter; y: UserInterfaceParameter }) {
  const padRef = useRef<HTMLDivElement>(null)
  const xDefinition = x.definition
  const yDefinition = y.definition
  if (!isNumberParam(xDefinition) || !isNumberParam(yDefinition)) return null
  if (typeof x.value !== 'number' || typeof y.value !== 'number') return null

  const xPercent = ((x.value - xDefinition.min) / (xDefinition.max - xDefinition.min)) * 100
  const yPercent = 100 - ((y.value - yDefinition.min) / (yDefinition.max - yDefinition.min)) * 100

  const setFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = padRef.current?.getBoundingClientRect()
    if (!rect) return
    const nx = clamp((event.clientX - rect.left) / rect.width, 0, 1)
    const ny = clamp((event.clientY - rect.top) / rect.height, 0, 1)
    const snap = (raw: number, min: number, max: number, step: number) =>
      clamp(min + Math.round((raw - min) / step) * step, min, max)
    x.setValue(snap(xDefinition.min + nx * (xDefinition.max - xDefinition.min), xDefinition.min, xDefinition.max, xDefinition.step))
    y.setValue(snap(yDefinition.max - ny * (yDefinition.max - yDefinition.min), yDefinition.min, yDefinition.max, yDefinition.step))
  }

  return (
    <div
      ref={padRef}
      role="group"
      aria-label="Orbit pivot X and Y"
      title="Drag to move the pivot · double-click to reset"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        setFromPointer(event)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromPointer(event)
      }}
      onDoubleClick={() => { x.setValue(xDefinition.default); y.setValue(yDefinition.default) }}
      className="relative h-[84px] cursor-crosshair touch-none overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg-app)] shadow-[inset_0_0_18px_rgba(0,0,0,.5)]"
      style={{
        backgroundImage: 'linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px)',
        backgroundSize: '20% 25%',
      }}
    >
      <span className="absolute left-1/2 top-0 h-full w-px bg-white/10" />
      <span className="absolute left-0 top-1/2 h-px w-full bg-white/10" />
      <span
        className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--text-2)] bg-[var(--accent-muted)] shadow-[0_0_10px_rgba(53,167,230,.55)]"
        style={{ left: `${xPercent}%`, top: `${yPercent}%` }}
      />
      <span className="absolute bottom-1 left-1.5 font-mono text-[7px] text-white/30">PX {x.value.toFixed(1)}</span>
      <span className="absolute right-1.5 top-1 font-mono text-[7px] text-white/30">PY {y.value.toFixed(1)}</span>
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

// --- Hero: continuous 3D orbit around the pivot -----------------------------

/** Fixed 3/4 camera tilt only; returns view-space xyz. */
function camera(v: [number, number, number]): [number, number, number] {
  let [x, y, z] = v
  const cy = Math.cos(-0.55); const sy = Math.sin(-0.55); [x, z] = [x * cy + z * sy, -x * sy + z * cy]
  const cx = Math.cos(0.4); const sx = Math.sin(0.4); [y, z] = [y * cx - z * sx, y * sx + z * cx]
  return [x, y, z]
}

function rotateAboutAxis(axis: 0 | 1 | 2, phi: number, v: [number, number, number]): [number, number, number] {
  const c = Math.cos(phi)
  const s = Math.sin(phi)
  const [x, y, z] = v
  if (axis === 0) return [x, y * c - z * s, y * s + z * c]
  if (axis === 1) return [x * c + z * s, y, -x * s + z * c]
  return [x * c - y * s, x * s + y * c, z]
}

/** The engine's composition order: rotate about X, then Y, then Z. */
function composedRotation(angles: [number, number, number], v: [number, number, number]) {
  return rotateAboutAxis(2, angles[2], rotateAboutAxis(1, angles[1], rotateAboutAxis(0, angles[0], v)))
}

const SIM_BEATS_PER_SECOND = 0.75 // slow preview clock so fast orbits stay readable
const SPIN_BEATS = 7 // simulated held note length before a RETURN sweep
const MAX_TOTAL_DEG_PER_BEAT = 720

function ConstantOrbitHero({
  speeds,
  mult,
  returnBeats,
  pivot,
}: {
  speeds: [number, number, number]
  mult: number
  returnBeats: number
  pivot: [number, number, number] // param space, -20..20 each
}) {
  const live = useLiveRef({ speeds, mult, returnBeats, pivot })
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const sim = {
      mode: 'spin' as 'spin' | 'return',
      modeStart: 0,
      snap: [0, 0, 0] as [number, number, number],
      trail: [] as { x: number; y: number }[],
    }
    let beat = 0
    let last = performance.now()
    let raf = 0

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      beat += dt * SIM_BEATS_PER_SECOND

      const { speeds, mult, returnBeats, pivot } = live.current
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
      const anglesRad = angles.map((angle) => angle * DEG) as [number, number, number]

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
      const scale = Math.min(h * 0.22, 36)
      const toScreen = (v: [number, number, number]): [number, number] => {
        const p = camera(v)
        const persp = 3.6 / (3.6 - p[2] * 0.3)
        return [cx + p[0] * scale * persp, cy - p[1] * scale * persp]
      }

      // world: object home at the origin, pivot mapped into ~±1.5 units
      const pivot3: [number, number, number] = [pivot[0] / 20 * 1.5, pivot[1] / 20 * 1.5, pivot[2] / 20 * 1.5]
      const rel: [number, number, number] = [-pivot3[0], -pivot3[1], -pivot3[2]]
      const radius = Math.hypot(rel[0], rel[1], rel[2])
      const [pivotSX, pivotSY] = toScreen(pivot3)

      // per-axis orbit rings through the object's home position
      if (radius > 0.03) {
        for (const axis of [0, 1, 2] as const) {
          if (Math.abs(rates[axis]) < 0.5) continue
          ctx.strokeStyle = `${AXES[axis].color}38`
          ctx.lineWidth = 1
          ctx.beginPath()
          for (let i = 0; i <= 56; i++) {
            const q = rotateAboutAxis(axis, (i / 56) * Math.PI * 2, rel)
            const [px, py] = toScreen([pivot3[0] + q[0], pivot3[1] + q[1], pivot3[2] + q[2]])
            if (i === 0) ctx.moveTo(px, py)
            else ctx.lineTo(px, py)
          }
          ctx.stroke()
        }
      }

      // pivot crosshair
      ctx.strokeStyle = 'rgba(53,167,230,0.85)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(pivotSX - 5, pivotSY); ctx.lineTo(pivotSX + 5, pivotSY)
      ctx.moveTo(pivotSX, pivotSY - 5); ctx.lineTo(pivotSX, pivotSY + 5)
      ctx.stroke()
      ctx.fillStyle = 'rgba(53,167,230,0.35)'
      ctx.beginPath(); ctx.arc(pivotSX, pivotSY, 2, 0, Math.PI * 2); ctx.fill()

      // object position: home rotated about the pivot by the composed rotation
      const rotated = composedRotation(anglesRad, rel)
      const world: [number, number, number] = [pivot3[0] + rotated[0], pivot3[1] + rotated[1], pivot3[2] + rotated[2]]
      const [objSX, objSY] = toScreen(world)

      // fading trail
      if (spinning && radius > 0.03) {
        sim.trail.push({ x: objSX, y: objSY })
        if (sim.trail.length > 64) sim.trail.shift()
      } else {
        sim.trail.length = 0
      }
      if (sim.trail.length > 1) {
        for (let i = 1; i < sim.trail.length; i++) {
          const alpha = (i / sim.trail.length) * 0.4
          ctx.strokeStyle = `rgba(53,167,230,${alpha.toFixed(3)})`
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(sim.trail[i - 1].x, sim.trail[i - 1].y)
          ctx.lineTo(sim.trail[i].x, sim.trail[i].y)
          ctx.stroke()
        }
      }

      // radius spoke
      if (radius > 0.03) {
        ctx.strokeStyle = 'rgba(255,255,255,0.14)'
        ctx.beginPath(); ctx.moveTo(pivotSX, pivotSY); ctx.lineTo(objSX, objSY); ctx.stroke()
      }

      // the object: a small square that also carries the rotation
      ctx.save()
      ctx.translate(objSX, objSY)
      ctx.rotate(anglesRad[2])
      ctx.strokeStyle = 'rgba(216,217,223,0.92)'
      ctx.lineWidth = 1.5
      ctx.strokeRect(-5, -5, 10, 10)
      ctx.fillStyle = 'rgba(53,167,230,0.16)'
      ctx.fillRect(-5, -5, 10, 10)
      ctx.restore()

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
      if (radius <= 0.03) {
        ctx.fillStyle = 'rgba(255,255,255,0.3)'
        ctx.textAlign = 'center'
        ctx.fillText('PIVOT AT ORIGIN — SET A PIVOT TO ORBIT', cx, cy + 30)
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
      data-testid="constant-orbit-live-preview"
      className="relative h-[156px] overflow-hidden border-y border-[var(--border)]"
      style={{ background: 'radial-gradient(circle at 50% 42%, rgba(53,167,230,0.10), rgba(9,10,14,0.97) 68%), linear-gradient(150deg, #0f131a, #090a0e)' }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage: 'repeating-radial-gradient(circle at 50% 50%, transparent 0, transparent 23px, rgba(255,255,255,.09) 24px)',
          maskImage: 'radial-gradient(circle at 50% 50%, black 55%, transparent 92%)',
        }}
      />
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  )
}

// --- Panel ------------------------------------------------------------------

const PLACED_KEYS = new Set(['speedX', 'speedY', 'speedZ', 'speed', 'returnBeats', 'pivotX', 'pivotY', 'pivotZ'])

export const ConstantOrbitMoverUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const speedX = parameter(parameters, 'speedX')
  const speedY = parameter(parameters, 'speedY')
  const speedZ = parameter(parameters, 'speedZ')
  const speed = parameter(parameters, 'speed')
  const returnBeats = parameter(parameters, 'returnBeats')
  const pivotX = parameter(parameters, 'pivotX')
  const pivotY = parameter(parameters, 'pivotY')
  const pivotZ = parameter(parameters, 'pivotZ')

  if (!speedX || !speedY || !speedZ || !speed || !returnBeats || !pivotX || !pivotY || !pivotZ) {
    return <ParameterList parameters={parameters} />
  }

  const leftover = parameters.filter((bound) => !PLACED_KEYS.has(bound.definition.key))
  const resetAll = () => { for (const bound of parameters) bound.setValue(bound.definition.default) }

  return (
    <section
      data-testid="constant-orbit-user-interface"
      className="-mx-1 overflow-hidden rounded-xl border border-[var(--border)] bg-[#0d0f14] text-[var(--text-2)] shadow-[0_16px_38px_rgba(0,0,0,.32)]"
    >
      <header className="flex h-10 items-center justify-between px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border"
            style={{ borderColor: 'rgba(53,167,230,0.28)', background: 'rgba(53,167,230,0.09)', color: 'var(--accent)' }}
          >
            <Satellite size={13} strokeWidth={1.8} />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[10px] font-bold uppercase tracking-[0.13em]">Constant Orbit</div>
            <div className="truncate text-[7px] tracking-[0.14em] text-[var(--text-muted)]">CIRCLES THE PIVOT · WHILE NOTES HOLD</div>
          </div>
        </div>
        <button
          aria-label="Reset all Constant Orbit parameters"
          title="Reset all"
          onClick={resetAll}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] bg-white/[0.02] text-[var(--text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--text-3)]"
        >
          <RotateCcw size={12} />
        </button>
      </header>

      <ConstantOrbitHero
        speeds={[numericValue(speedX, 90), numericValue(speedY, 90), numericValue(speedZ, 90)]}
        mult={numericValue(speed, 1)}
        returnBeats={numericValue(returnBeats, 1)}
        pivot={[numericValue(pivotX), numericValue(pivotY), numericValue(pivotZ)]}
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

        <div className="rounded-lg border border-[var(--border)] bg-white/[0.02] p-1.5">
          <div className="pb-1 text-center text-[7px] font-semibold tracking-[0.14em] text-[var(--text-muted)]">ORBIT PIVOT</div>
          <div className="grid grid-cols-[1fr_auto] items-center gap-1.5">
            <PivotPad x={pivotX} y={pivotY} />
            <DialKnob bound={pivotZ} label="PZ" digits={1} />
          </div>
        </div>
      </div>

      <MidiLegend />
      <AdvancedSection title="ROTATION BASIS" parameters={leftover} />
    </section>
  )
}
