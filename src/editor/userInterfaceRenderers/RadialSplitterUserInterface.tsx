'use client'

// Bespoke settings for the Radial splitter. The hero is a live ring diagram of
// the layout the splitter actually produces: N marks at i/N of a full turn
// (copy 1 accented - it is the unrotated slot), each mark spun by its own slot
// rotation, with a dashed guide ring at the current radius. Dragging anywhere
// on the diagram sets the radius radially from the center; the copy count is a
// stepper whose readout also drags vertically like a knob. The plane select is
// three oriented-ellipse buttons that re-orient the diagram (the depth planes
// foreshorten into ellipses). The mute map spells out the splitter's MIDI
// grammar - pitch 127 downward, note on hides the copy - and hover-syncs with
// the diagram marks. Presentation only: every control routes through the
// passed parameter bindings.

import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { RotateCcw } from 'lucide-react'
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

// Mirrors the splitter's MIDI grammar in library.ts: with copies <= 32 there is
// exactly one row per copy, pitch 127 - slot, and a note on hides that copy.
const SPLITTER_TOP_PITCH = 127
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const noteName = (pitch: number) => `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`

/** How each plane draws: ellipse squash (the depth planes foreshorten), where
 *  copy 1 sits (its translation direction in library.ts), and axis letters. */
const PLANE_VIEWS = [
  { sx: 1, sy: 1, start: 0, h: 'X', v: 'Y' }, // XY - ring faces the camera; copy 1 at +X
  { sx: 1, sy: 0.38, start: 0, h: 'X', v: 'Z' }, // XZ - ring lies flat; copy 1 at +X
  { sx: 0.38, sy: 1, start: Math.PI / 2, h: 'Z', v: 'Y' }, // YZ - ring edge-on; copy 1 at +Y
]

const VB_W = 240
const VB_H = 170
const CX = VB_W / 2
const CY = VB_H / 2
const RING_MAX_PX = 70

