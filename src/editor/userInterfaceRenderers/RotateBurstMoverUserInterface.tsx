'use client'

// Bespoke settings surface for the Rotate Burst mover: a live wireframe cube
// that receives simulated per-note kicks along the ACTUAL easing/sharpness/
// angle params, an ease-curve strip with a synced playhead, per-axis angle
// arc dials (0-720 = two turns), and console-styled knobs. Basis params fall
// through to the generic ParameterList in a collapsible section.

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ChevronDown, RotateCcw, RotateCw } from 'lucide-react'
import { ROTATION_EASINGS } from '../core/visualCopies/rotationMovers'
import { SIGNED_BASIS_ROWS } from '../core/visualCopies/motionBasis'
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

/** Keep latest values visible to the persistent rAF loop without re-subscribing. */
function useLiveRef<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}

// --- SVG arc helpers (angles clockwise from 12 o'clock) ---------------------

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

// --- Console-styled drag knob ----------------------------------------------

function DialKnob({
  bound,
  label,
  unit = '',
  color = 'var(--accent)',
  digits = 2,
}: {
  bound: UserInterfaceParameter
  label: string
  unit?: string
  color?: string
  digits?: number
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

  const size = 46
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

// --- Per-axis angle arc (0..720 drawn as two nested turns) ------------------

function AngleArc({ bound, axis }: { bound: UserInterfaceParameter; axis: 0 | 1 | 2 }) {
  const definition = bound.definition
  const dragRef = useRef<{ y: number; value: number } | null>(null)
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null

  const value = bound.value
  const range = definition.max - definition.min
  const { letter, color } = AXES[axis]
  const turnOne = Math.min(value, 360)
  const turnTwo = Math.max(0, value - 360)

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
    commit(dragRef.current.value + ((dragRef.current.y - event.clientY) / 140) * range)
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

  const size = 48
  const c = size / 2

  return (
    <div className="flex min-w-0 flex-col items-center py-1">
      <div
        role="slider"
        tabIndex={0}
        aria-label={definition.label}
        aria-valuemin={definition.min}
        aria-valuemax={definition.max}
        aria-valuenow={value}
        title={`${definition.label} — drag vertically · double-click to reset`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => bound.setValue(definition.default)}
        onKeyDown={onKeyDown}
        className="cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <svg width={size} height={size} aria-hidden="true">
          <circle cx={c} cy={c} r={c - 3} fill="none" stroke="var(--border)" strokeWidth="2" />
          {turnOne > 0.5 && (
            <path d={arcPath(c, c, c - 3, 0, turnOne)} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
          )}
          {turnTwo > 0.5 && (
            <path d={arcPath(c, c, c - 8, 0, turnTwo)} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.55" />
          )}
          <line
            x1={polar(c, c, c - 12, value % 360)[0]}
            y1={polar(c, c, c - 12, value % 360)[1]}
            x2={polar(c, c, c - 3, value % 360)[0]}
            y2={polar(c, c, c - 3, value % 360)[1]}
            stroke="var(--text-2)"
            strokeWidth="1.5"
          />
          <text x={c} y={c + 3.5} textAnchor="middle" fontSize="10" fontWeight="700" fill={color}>{letter}</text>
        </svg>
      </div>
      <span className="mt-0.5 font-mono text-[8px] tabular-nums text-[var(--text-3)]">{Math.round(value)}°</span>
    </div>
  )
}

// --- Easing picker with real curve thumbnails -------------------------------

function EasingPicker({ bound }: { bound: UserInterfaceParameter }) {
  const definition = bound.definition
  if (definition.type !== 'select' || typeof bound.value !== 'number') return null

  return (
    <div
      className="grid gap-1 px-2 pt-2"
      style={{ gridTemplateColumns: `repeat(${Math.min(definition.options.length, 6)}, minmax(0, 1fr))` }}
      role="radiogroup"
      aria-label={definition.label}
    >
      {definition.options.map((option) => {
        const ease = ROTATION_EASINGS[option.value]?.ease ?? ((t: number) => t)
        const active = bound.value === option.value
        let d = ''
        for (let i = 0; i <= 20; i++) {
          const t = i / 20
          d += `${i === 0 ? 'M' : 'L'}${(t * 20).toFixed(1)},${(11 - ease(t) * 9).toFixed(1)} `
        }
        return (
          <button
            key={option.value}
            role="radio"
            aria-checked={active}
            aria-label={`${option.label} easing`}
            onClick={() => bound.setValue(option.value)}
            className={`flex min-w-0 flex-col items-center gap-0.5 rounded-md border py-1 transition-colors ${active
              ? 'border-[var(--accent-muted)] bg-[rgba(53,167,230,0.10)] text-[var(--accent)]'
              : 'border-[var(--border)] bg-white/[0.02] text-[var(--text-muted)] hover:bg-white/[0.05] hover:text-[var(--text-3)]'}`}
          >
            <svg viewBox="-1 -4 22 18" className="h-3 w-6" aria-hidden="true">
              <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="max-w-full truncate text-[6px] font-semibold tracking-[0.06em]">{option.label.toUpperCase()}</span>
          </button>
        )
      })}
    </div>
  )
}

// --- MIDI grammar legend ----------------------------------------------------

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

// --- Hero: wireframe cube kicked per simulated note + ease curve strip ------

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

const SIM_BEATS_PER_SECOND = 2 // preview clock: 120 BPM

function BurstHero({
  burstBeats,
  sharpness,
  easeIndex,
  angles,
  mult,
}: {
  burstBeats: number
  sharpness: number
  easeIndex: number
  angles: [number, number, number]
  mult: number
}) {
  const live = useLiveRef({ burstBeats, sharpness, easeIndex, angles, mult })
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const sim = { base: [0, 0, 0] as [number, number, number], axis: 0, sign: 1, noteStart: 0, count: 0 }
    let beat = 0
    let last = performance.now()
    let raf = 0

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      beat += dt * SIM_BEATS_PER_SECOND

      const { burstBeats, sharpness, easeIndex, angles, mult } = live.current
      const ease = (ROTATION_EASINGS[easeIndex] ?? ROTATION_EASINGS[0]).ease
      const beats = clamp(burstBeats, 0.05, 16)
      const period = beats + 1
      const activeAxes = ([0, 1, 2] as const).filter((axis) => Math.abs(angles[axis] * mult) > 0.001)

      let progress = 0
      const current: [number, number, number] = [...sim.base]
      if (activeAxes.length > 0) {
        if (!activeAxes.includes(sim.axis as 0 | 1 | 2) || beat - sim.noteStart >= period) {
          if (activeAxes.includes(sim.axis as 0 | 1 | 2)) {
            sim.base[sim.axis] = (((sim.base[sim.axis] + sim.sign * angles[sim.axis] * mult) % 360) + 360) % 360
          }
          sim.count += 1
          const index = activeAxes.indexOf(sim.axis as 0 | 1 | 2)
          sim.axis = activeAxes[(index + 1 + activeAxes.length) % activeAxes.length] ?? activeAxes[0]
          sim.sign = Math.floor(sim.count / activeAxes.length) % 2 === 0 ? 1 : -1
          sim.noteStart = beat
        }
        progress = clamp((beat - sim.noteStart) / beats, 0, 1)
        const eased = ease(Math.pow(progress, 1 / Math.max(sharpness, 0.0001)))
        current[sim.axis] += sim.sign * angles[sim.axis] * mult * eased
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

      const stripH = 38
      const cx = w / 2
      const cy = (h - stripH) / 2 + 2
      const scale = Math.min((h - stripH) * 0.26, 44)
      const axisColor = AXES[sim.axis as 0 | 1 | 2].color

      // rotation-axis guide line (world axis, camera tilt only)
      if (activeAxes.length > 0) {
        const dir: [number, number, number] = [0, 0, 0]
        dir[sim.axis] = 1
        const p = project(dir, 0, 0, 0)
        ctx.strokeStyle = `${axisColor}66`
        ctx.lineWidth = 1
        ctx.setLineDash([3, 4])
        ctx.beginPath()
        ctx.moveTo(cx - p[0] * scale * 1.8, cy + p[1] * scale * 1.8)
        ctx.lineTo(cx + p[0] * scale * 1.8, cy - p[1] * scale * 1.8)
        ctx.stroke()
        ctx.setLineDash([])
      }

      // cube wireframe, depth-shaded
      const rotated = CUBE_VERTICES.map((v) => project(v, current[0] * DEG, current[1] * DEG, current[2] * DEG))
      for (const [a, b] of CUBE_EDGES) {
        const va = rotated[a]
        const vb = rotated[b]
        const depth = (va[2] + vb[2]) / 2 // -1.7..1.7, camera looks down -z-ish
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

      // kick flash on the cube at note onset
      if (activeAxes.length > 0 && progress < 1) {
        ctx.strokeStyle = `${axisColor}${Math.round((1 - progress) * 120).toString(16).padStart(2, '0')}`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(cx, cy, scale * (1.35 + progress * 0.5), 0, Math.PI * 2)
        ctx.stroke()
      }

      // readout
      ctx.font = '8px ui-monospace, SFMono-Regular, monospace'
      ctx.fillStyle = 'rgba(255,255,255,0.32)'
      ctx.textAlign = 'left'
      if (activeAxes.length > 0) {
        const kick = Math.abs(angles[sim.axis] * mult)
        ctx.fillText(`KICK ${sim.sign > 0 ? '+' : '−'}${Math.round(kick)}° ${AXES[sim.axis as 0 | 1 | 2].letter}`, 8, 12)
      } else {
        ctx.fillText('ALL ANGLES ZERO — NO MOTION', 8, 12)
      }
      ctx.textAlign = 'right'
      ctx.fillText(`${beats.toFixed(2)} BEATS`, w - 8, 12)

      // ease-curve strip with synced playhead
      const padX = 10
      const y0 = h - 6
      const y1 = h - stripH + 8
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(padX, y0); ctx.lineTo(w - padX, y0); ctx.stroke()
      ctx.setLineDash([2, 3])
      ctx.beginPath(); ctx.moveTo(padX, y0 - (y0 - y1) * 0.78); ctx.lineTo(w - padX, y0 - (y0 - y1) * 0.78); ctx.stroke()
      ctx.setLineDash([])

      const curveY = (t: number) => {
        const value = ease(Math.pow(t, 1 / Math.max(sharpness, 0.0001)))
        return y0 - value * (y0 - y1) * 0.78
      }
      ctx.strokeStyle = 'rgba(53,167,230,0.85)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (let i = 0; i <= 72; i++) {
        const t = i / 72
        const px = padX + t * (w - padX * 2)
        if (i === 0) ctx.moveTo(px, curveY(t))
        else ctx.lineTo(px, curveY(t))
      }
      ctx.stroke()

      if (activeAxes.length > 0) {
        const px = padX + progress * (w - padX * 2)
        ctx.fillStyle = axisColor
        ctx.beginPath()
        ctx.arc(px, curveY(progress), 3, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [live])

  return (
    <div
      data-testid="rotate-burst-live-preview"
      className="relative h-[164px] overflow-hidden border-y border-[var(--border)]"
      style={{ background: 'radial-gradient(circle at 50% 36%, rgba(53,167,230,0.10), rgba(9,10,14,0.97) 68%), linear-gradient(150deg, #10131a, #090a0e)' }}
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

const PLACED_KEYS = new Set(['burstBeats', 'easing', 'sharpness', 'angleX', 'angleY', 'angleZ', 'angle'])

export const RotateBurstMoverUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const burstBeats = parameter(parameters, 'burstBeats')
  const easing = parameter(parameters, 'easing')
  const sharpness = parameter(parameters, 'sharpness')
  const angleX = parameter(parameters, 'angleX')
  const angleY = parameter(parameters, 'angleY')
  const angleZ = parameter(parameters, 'angleZ')
  const angle = parameter(parameters, 'angle')

  if (!burstBeats || !easing || !sharpness || !angleX || !angleY || !angleZ || !angle) {
    return <ParameterList parameters={parameters} />
  }

  const leftover = parameters.filter((bound) => !PLACED_KEYS.has(bound.definition.key))
  const resetAll = () => { for (const bound of parameters) bound.setValue(bound.definition.default) }

  return (
    <section
      data-testid="rotate-burst-user-interface"
      className="-mx-1 overflow-hidden rounded-xl border border-[var(--border)] bg-[#0d0f14] text-[var(--text-2)] shadow-[0_16px_38px_rgba(0,0,0,.32)]"
    >
      <header className="flex h-10 items-center justify-between px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border"
            style={{ borderColor: 'rgba(53,167,230,0.28)', background: 'rgba(53,167,230,0.09)', color: 'var(--accent)' }}
          >
            <RotateCw size={13} strokeWidth={1.8} />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[10px] font-bold uppercase tracking-[0.13em]">Rotate Burst</div>
            <div className="truncate text-[7px] tracking-[0.14em] text-[var(--text-muted)]">SPINS IN PLACE · ONE EASED KICK PER NOTE</div>
          </div>
        </div>
        <button
          aria-label="Reset all Rotate Burst parameters"
          title="Reset all"
          onClick={resetAll}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] bg-white/[0.02] text-[var(--text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--text-3)]"
        >
          <RotateCcw size={12} />
        </button>
      </header>

      <BurstHero
        burstBeats={numericValue(burstBeats, 1)}
        sharpness={numericValue(sharpness, 1)}
        easeIndex={numericValue(easing, 0)}
        angles={[numericValue(angleX, 90), numericValue(angleY, 90), numericValue(angleZ, 90)]}
        mult={numericValue(angle, 1)}
      />

      <EasingPicker bound={easing} />

      <div className="space-y-2 p-2">
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-[var(--border)] bg-white/[0.02] px-1.5 py-0.5">
          <DialKnob bound={burstBeats} label="BURST" unit="b" />
          <DialKnob bound={sharpness} label="SHARP" unit="×" />
          <DialKnob bound={angle} label="MULT" unit="×" />
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-white/[0.02] px-1.5 py-0.5">
          <div className="pt-1 text-center text-[7px] font-semibold tracking-[0.14em] text-[var(--text-muted)]">KICK ANGLE PER AXIS</div>
          <div className="grid grid-cols-3 gap-1">
            <AngleArc bound={angleX} axis={0} />
            <AngleArc bound={angleY} axis={1} />
            <AngleArc bound={angleZ} axis={2} />
          </div>
        </div>
      </div>

      <MidiLegend />
      <AdvancedSection title="ROTATION BASIS" parameters={leftover} />
    </section>
  )
}
