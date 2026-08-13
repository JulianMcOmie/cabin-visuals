'use client'

// Bespoke settings for the Line splitter, following
// docs/instrument-panel-design-guide.md. The Radial splitter's console is the
// nearest sibling (same subject, a LAYOUT) and this panel keeps its shape:
//
// 1. A live preview window: the splitter's REAL resolve() (no notes - the
//    resting formation is the panel's claim; MIDI mutes copies out of it)
//    applied to generic cubes, drawn with a plain 2D canvas - no r3f, because
//    a panel <Canvas> stays black until the transport plays (see the renderers
//    CLAUDE.md) and a layout is exactly the thing you dial in while paused.
//    Drag orbits it; until touched it turns on its own. No readouts or
//    captions in the window: the knobs already say the numbers.
// 2. Two console rows: COPIES / SPACING (primary) / GROWTH, then the axis
//    aim - ANGLE / TILT, both bipolar (zero is the dark centered arc).
//
// The GROWTH knob is a LaserKnob driven in LOG2 units (Radial Motion's
// detent-index pattern): the stored param stays an honest ratio 0.5-2 for the
// generic list and automation, while the knob travels log2(ratio) in [-1, 1]
// so ×2 and ×0.5 sit symmetrically about the dark ×1 center - a bipolar arc
// over the raw ratio would put ×1 at a third of the travel and read as ON.
//
// Presentation only: every control routes through the passed parameter
// bindings; the preview imports the definition read-only.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { mergeDefinitionSettings } from '../core/visualCopies/definitions'
import { LINE_COLOR } from '../core/visualCopies/identityColors'
import { lineSplitter, type LineSettings } from '../core/visualCopies/library'
import { resolveVisualCopies } from '../core/visualCopies/resolveVisualCopies'
import { isNumberParam, type NumberParamDef } from '../instruments/types'
import { withAlpha } from './colorWheel'
import { LaserKnob } from './laserKnob'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const ACCENT = LINE_COLOR
// The guide's hue-true dark shade of the accent (never an alpha tint).
const PANEL_SHADE = '#0b1309'
const ROOM = '#05070c'
const PREVIEW_HEIGHT = 140

interface NumBinding { def: NumberParamDef; value: number; set: (v: number) => void }

function bind(parameters: readonly UserInterfaceParameter[]) {
  const pool = new Map(parameters.map((p) => [p.definition.key, p]))
  return {
    num(key: string): NumBinding | null {
      const b = pool.get(key)
      if (!b || !isNumberParam(b.definition) || typeof b.value !== 'number') return null
      pool.delete(key)
      return { def: b.definition, value: b.value, set: b.setValue }
    },
    rest(): UserInterfaceParameter[] { return [...pool.values()] },
  }
}

// ── 3D formation preview ─────────────────────────────────────────────────────
// Same painter-sorted-cube-faces approach as the Radial and Grid panels: the
// copy matrices carry the axis rotation AND the growth scale, so the cubes
// tilt with the line and ramp in size for free.

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

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}

/** The splitter's real output at beat 0 with no notes: copy matrices in slot
 *  order, plus how far the layout reaches (what the camera has to frame). */
function resolveLayout(settings: LineSettings) {
  const copies = resolveVisualCopies([lineSplitter.resolve({ settings, notes: [] })], 0)
  const matrices = copies.map((copy) => copy.transform.elements)
  let reach = 1
  for (const e of matrices) {
    // Basis column length = the copy's scale; the cube extends that far.
    const scale = Math.hypot(e[0], e[1], e[2])
    reach = Math.max(reach, Math.hypot(e[12], e[13], e[14]) + CUBE_HALF * 2 * scale)
  }
  return { matrices, reach }
}

function FormationPreview({ settings }: { settings: LineSettings }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef({ yaw: -0.55, pitch: 0.38, auto: true })
  const dragRef = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null)

  const layout = useMemo(() => resolveLayout(settings), [settings])
  const live = useRef(layout)
  live.current = layout

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const [ar, ag, ab] = hexToRgb(ACCENT)
    let raf = 0

    const draw = () => {
      raf = requestAnimationFrame(draw)
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
      if (view.auto) view.yaw += 0.0035
      const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw)
      const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch)
      const { matrices, reach } = live.current
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

      const faces: { depth: number; points: [number, number, number][]; fill: string }[] = []
      for (const e of matrices) {
        const corners = CUBE_CORNERS.map(([lx, ly, lz]) => rotate(
          e[0] * lx + e[4] * ly + e[8] * lz + e[12],
          e[1] * lx + e[5] * ly + e[9] * lz + e[13],
          e[2] * lx + e[6] * ly + e[10] * lz + e[14],
        ))
        const center = rotate(e[12], e[13], e[14])
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
          const glow = clamp(light * 0.9, 0, 1.2)
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
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div
      ref={hostRef}
      data-testid="line-formation-preview"
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
    </div>
  )
}

