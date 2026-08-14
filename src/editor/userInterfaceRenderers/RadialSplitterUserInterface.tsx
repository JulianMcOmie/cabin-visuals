'use client'

// Bespoke settings for the Radial splitter, built from the console kit
// (./console) to docs/instrument-panel-design-guide.md (the Grid splitter's
// panel is the nearest sibling - same subject, a LAYOUT):
//
// 1. A live preview window: the splitter's REAL resolve() (no notes - the
//    resting formation is the panel's claim; MIDI bends it) applied to generic
//    cubes, drawn with a plain 2D canvas - no r3f, because a panel <Canvas>
//    stays black until the transport plays (see the renderers CLAUDE.md) and a
//    layout is exactly the thing you dial in while paused. Drag orbits it;
//    until touched it turns on its own. No readouts or captions in the window:
//    the knobs already say the numbers.
// 2. One console row: COPIES / RADIUS (primary) / SIZE knobs and the PLANE
//    segmented control.
//
// The old drag-the-ring pad, header chrome, reset-all and mute map are gone
// (2026-08 rework, same pass that turned the lane into a value lane - see the
// definition's comment in core/visualCopies/library.ts).
//
// Presentation only: every control routes through the passed parameter
// bindings; the preview imports the definition read-only.

import { useEffect, useMemo, useRef } from 'react'
import { mergeDefinitionSettings } from '../core/visualCopies/definitions'
import { RADIAL_COLOR } from '../core/visualCopies/identityColors'
import { radialSplitter, type RadialSettings } from '../core/visualCopies/library'
import { resolveVisualCopies } from '../core/visualCopies/resolveVisualCopies'
import {
  bindPanel,
  Console,
  ControlRow,
  Knob,
  More,
  ParameterList,
  PreviewWindow,
  type NumBinding,
  type SelectBinding,
} from './console'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

// The accent comes FROM THE DEFINITION - the same hue this splitter's timeline
// blocks and piano-roll notes wear.
const ACCENT = RADIAL_COLOR
const PREVIEW_HEIGHT = 140

// ── 3D formation preview ─────────────────────────────────────────────────────
// Same painter-sorted-cube-faces approach as GridSplitterUserInterface: the
// copy matrices carry the slot rotation AND the SIZE scale, so the cubes turn
// around the ring and grow with the knob for free.

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
function resolveLayout(settings: RadialSettings) {
  const copies = resolveVisualCopies([radialSplitter.resolve({ settings, notes: [] })], 0)
  const matrices = copies.map((copy) => copy.transform.elements)
  let reach = 1
  for (const e of matrices) {
    // Basis column length = the copy's scale; the cube extends that far.
    const scale = Math.hypot(e[0], e[1], e[2])
    reach = Math.max(reach, Math.hypot(e[12], e[13], e[14]) + CUBE_HALF * 2 * scale)
  }
  return { matrices, reach }
}

function FormationPreview({ settings }: { settings: RadialSettings }) {
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
    <PreviewWindow height={PREVIEW_HEIGHT} testId="radial-formation-preview" title="Drag to orbit">
      <div
        ref={hostRef}
        className="absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing"
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
    </PreviewWindow>
  )
}

// ── Controls ─────────────────────────────────────────────────────────────────

/** Segmented selector over the plane select's options, in the solid-fill
 *  family (Approach's icon segments are the sibling). */
function PlaneSegmented({ b }: { b: SelectBinding }) {
  return (
    <div className="flex flex-col items-center gap-1" data-testid="radial-plane">
      <div className="flex overflow-hidden rounded-md border border-white/10">
        {b.def.options.map((option) => {
          const active = option.value === b.value
          return (
            <button
              key={option.value}
              aria-label={`${b.def.label}: ${option.label}`}
              aria-pressed={active}
              title={`${b.def.label}: ${option.label}`}
              onClick={() => b.set(option.value)}
              className={`flex h-[22px] min-w-[30px] items-center justify-center px-1.5 text-[8px] font-bold tracking-[0.1em] transition-colors ${
                active ? 'text-black' : 'bg-black/25 text-white/40 hover:text-white/70'
              }`}
              style={active ? { background: ACCENT } : undefined}
            >
              {option.label}
            </button>
          )
        })}
      </div>
      <span className="text-[8px] font-semibold tracking-[0.12em] text-white/40">PLANE</span>
    </div>
  )
}

// ── Renderer ─────────────────────────────────────────────────────────────────

interface RadialBindings {
  copies: NumBinding
  radius: NumBinding
  size: NumBinding
  plane: SelectBinding
  rest: UserInterfaceParameter[]
}

/** Hooks live here, below the renderer's fallback branch. */
function RadialConsole({ bound }: { bound: RadialBindings }) {
  const { copies, radius, size, plane, rest } = bound

  const settings = useMemo(() => ({
    ...(mergeDefinitionSettings(radialSplitter, undefined) as unknown as RadialSettings),
    copies: copies.value,
    radius: radius.value,
    size: size.value,
    plane: plane.value,
  }), [copies.value, radius.value, size.value, plane.value])

  return (
    <Console accent={ACCENT} testId="radial-user-interface">
      <FormationPreview settings={settings} />
      {/* The preview's light spilling through the seam onto the controls. */}
      <ControlRow spill className="justify-center gap-5 px-4 pt-2.5">
        <Knob b={copies} label="COPIES" format={(v) => `${Math.round(v)}`} />
        <Knob b={radius} label="RADIUS" large />
        <Knob b={size} label="SIZE" />
      </ControlRow>
      <div className="flex justify-center px-4 pb-3 pt-2">
        <PlaneSegmented b={plane} />
      </div>
      <More parameters={rest} label="MORE" className="px-4 pb-2" />
    </Console>
  )
}

export const RadialSplitterUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const pool = bindPanel(parameters)
  const copies = pool.num('copies')
  const radius = pool.num('radius')
  const size = pool.num('size')
  const plane = pool.select('plane')

  if (!copies || !radius || !size || !plane) return <ParameterList parameters={parameters} />

  return <RadialConsole bound={{ copies, radius, size, plane, rest: pool.rest() }} />
}
