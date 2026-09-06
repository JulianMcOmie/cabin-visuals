'use client'

// Bespoke settings for the Grid splitter, following
// docs/instrument-panel-design-guide.md (Laser Sphere is the reference,
// Radial Motion the nearest sibling with a matrix of same-question knobs).
//
// The old panel's Word-table drag chooser is gone. The layout is now:
//
// 1. A live preview window: the splitter's REAL resolve() (no notes) applied to
//   a single generic cube, drawn with a plain 2D canvas - no r3f, because a
//   panel <Canvas> stays black until the transport plays (see the renderers
//   CLAUDE.md) and a layout is exactly the thing you dial in while paused.
//   Drag orbits it; until touched it turns on its own. An index pulse sweeps
//   the copies in slot order, so the four indexing modes read differently.
// 2. Three vertical strips, one per dimension (columns / rows / depth), each
//   labelled with the world axis it drives: a grid-vs-circular segmented
//   control on top, then a COUNT knob, then - only while circular - a RADIUS
//   knob.
// 3. A bottom row: SPACING knob, plane select, indexing select.
//
// Presentation only: every control routes through the passed parameter
// bindings; the preview imports the definition read-only.

import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { mergeDefinitionSettings } from '../core/visualCopies/definitions'
import { GRID_COLOR } from '../core/visualCopies/identityColors'
import { gridSplitter, type GridSettings } from '../core/visualCopies/library'
import { resolveVisualCopies } from '../core/visualCopies/resolveVisualCopies'
import { withAlpha } from './colorWheel'
import { bindPanel, Knob, usePreviewLoop, type NumBinding, type SelectBinding } from './console'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'
import { clamp } from '../utils/math'
import { hexToRgb } from '../utils/colors'

const ACCENT = GRID_COLOR
// The guide's hue-true dark shade of the accent (never an alpha tint).
const PANEL_SHADE = '#130a0f'
const ROOM = '#05070c'
const PREVIEW_HEIGHT = 148
/** Above this copy count the preview drops from lit cubes to points. */
const CUBE_BUDGET = 360

// ── 3D layout preview ────────────────────────────────────────────────────────

const CUBE_HALF = 0.3
/** Local cube corners, bit-indexed (bit0 = +X, bit1 = +Y, bit2 = +Z). */
const CUBE_CORNERS = Array.from({ length: 8 }, (_, i) => [
  i & 1 ? CUBE_HALF : -CUBE_HALF,
  i & 2 ? CUBE_HALF : -CUBE_HALF,
  i & 4 ? CUBE_HALF : -CUBE_HALF,
])
const CUBE_FACES = [
  [1, 5, 7, 3], [0, 2, 6, 4], [2, 3, 7, 6], [0, 4, 5, 1], [4, 6, 7, 5], [0, 1, 3, 2],
]

/** The splitter's real output at beat 0 with no notes: copy matrices in slot
 *  order, plus how far the layout reaches (what the camera has to frame). */
function resolveLayout(settings: GridSettings) {
  const copies = resolveVisualCopies([gridSplitter.resolve({ settings, notes: [] })], 0)
  const matrices = copies.map((copy) => copy.transform.elements)
  let reach = 1
  for (const e of matrices) {
    // Basis column length = the copy's scale, so a big SIZE stays framed
    // instead of growing out through the window's edges.
    const scale = Math.hypot(e[0], e[1], e[2])
    reach = Math.max(reach, Math.hypot(e[12], e[13], e[14]) + CUBE_HALF * 2 * scale)
  }
  return { matrices, reach }
}