/** The hero: the splitter's ring, drawn live. Radial drag sets the radius. */
function RingPad({ count, radius, planeValue, planeLabel, hoveredSlot, onHoverSlot }: {
  count: number
  radius: NumBinding
  planeValue: number
  planeLabel: string
  hoveredSlot: number | null
  onHoverSlot: (slot: number | null) => void
}) {
  const padRef = useRef<HTMLDivElement>(null)
  const view = PLANE_VIEWS[planeValue] ?? PLANE_VIEWS[0]
  const { def, value, set } = radius
  const rPx = (clamp(value, def.min, def.max) / def.max) * RING_MAX_PX

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

  const setFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = toViewBox(event.clientX, event.clientY)
    if (!point) return
    // Undo the plane's ellipse squash so the drag distance reads in ring units.
    const dx = (point.u - CX) / view.sx
    const dy = (CY - point.v) / view.sy
    const raw = (Math.hypot(dx, dy) / RING_MAX_PX) * def.max
    const snapped = Math.round(raw / def.step) * def.step
    set(clamp(Number(snapped.toFixed(8)), def.min, def.max))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
    event.preventDefault()
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1
    set(clamp(Number((value + direction * (event.shiftKey ? 10 : 1) * def.step).toFixed(8)), def.min, def.max))
  }

  const marks = Array.from({ length: count }, (_, slot) => {
    const angle = view.start + (slot / count) * Math.PI * 2
    return {
      slot,
      x: CX + Math.cos(angle) * rPx * view.sx,
      y: CY - Math.sin(angle) * rPx * view.sy,
      spin: -(slot / count) * 360, // each copy is rotated by its slot angle
    }
  })

  const hoverInfo = hoveredSlot != null
    ? `COPY ${hoveredSlot + 1} · MUTE ${SPLITTER_TOP_PITCH - hoveredSlot} (${noteName(SPLITTER_TOP_PITCH - hoveredSlot)})`
    : `${count} ${count === 1 ? 'COPY' : 'COPIES'} · 1 UNROTATED`

  return (
    <div
      ref={padRef}
      data-testid="radial-ring-pad"
      role="slider"
      tabIndex={0}
      aria-label="Radius"
      aria-valuemin={def.min}
      aria-valuemax={def.max}
      aria-valuenow={value}
      title="Drag from the center to set radius · double-click to reset"
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
      onDoubleClick={() => set(def.default)}
      onKeyDown={onKeyDown}
      className="relative w-full cursor-crosshair touch-none select-none border-y border-[var(--border)] bg-[var(--bg-canvas)] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
      style={{ aspectRatio: `${VB_W} / ${VB_H}` }}
    >
      <svg aria-hidden="true" viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-full w-full">
        {/* max-radius bound + center + axis letters */}
        <ellipse cx={CX} cy={CY} rx={RING_MAX_PX * view.sx} ry={RING_MAX_PX * view.sy} className="fill-none stroke-[var(--border-subtle)]" strokeWidth="1" />
        <path d={`M${CX - 4} ${CY}H${CX + 4}M${CX} ${CY - 4}V${CY + 4}`} className="fill-none stroke-[var(--border-strong)]" strokeWidth="1" />
        <text x={CX + (RING_MAX_PX + 7) * view.sx} y={CY + 2.5} className="fill-[var(--text-muted)] font-mono text-[7px]">{view.h}</text>
        <text x={CX} y={CY - (RING_MAX_PX + 5) * view.sy} textAnchor="middle" className="fill-[var(--text-muted)] font-mono text-[7px]">{view.v}</text>

        {/* spokes + dashed guide ring at the current radius */}
        {rPx > 2 && (
          <>
            {marks.map((mark) => (
              <line key={mark.slot} x1={CX} y1={CY} x2={mark.x} y2={mark.y} className="stroke-[var(--border)]" strokeWidth="1" />
            ))}
            <ellipse cx={CX} cy={CY} rx={rPx * view.sx} ry={rPx * view.sy} className="fill-none stroke-[var(--accent-muted)]" strokeWidth="1" strokeDasharray="3 3" />
          </>
        )}

        {/* copy marks - small squares, each spun by its own slot rotation */}
        {marks.map((mark) => {
          const active = hoveredSlot === mark.slot
          return (
            <g key={mark.slot} onPointerEnter={() => onHoverSlot(mark.slot)} onPointerLeave={() => onHoverSlot(null)}>
              <circle cx={mark.x} cy={mark.y} r="9" fill="transparent" />
              {(active || mark.slot === 0) && (
                <circle
                  cx={mark.x}
                  cy={mark.y}
                  r="7"
                  className={`fill-none ${active ? 'stroke-[var(--accent-hover)]' : 'stroke-[var(--accent-muted)]'}`}
                  strokeWidth="1"
                  strokeDasharray={mark.slot === 0 && !active ? '2 2' : undefined}
                />
              )}
              <rect
                x="-3.6"
                y="-3.6"
                width="7.2"
                height="7.2"
                rx="1.2"
                transform={`translate(${mark.x} ${mark.y}) rotate(${mark.spin})`}
                className={mark.slot === 0 ? 'fill-[var(--accent)]' : active ? 'fill-[var(--accent-hover)]' : 'fill-[var(--text-muted)]'}
              />
              {mark.slot === 0 && (
                <text x={mark.x} y={mark.y - 10} textAnchor="middle" className="fill-[var(--accent)] font-mono text-[7px]">1</text>
              )}
            </g>
          )
        })}
      </svg>
      <span className="pointer-events-none absolute bottom-1 left-1.5 font-mono text-[8px] tabular-nums text-[var(--text-3)]">R {value.toFixed(1)}</span>
      <span className="pointer-events-none absolute right-1.5 top-1 font-mono text-[8px] text-[var(--text-muted)]">{planeLabel}</span>
      <span className="pointer-events-none absolute bottom-1 right-1.5 font-mono text-[8px] tabular-nums text-[var(--text-muted)]">{hoverInfo}</span>
    </div>
  )
}

/** Copy count: - / + stepper whose readout also drags vertically like a knob. */
function CopiesStepper({ b }: { b: NumBinding }) {
  const dragRef = useRef<{ y: number; start: number } | null>(null)
  const { def } = b
  const count = clamp(Math.round(b.value), def.min, def.max)
  const commit = (raw: number) => b.set(clamp(Math.round(raw), def.min, def.max))
  const buttonClass =
    'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] text-sm leading-none text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)] active:scale-95 disabled:pointer-events-none disabled:opacity-35'

  return (
    <div className="flex items-stretch gap-1">
      <button aria-label="One fewer copy" className={buttonClass} onClick={() => commit(count - 1)} disabled={count <= def.min}>−</button>
      <div
        role="slider"
        tabIndex={0}
        aria-label={def.label}
        aria-valuemin={def.min}
        aria-valuemax={def.max}
        aria-valuenow={count}
        title="Drag vertically · double-click to reset"
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          dragRef.current = { y: event.clientY, start: count }
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (drag) commit(drag.start + (drag.y - event.clientY) / 7)
        }}
        onPointerUp={(event) => {
          dragRef.current = null
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onDoubleClick={() => b.set(def.default)}
        onKeyDown={(event) => {
          if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
          event.preventDefault()
          commit(count + (event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1))
        }}
        className="flex flex-1 cursor-ns-resize touch-none select-none items-baseline justify-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-app)] py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
      >
        <span className="font-mono text-[16px] leading-none tabular-nums text-[var(--text)]">{count}</span>
        <span className="text-[8px] font-semibold tracking-[0.12em] text-[var(--text-muted)]">COPIES</span>
      </div>
      <button aria-label="One more copy" className={buttonClass} onClick={() => commit(count + 1)} disabled={count >= def.max}>+</button>
    </div>
  )
}