// ── Controls ─────────────────────────────────────────────────────────────────

function Knob({ b, label, large = false, bipolar = false, format }: {
  b: NumBinding
  label: string
  large?: boolean
  bipolar?: boolean
  format?: (value: number) => string
}) {
  return (
    <LaserKnob
      value={b.value}
      min={b.def.min}
      max={b.def.max}
      step={b.def.step}
      defaultValue={b.def.default}
      curve={b.def.curve ?? 1}
      label={label}
      ariaLabel={b.def.label}
      accent={ACCENT}
      large={large}
      bipolar={bipolar}
      format={format}
      onChange={b.set}
    />
  )
}

/** The stored ratio param behind a knob travelling log2(ratio), so the ×1
 *  neutral sits at the bipolar arc's dark center and ×2/×0.5 mirror exactly. */
function GrowthKnob({ b }: { b: NumBinding }) {
  return (
    <LaserKnob
      value={Math.log2(clamp(b.value, b.def.min, b.def.max))}
      min={Math.log2(b.def.min)}
      max={Math.log2(b.def.max)}
      step={0.02}
      defaultValue={Math.log2(b.def.default)}
      label="GROWTH"
      ariaLabel={b.def.label}
      accent={ACCENT}
      bipolar
      format={(v) => `×${Math.pow(2, v).toFixed(2)}`}
      onChange={(v) => b.set(Number(Math.pow(2, v).toFixed(2)))}
    />
  )
}

// ── Renderer ─────────────────────────────────────────────────────────────────

interface LineBindings {
  copies: NumBinding
  spacing: NumBinding
  growth: NumBinding
  angle: NumBinding
  tilt: NumBinding
  rest: UserInterfaceParameter[]
}

/** Hooks live here, below the renderer's fallback branch. */
function LineConsole({ bound }: { bound: LineBindings }) {
  const { copies, spacing, growth, angle, tilt, rest } = bound
  const [showMore, setShowMore] = useState(false)

  const settings = useMemo(() => ({
    ...(mergeDefinitionSettings(lineSplitter, undefined) as unknown as LineSettings),
    copies: copies.value,
    spacing: spacing.value,
    growth: growth.value,
    angle: angle.value,
    tilt: tilt.value,
  }), [copies.value, spacing.value, growth.value, angle.value, tilt.value])

  return (
    <section data-testid="line-user-interface" className="-mx-3 -mt-3" style={{ background: PANEL_SHADE }}>
      <FormationPreview settings={settings} />
      {/* The preview's light spilling through the seam onto the controls. */}
      <div
        className="pointer-events-none h-0"
        style={{ background: `radial-gradient(58% 30px at 50% 0, ${withAlpha(ACCENT, 0.14)}, transparent)` }}
      />
      <div className="flex items-end justify-center gap-5 px-4 pt-2.5">
        <Knob b={copies} label="COPIES" format={(v) => `${Math.round(v)}`} />
        <Knob b={spacing} label="SPACING" large />
        <GrowthKnob b={growth} />
      </div>
      <div className="flex items-end justify-center gap-5 px-4 pb-1 pt-2">
        <Knob b={angle} label="ANGLE" bipolar format={(v) => `${Math.round(v)}°`} />
        <Knob b={tilt} label="TILT" bipolar format={(v) => `${Math.round(v)}°`} />
      </div>
      <div className="px-4 pb-3">
        {rest.length > 0 && (
          <>
            <button
              aria-expanded={showMore}
              onClick={() => setShowMore((v) => !v)}
              className="flex items-center gap-1 text-[8px] font-bold tracking-[0.18em] text-white/30 transition-colors hover:text-white/60"
            >
              {showMore ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
              MORE
            </button>
            {showMore && (
              <div className="mt-1.5 rounded-md border border-white/[0.06] bg-black/25 p-2">
                <ParameterList parameters={rest} />
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

export const LineSplitterUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const pool = bind(parameters)
  const copies = pool.num('copies')
  const spacing = pool.num('spacing')
  const growth = pool.num('growth')
  const angle = pool.num('angle')
  const tilt = pool.num('tilt')

  if (!copies || !spacing || !growth || !angle || !tilt) return <ParameterList parameters={parameters} />

  return <LineConsole bound={{ copies, spacing, growth, angle, tilt, rest: pool.rest() }} />
}
