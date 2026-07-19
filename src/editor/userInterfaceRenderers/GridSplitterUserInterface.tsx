'use client'

// Bespoke settings for the Grid splitter. Two live surfaces stacked:
//
// 1. A table-size chooser (the Word-table gesture): a 32 x 32 cell field where
//    hovering previews a rows x columns choice and pressing/dragging commits it
//    in one sweep. Fine adjustment via - / + steppers whose readouts drag
//    vertically.
// 2. A layout preview of the grid the splitter actually produces: cells placed
//    with the real spacing (the gap widens live as the slider moves until the
//    fit clamp takes over), re-oriented by the plane select (the depth planes
//    project as foreshortened parallelograms), and swept by a repeating index
//    pulse that travels in the EXACT order from gridCellOrder - so the four
//    indexing modes are visibly different. Small grids also overlay the index
//    numbers; the dashed ring marks cell 1.
//
// Presentation only: every control routes through the passed parameter
// bindings; gridCellOrder is imported read-only from the splitter definition.

import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { RotateCcw } from 'lucide-react'
import { gridCellOrder } from '../core/visualCopies/library'
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

const intValue = (b: NumBinding) => clamp(Math.round(b.value), b.def.min, b.def.max)

// ── Size chooser ─────────────────────────────────────────────────────────────

const MAX_DIMENSION = 32
const CHOOSER_CELL = 7
const CHOOSER_PAD = 2
const CHOOSER_FIELD = MAX_DIMENSION * CHOOSER_CELL
const CHOOSER_VB = CHOOSER_FIELD + CHOOSER_PAD * 2

/** All lattice lines as one path each - minor every cell, major every 8th. */
const CHOOSER_LINES = (() => {
  let minor = ''
  let major = ''
  for (let i = 0; i <= MAX_DIMENSION; i++) {
    const p = CHOOSER_PAD + i * CHOOSER_CELL
    const d = `M${CHOOSER_PAD} ${p}H${CHOOSER_PAD + CHOOSER_FIELD}M${p} ${CHOOSER_PAD}V${CHOOSER_PAD + CHOOSER_FIELD}`
    if (i % 8 === 0) major += d
    else minor += d
  }
  return { minor, major }
})()