function LayoutPreview({ settings }: { settings: GridSettings }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef({ yaw: -0.55, pitch: 0.38, auto: true })
  const dragRef = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null)

  const layout = useMemo(() => resolveLayout(settings), [settings])
  const live = useRef(layout)
  live.current = layout

  // The draw closes over the 2D context built in the effect; the shared loop
  // (~30fps, offscreen-gated) calls whatever the current mount stashed here.
  const drawImpl = useRef<((tSec: number) => void) | null>(null)
  const hostRef = usePreviewLoop<HTMLDivElement>((tSec) => drawImpl.current?.(tSec))

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const [ar, ag, ab] = hexToRgb(ACCENT)
    // The auto-orbit advances by elapsed TIME, not by frame count, so the
    // shared loop's frame rate is not also the orbit's speed.
    let lastT = 0

    drawImpl.current = (tSec: number) => {
      const dt = tSec - lastT
      lastT = tSec
      const host = hostRef.current
      if (!host) return
      // Size is re-derived per frame (the pane is user-resizable, and
      // ResizeObserver callbacks starve in a hidden pane).
      const w = host.clientWidth
      const h = host.clientHeight
      if (w === 0 || h === 0) return
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const view = viewRef.current
      if (view.auto) view.yaw += 0.21 * dt // 0.0035/frame at the old 60fps
      const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw)
      const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch)
      const { matrices, reach } = live.current
      const total = matrices.length
      const pxScale = (Math.min(w, h) * 0.42) / reach
      const camera = reach * 3.5
      const cx = w / 2, cyPx = h / 2

      // View-rotate (yaw about Y, then pitch about X); camera on +Z.
      const rotate = (x: number, y: number, z: number): [number, number, number] => {
        const x1 = cy * x + sy * z
        const z1 = -sy * x + cy * z
        return [x1, cp * y - sp * z1, sp * y + cp * z1]
      }
      const project = (p: [number, number, number]): [number, number, number] => {
        const f = camera / Math.max(camera - p[2], camera * 0.2)
        return [cx + p[0] * pxScale * f, cyPx - p[1] * pxScale * f, f]
      }

      // The index pulse: a slot-order sweep so the indexing modes are visibly
      // different. Panel chrome may run on wall time - the pause invariant
      // governs the rendered visual, not the console.
      const period = clamp(total * 0.14, 1.8, 6)
      const phase = (tSec % period) / period * total
      const pulse = (slot: number) => {
        const d = Math.min(Math.abs(slot - phase), total - Math.abs(slot - phase))
        return Math.exp(-d * d * 2)
      }

      if (total <= CUBE_BUDGET) {
        // Generic cubes with the real copy orientation: circular dimensions
        // turn each copy to face around its ring, and that should be visible.
        const faces: { depth: number; points: [number, number, number][]; fill: string }[] = []
        for (let slot = 0; slot < total; slot++) {
          const e = matrices[slot]
          const corners = CUBE_CORNERS.map(([lx, ly, lz]) => rotate(
            e[0] * lx + e[4] * ly + e[8] * lz + e[12],
            e[1] * lx + e[5] * ly + e[9] * lz + e[13],
            e[2] * lx + e[6] * ly + e[10] * lz + e[14],
          ))
          const center = rotate(e[12], e[13], e[14])
          const boost = pulse(slot)
          for (const face of CUBE_FACES) {
            let fx = 0, fy = 0, fz = 0
            for (const i of face) { fx += corners[i][0]; fy += corners[i][1]; fz += corners[i][2] }
            fx /= 4; fy /= 4; fz /= 4
            // Outward normal straight from the geometry (centroid minus cube
            // center) - immune to winding mistakes, and exact for a cube.
            const nl = Math.hypot(fx - center[0], fy - center[1], fz - center[2]) || 1
            const nx = (fx - center[0]) / nl, ny = (fy - center[1]) / nl, nz = (fz - center[2]) / nl
            if (nz <= 0.02) continue
            const light = 0.28 + 0.72 * Math.max(0, nx * -0.33 + ny * 0.62 + nz * 0.71)
            const glow = clamp(light * (0.55 + 0.45 * boost) + boost * 0.25, 0, 1.2)
            faces.push({
              depth: fz,
              points: face.map((i) => project(corners[i])),
              fill: `rgb(${Math.round(ar * glow)},${Math.round(ag * glow)},${Math.round(ab * glow)})`,
            })
          }
        }
        faces.sort((a, b) => a.depth - b.depth)
        for (const face of faces) {
          ctx.beginPath()
          ctx.moveTo(face.points[0][0], face.points[0][1])
          for (let i = 1; i < 4; i++) ctx.lineTo(face.points[i][0], face.points[i][1])
          ctx.closePath()
          ctx.fillStyle = face.fill
          ctx.fill()
          ctx.strokeStyle = 'rgba(0,0,0,0.35)'
          ctx.lineWidth = 0.5
          ctx.stroke()
        }
      } else {
        // Point cloud past the cube budget: position + depth cue only.
        for (let slot = 0; slot < total; slot++) {
          const e = matrices[slot]
          const [px, py, f] = project(rotate(e[12], e[13], e[14]))
          const a = clamp(0.25 + 0.45 * f + pulse(slot) * 0.5, 0, 1)
          ctx.fillStyle = `rgba(${ar},${ag},${ab},${a.toFixed(3)})`
          const size = clamp(2.4 * f, 1, 4)
          ctx.fillRect(px - size / 2, py - size / 2, size, size)
        }
      }

      // Axis gizmo, so the strips' X/Y/Z captions point at something.
      const gx = 16, gy = h - 16, gr = 11
      ctx.font = '7px ui-monospace, monospace'
      for (const [axis, label] of [[0, 'X'], [1, 'Y'], [2, 'Z']] as const) {
        const dir = rotate(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0)
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(gx, gy)
        ctx.lineTo(gx + dir[0] * gr, gy - dir[1] * gr)
        ctx.stroke()
        ctx.fillStyle = 'rgba(255,255,255,0.55)'
        ctx.fillText(label, gx + dir[0] * (gr + 3) - 2, gy - dir[1] * (gr + 3) + 2)
      }
    }

    return () => { drawImpl.current = null }
    // hostRef is the loop hook's stable ref - listed only to satisfy the lint.
  }, [hostRef])

  const dims = `${Math.round(settings.rows)} × ${Math.round(settings.columns)} × ${Math.round(settings.depth)}`
  const total = layout.matrices.length

  return (
    <div
      ref={hostRef}
      data-testid="grid-layout-preview"
      title="Drag to orbit"
      className="relative w-full cursor-grab touch-none select-none overflow-hidden border-b border-white/[0.06] active:cursor-grabbing"
      style={{ height: PREVIEW_HEIGHT, background: ROOM }}
      onPointerDown={(event) => {
        event.preventDefault()
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
        const view = viewRef.current
        view.auto = false
        dragRef.current = { x: event.clientX, y: event.clientY, yaw: view.yaw, pitch: view.pitch }
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current
        if (!drag) return
        viewRef.current.yaw = drag.yaw + (event.clientX - drag.x) * 0.01
        viewRef.current.pitch = clamp(drag.pitch + (event.clientY - drag.y) * 0.01, -1.35, 1.35)
      }}
      onPointerUp={(event) => {
        dragRef.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
      <span className="pointer-events-none absolute right-1.5 top-1 font-mono text-[8px] tabular-nums text-white/45">{dims}</span>
      <span className="pointer-events-none absolute bottom-1 right-1.5 font-mono text-[8px] tabular-nums text-white/45">
        {total} {total === 1 ? 'COPY' : 'COPIES'}
      </span>
    </div>
  )
}

// ── Controls ─────────────────────────────────────────────────────────────────

/** Linear run: dots along a line. */
function GridModeGlyph() {
  return (
    <svg viewBox="0 0 20 14" className="h-3.5 w-5 fill-current" aria-hidden="true">
      <circle cx="3.5" cy="7" r="1.8" />
      <circle cx="10" cy="7" r="1.8" />
      <circle cx="16.5" cy="7" r="1.8" />
    </svg>
  )
}

/** The same count wrapped into a ring. */
function CircularModeGlyph() {
  const dots = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2
    return [10 + Math.cos(a) * 4.6, 7 + Math.sin(a) * 4.6]
  })
  return (
    <svg viewBox="0 0 20 14" className="h-3.5 w-5 fill-current" aria-hidden="true">
      {dots.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.5" />)}
    </svg>
  )
}

