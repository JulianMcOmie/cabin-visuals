'use client'

// Bespoke settings for a Word Formation lane, following
// docs/instrument-panel-design-guide.md. Grid's splitter panel is the nearest
// sibling and the reason for the preview's shape: the subject is a LAYOUT, so
// the window is a plain 2D canvas on its own rAF rather than an r3f <Canvas>
// (a panel Canvas stays black until the transport plays - see this directory's
// CLAUDE.md - and a layout is exactly what you dial in while paused).
//
// The window draws the lane's REAL seats, from the same `formationSeats` the
// instrument calls, numbered in fill order - so the fill-order control is made
// legible by looking rather than by reading its option names.
//
// The accent is the lane's own track color, which is also what its timeline
// blocks and its notes wear: the console and the notes you write in it are one
// color by construction. (Movers take theirs from the definition's
// identityColor; a formation lane has no definition, so the track is the
// source.)

import { useEffect, useMemo, useRef } from 'react'
import {
  FILL_CENTER,
  FILL_COLUMN,
  FILL_ROW,
  formationSeats,
  type FormationSlot,
} from '../core/visual/wordFormation'
import { isNumberParam, type NumberParamDef, type SelectParamDef } from '../instruments/types'
import { useProjectStore } from '../store/ProjectStore'
import { resolveTrackDisplayColor } from '../utils/trackDisplayColor'
import { withAlpha } from './colorWheel'
import { LaserKnob } from './laserKnob'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceParameter } from './types'

const PREVIEW_HEIGHT = 138
const ROOM = '#05070c'
/** Camera distance for the preview's perspective - the same value the app's own
 *  camera sits at, so depth reads the way it will on screen. */
const CAM_Z = 5

interface NumBinding { def: NumberParamDef; value: number; set: (v: number) => void }
interface SelectBinding { def: SelectParamDef; value: number; set: (v: number) => void }

function bind(parameters: readonly UserInterfaceParameter[]) {
  const pool = new Map(parameters.map((p) => [p.definition.key, p]))
  return {
    num(key: string): NumBinding | null {
      const b = pool.get(key)
      if (!b || !isNumberParam(b.definition) || typeof b.value !== 'number') return null
      pool.delete(key)
      return { def: b.definition, value: b.value, set: b.setValue }
    },
    select(key: string): SelectBinding | null {
      const b = pool.get(key)
      if (!b || b.definition.type !== 'select' || typeof b.value !== 'number') return null
      pool.delete(key)
      return { def: b.definition, value: b.value, set: b.setValue }
    },
    /** A boolean param is a 0/1 number on the wire, like everywhere else. */
    bool(key: string): NumBinding | null {
      const b = pool.get(key)
      if (!b || b.definition.type !== 'boolean' || typeof b.value !== 'number') return null
      pool.delete(key)
      return { def: b.definition as unknown as NumberParamDef, value: b.value, set: b.setValue }
    },
    rest(): UserInterfaceParameter[] { return [...pool.values()] },
  }
}

// ── the layout window ────────────────────────────────────────────────────────

/** Draw the seats, numbered in the order words land in them. Re-reads its own
 *  client size per frame instead of using a ResizeObserver (those starve in a
 *  hidden pane, and the panel is resizable). */