/** The Word-table gesture: hover previews rows x columns, press/drag commits. */
function SizeChooser({ rows, columns }: { rows: NumBinding; columns: NumBinding }) {
  const padRef = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<{ r: number; c: number } | null>(null)
  const committedR = intValue(rows)
  const committedC = intValue(columns)

  const cellFromPointer = (clientX: number, clientY: number) => {
    const rect = padRef.current?.getBoundingClientRect()
    if (!rect) return null
    const scale = Math.min(rect.width / CHOOSER_VB, rect.height / CHOOSER_VB)
    const u = (clientX - rect.left - (rect.width - CHOOSER_VB * scale) / 2) / scale
    const v = (clientY - rect.top - (rect.height - CHOOSER_VB * scale) / 2) / scale
    return {
      r: clamp(Math.ceil((v - CHOOSER_PAD) / CHOOSER_CELL), 1, MAX_DIMENSION),
      c: clamp(Math.ceil((u - CHOOSER_PAD) / CHOOSER_CELL), 1, MAX_DIMENSION),
    }
  }

  const commit = (cell: { r: number; c: number }) => {
    rows.set(clamp(cell.r, rows.def.min, rows.def.max))
    columns.set(clamp(cell.c, columns.def.min, columns.def.max))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta: Record<string, [number, number]> = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
    }
    const step = delta[event.key]
    if (!step) return
    event.preventDefault()
    commit({ r: clamp(committedR + step[0], 1, MAX_DIMENSION), c: clamp(committedC + step[1], 1, MAX_DIMENSION) })
  }

  const shown = preview ?? { r: committedR, c: committedC }
  const previewDiffers = preview != null && (preview.r !== committedR || preview.c !== committedC)

  return (
    <div
      ref={padRef}
      data-testid="grid-size-chooser"
      role="group"
      tabIndex={0}
      aria-label={`${rows.def.label} and ${columns.def.label}`}
      title="Hover to preview · click or drag to set rows × columns"
      onPointerMove={(event) => {
        const cell = cellFromPointer(event.clientX, event.clientY)
        if (!cell) return
        setPreview(cell)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) commit(cell)
      }}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        const cell = cellFromPointer(event.clientX, event.clientY)
        if (cell) { setPreview(cell); commit(cell) }
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerLeave={() => setPreview(null)}
      onKeyDown={onKeyDown}
      className="relative w-full cursor-crosshair touch-none select-none border-y border-[var(--border)] bg-[var(--bg-canvas)] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
      style={{ aspectRatio: '1 / 1' }}
    >
      <svg aria-hidden="true" viewBox={`0 0 ${CHOOSER_VB} ${CHOOSER_VB}`} className="h-full w-full">
        <path d={CHOOSER_LINES.minor} className="stroke-[var(--border-subtle)]" strokeWidth="0.6" />
        <path d={CHOOSER_LINES.major} className="stroke-[var(--border)]" strokeWidth="0.6" />
        {/* committed rows x columns */}
        <rect
          x={CHOOSER_PAD}
          y={CHOOSER_PAD}
          width={committedC * CHOOSER_CELL}
          height={committedR * CHOOSER_CELL}
          fill="rgba(63,124,166,0.30)"
          className="stroke-[var(--accent)]"
          strokeWidth="1"
        />
        {/* hover preview */}
        {previewDiffers && preview && (
          <rect
            x={CHOOSER_PAD}
            y={CHOOSER_PAD}
            width={preview.c * CHOOSER_CELL}
            height={preview.r * CHOOSER_CELL}
            fill="rgba(255,255,255,0.03)"
            className="stroke-[var(--text-3)]"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}
      </svg>
      <span
        className="pointer-events-none absolute rounded-sm border border-[var(--border)] px-1 py-px font-mono text-[9px] leading-tight tabular-nums text-[var(--text-2)]"
        style={{
          background: 'rgba(19,19,22,0.92)',
          left: `${clamp(((CHOOSER_PAD + shown.c * CHOOSER_CELL) / CHOOSER_VB) * 100 + 1.5, 2, 74)}%`,
          top: `${clamp(((CHOOSER_PAD + shown.r * CHOOSER_CELL) / CHOOSER_VB) * 100 + 1.5, 2, 88)}%`,
        }}
      >
        {shown.r} × {shown.c}
      </span>
    </div>
  )
}

/** Compact dimension stepper: - / + around a vertically draggable readout. */
function DimStepper({ b, tag }: { b: NumBinding; tag: string }) {
  const dragRef = useRef<{ y: number; start: number } | null>(null)
  const { def } = b
  const value = intValue(b)
  const commit = (raw: number) => b.set(clamp(Math.round(raw), def.min, def.max))
  const buttonClass =
    'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] text-[13px] leading-none text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)] active:scale-95 disabled:pointer-events-none disabled:opacity-35'

  return (
    <div className="flex items-stretch gap-1">
      <button aria-label={`One fewer ${tag.toLowerCase()}`} className={buttonClass} onClick={() => commit(value - 1)} disabled={value <= def.min}>−</button>
      <div
        role="slider"
        tabIndex={0}
        aria-label={def.label}
        aria-valuemin={def.min}
        aria-valuemax={def.max}
        aria-valuenow={value}
        title="Drag vertically · double-click to reset"
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          dragRef.current = { y: event.clientY, start: value }
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
          commit(value + (event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1))
        }}
        className="flex min-w-0 flex-1 cursor-ns-resize touch-none select-none items-baseline justify-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-app)] py-1 outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
      >
        <span className="font-mono text-[13px] leading-none tabular-nums text-[var(--text)]">{value}</span>
        <span className="text-[7px] font-semibold tracking-[0.12em] text-[var(--text-muted)]">{tag}</span>
      </div>
      <button aria-label={`One more ${tag.toLowerCase()}`} className={buttonClass} onClick={() => commit(value + 1)} disabled={value >= def.max}>+</button>
    </div>
  )
}