function ModeControl({ b, axis }: { b: SelectBinding; axis: string }) {
  return (
    <div role="radiogroup" aria-label={`${axis} axis layout`} className="grid w-full grid-cols-2 gap-px overflow-hidden rounded-md border border-white/[0.08]">
      {b.def.options.map((option) => {
        const active = option.value === b.value
        return (
          <button
            key={option.value}
            role="radio"
            aria-checked={active}
            title={`${axis}: ${option.label}`}
            onClick={() => b.set(option.value)}
            className="flex items-center justify-center py-1 "
            style={active
              ? { background: withAlpha(ACCENT, 0.16), color: ACCENT }
              : { background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.35)' }}
          >
            {option.value === 1 ? <CircularModeGlyph /> : <GridModeGlyph />}
          </button>
        )
      })}
    </div>
  )
}

/** One dimension's vertical strip: axis caption, grid/circular segmented
 *  control, COUNT knob, and (while circular) the RADIUS knob. The radius gate
 *  lives HERE: the mover branch of TrackEditor passes showIf-gated params
 *  through unfiltered (only the instrument branch filters), so the binding is
 *  present in both modes and display is the panel's own decision. */
function AxisStrip({ axis, role, mode, count, radius }: {
  axis: string
  role: string
  mode: SelectBinding
  count: NumBinding
  radius: NumBinding | null
}) {
  const circular = mode.value === 1
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-md border border-white/[0.06] bg-black/25 px-1 pb-1.5 pt-1">
      <div className="flex items-baseline gap-1">
        <span className="text-[11px] font-bold" style={{ color: ACCENT }}>{axis}</span>
        <span className="text-[7px] font-semibold tracking-[0.14em] text-white/35">{role}</span>
      </div>
      <ModeControl b={mode} axis={axis} />
      <Knob b={count} label="COUNT" accent={ACCENT} format={(v) => `${Math.round(v)}`} />
      {circular && radius && (
        <Knob b={radius} label="RADIUS" accent={ACCENT} />
      )}
    </div>
  )
}

