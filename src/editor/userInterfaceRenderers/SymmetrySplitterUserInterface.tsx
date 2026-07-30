'use client'

// Bespoke settings for the Symmetry splitter. The hero is the fold diagram: the
// mirror lines drawn across the pad, the wedge between the first pair shaded as
// the fundamental domain, and one deliberately ASYMMETRIC glyph per copy drawn
// through that copy's own in-plane basis - so reflected copies visibly read as
// mirror images rather than as rotations, which is the whole point of the
// splitter. Dragging the pad sets both halves of the symmetry line at once:
// the drag angle is the tilt, the distance from the center is the spread.
// The mirror count is a stepper, the plane a row of oriented glyphs, and the
// mute map spells out the shared splitter MIDI grammar. Presentation only:
// every control routes through the passed parameter bindings, and the diagram
// reads its geometry from the definition's own layout helper.

import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  symmetryLayout,
  symmetryMirrorAngles,
  type SymmetrySettings,
} from '../core/visualCopies/symmetry'
import { isNumberParam, type NumberParamDef, type SelectParamDef } from '../instruments/types'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

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
    rest(): UserInterfaceParameter[] { return [...pool.values()] },
  }
}

// Mirrors the shared splitter MIDI grammar: one row per copy counting down from
// pitch 127, and a note on hides that copy.
const SPLITTER_TOP_PITCH = 127
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const noteName = (pitch: number) => `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`

/** How each plane draws: the depth planes foreshorten, and the axis letters name
 *  the horizontal/vertical axes from the definition's plane table. */
const PLANE_VIEWS = [
  { sx: 1, sy: 1, h: 'X', v: 'Y' }, // XY - faces the camera
  { sx: 1, sy: 0.38, h: 'X', v: 'Z' }, // XZ - the floor, seen flat
  { sx: 0.38, sy: 1, h: 'Z', v: 'Y' }, // YZ - the side wall, edge-on
]

const VB_W = 240
const VB_H = 170
const CX = VB_W / 2
const CY = VB_H / 2
const SPREAD_MAX_PX = 62
const LINE_PX = 82

/** A small flag - narrow tail, one arm off to the right. Asymmetric on purpose:
 *  it is the only way a reflection reads as a reflection at glyph size. */
const COPY_GLYPH = 'M-2.6 4.4 V-4.4 H4.4 L1.6 -1.6 L4.4 1.2 H-2.6 Z'

/** The hero: mirror lines, the shaded fundamental wedge, and the copies. Drag
 *  angle sets the tilt, drag distance sets the spread. */