/** Plane glyph: the ring as it will be drawn, with a dot where copy 1 sits. */
function PlaneGlyph({ value }: { value: number }) {
  const [rx, ry] = value === 1 ? [7.5, 3] : value === 2 ? [3, 7.5] : [6.5, 6.5]
  const [dx, dy] = value === 2 ? [10, 10 - ry] : [10 + rx, 10]
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.4" aria-hidden="true">
      <ellipse cx="10" cy="10" rx={rx} ry={ry} />
      <circle cx={dx} cy={dy} r="1.7" className="fill-current stroke-none" />
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
 *  with the ring diagram. A note on at that pitch hides the copy. */
function MuteMap({ count, hoveredSlot, onHoverSlot }: {
  count: number
  hoveredSlot: number | null
  onHoverSlot: (slot: number | null) => void
}) {
  return (
    <div data-testid="radial-mute-map" className="rounded-md border border-[var(--border)] bg-[var(--bg-app)] p-1.5">
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
              title={`Copy ${slot + 1} · mute with pitch ${pitch} (${noteName(pitch)})`}
              onPointerEnter={() => onHoverSlot(slot)}
              onPointerLeave={() => onHoverSlot(null)}
              className={`cursor-default rounded-[3px] border py-[3px] text-center font-mono text-[8px] leading-none tabular-nums transition-colors ${hovered
                ? 'border-[var(--accent)] bg-[rgba(53,167,230,0.14)] text-[var(--accent-hover)]'
                : slot === 0
                  ? 'border-[var(--accent-muted)] text-[var(--text-3)]'
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

function RadialGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => {
        const angle = (index / 6) * Math.PI * 2
        return <circle key={index} cx={10 + Math.cos(angle) * 6.2} cy={10 - Math.sin(angle) * 6.2} r={index === 0 ? 2.1 : 1.4} />
      })}
    </svg>
  )
}

export const RadialSplitterUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null)
  const pool = bind(parameters)
  const copies = pool.num('copies')
  const radius = pool.num('radius')
  const plane = pool.select('plane')

  if (!copies || !radius || !plane) return <ParameterList parameters={parameters} />
  const rest = pool.rest()

  const count = clamp(Math.round(copies.value), copies.def.min, copies.def.max)
  const planeLabel = plane.def.options.find((option) => option.value === plane.value)?.label ?? plane.def.options[0]?.label ?? ''
  const safeHover = hoveredSlot != null && hoveredSlot < count ? hoveredSlot : null
  const resetAll = () => {
    for (const bound of parameters) bound.setValue(bound.definition.default)
  }

  return (
    <section
      data-testid="radial-user-interface"
      className="-mx-1 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] shadow-[0_14px_34px_rgba(0,0,0,.35)]"
    >
      <header className="flex h-9 items-center justify-between px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--accent)]">
            <RadialGlyph />
          </div>
          <span className="truncate text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text)]">Radial</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded border border-[var(--border)] bg-[var(--bg-app)] px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-[var(--text-3)]">{count} ×</span>
          <button
            aria-label="Reset all Radial parameters"
            title="Reset all"
            onClick={resetAll}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-2)]"
          >
            <RotateCcw size={11} />
          </button>
        </div>
      </header>

      <RingPad
        count={count}
        radius={radius}
        planeValue={plane.value}
        planeLabel={planeLabel}
        hoveredSlot={safeHover}
        onHoverSlot={setHoveredSlot}
      />

      <div className="space-y-2 p-2">
        <CopiesStepper b={copies} />
        <PlaneSelector b={plane} />
        <MuteMap count={count} hoveredSlot={safeHover} onHoverSlot={setHoveredSlot} />
        {rest.length > 0 && (
          <div className="border-t border-[var(--border-subtle)] pt-2">
            <ParameterList parameters={rest} />
          </div>
        )}
      </div>
    </section>
  )
}