/** Plane glyph: the grid's footprint - upright square for X/Y, foreshortened
 *  parallelograms for the depth planes. */
function PlaneGlyph({ value }: { value: number }) {
  const outline = value === 1 ? '3,14 8,6 17,6 12,14' : value === 2 ? '6,3 13,6 13,17 6,14' : '5,4 15,4 15,16 5,16'
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="1.3" aria-hidden="true">
      <polygon points={outline} />
    </svg>
  )
}

/** Indexing glyph: a scan arrow plus a dot at the starting corner. */
function IndexingGlyph({ value }: { value: number }) {
  const horizontal = value === 0 || value === 1
  const reversed = value === 1 || value === 3
  const d = horizontal
    ? reversed ? 'M17 8H4M8 4.8L4 8L8 11.2' : 'M3 8H16M12 4.8L16 8L12 11.2'
    : reversed ? 'M10 14V3M6.8 7L10 3L13.2 7' : 'M10 2V13M6.8 9L10 13L13.2 9'
  const [dotX, dotY] = horizontal ? (reversed ? [17, 8] : [3, 8]) : (reversed ? [10, 14] : [10, 2])
  return (
    <svg viewBox="0 0 20 16" className="h-3.5 w-4 fill-none stroke-current" strokeWidth="1.4" aria-hidden="true">
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={dotX} cy={dotY} r="1.6" className="fill-current stroke-none" />
    </svg>
  )
}

