'use client'

// Bespoke settings for the Radial splitter, migrated to
// docs/instrument-panel-design-guide.md on the console kit (./console). The
// hero is a live ring window of the layout the splitter actually produces: N
// marks at i/N of a full turn (copy 1 accented - it is the unrotated slot),
// each mark spun by its own slot rotation, with a dashed guide ring at the
// current radius. The window is also the EDITOR (the guide's sanctioned
// exception): dragging anywhere sets the radius radially from the center. The
// copy count is a stepper whose readout also drags vertically like a knob,
// the plane select is three oriented-ellipse buttons that re-orient the
// window, and the mute map spells out the splitter's MIDI grammar - pitch 127
// downward, note on hides the copy - hover-synced with the window's marks.

import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { RADIAL_COLOR } from '../core/visualCopies/identityColors'
import {
  bindPanel,
  Console,
  More,
  ParameterList,
  PreviewWindow,
  towardWhite,
  withAlpha,
  type NumBinding,
  type SelectBinding,
} from './console'
import type { UserInterfaceRendererDefinition } from './types'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

// The accent comes FROM THE DEFINITION - the same hue this splitter's timeline
// blocks and piano-roll notes wear.
const ACCENT = RADIAL_COLOR

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
    <PreviewWindow height={170} testId="radial-ring-window">
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
        className="absolute inset-0 cursor-crosshair touch-none select-none outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/50"
      >
        <svg aria-hidden="true" viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-full w-full">
          {/* max-radius bound + center + axis letters */}
          <ellipse cx={CX} cy={CY} rx={RING_MAX_PX * view.sx} ry={RING_MAX_PX * view.sy} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          <path d={`M${CX - 4} ${CY}H${CX + 4}M${CX} ${CY - 4}V${CY + 4}`} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
          <text x={CX + (RING_MAX_PX + 7) * view.sx} y={CY + 2.5} fill="rgba(255,255,255,0.35)" className="font-mono text-[7px]">{view.h}</text>
          <text x={CX} y={CY - (RING_MAX_PX + 5) * view.sy} textAnchor="middle" fill="rgba(255,255,255,0.35)" className="font-mono text-[7px]">{view.v}</text>

          {/* spokes + dashed guide ring at the current radius */}
          {rPx > 2 && (
            <>
              {marks.map((mark) => (
                <line key={mark.slot} x1={CX} y1={CY} x2={mark.x} y2={mark.y} stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
              ))}
              <ellipse cx={CX} cy={CY} rx={rPx * view.sx} ry={rPx * view.sy} fill="none" stroke={withAlpha(ACCENT, 0.55)} strokeWidth="1" strokeDasharray="3 3" />
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
                    fill="none"
                    stroke={active ? towardWhite(ACCENT, 0.3) : withAlpha(ACCENT, 0.55)}
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
                  fill={mark.slot === 0 ? ACCENT : active ? towardWhite(ACCENT, 0.3) : 'rgba(255,255,255,0.35)'}
                />
                {mark.slot === 0 && (
                  <text x={mark.x} y={mark.y - 10} textAnchor="middle" fill={ACCENT} className="font-mono text-[7px]">1</text>
                )}
              </g>
            )
          })}
        </svg>
        <span className="pointer-events-none absolute bottom-1 left-1.5 font-mono text-[8px] tabular-nums text-white/60">R {value.toFixed(1)}</span>
        <span className="pointer-events-none absolute right-1.5 top-1 font-mono text-[8px] text-white/30">{planeLabel}</span>
        <span className="pointer-events-none absolute bottom-1 right-1.5 font-mono text-[8px] tabular-nums text-white/30">{hoverInfo}</span>
      </div>
    </PreviewWindow>
  )
}

/** Copy count: - / + stepper whose readout also drags vertically like a knob. */
function CopiesStepper({ b }: { b: NumBinding }) {
  const dragRef = useRef<{ y: number; start: number } | null>(null)
  const { def } = b
  const count = clamp(Math.round(b.value), def.min, def.max)
  const commit = (raw: number) => b.set(clamp(Math.round(raw), def.min, def.max))
  const buttonClass =
    'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-sm leading-none text-white/70 transition-colors hover:border-white/25 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-35'

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
        className="flex flex-1 cursor-ns-resize touch-none select-none items-baseline justify-center gap-1.5 rounded-md border border-white/10 bg-black/25 py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-white/50"
      >
        <span className="font-mono text-[16px] leading-none tabular-nums text-white/90">{count}</span>
        <span className="text-[8px] font-semibold tracking-[0.12em] text-white/40">COPIES</span>
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

/** Each option IS the plane it draws (the guide's segments-with-shapes rule). */
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
            className={`flex cursor-pointer flex-col items-center gap-0.5 rounded-md border py-1.5 transition-colors ${
              active ? '' : 'border-white/[0.07] bg-white/[0.025] text-white/30 hover:bg-white/[0.06] hover:text-white/65'
            }`}
            style={active ? { borderColor: withAlpha(ACCENT, 0.4), background: withAlpha(ACCENT, 0.15), color: towardWhite(ACCENT, 0.45) } : undefined}
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
 *  with the ring window. A note on at that pitch hides the copy. */
function MuteMap({ count, hoveredSlot, onHoverSlot }: {
  count: number
  hoveredSlot: number | null
  onHoverSlot: (slot: number | null) => void
}) {
  return (
    <div data-testid="radial-mute-map" className="rounded-md border border-white/[0.06] bg-black/25 p-1.5">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[8px] font-semibold tracking-[0.12em] text-white/40 select-none">MUTE MAP</span>
        <span className="text-[7px] text-white/25 select-none">note on hides the copy</span>
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
              className="cursor-default rounded-[3px] border py-[3px] text-center font-mono text-[8px] leading-none tabular-nums transition-colors"
              style={hovered
                ? { borderColor: ACCENT, background: withAlpha(ACCENT, 0.14), color: towardWhite(ACCENT, 0.3) }
                : slot === 0
                  ? { borderColor: withAlpha(ACCENT, 0.55), color: 'rgba(255,255,255,0.6)' }
                  : { borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' }}
            >
              {pitch}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export const RadialSplitterUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null)
  const pool = bindPanel(parameters)
  const copies = pool.num('copies')
  const radius = pool.num('radius')
  const plane = pool.select('plane')

  if (!copies || !radius || !plane) return <ParameterList parameters={parameters} />

  const count = clamp(Math.round(copies.value), copies.def.min, copies.def.max)
  const planeLabel = plane.def.options.find((option) => option.value === plane.value)?.label ?? plane.def.options[0]?.label ?? ''
  const safeHover = hoveredSlot != null && hoveredSlot < count ? hoveredSlot : null

  return (
    <Console accent={ACCENT} testId="radial-user-interface">
      <RingPad
        count={count}
        radius={radius}
        planeValue={plane.value}
        planeLabel={planeLabel}
        hoveredSlot={safeHover}
        onHoverSlot={setHoveredSlot}
      />
      <div className="flex flex-col gap-2 px-3 pb-3 pt-2">
        <CopiesStepper b={copies} />
        <PlaneSelector b={plane} />
        <MuteMap count={count} hoveredSlot={safeHover} onHoverSlot={setHoveredSlot} />
        <More parameters={pool.rest()} label="MORE" className="" />
      </div>
    </Console>
  )
}