// ── Layout preview ───────────────────────────────────────────────────────────

const PREVIEW_W = 240
const PREVIEW_H = 150
// Depth planes project as foreshortened parallelograms; XY faces the camera.
const PLANE_PROJECTIONS = ['', 'scale(1 0.46) skewX(-26)', 'scale(0.46 1) skewY(-16)']
// Mirrors GRID_PLANES in library.ts: [horizontal axis, vertical axis].
const PLANE_AXES = [['X', 'Y'], ['X', 'Z'], ['Y', 'Z']]

/** The grid the splitter actually produces: real spacing, plane-oriented, with
 *  a repeating pulse traveling in the exact gridCellOrder index order. */
function LayoutPreview({ rows, columns, spacing, planeValue, indexing }: {
  rows: number
  columns: number
  spacing: number
  planeValue: number
  indexing: number
}) {
  const order = useMemo(() => gridCellOrder(rows, columns, indexing), [rows, columns, indexing])
  const total = rows * columns
  // Fixed pixels-per-unit until the grid would overflow, then fit-clamped - so
  // dragging SPACING visibly widens the gaps instead of being normalized away.
  const safeSpacing = Math.max(spacing, 0.0001)
  const unit = Math.min(
    26,
    columns > 1 ? 176 / ((columns - 1) * safeSpacing) : 26,
    rows > 1 ? 112 / ((rows - 1) * safeSpacing) : 26,
  )
  const gap = spacing * unit
  const size = spacing === 0 ? 5 : clamp(gap * 0.5, 3, 12)
  const showNumbers = total <= 49 && size >= 8
  const sweepSeconds = clamp(total * 0.14, 1.8, 6)
  const [hAxis, vAxis] = PLANE_AXES[planeValue] ?? PLANE_AXES[0]
  const first = order[0]
  const cellX = (column: number) => (column - (columns - 1) / 2) * gap
  const cellY = (row: number) => (row - (rows - 1) / 2) * gap

  return (
    <div
      data-testid="grid-layout-preview"
      className="relative w-full select-none overflow-hidden border-y border-[var(--border)] bg-[var(--bg-canvas)]"
      style={{ aspectRatio: `${PREVIEW_W} / ${PREVIEW_H}` }}
    >
      <style>{'@keyframes cabin-grid-index-sweep { 0%, 5% { fill: var(--accent); opacity: 1; } 11%, 100% { fill: var(--accent-muted); opacity: 0.5; } }'}</style>
      <svg aria-hidden="true" viewBox={`0 0 ${PREVIEW_W} ${PREVIEW_H}`} className="h-full w-full">
        <g transform={`translate(${PREVIEW_W / 2} ${PREVIEW_H / 2}) ${PLANE_PROJECTIONS[planeValue] ?? ''}`}>
          {order.map(([row, column], index) => (
            <rect
              key={`${row}-${column}`}
              x={cellX(column) - size / 2}
              y={cellY(row) - size / 2}
              width={size}
              height={size}
              rx={1}
              style={{
                fill: 'var(--accent-muted)',
                opacity: 0.5,
                animation: `cabin-grid-index-sweep ${sweepSeconds}s linear infinite`,
                // Negative delay: the sweep is mid-flight on the first frame.
                animationDelay: `${(index / total) * sweepSeconds - sweepSeconds}s`,
              }}
            />
          ))}
          {first && (
            <rect
              x={cellX(first[1]) - size / 2 - 2.5}
              y={cellY(first[0]) - size / 2 - 2.5}
              width={size + 5}
              height={size + 5}
              rx={2}
              className="fill-none stroke-[var(--accent)]"
              strokeWidth="1"
              strokeDasharray="2 2"
            />
          )}
          {showNumbers && order.map(([row, column], index) => (
            <text
              key={`n-${row}-${column}`}
              x={cellX(column)}
              y={cellY(row) + size * 0.22}
              textAnchor="middle"
              className="pointer-events-none fill-[var(--text)] font-mono"
              style={{ fontSize: Math.min(8, size * 0.6) }}
            >
              {index + 1}
            </text>
          ))}
        </g>
      </svg>
      <span className="pointer-events-none absolute left-1.5 top-1 font-mono text-[8px] text-[var(--text-muted)]">↑ {vAxis}</span>
      <span className="pointer-events-none absolute bottom-1 left-1.5 font-mono text-[8px] text-[var(--text-muted)]">→ {hAxis}</span>
      <span className="pointer-events-none absolute right-1.5 top-1 font-mono text-[8px] tabular-nums text-[var(--text-3)]">GAP {spacing.toFixed(1)}</span>
      <span className="pointer-events-none absolute bottom-1 right-1.5 font-mono text-[8px] tabular-nums text-[var(--text-muted)]">{total} {total === 1 ? 'COPY' : 'COPIES'}</span>
    </div>
  )
}