function IconRadioRow({ b, glyph }: { b: SelectBinding; glyph: (value: number) => ReactNode }) {
  return (
    <div role="radiogroup" aria-label={b.def.label} className="flex gap-px overflow-hidden rounded-md border border-white/[0.08]">
      {b.def.options.map((option) => {
        const active = option.value === b.value
        return (
          <button
            key={option.value}
            role="radio"
            aria-checked={active}
            title={`${b.def.label}: ${option.label}`}
            onClick={() => b.set(option.value)}
            className="flex h-6 w-6 items-center justify-center "
            style={active
              ? { background: withAlpha(ACCENT, 0.16), color: ACCENT }
              : { background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.35)' }}
          >
            {glyph(option.value)}
          </button>
        )
      })}
    </div>
  )
}

// ── Renderer ─────────────────────────────────────────────────────────────────

const AXIS_LETTERS = ['X', 'Y', 'Z']
// Mirrors GRID_PLANES in library.ts: [horizontal, vertical] world axes.
const PLANE_AXES: [number, number][] = [[0, 1], [0, 2], [1, 2]]

interface GridBindings {
  rows: NumBinding
  columns: NumBinding
  depth: NumBinding
  spacing: NumBinding
  size: NumBinding | null
  columnsMode: SelectBinding
  rowsMode: SelectBinding
  depthMode: SelectBinding
  columnsRadius: NumBinding | null
  rowsRadius: NumBinding | null
  depthRadius: NumBinding | null
  plane: SelectBinding
  indexing: SelectBinding
  rest: UserInterfaceParameter[]
}

/** Hooks live here, below the renderer's fallback branch. */
function GridConsole({ bound }: { bound: GridBindings }) {
  const {
    rows, columns, depth, spacing, size, columnsMode, rowsMode, depthMode,
    columnsRadius, rowsRadius, depthRadius, plane, indexing, rest,
  } = bound

  const sizeValue = size?.value
  const columnsRadiusValue = columnsRadius?.value
  const rowsRadiusValue = rowsRadius?.value
  const depthRadiusValue = depthRadius?.value
  const settings = useMemo(() => ({
    ...(mergeDefinitionSettings(gridSplitter, undefined) as unknown as GridSettings),
    rows: rows.value,
    columns: columns.value,
    depth: depth.value,
    spacing: spacing.value,
    plane: plane.value,
    indexing: indexing.value,
    columnsMode: columnsMode.value,
    rowsMode: rowsMode.value,
    depthMode: depthMode.value,
    ...(sizeValue !== undefined ? { size: sizeValue } : {}),
    ...(columnsRadiusValue !== undefined ? { columnsRadius: columnsRadiusValue } : {}),
    ...(rowsRadiusValue !== undefined ? { rowsRadius: rowsRadiusValue } : {}),
    ...(depthRadiusValue !== undefined ? { depthRadius: depthRadiusValue } : {}),
  }), [
    rows.value, columns.value, depth.value, spacing.value, plane.value, indexing.value,
    columnsMode.value, rowsMode.value, depthMode.value,
    sizeValue, columnsRadiusValue, rowsRadiusValue, depthRadiusValue,
  ])

  const [horizontalAxis, verticalAxis] = PLANE_AXES[plane.value] ?? PLANE_AXES[0]
  const normalAxis = 3 - horizontalAxis - verticalAxis

  return (
    <section data-testid="grid-user-interface" className="-mx-3 -mt-3" style={{ background: PANEL_SHADE }}>
      <LayoutPreview settings={settings} />
      {/* The preview's light spilling through the seam onto the controls. */}
      <div
        className="pointer-events-none h-0"
        style={{ background: `radial-gradient(58% 30px at 50% 0, ${withAlpha(ACCENT, 0.14)}, transparent)` }}
      />
      <div className="grid grid-cols-3 gap-1 px-2 pt-2">
        <AxisStrip axis={AXIS_LETTERS[horizontalAxis]} role="COLS" mode={columnsMode} count={columns} radius={columnsRadius} />
        <AxisStrip axis={AXIS_LETTERS[verticalAxis]} role="ROWS" mode={rowsMode} count={rows} radius={rowsRadius} />
        <AxisStrip axis={AXIS_LETTERS[normalAxis]} role="DEPTH" mode={depthMode} count={depth} radius={depthRadius} />
      </div>
      <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1.5">
        {/* The two independent axes of the layout, side by side: SPACING moves
            the cells apart, SIZE grows them in place. */}
        <div className="flex items-center gap-3">
          <Knob b={spacing} label="SPACING" ariaLabel="SPACING" accent={ACCENT} />
          <Knob b={size} label="SIZE" accent={ACCENT} />
        </div>
        <div className="flex flex-col items-end gap-1">
          <IconRadioRow b={plane} glyph={(value) => <PlaneGlyph value={value} />} />
          <IconRadioRow b={indexing} glyph={(value) => <IndexingGlyph value={value} />} />
        </div>
      </div>
      {rest.length > 0 && (
        <div className="border-t border-white/[0.06] px-2 pb-2 pt-2">
          <ParameterList parameters={rest} />
        </div>
      )}
    </section>
  )
}

export const GridSplitterUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const pool = bindPanel(parameters)
  const rows = pool.num('rows')
  const columns = pool.num('columns')
  const depth = pool.num('depth')
  const spacing = pool.num('spacing')
  // Optional binding, like the radii below: the console must still render if a
  // definition ever ships without the shared SIZE knob.
  const size = pool.num('size', { optional: true })
  const columnsMode = pool.select('columnsMode')
  const rowsMode = pool.select('rowsMode')
  const depthMode = pool.select('depthMode')
  // showIf-gated on their mode. The mover branch of TrackEditor passes gated
  // params through today, but keep these OPTIONAL: listing them in the
  // fallback check would silently drop the whole console if that ever changes.
  const columnsRadius = pool.num('columnsRadius', { optional: true })
  const rowsRadius = pool.num('rowsRadius', { optional: true })
  const depthRadius = pool.num('depthRadius', { optional: true })
  const plane = pool.select('plane')
  const indexing = pool.select('indexing')

  if (!rows || !columns || !depth || !spacing || !columnsMode || !rowsMode || !depthMode || !plane || !indexing) {
    return <ParameterList parameters={parameters} />
  }

  return (
    <GridConsole bound={{
      rows, columns, depth, spacing, size, columnsMode, rowsMode, depthMode,
      columnsRadius, rowsRadius, depthRadius, plane, indexing, rest: pool.rest(),
    }} />
  )
}