function FoldPad({ settings, tilt, spread, planeLabel, hoveredSlot, onHoverSlot }: {
  settings: SymmetrySettings
  tilt: NumBinding
  spread: NumBinding
  planeLabel: string
  hoveredSlot: number | null
  onHoverSlot: (slot: number | null) => void
}) {
  const padRef = useRef<HTMLDivElement>(null)
  const view = PLANE_VIEWS[settings.plane] ?? PLANE_VIEWS[0]
  const perUnit = SPREAD_MAX_PX / spread.def.max

  /** Client point -> viewBox coords under xMidYMid meet (letterbox-aware). */
  const toViewBox = (clientX: number, clientY: number) => {
    const rect = padRef.current?.getBoundingClientRect()
    if (!rect) return null
    const scale = Math.min(rect.width / VB_W, rect.height / VB_H)
    return {
      u: (clientX - rect.left - (rect.width - VB_W * scale) / 2) / scale,
      v: (clientY - rect.top - (rect.height - VB_H * scale) / 2) / scale,
    }
  }

  const snap = (raw: number, def: NumberParamDef) =>
    clamp(Number((Math.round(raw / def.step) * def.step).toFixed(8)), def.min, def.max)

  const setFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = toViewBox(event.clientX, event.clientY)
    if (!point) return
    // Undo the plane's foreshortening so the drag reads in scene units.
    const dx = (point.u - CX) / view.sx
    const dy = (CY - point.v) / view.sy
    spread.set(snap(Math.hypot(dx, dy) / perUnit, spread.def))
    // The pointer picks the WEDGE the object sits in; the tilt is the mirror
    // line half a wedge back from it, so the copy lands under the cursor.
    if (Math.hypot(dx, dy) < 6) return
    const wedge = (Math.atan2(dx, dy) * 180) / Math.PI
    const halfWedge = 90 / clamp(Math.round(settings.mirrors), 1, 12)
    tilt.set(snap(((wedge - halfWedge) % 180 + 180) % 180, tilt.def))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
    event.preventDefault()
    const step = event.shiftKey ? 10 : 1
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1
    const target = horizontal ? tilt : spread
    const raw = target.value + direction * step * target.def.step
    // Tilt is an angle - it wraps rather than sticking at either end.
    target.set(horizontal
      ? Number((((raw - tilt.def.min) % 180 + 180) % 180 + tilt.def.min).toFixed(8))
      : clamp(Number(raw.toFixed(8)), target.def.min, target.def.max))
  }

  const project = (u: number, v: number) => ({
    x: CX + u * perUnit * view.sx,
    y: CY - v * perUnit * view.sy,
  })

  const slots = symmetryLayout(settings).map((slot, index) => {
    const { x, y } = project(slot.u, slot.v)
    // The slot's own in-plane basis, re-expressed in the SVG's y-down space, so
    // a reflected slot draws its glyph genuinely flipped.
    const [uu, uv, vu, vv] = slot.basis
    return { ...slot, index, x, y, matrix: `matrix(${uu} ${-uv} ${-vu} ${vv} ${x} ${y})` }
  })

  const mirrorAngles = symmetryMirrorAngles(settings)
  const hovered = hoveredSlot != null ? slots[hoveredSlot] : undefined
  const info = hovered
    ? `COPY ${hoveredSlot! + 1} · ${hovered.mirrored ? 'MIRRORED' : 'UPRIGHT'} · MUTE ${SPLITTER_TOP_PITCH - hoveredSlot!}`
    : `${slots.length} COPIES · ${mirrorAngles.length} ${mirrorAngles.length === 1 ? 'MIRROR' : 'MIRRORS'}`

  return (
    <div
      ref={padRef}
      data-testid="symmetry-fold-pad"
      role="slider"
      tabIndex={0}
      aria-label="Mirror line tilt and spread"
      aria-valuemin={tilt.def.min}
      aria-valuemax={tilt.def.max}
      aria-valuenow={tilt.value}
      aria-valuetext={`Tilt ${tilt.value}°, spread ${spread.value}`}
      title="Drag to swing the mirror line and set the spread · double-click to reset"
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setFromPointer(event)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromPointer(event)
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onDoubleClick={() => { tilt.set(tilt.def.default); spread.set(spread.def.default) }}
      onKeyDown={onKeyDown}
      className="relative w-full cursor-crosshair touch-none select-none border-y border-[var(--border)] bg-[var(--bg-canvas)] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
      style={{ aspectRatio: `${VB_W} / ${VB_H}` }}
    >
      <svg aria-hidden="true" viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-full w-full">
        {/* the reach of the spread drag, plus the plane's axis letters */}
        <ellipse cx={CX} cy={CY} rx={SPREAD_MAX_PX * view.sx} ry={SPREAD_MAX_PX * view.sy} className="fill-none stroke-[var(--border-subtle)]" strokeWidth="1" />
        <text x={CX + (SPREAD_MAX_PX + 8) * view.sx} y={CY + 2.5} className="fill-[var(--text-muted)] font-mono text-[7px]">{view.h}</text>
        <text x={CX} y={CY - (SPREAD_MAX_PX + 6) * view.sy} textAnchor="middle" className="fill-[var(--text-muted)] font-mono text-[7px]">{view.v}</text>

        {/* the fundamental wedge: the slice of the plane every copy is folded
            out of. Shading it makes "one wedge, mirrored around" legible. */}
        {(() => {
          const half = 180 / mirrorAngles.length
          const a = project(Math.sin((mirrorAngles[0] * Math.PI) / 180) * spread.def.max, Math.cos((mirrorAngles[0] * Math.PI) / 180) * spread.def.max)
          const b = project(Math.sin(((mirrorAngles[0] + half) * Math.PI) / 180) * spread.def.max, Math.cos(((mirrorAngles[0] + half) * Math.PI) / 180) * spread.def.max)
          return <path d={`M${CX} ${CY} L${a.x} ${a.y} L${b.x} ${b.y} Z`} className="fill-[var(--accent)] opacity-[0.09]" />
        })()}

        {/* the mirror lines themselves, drawn full width through the center */}
        {mirrorAngles.map((angle, k) => {
          const radians = (angle * Math.PI) / 180
          const dx = Math.sin(radians) * LINE_PX * view.sx
          const dy = -Math.cos(radians) * LINE_PX * view.sy
          return (
            <line
              key={k}
              x1={CX - dx}
              y1={CY - dy}
              x2={CX + dx}
              y2={CY + dy}
              className={k === 0 ? 'stroke-[var(--accent-muted)]' : 'stroke-[var(--border-strong)]'}
              strokeWidth="1"
              strokeDasharray="4 3"
            />
          )
        })}
        <path d={`M${CX - 4} ${CY}H${CX + 4}M${CX} ${CY - 4}V${CY + 4}`} className="fill-none stroke-[var(--border-strong)]" strokeWidth="1" />

        {/* one flag per copy, drawn through that copy's own basis */}
        {slots.map((slot) => {
          const active = hoveredSlot === slot.index
          return (
            <g key={slot.index} onPointerEnter={() => onHoverSlot(slot.index)} onPointerLeave={() => onHoverSlot(null)}>
              <circle cx={slot.x} cy={slot.y} r="9" fill="transparent" />
              {(active || slot.index === 0) && (
                <circle
                  cx={slot.x}
                  cy={slot.y}
                  r="8"
                  className={`fill-none ${active ? 'stroke-[var(--accent-hover)]' : 'stroke-[var(--accent-muted)]'}`}
                  strokeWidth="1"
                  strokeDasharray={slot.index === 0 && !active ? '2 2' : undefined}
                />
              )}
              <path
                d={COPY_GLYPH}
                transform={slot.matrix}
                className={slot.index === 0
                  ? 'fill-[var(--accent)]'
                  : active
                    ? 'fill-[var(--accent-hover)]'
                    : slot.mirrored ? 'fill-[var(--text-3)]' : 'fill-[var(--text-muted)]'}
              />
            </g>
          )
        })}
      </svg>
      <span className="pointer-events-none absolute bottom-1 left-1.5 font-mono text-[8px] tabular-nums text-[var(--text-3)]">
        {tilt.value}° · S {spread.value.toFixed(1)}
      </span>
      <span className="pointer-events-none absolute right-1.5 top-1 font-mono text-[8px] text-[var(--text-muted)]">{planeLabel}</span>
      <span className="pointer-events-none absolute bottom-1 right-1.5 font-mono text-[8px] tabular-nums text-[var(--text-muted)]">{info}</span>
    </div>
  )
}