/** Console-styled spacing slider; the layout preview above is its live readout. */
function SpacingSlider({ b }: { b: NumBinding }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const { def, value, set } = b
  const pct = ((clamp(value, def.min, def.max) - def.min) / (def.max - def.min)) * 100

  const setFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const t = clamp((clientX - rect.left) / rect.width, 0, 1)
    const raw = def.min + t * (def.max - def.min)
    const snapped = Math.round(raw / def.step) * def.step
    set(clamp(Number(snapped.toFixed(8)), def.min, def.max))
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-app)] px-2 py-2">
      <span className="w-[52px] flex-shrink-0 text-[8px] font-semibold tracking-[0.12em] text-[var(--text-3)] select-none">SPACING</span>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={def.label}
        aria-valuemin={def.min}
        aria-valuemax={def.max}
        aria-valuenow={value}
        title="Drag · double-click to reset"
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          setFromClientX(event.clientX)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromClientX(event.clientX)
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onDoubleClick={() => set(def.default)}
        onKeyDown={(event) => {
          if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
          event.preventDefault()
          const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1
          set(clamp(Number((value + direction * def.step).toFixed(8)), def.min, def.max))
        }}
        className="relative h-4 flex-1 cursor-ew-resize touch-none outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
      >
        <span className="absolute left-0 top-1/2 h-[3px] w-full -translate-y-1/2 bg-[var(--border)]" />
        <span className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 bg-[var(--accent-muted)]" style={{ width: `${pct}%` }} />
        <span className="absolute top-1/2 h-[9px] w-[9px] -translate-y-1/2 border border-[var(--border-strong)] bg-[var(--accent-muted)]" style={{ left: `calc(${pct}% - 4px)` }} />
      </div>
      <span className="w-[30px] flex-shrink-0 text-right font-mono text-[10px] tabular-nums text-[var(--text-3)]">{value.toFixed(1)}</span>
    </div>
  )
}

// ── Selects ──────────────────────────────────────────────────────────────────

/** Plane glyph: the grid's footprint as it will be drawn - upright square for
 *  X/Y, foreshortened parallelograms for the depth planes. */
