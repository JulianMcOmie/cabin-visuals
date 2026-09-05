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
// 2. Three rows, in the order the ring is built: the geometry knobs (COPIES /
//    RADIUS primary / SIZE), then the polar modifiers (SWEEP / RISE / TILT -
//    the ring's own nod, a polar modifier even though it moves nothing - plus
//    GROWTH once SHAPE is spiral - the segment is what turns that knob on,
//    exactly as the definition reads it), then the RINGS row, then the three
//    KINDS as segmented controls (SHAPE / PLANE / FACING). Kinds last is
//    Grid's and Line's grammar: amounts first, modifiers, then the selects.
//    The kinds row wraps because eight segments overrun a narrow inspector
//    pane, and a fixed row clips rather than shrinking (Tunnel's lesson).
//    RINGS carries its own four knobs the way SHAPE carries GROWTH: the
//    per-ring amounts render only above one ring, because that is exactly
//    when the definition stops ignoring them (ring 0 anchors all three), and
//    a single ring is the common case that should stay a short panel.
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
import {
  RADIAL_FACING_CENTER,
  RADIAL_FACING_OUTWARD,
  RADIAL_FACING_PATH,
  RADIAL_FACING_UPRIGHT,
  RADIAL_SHAPE_SPIRAL,
  radialSplitter,
  type RadialSettings,
} from '../core/visualCopies/library'
import { resolveVisualCopies } from '../core/visualCopies/resolveVisualCopies'
import {
  bindPanel,
  Console,
  ControlRow,
  Knob,
  More,
  ParameterList,
  PreviewWindow,
  usePreviewLoop,
  type NumBinding,
  type SelectBinding,
} from './console'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'
import { clamp } from '../utils/math'
import { hexToRgb } from '../utils/colors'

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

    return () => { drawImpl.current = null }
    // hostRef is the loop hook's stable ref - listed only to satisfy the lint.
  }, [hostRef])

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

/** Segmented selector over a select param's options, in the solid-fill family
 *  (Approach's icon segments are the sibling), with its name captioned
 *  underneath. The three kinds this panel picks - PLANE, SHAPE, FACING - all
 *  wear it, so the row of them reads as one grammar. */
function KindSegmented({ b, caption, labels, testId }: {
  b: SelectBinding
  caption: string
  /** Short display labels by option value; the def's own label still speaks
   *  through aria-label and the tooltip. */
  labels?: Record<number, string>
  testId?: string
}) {
  return (
    <div className="flex flex-col items-center gap-1" data-testid={testId}>
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
              className={`flex h-[22px] min-w-[30px] items-center justify-center px-1.5 text-[8px] font-bold tracking-[0.1em] ${
                active ? 'text-black' : 'bg-black/25 text-white/40 hover:text-white/70'
              }`}
              style={active ? { background: ACCENT } : undefined}
            >
              {labels?.[option.value] ?? option.label}
            </button>
          )
        })}
      </div>
      <span className="text-[8px] font-semibold tracking-[0.12em] text-white/40">{caption}</span>
    </div>
  )
}

// ── Renderer ─────────────────────────────────────────────────────────────────

interface RadialBindings {
  copies: NumBinding
  radius: NumBinding
  size: NumBinding
  plane: SelectBinding
  sweep: NumBinding | null
  shape: SelectBinding | null
  growth: NumBinding | null
  rise: NumBinding | null
  tilt: NumBinding | null
  facing: SelectBinding | null
  rings: NumBinding | null
  ringSpacing: NumBinding | null
  ringSize: NumBinding | null
  ringDepth: NumBinding | null
  ringTwist: NumBinding | null
  rest: UserInterfaceParameter[]
}