/** Mirror count: - / + stepper whose readout also drags vertically like a knob. */
function MirrorsStepper({ b }: { b: NumBinding }) {
  const dragRef = useRef<{ y: number; start: number } | null>(null)
  const { def } = b
  const mirrors = clamp(Math.round(b.value), def.min, def.max)
  const commit = (raw: number) => b.set(clamp(Math.round(raw), def.min, def.max))
  const buttonClass =
    'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] text-sm leading-none text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)] active:scale-95 disabled:pointer-events-none disabled:opacity-35'

  return (
    <div className="flex items-stretch gap-1">
      <button aria-label="One fewer mirror line" className={buttonClass} onClick={() => commit(mirrors - 1)} disabled={mirrors <= def.min}>−</button>
      <div
        role="slider"
        tabIndex={0}
        aria-label={def.label}
        aria-valuemin={def.min}
        aria-valuemax={def.max}
        aria-valuenow={mirrors}
        title="Drag vertically · double-click to reset"
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          dragRef.current = { y: event.clientY, start: mirrors }
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (drag) commit(drag.start + (drag.y - event.clientY) / 9)
        }}
        onPointerUp={(event) => {
          dragRef.current = null
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onDoubleClick={() => b.set(def.default)}
        onKeyDown={(event) => {
          if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
          event.preventDefault()
          commit(mirrors + (event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1))
        }}
        className="flex flex-1 cursor-ns-resize touch-none select-none items-baseline justify-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-app)] py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
      >
        <span className="font-mono text-[16px] leading-none tabular-nums text-[var(--text)]">{mirrors}</span>
        <span className="text-[8px] font-semibold tracking-[0.12em] text-[var(--text-muted)]">
          {mirrors === 1 ? 'MIRROR' : 'MIRRORS'}
        </span>
      </div>
      <button aria-label="One more mirror line" className={buttonClass} onClick={() => commit(mirrors + 1)} disabled={mirrors >= def.max}>+</button>
    </div>
  )
}

/** Plane glyph: the upright mirror line inside that plane's disc, foreshortened
 *  the way the fold diagram will draw it (the depth planes squash to ellipses). */
function PlaneGlyph({ value }: { value: number }) {
  const [rx, ry] = value === 1 ? [7.5, 3] : value === 2 ? [3, 7.5] : [6.5, 6.5]
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.4" aria-hidden="true">
      <ellipse cx="10" cy="10" rx={rx} ry={ry} />
      <path d={`M10 ${10 - ry - 2} V${10 + ry + 2}`} strokeDasharray="2.5 2" />
    </svg>
  )
}

