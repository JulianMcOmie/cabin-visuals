'use client'

// Bespoke settings for the Symmetry splitter, migrated to
// docs/instrument-panel-design-guide.md on the console kit (./console). The
// hero is the fold window: the
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
import {
  symmetryLayout,
  symmetryMirrorAngles,
  type SymmetrySettings,
} from '../core/visualCopies/symmetry'
import { SYMMETRY_COLOR } from '../core/visualCopies/identityColors'
import { SPLITTER_SIZE_DEFAULT } from '../core/visualCopies/splitterSize'
import type { NumberParamDef } from '../instruments/types'
import {
  bindPanel,
  Console,
  Knob,
  More,
  ParameterList,
  PreviewWindow,
  towardWhite,
  withAlpha,
  type NumBinding,
  type SelectBinding,
} from './console'
import type { UserInterfaceRendererDefinition } from './types'
import { clamp } from '../utils/math'

// The accent comes FROM THE DEFINITION - the same hue this splitter's timeline
// blocks and piano-roll notes wear.
const ACCENT = SYMMETRY_COLOR

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
    <PreviewWindow height={170} testId="symmetry-fold-window">
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
      className="absolute inset-0 cursor-crosshair touch-none select-none outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/50"
    >
      <svg aria-hidden="true" viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-full w-full">
        {/* the reach of the spread drag, plus the plane's axis letters */}
        <ellipse cx={CX} cy={CY} rx={SPREAD_MAX_PX * view.sx} ry={SPREAD_MAX_PX * view.sy} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
        <text x={CX + (SPREAD_MAX_PX + 8) * view.sx} y={CY + 2.5} fill="rgba(255,255,255,0.35)" className="font-mono text-[7px]">{view.h}</text>
        <text x={CX} y={CY - (SPREAD_MAX_PX + 6) * view.sy} textAnchor="middle" fill="rgba(255,255,255,0.35)" className="font-mono text-[7px]">{view.v}</text>

        {/* the fundamental wedge: the slice of the plane every copy is folded
            out of. Shading it makes "one wedge, mirrored around" legible. */}
        {(() => {
          const half = 180 / mirrorAngles.length
          const a = project(Math.sin((mirrorAngles[0] * Math.PI) / 180) * spread.def.max, Math.cos((mirrorAngles[0] * Math.PI) / 180) * spread.def.max)
          const b = project(Math.sin(((mirrorAngles[0] + half) * Math.PI) / 180) * spread.def.max, Math.cos(((mirrorAngles[0] + half) * Math.PI) / 180) * spread.def.max)
          return <path d={`M${CX} ${CY} L${a.x} ${a.y} L${b.x} ${b.y} Z`} fill={ACCENT} className="opacity-[0.09]" />
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
              stroke={k === 0 ? withAlpha(ACCENT, 0.55) : 'rgba(255,255,255,0.25)'}
              strokeWidth="1"
              strokeDasharray="4 3"
            />
          )
        })}
        <path d={`M${CX - 4} ${CY}H${CX + 4}M${CX} ${CY - 4}V${CY + 4}`} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />

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
                  fill="none"
                  stroke={active ? towardWhite(ACCENT, 0.3) : withAlpha(ACCENT, 0.55)}
                  strokeWidth="1"
                  strokeDasharray={slot.index === 0 && !active ? '2 2' : undefined}
                />
              )}
              <path
                d={COPY_GLYPH}
                transform={slot.matrix}
                fill={slot.index === 0
                  ? ACCENT
                  : active
                    ? towardWhite(ACCENT, 0.3)
                    : slot.mirrored ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.35)'}
              />
            </g>
          )
        })}
      </svg>
      <span className="pointer-events-none absolute bottom-1 left-1.5 font-mono text-[8px] tabular-nums text-white/60">
        {tilt.value}° · S {spread.value.toFixed(1)}
      </span>
      <span className="pointer-events-none absolute right-1.5 top-1 font-mono text-[8px] text-white/30">{planeLabel}</span>
      <span className="pointer-events-none absolute bottom-1 right-1.5 font-mono text-[8px] tabular-nums text-white/30">{info}</span>
    </div>
    </PreviewWindow>
  )
}