function PlaneGlyph({ value }: { value: number }) {
  const outline = value === 1 ? '3,14 8,6 17,6 12,14' : value === 2 ? '6,3 13,6 13,17 6,14' : '5,4 15,4 15,16 5,16'
  const inner = value === 1 ? 'M5.5 10H14.5M12.5 6L7.5 14' : value === 2 ? 'M9.5 4.5V15.5M6 8.5L13 11.5' : 'M10 4V16M5 10H15'
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.3" aria-hidden="true">
      <polygon points={outline} />
      <path d={inner} opacity="0.55" />
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

/** Indexing glyph: three scan arrows plus a dot at the starting corner. */
function IndexingGlyph({ value }: { value: number }) {
  const horizontal = value === 0 || value === 1
  const reversed = value === 1 || value === 3
  const lanes = horizontal ? [3.5, 8, 12.5] : [4, 11, 18]
  let d = ''
  for (const lane of lanes) {
    if (horizontal) {
      d += reversed
        ? `M19 ${lane}H3.5M7 ${lane - 2.4}L3.5 ${lane}L7 ${lane + 2.4}`
        : `M3 ${lane}H18.5M15 ${lane - 2.4}L18.5 ${lane}L15 ${lane + 2.4}`
    } else {
      d += reversed
        ? `M${lane} 14.5V2.5M${lane - 2.4} 6L${lane} 2.5L${lane + 2.4} 6`
        : `M${lane} 1.5V13.5M${lane - 2.4} 10L${lane} 13.5L${lane + 2.4} 10`
    }
  }
  const [dotX, dotY] = horizontal ? (reversed ? [19, 12.5] : [3, 3.5]) : (reversed ? [18, 14.5] : [4, 1.5])
  return (
    <svg viewBox="0 0 22 16" className="h-3.5 w-[19px] fill-none stroke-current" strokeWidth="1.3" aria-hidden="true">
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={dotX} cy={dotY} r="1.7" className="fill-current stroke-none" />
    </svg>
  )
}

const INDEXING_SHORT: Record<number, string> = { 0: 'ROWS', 1: 'ROWS · REV', 2: 'COLS', 3: 'COLS · REV' }

function IndexingSelector({ b }: { b: SelectBinding }) {
  return (
    <div role="radiogroup" aria-label={b.def.label} className="grid grid-cols-2 gap-1">
      {b.def.options.map((option) => {
        const active = option.value === b.value
        return (
          <button
            key={option.value}
            role="radio"
            aria-checked={active}
            title={`${b.def.label}: ${option.label}`}
            onClick={() => b.set(option.value)}
            className={`flex items-center justify-center gap-1.5 rounded-md border py-1.5 transition-colors ${active
              ? 'border-[var(--accent-muted)] bg-[rgba(53,167,230,0.12)] text-[var(--accent-hover)]'
              : 'border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-3)]'}`}
          >
            <IndexingGlyph value={option.value} />
            <span className="text-[7px] font-semibold tracking-[0.08em]">{INDEXING_SHORT[option.value] ?? option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function GridGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="1.4" aria-hidden="true">
      <path d="M3.5 3.5H16.5V16.5H3.5V3.5M10 3.5V16.5M3.5 10H16.5" />
    </svg>
  )
}

export const GridSplitterUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const pool = bind(parameters)
  const rows = pool.num('rows')
  const columns = pool.num('columns')
  const spacing = pool.num('spacing')
  const plane = pool.select('plane')
  const indexing = pool.select('indexing')

  if (!rows || !columns || !spacing || !plane || !indexing) return <ParameterList parameters={parameters} />
  const rest = pool.rest()

  const r = intValue(rows)
  const c = intValue(columns)
  const resetAll = () => {
    for (const bound of parameters) bound.setValue(bound.definition.default)
  }

  return (
    <section
      data-testid="grid-user-interface"
      className="-mx-1 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] shadow-[0_14px_34px_rgba(0,0,0,.35)]"
    >
      <header className="flex h-9 items-center justify-between px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--accent)]">
            <GridGlyph />
          </div>
          <span className="truncate text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text)]">Grid</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded border border-[var(--border)] bg-[var(--bg-app)] px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-[var(--text-3)]">{r} × {c}</span>
          <button
            aria-label="Reset all Grid parameters"
            title="Reset all"
            onClick={resetAll}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-2)]"
          >
            <RotateCcw size={11} />
          </button>
        </div>
      </header>

      <SizeChooser rows={rows} columns={columns} />

      <div className="grid grid-cols-2 gap-1 p-2">
        <DimStepper b={rows} tag="ROWS" />
        <DimStepper b={columns} tag="COLS" />
      </div>

      <LayoutPreview
        rows={r}
        columns={c}
        spacing={clamp(spacing.value, spacing.def.min, spacing.def.max)}
        planeValue={plane.value}
        indexing={indexing.value}
      />

      <div className="space-y-2 p-2">
        <SpacingSlider b={spacing} />
        <PlaneSelector b={plane} />
        <IndexingSelector b={indexing} />
        {rest.length > 0 && (
          <div className="border-t border-[var(--border-subtle)] pt-2">
            <ParameterList parameters={rest} />
          </div>
        )}
      </div>
    </section>
  )
}