function PlaneSelector({ b }: { b: SelectBinding }) {
  return (
    <div role="radiogroup" aria-label={b.def.label} className="grid grid-cols-3 gap-1">
      {b.def.options.map((option) => {
        const active = option.value === b.value
        return (
          <button
            key={option.value}
            role="radio"
            aria-checked={active}
            title={`${b.def.label}: ${option.label}`}
            onClick={() => b.set(option.value)}
            className={`flex flex-col items-center gap-0.5 rounded-md border py-1.5 transition-colors ${active
              ? 'border-[var(--accent-muted)] bg-[rgba(53,167,230,0.12)] text-[var(--accent-hover)]'
              : 'border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-3)]'}`}
          >
            <PlaneGlyph value={option.value} />
            <span className="text-[7px] font-semibold tracking-[0.08em]">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/** The splitter's MIDI grammar, compact: one pitch chip per copy, hover-synced
 *  with the fold diagram. A note on at that pitch hides the copy. */
function MuteMap({ count, mirroredSlot, hoveredSlot, onHoverSlot }: {
  count: number
  mirroredSlot: (slot: number) => boolean
  hoveredSlot: number | null
  onHoverSlot: (slot: number | null) => void
}) {
  return (
    <div data-testid="symmetry-mute-map" className="rounded-md border border-[var(--border)] bg-[var(--bg-app)] p-1.5">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[8px] font-semibold tracking-[0.12em] text-[var(--text-3)] select-none">MUTE MAP</span>
        <span className="text-[7px] text-[var(--text-muted)] select-none">note on hides the copy</span>
      </div>
      <div className="grid grid-cols-8 gap-[3px]">
        {Array.from({ length: count }, (_, slot) => {
          const pitch = SPLITTER_TOP_PITCH - slot
          const hovered = hoveredSlot === slot
          return (
            <span
              key={slot}
              title={`Copy ${slot + 1}${mirroredSlot(slot) ? ' (mirrored)' : ''} · mute with pitch ${pitch} (${noteName(pitch)})`}
              onPointerEnter={() => onHoverSlot(slot)}
              onPointerLeave={() => onHoverSlot(null)}
              className={`cursor-default rounded-[3px] border py-[3px] text-center font-mono text-[8px] leading-none tabular-nums transition-colors ${hovered
                ? 'border-[var(--accent)] bg-[rgba(53,167,230,0.14)] text-[var(--accent-hover)]'
                : slot === 0
                  ? 'border-[var(--accent-muted)] text-[var(--text-3)]'
                  : mirroredSlot(slot)
                    ? 'border-[var(--border-subtle)] text-[var(--text-muted)]'
                    : 'border-[var(--border)] text-[var(--text-muted)]'}`}
            >
              {pitch}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function SymmetryGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M10 2 V18" className="stroke-current" strokeWidth="1.2" strokeDasharray="2.5 2" fill="none" />
      <path d="M8.4 6 L3 10 L8.4 14 Z" className="fill-current" />
      <path d="M11.6 6 L17 10 L11.6 14 Z" className="fill-current opacity-50" />
    </svg>
  )
}

export const SymmetrySplitterUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null)
  const pool = bind(parameters)
  const mirrors = pool.num('mirrors')
  const tilt = pool.num('tilt')
  const spread = pool.num('spread')
  const plane = pool.select('plane')

  if (!mirrors || !tilt || !spread || !plane) return <ParameterList parameters={parameters} />
  const rest = pool.rest()

  const settings: SymmetrySettings = {
    mirrors: clamp(Math.round(mirrors.value), mirrors.def.min, mirrors.def.max),
    tilt: tilt.value,
    spread: spread.value,
    plane: plane.value,
  }
  const count = settings.mirrors * 2
  const planeLabel = plane.def.options.find((option) => option.value === plane.value)?.label ?? plane.def.options[0]?.label ?? ''
  const safeHover = hoveredSlot != null && hoveredSlot < count ? hoveredSlot : null
  const resetAll = () => {
    for (const bound of parameters) bound.setValue(bound.definition.default)
  }

  return (
    <section
      data-testid="symmetry-user-interface"
      className="-mx-1 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] shadow-[0_14px_34px_rgba(0,0,0,.35)]"
    >
      <header className="flex h-9 items-center justify-between px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--accent)]">
            <SymmetryGlyph />
          </div>
          <span className="truncate text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text)]">Symmetry</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded border border-[var(--border)] bg-[var(--bg-app)] px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-[var(--text-3)]">{count} ×</span>
          <button
            aria-label="Reset all Symmetry parameters"
            title="Reset all"
            onClick={resetAll}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-2)]"
          >
            <RotateCcw size={11} />
          </button>
        </div>
      </header>

      <FoldPad
        settings={settings}
        tilt={tilt}
        spread={spread}
        planeLabel={planeLabel}
        hoveredSlot={safeHover}
        onHoverSlot={setHoveredSlot}
      />

      <div className="space-y-2 p-2">
        <MirrorsStepper b={mirrors} />
        <PlaneSelector b={plane} />
        <MuteMap
          count={count}
          mirroredSlot={(slot) => slot % 2 === 1}
          hoveredSlot={safeHover}
          onHoverSlot={setHoveredSlot}
        />
        {rest.length > 0 && (
          <div className="border-t border-[var(--border-subtle)] pt-2">
            <ParameterList parameters={rest} />
          </div>
        )}
      </div>
    </section>
  )
}