/** Mirror count: - / + stepper whose readout also drags vertically like a knob. */
function MirrorsStepper({ b }: { b: NumBinding }) {
  const dragRef = useRef<{ y: number; start: number } | null>(null)
  const { def } = b
  const mirrors = clamp(Math.round(b.value), def.min, def.max)
  const commit = (raw: number) => b.set(clamp(Math.round(raw), def.min, def.max))
  const buttonClass =
    'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-sm leading-none text-white/70 transition-colors hover:border-white/25 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-35'

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
        className="flex flex-1 cursor-ns-resize touch-none select-none items-baseline justify-center gap-1.5 rounded-md border border-white/10 bg-black/25 py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-white/50"
      >
        <span className="font-mono text-[16px] leading-none tabular-nums text-white/90">{mirrors}</span>
        <span className="text-[8px] font-semibold tracking-[0.12em] text-white/40">
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
 *  with the fold diagram. A note on at that pitch hides the copy. */
function MuteMap({ count, mirroredSlot, hoveredSlot, onHoverSlot }: {
  count: number
  mirroredSlot: (slot: number) => boolean
  hoveredSlot: number | null
  onHoverSlot: (slot: number | null) => void
}) {
  return (
    <div data-testid="symmetry-mute-map" className="rounded-md border border-white/[0.06] bg-black/25 p-1.5">
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
              title={`Copy ${slot + 1}${mirroredSlot(slot) ? ' (mirrored)' : ''} · mute with pitch ${pitch} (${noteName(pitch)})`}
              onPointerEnter={() => onHoverSlot(slot)}
              onPointerLeave={() => onHoverSlot(null)}
              className="cursor-default rounded-[3px] border py-[3px] text-center font-mono text-[8px] leading-none tabular-nums transition-colors"
              style={hovered
                ? { borderColor: ACCENT, background: withAlpha(ACCENT, 0.14), color: towardWhite(ACCENT, 0.3) }
                : slot === 0
                  ? { borderColor: withAlpha(ACCENT, 0.55), color: 'rgba(255,255,255,0.6)' }
                  : { borderColor: mirroredSlot(slot) ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' }}
            >
              {pitch}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export const SymmetrySplitterUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null)
  const pool = bindPanel(parameters)
  const mirrors = pool.num('mirrors')
  const tilt = pool.num('tilt')
  const spread = pool.num('spread')
  const plane = pool.select('plane')
  // Optional: the console must survive a definition without the shared knob.
  const size = pool.num('size', { optional: true })

  if (!mirrors || !tilt || !spread || !plane) return <ParameterList parameters={parameters} />

  const settings: SymmetrySettings = {
    mirrors: clamp(Math.round(mirrors.value), mirrors.def.min, mirrors.def.max),
    tilt: tilt.value,
    spread: spread.value,
    // The pad draws the FOLD - mirror lines, the fundamental wedge, and each
    // copy's handedness - so it deliberately draws every copy at one glyph
    // size. Scaling the glyphs by SIZE would bury the lines you drag at the
    // top of the knob's range without saying anything the knob doesn't.
    size: size?.value ?? SPLITTER_SIZE_DEFAULT,
    plane: plane.value,
  }
  const count = settings.mirrors * 2
  const planeLabel = plane.def.options.find((option) => option.value === plane.value)?.label ?? plane.def.options[0]?.label ?? ''
  const safeHover = hoveredSlot != null && hoveredSlot < count ? hoveredSlot : null

  return (
    <Console accent={ACCENT} testId="symmetry-user-interface">
      <FoldPad
        settings={settings}
        tilt={tilt}
        spread={spread}
        planeLabel={planeLabel}
        hoveredSlot={safeHover}
        onHoverSlot={setHoveredSlot}
      />
      <div className="flex flex-col gap-2 px-3 pb-3 pt-2">
        <MirrorsStepper b={mirrors} />
        {size && (
          <div className="flex justify-center">
            <Knob b={size} label="SIZE" />
          </div>
        )}
        <PlaneSelector b={plane} />
        <MuteMap
          count={count}
          mirroredSlot={(slot) => slot % 2 === 1}
          hoveredSlot={safeHover}
          onHoverSlot={setHoveredSlot}
        />
        <More parameters={pool.rest()} label="MORE" className="" />
      </div>
    </Console>
  )
}