function FormationWindow({ seats, accent }: { seats: FormationSlot[]; accent: string }) {
  const hostRef = useRef<HTMLCanvasElement>(null)
  const seatsRef = useRef(seats)
  const accentRef = useRef(accent)
  seatsRef.current = seats
  accentRef.current = accent

  useEffect(() => {
    const canvas = hostRef.current
    if (!canvas) return
    let raf = 0
    let turn = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const dpr = window.devicePixelRatio || 1
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = ROOM
      ctx.fillRect(0, 0, w, h)

      const list = seatsRef.current
      if (list.length === 0) return
      // Turn slowly so depth reads: a flat grid and a ring of the same width are
      // the same picture from dead on.
      turn += 0.004
      const cos = Math.cos(turn)
      const sin = Math.sin(turn)
      // Frame by whichever axis is tighter, so a wide line and a tall column both fit.
      let reach = 0.001
      for (const s of list) reach = Math.max(reach, Math.abs(s.x), Math.abs(s.y))
      const unit = Math.min(w * 0.4, h * 0.4) / (reach + 0.6)

      const placed = list.map((s, i) => {
        const x = s.x * cos - s.z * sin
        const z = s.x * sin + s.z * cos
        const scale = CAM_Z / Math.max(0.9, CAM_Z - z)
        return { i, x: w / 2 + x * unit * scale, y: h / 2 - s.y * unit * scale, r: Math.max(6 * dpr, unit * 0.17) * scale, z }
      })
      // Painter order: far seats first, so the nearer ones read as in front.
      placed.sort((a, b) => a.z - b.z)
      for (const p of placed) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = withAlpha(accentRef.current, 0.16)
        ctx.fill()
        ctx.lineWidth = dpr
        ctx.strokeStyle = withAlpha(accentRef.current, 0.8)
        ctx.stroke()
        ctx.fillStyle = withAlpha(accentRef.current, 0.95)
        ctx.font = `${Math.max(8 * dpr, p.r * 0.95).toFixed(1)}px ui-monospace, Menlo, monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(p.i + 1), p.x, p.y)
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="-mx-3 -mt-3 border-b border-white/[0.06]" style={{ height: PREVIEW_HEIGHT, background: ROOM }}>
      <canvas ref={hostRef} className="block h-full w-full" />
    </div>
  )
}

// ── controls ────────────────────────────────────────────────────────────────

/** A dimension: its count knob with the line/ring choice beneath it. */
function DimensionKnob({ count, ring, accent }: { count: NumBinding; ring: NumBinding | null; accent: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <LaserKnob
        value={count.value}
        min={count.def.min}
        max={count.def.max}
        step={count.def.step}
        defaultValue={count.def.default}
        label={count.def.label}
        accent={accent}
        onChange={count.set}
      />
      {ring && (
        <button
          type="button"
          aria-pressed={ring.value >= 0.5}
          onClick={() => ring.set(ring.value >= 0.5 ? 0 : 1)}
          className="rounded-[3px] border px-[7px] py-[2px] text-[9px] uppercase tracking-[0.05em] transition-colors"
          style={ring.value >= 0.5
            ? { background: withAlpha(accent, 0.22), borderColor: withAlpha(accent, 0.45), color: '#fff' }
            : { background: 'rgba(0,0,0,0.30)', borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.4)' }}
        >
          {ring.value >= 0.5 ? 'Ring' : 'Line'}
        </button>
      )}
    </div>
  )
}

/** The guide's segmented control: the whole choice visible at once, one lit
 *  segment wearing the accent as light. */
function Segmented({ binding, accent, shapes }: { binding: SelectBinding; accent: string; shapes?: boolean }) {
  return (
    <div>
      <span className="mb-1.5 block text-[9.5px] uppercase tracking-[0.09em] text-white/40">{binding.def.label}</span>
      <div className="flex gap-[2px] rounded-[5px] border border-white/[0.08] bg-black/30 p-[2px]">
        {binding.def.options.map((opt) => {
          const on = Math.round(binding.value) === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={on}
              onClick={() => binding.set(opt.value)}
              className="flex flex-1 flex-col items-center gap-1 rounded-[3px] py-[5px] text-[10.5px] transition-colors"
              style={on ? { background: withAlpha(accent, 0.22), color: '#fff' } : { color: 'rgba(255,255,255,0.4)' }}
            >
              {shapes && <FillGlyph mode={opt.value} color={on ? accent : 'rgba(255,255,255,0.32)'} />}
              <span>{opt.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Fill order drawn as the path it takes - the guide's rule for options whose
 *  values have shapes: the segment IS the shape. */
function FillGlyph({ mode, color }: { mode: number; color: string }) {
  const dots = mode === FILL_ROW ? [[4, 5], [12, 5], [20, 5], [4, 13], [12, 13], [20, 13]]
    : mode === FILL_COLUMN ? [[6, 4], [6, 9], [6, 14], [18, 4], [18, 9], [18, 14]]
      : mode === FILL_CENTER ? [[12, 9], [12, 3], [18, 9], [12, 15], [6, 9]]
        : []
  const path = mode === FILL_ROW ? 'M4 5 H20 M4 13 H20'
    : mode === FILL_COLUMN ? 'M6 3 V15 M18 3 V15'
      : mode === FILL_CENTER ? 'M12 9 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0'
        : 'M12 9 q4 -6 -3 -5 q-7 1 -4 7 q3 6 9 3'
  return (
    <svg width="24" height="18" viewBox="0 0 24 18" aria-hidden="true">
      <path d={path} stroke={color} strokeWidth="1" fill="none" opacity="0.75" />
      {dots.map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.6" fill={color} />)}
    </svg>
  )
}

function Toggle({ binding, accent }: { binding: NumBinding; accent: string }) {
  const on = binding.value >= 0.5
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => binding.set(on ? 0 : 1)}
      className="flex flex-1 items-center gap-[7px] rounded-[5px] border bg-black/30 px-[9px] py-[7px] text-left text-[10.5px] transition-colors"
      style={on
        ? { borderColor: withAlpha(accent, 0.35), color: '#fff' }
        : { borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.4)' }}
    >
      <span
        className="h-[6px] w-[6px] flex-none rounded-full"
        style={on
          ? { background: accent, boxShadow: `0 0 6px 1px ${withAlpha(accent, 0.7)}` }
          : { background: 'rgba(255,255,255,0.16)' }}
      />
      {binding.def.label}
    </button>
  )
}

export function WordFormationUserInterface({ targetId, parameters }: { targetId: string; parameters: readonly UserInterfaceParameter[] }) {
  const trackColor = useProjectStore((s) => {
    const t = s.tracks[targetId]
    return t ? resolveTrackDisplayColor(t) : undefined
  })
  const accent = trackColor ?? '#e0a33c'

  // Resolve every binding INSIDE the memo. `bind` drains its pool as it hands
  // bindings out, so keeping the binder itself memoized and calling it during
  // render silently returns null for everything the second time a render runs
  // against the same `parameters` array - which this panel does on every store
  // change, because it subscribes for its accent. The symptom is the generic
  // ParameterList appearing in place of the console, as if registration failed.
  const bound = useMemo(() => {
    const b = bind(parameters)
    return {
      columns: b.num('columns'),
      columnsRing: b.bool('columnsRing'),
      rows: b.num('rows'),
      rowsRing: b.bool('rowsRing'),
      depth: b.num('depth'),
      depthRing: b.bool('depthRing'),
      spacing: b.num('spacing'),
      radius: b.num('radius'),
      tilt: b.num('tilt'),
      size: b.num('size'),
      cycle: b.select('cycle'),
      fill: b.select('fill'),
      carry: b.bool('carry'),
      fade: b.num('fade'),
      rest: b.rest(),
    }
  }, [parameters])
  const { columns, columnsRing, rows, rowsRing, depth, depthRing, spacing, radius, tilt, size, cycle, fill, carry, fade } = bound

  // Every ungated key must be present; a missing one means the binding drifted
  // from the schema, and a half-built console is worse than the generic list.
  const complete = columns && rows && depth && spacing && radius && tilt && size && cycle && fill

  const seats = useMemo(() => {
    if (!complete) return []
    return formationSeats({
      columns: columns.value,
      columnsRing: columnsRing?.value ?? 0,
      rows: rows.value,
      rowsRing: rowsRing?.value ?? 0,
      depth: depth.value,
      depthRing: depthRing?.value ?? 0,
      spacing: spacing.value,
      radius: radius.value,
      tilt: tilt.value,
      fill: fill.value,
    })
  }, [complete, columns, columnsRing, rows, rowsRing, depth, depthRing, spacing, radius, tilt, fill])

  if (!complete) return <ParameterList parameters={parameters} />

  return (
    <div className="-mx-3 -mt-3">
      <FormationWindow seats={seats} accent={accent} />
      {/* The one earned gradient: the window's light spilling onto the controls. */}
      <div
        className="h-[30px]"
        style={{ background: `radial-gradient(58% 30px at 50% 0, ${withAlpha(accent, 0.14)}, transparent)`, marginBottom: -22 }}
      />
      <div className="px-3 pb-4">
        <div className="mb-3 flex justify-between">
          <DimensionKnob count={columns} ring={columnsRing} accent={accent} />
          <DimensionKnob count={rows} ring={rowsRing} accent={accent} />
          <DimensionKnob count={depth} ring={depthRing} accent={accent} />
        </div>
        <div className="mb-4 flex justify-between">
          {[spacing, radius, tilt, size].map((k) => (
            <LaserKnob
              key={k.def.key}
              value={k.value}
              min={k.def.min}
              max={k.def.max}
              step={k.def.step}
              defaultValue={k.def.default}
              label={k.def.label}
              accent={accent}
              // Tilt rakes either way from flat, so its zero is the middle of
              // the travel and the arc has to grow out of 12 o'clock.
              bipolar={k.def.key === 'tilt'}
              onChange={k.set}
            />
          ))}
        </div>
        <div className="mb-3"><Segmented binding={cycle} accent={accent} /></div>
        <div className="mb-3"><Segmented binding={fill} accent={accent} shapes /></div>
        <div className="flex gap-1.5">
          {carry && <Toggle binding={carry} accent={accent} />}
          {fade && (
            <div className="flex-1">
              <LaserKnob
                value={fade.value}
                min={fade.def.min}
                max={fade.def.max}
                step={fade.def.step}
                defaultValue={fade.def.default}
                label={fade.def.label}
                accent={accent}
                onChange={fade.set}
              />
            </div>
          )}
        </div>
        {bound.rest.length > 0 && <div className="mt-3"><ParameterList parameters={bound.rest} /></div>}
      </div>
    </div>
  )
}