/** Hooks live here, below the renderer's fallback branch. */
function RadialConsole({ bound }: { bound: RadialBindings }) {
  const {
    copies, radius, size, plane, sweep, shape, growth, rise, tilt, facing,
    rings, ringSpacing, ringSize, ringDepth, ringTwist, rest,
  } = bound
  const { value: copiesValue } = copies
  const { value: radiusValue } = radius
  const { value: sizeValue } = size
  const { value: planeValue } = plane
  // Read the optional bindings' VALUES out here: the memo has to depend on the
  // numbers, not on the binding objects (a fresh one arrives every render).
  const sweepValue = sweep?.value
  const shapeValue = shape?.value
  const growthValue = growth?.value
  const riseValue = rise?.value
  const tiltValue = tilt?.value
  const facingValue = facing?.value
  const ringsValue = rings?.value
  const ringSpacingValue = ringSpacing?.value
  const ringSizeValue = ringSize?.value
  const ringDepthValue = ringDepth?.value
  const ringTwistValue = ringTwist?.value
  const spiral = shapeValue === RADIAL_SHAPE_SPIRAL
  // One ring means the definition ignores all three per-ring amounts, so the
  // panel hides them - the RINGS knob is what turns them on.
  const stacked = (ringsValue ?? 1) > 1

  const settings = useMemo(() => {
    const base = mergeDefinitionSettings(radialSplitter, undefined) as unknown as RadialSettings
    return {
      ...base,
      copies: copiesValue,
      radius: radiusValue,
      size: sizeValue,
      plane: planeValue,
      sweep: sweepValue ?? base.sweep,
      shape: shapeValue ?? base.shape,
      growth: growthValue ?? base.growth,
      rise: riseValue ?? base.rise,
      tilt: tiltValue ?? base.tilt,
      facing: facingValue ?? base.facing,
      rings: ringsValue ?? base.rings,
      ringSpacing: ringSpacingValue ?? base.ringSpacing,
      ringSize: ringSizeValue ?? base.ringSize,
      ringDepth: ringDepthValue ?? base.ringDepth,
      ringTwist: ringTwistValue ?? base.ringTwist,
    }
  }, [
    copiesValue, radiusValue, sizeValue, planeValue,
    sweepValue, shapeValue, growthValue, riseValue, tiltValue, facingValue,
    ringsValue, ringSpacingValue, ringSizeValue, ringDepthValue, ringTwistValue,
  ])

  return (
    <Console accent={ACCENT} testId="radial-user-interface">
      <FormationPreview settings={settings} />
      {/* The preview's light spilling through the seam onto the controls. */}
      <ControlRow spill className="justify-center gap-5 px-4 pt-2.5">
        <Knob b={copies} label="COPIES" format={(v) => `${Math.round(v)}`} />
        <Knob b={radius} label="RADIUS" large />
        <Knob b={size} label="SIZE" />
      </ControlRow>
      {/* The polar modifiers: what the ring does on top of being a ring.
          GROWTH renders only in spiral mode - the SHAPE segment is what turns
          it on, matching the definition (a stored growth is inert until then).
          Spiral makes this four knobs, so it WRAPS like the rings row below. */}
      <ControlRow className="flex-wrap justify-center gap-x-5 gap-y-2 px-4 pt-2">
        <Knob b={sweep} label="SWEEP" format={(v) => `${Math.round(v)}°`} />
        <Knob b={rise} label="RISE" bipolar />
        <Knob b={tilt} label="TILT" bipolar format={(v) => `${Math.round(v)}°`} />
        {spiral ? <Knob b={growth} label="GROWTH" /> : null}
      </ControlRow>
      {/* RINGS and, once there is more than one, the four independent per-ring
          amounts: how much further out each ring sits, how much bigger or
          smaller its copies are, how far along the axis it steps and how far
          round it turns. Five knobs overrun a narrow inspector, so this row
          WRAPS (the kinds row's rule) rather than clipping its last knob. */}
      <ControlRow className="flex-wrap justify-center gap-x-5 gap-y-2 px-4 pt-2">
        <Knob b={rings} label="RINGS" format={(v) => `${Math.round(v)}`} />
        {stacked ? <Knob b={ringSpacing} label="SPACING" bipolar /> : null}
        {stacked ? <Knob b={ringSize} label="SCALE" /> : null}
        {stacked ? <Knob b={ringDepth} label="DEPTH" bipolar /> : null}
        {stacked ? <Knob b={ringTwist} label="TWIST" bipolar format={(v) => `${Math.round(v)}°`} /> : null}
      </ControlRow>
      <div className="flex flex-wrap items-start justify-center gap-4 px-4 pb-3 pt-2.5">
        {shape ? <KindSegmented b={shape} caption="SHAPE" testId="radial-shape" /> : null}
        <KindSegmented b={plane} caption="PLANE" testId="radial-plane" />
        {facing ? (
          <KindSegmented
            b={facing}
            caption="FACING"
            labels={{
              [RADIAL_FACING_OUTWARD]: 'OUT',
              [RADIAL_FACING_UPRIGHT]: 'UP',
              [RADIAL_FACING_PATH]: 'PATH',
              [RADIAL_FACING_CENTER]: 'IN',
            }}
            testId="radial-facing"
          />
        ) : null}
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
  // The polar options bind OPTIONALLY, like the shared SIZE knob: a console
  // that requires them falls back to the generic slider list wholesale the day
  // one of them is renamed or retired.
  const sweep = pool.num('sweep', { optional: true })
  const shape = pool.select('shape', { optional: true })
  const growth = pool.num('growth', { optional: true })
  const rise = pool.num('rise', { optional: true })
  const tilt = pool.num('tilt', { optional: true })
  const facing = pool.select('facing', { optional: true })
  const rings = pool.num('rings', { optional: true })
  const ringSpacing = pool.num('ringSpacing', { optional: true })
  const ringSize = pool.num('ringSize', { optional: true })
  const ringDepth = pool.num('ringDepth', { optional: true })
  const ringTwist = pool.num('ringTwist', { optional: true })

  if (!copies || !radius || !size || !plane) return <ParameterList parameters={parameters} />

  return (
    <RadialConsole bound={{
      copies, radius, size, plane, sweep, shape, growth, rise, tilt, facing,
      rings, ringSpacing, ringSize, ringDepth, ringTwist, rest: pool.rest(),
    }} />
  )
}
