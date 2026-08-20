'use client'

// Bespoke settings for the Symmetric Rotation mover, built on the console kit
// per docs/instrument-panel-design-guide.md and the 2026-08-15 mock round
// (live-grid preview · ramp-glyph falloff · bipolar channel strips ·
// essentials + MORE · no note map). The layout leads with the picture: a wall
// of copies run through the mover's REAL resolve(), so FALLOFF - the param
// that makes this a twist deformer rather than a rigid turn - is understood
// by watching the wall shear, not by reading option names. Params a mode
// doesn't read are simply absent (the mover branch hands every param over
// regardless of `showIf`; the gating lives here).

import { useEffect, useMemo, useRef } from 'react'
import { mergeDefinitionSettings } from '../core/visualCopies/definitions'
import { SYMMETRIC_ROTATION_COLOR } from '../core/visualCopies/identityColors'
import {
  resolveSymmetryAxis,
  symmetricRotationMover,
  SYMMETRIC_ROTATION_DRIVE_MIDI,
  SYMMETRIC_ROTATION_MODE_BURST,
  SYMMETRIC_ROTATION_MODE_CONSTANT,
  SYMMETRIC_ROTATION_MODE_OSCILLATE,
  type SymmetricRotationSettings,
} from '../core/visualCopies/symmetricRotation'
import { identityVisualCopy } from '../core/visualCopies/identityVisualCopy'
import type { ResolvedNote } from '../core/visual/types'
import { ParamControl } from './ParameterControl'
import {
  bindPanel,
  Console,
  ControlRow,
  Knob,
  More,
  ParameterList,
  PreviewWindow,
  Segmented,
  usePreviewLoop,
  type NumBinding,
  type SelectBinding,
} from './console'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'
import { clamp } from '../utils/math'
import { hexToRgb } from '../utils/colors'

// The accent comes FROM THE DEFINITION - the same cornflower this mover's
// timeline blocks and piano-roll notes wear.
const ACCENT = SYMMETRIC_ROTATION_COLOR

// ── Live preview: a wall of copies through the real resolve ─────────────────

/** 5×5 wall in the XY plane, spacing 1 - enough extent either side of every
 *  axis choice for all four falloffs to read differently. */
const WALL = (() => {
  const seats: [number, number, number][] = []
  for (let y = 2; y >= -2; y--) for (let x = -2; x <= 2; x++) seats.push([x, y, 0])
  return seats
})()
const CUBE_HALF = 0.24
/** Local cube corners, bit-indexed (bit0 = +X, bit1 = +Y, bit2 = +Z). */
const CUBE_CORNERS = Array.from({ length: 8 }, (_, i) => [
  i & 1 ? CUBE_HALF : -CUBE_HALF,
  i & 2 ? CUBE_HALF : -CUBE_HALF,
  i & 4 ? CUBE_HALF : -CUBE_HALF,
])
const CUBE_FACES = [
  [1, 5, 7, 3], [0, 2, 6, 4], [2, 3, 7, 6], [0, 4, 5, 1], [4, 6, 7, 5], [0, 1, 3, 2],
]

function demoNote(beat: number, pitch: number, durationBeats: number): ResolvedNote {
  return { beat, blockStartBeat: 0, blockEndBeat: 1e9, pitch, velocity: 1, durationBeats }
}

/** The demo phrase per mode. Amount plays NOTHING on purpose - the knobs ARE
 *  the pose, and a static wall that answers the knobs live is that mode's
 *  actual claim (Radial Motion's no-notes preview reasoning). Constant on
 *  auto-drive also plays nothing: an empty lane spinning is that cell's claim;
 *  MIDI-only drive gets a held note so the window isn't dead. */
function demoPhrase(mode: number, drive: number): { notes: ResolvedNote[]; loopBeats: number } {
  if (mode === SYMMETRIC_ROTATION_MODE_BURST) {
    // One hit per channel row the knobs have dialled in; 4-beat loop.
    return { notes: [demoNote(0.5, 60, 1), demoNote(2.5, 62, 1)], loopBeats: 4 }
  }
  if (mode === SYMMETRIC_ROTATION_MODE_CONSTANT) {
    return drive === SYMMETRIC_ROTATION_DRIVE_MIDI
      ? { notes: [demoNote(0, 60, 1e9)], loopBeats: 0 }
      : { notes: [], loopBeats: 0 }
  }
  if (mode === SYMMETRIC_ROTATION_MODE_OSCILLATE) {
    return { notes: [demoNote(0, 60, 1e9)], loopBeats: 0 }
  }
  return { notes: [], loopBeats: 0 }
}

function TwistPreview({ settings }: { settings: SymmetricRotationSettings }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef({ yaw: -0.5, pitch: 0.3, auto: true })
  const dragRef = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null)

  const scene = useMemo(() => {
    const { notes, loopBeats } = demoPhrase(settings.mode, settings.drive)
    return {
      entry: symmetricRotationMover.resolve({ settings, notes }),
      axis: resolveSymmetryAxis(settings),
      center: [settings.centerX ?? 0, settings.centerY ?? 0, settings.centerZ ?? 0] as const,
      loopBeats,
    }
  }, [settings])
  const live = useRef(scene)
  live.current = scene

  // The draw closes over the 2D context built in the effect; the shared loop
  // (~30fps, offscreen-gated) calls whatever the current mount stashed here.
  const drawImpl = useRef<((tSec: number) => void) | null>(null)
  const hostRef = usePreviewLoop<HTMLDivElement>((tSec) => drawImpl.current?.(tSec))

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const [ar, ag, ab] = hexToRgb(ACCENT)

    drawImpl.current = (tSec: number) => {
      const now = tSec * 1000
      const host = hostRef.current
      if (!host) return
      // Size re-derived per frame: the pane is user-resizable and
      // ResizeObserver callbacks starve in a hidden pane.
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
      if (view.auto) view.yaw = -0.5 + Math.sin(now / 6000) * 0.28
      const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw)
      const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch)
      const { entry, axis, center, loopBeats } = live.current
      // Panel chrome may run on wall time - the pause invariant governs the
      // rendered visual, not the console. ~120bpm feel.
      const t = now / 500
      const beat = loopBeats > 0 ? t % loopBeats : t

      const reach = 3.4
      const pxScale = (Math.min(w, h) * 0.46) / reach
      const camera = reach * 3.5
      const cx = w / 2, cyPx = h / 2

      const rotate = (x: number, y: number, z: number): [number, number, number] => {
        const x1 = cy * x + sy * z
        const z1 = -sy * x + cy * z
        return [x1, cp * y - sp * z1, sp * y + cp * z1]
      }
      const project = (p: [number, number, number]): [number, number] => {
        const f = camera / Math.max(camera - p[2], camera * 0.2)
        return [cx + p[0] * pxScale * f, cyPx - p[1] * pxScale * f]
      }

      // The symmetry axis, drawn faintly through its center so the AXIS and
      // aim controls point at something.
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'
      ctx.setLineDash([3, 4])
      ctx.lineWidth = 1
      ctx.beginPath()
      const a0 = project(rotate(center[0] - axis.x * reach, center[1] - axis.y * reach, center[2] - axis.z * reach))
      const a1 = project(rotate(center[0] + axis.x * reach, center[1] + axis.y * reach, center[2] + axis.z * reach))
      ctx.moveTo(a0[0], a0[1])
      ctx.lineTo(a1[0], a1[1])
      ctx.stroke()
      ctx.setLineDash([])

      // Every seat through the mover's real apply(), then painter-sorted
      // cube faces - the copy's true orientation is the whole subject.
      const faces: { depth: number; points: [number, number][]; fill: string }[] = []
      WALL.forEach(([sx2, sy2, sz2], index) => {
        const seed = identityVisualCopy()
        seed.transform.setPosition(sx2, sy2, sz2)
        const [copy] = entry.apply(seed, { beat, index, count: WALL.length, formation: [] })
        if (!copy) return
        const e = copy.transform.elements
        const corners = CUBE_CORNERS.map(([lx, ly, lz]) => rotate(
          e[0] * lx + e[4] * ly + e[8] * lz + e[12],
          e[1] * lx + e[5] * ly + e[9] * lz + e[13],
          e[2] * lx + e[6] * ly + e[10] * lz + e[14],
        ))
        const centerPoint = rotate(e[12], e[13], e[14])
        for (const face of CUBE_FACES) {
          let fx = 0, fy = 0, fz = 0
          for (const i of face) { fx += corners[i][0]; fy += corners[i][1]; fz += corners[i][2] }
          fx /= 4; fy /= 4; fz /= 4
          const nl = Math.hypot(fx - centerPoint[0], fy - centerPoint[1], fz - centerPoint[2]) || 1
          const nz = (fz - centerPoint[2]) / nl
          if (nz <= 0.02) continue
          const nx = (fx - centerPoint[0]) / nl, ny = (fy - centerPoint[1]) / nl
          const light = clamp(0.3 + 0.7 * Math.max(0, nx * -0.33 + ny * 0.62 + nz * 0.71), 0, 1)
          faces.push({
            depth: fz,
            points: face.map((i) => project(corners[i])),
            fill: `rgb(${Math.round(ar * light)},${Math.round(ag * light)},${Math.round(ab * light)})`,
          })
        }
      })
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
    <PreviewWindow height={118} testId="symmetric-rotation-window" title="Drag to orbit" className="cursor-grab touch-none select-none active:cursor-grabbing">
      <div
        ref={hostRef}
        className="h-full w-full"
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
      <span className="pointer-events-none absolute bottom-1 left-1.5 font-mono text-[8px] text-white/40">
        POSITION PICKS EACH COPY&apos;S SHARE
      </span>
    </PreviewWindow>
  )
}

// ── Controls ─────────────────────────────────────────────────────────────────

/** The four falloff ramps as pictures: weight (vertical) against position
 *  (horizontal, axis at the middle). ALONG's sign flip across center is the
 *  twist, and the glyph is the one place it can be SEEN before it is felt. */
const FALLOFF_RAMPS = [
  'M3 8 H21', // Uniform: everyone gets the whole angle
  'M3 13 L21 3 M12 2 V14', // Along: signed, reversing across the axis
  'M3 3 L12 12 L21 3', // From: outer copies turn hardest
  'M3 12 L12 3 L21 12', // Into: strongest at the core, gone past span
]

function FalloffGlyph({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex flex-col items-center gap-[1px] py-[1px]">
      <svg viewBox="0 0 24 16" className="h-3.5 w-6" aria-hidden="true">
        <path d={FALLOFF_RAMPS[value] ?? FALLOFF_RAMPS[0]} stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </svg>
      <span className="text-[7px] tracking-[0.06em]">{label.toUpperCase()}</span>
    </span>
  )
}

/** A captioned segmented switch: the kit control under the guide's quiet caps
 *  caption (the Symmetric Motion panel's pattern). */
function CaptionedSegments({ b, caption, glyphs }: {
  b: SelectBinding | null
  caption?: string
  glyphs?: boolean
}) {
  if (!b) return null
  return (
    <div>
      <span className="mb-1 block text-[8px] font-semibold tracking-[0.12em] text-white/40 select-none">
        {(caption ?? b.def.label).toUpperCase()}
      </span>
      <Segmented
        b={b}
        options={glyphs
          ? b.def.options.map((option) => ({
            value: option.value,
            label: option.label,
            glyph: <FalloffGlyph value={option.value} label={option.label.split(' ')[0]} />,
          }))
          : undefined}
      />
    </div>
  )
}

/**
 * A signed channel as a bipolar strip: lit fill growing from the zero detent
 * at center, so a resting channel reads OFF rather than half-on (the guide's
 * bipolar rule, in the horizontal throw the mock picked). Drag anywhere on the
 * track, double-click resets, arrows nudge.
 */
function ChannelStrip({ b, label }: { b: NumBinding | null; label: string }) {
  const dragRef = useRef<{ x: number; value: number; width: number } | null>(null)
  if (!b) return null
  const { def } = b
  const halfSpan = Math.max(Math.abs(def.min), Math.abs(def.max))
  const fraction = clamp(b.value / halfSpan, -1, 1)
  const commit = (value: number) => {
    const step = def.step ?? 1
    b.set(clamp(Math.round(value / step) * step, def.min, def.max))
  }
  return (
    <div className="grid grid-cols-[34px_1fr_40px] items-center gap-2">
      <span className="text-[8px] font-semibold tracking-[0.1em] text-white/50 select-none">{label}</span>
      <div
        role="slider"
        tabIndex={0}
        aria-label={def.label}
        aria-valuemin={def.min}
        aria-valuemax={def.max}
        aria-valuenow={b.value}
        className="relative h-3.5 cursor-ew-resize touch-none rounded border border-white/[0.08] bg-black/40 outline-none focus-visible:border-white/30"
        onPointerDown={(event) => {
          event.preventDefault()
          try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
          dragRef.current = { x: event.clientX, value: b.value, width: event.currentTarget.clientWidth }
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (!drag) return
          // Full track width = the full min..max throw, so the strip's travel
          // IS the value space (the gradient-slider rule).
          commit(drag.value + ((event.clientX - drag.x) / Math.max(1, drag.width)) * (def.max - def.min))
        }}
        onPointerUp={(event) => {
          dragRef.current = null
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onDoubleClick={() => b.set(def.default)}
        onKeyDown={(event) => {
          const step = (def.step ?? 1) * (event.shiftKey ? 15 : 1)
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); commit(b.value + step) }
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); commit(b.value - step) }
        }}
      >
        <span className="absolute bottom-0 left-1/2 top-0 w-px bg-white/20" />
        <span
          className="absolute bottom-[2px] top-[2px] rounded-[2px]"
          style={{
            background: ACCENT,
            opacity: 0.85,
            left: fraction >= 0 ? '50%' : `${50 + fraction * 50}%`,
            width: `${Math.max(Math.abs(fraction) * 50, 0.75)}%`,
          }}
        />
      </div>
      <span className="text-right font-mono text-[9px] tabular-nums text-white/70 select-none">
        {Math.round(b.value)}°
      </span>
    </div>
  )
}

// ── Renderer ─────────────────────────────────────────────────────────────────

const SR_DEFAULTS = mergeDefinitionSettings(symmetricRotationMover, undefined) as unknown as SymmetricRotationSettings

export const SymmetricRotationMoverUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const axis = b.select('axis')
  const mode = b.select('mode')
  const falloff = b.select('falloff')
  const anchor = b.select('anchor')
  const twist = b.num('twist')
  const fold = b.num('fold')
  const roll = b.num('roll')
  const span = b.num('span')
  const curve = b.num('curve')
  const angle = b.num('angle')
  // showIf-gated on mode. The mover branch passes gated params through today,
  // but keep these OPTIONAL in case the branches are ever unified.
  const burstBeats = b.num('burstBeats', { optional: true })
  const easing = b.select('easing', { optional: true })
  const sharpness = b.num('sharpness', { optional: true })
  const drive = b.select('drive', { optional: true })
  const cyclesPerBeat = b.num('cyclesPerBeat', { optional: true })
  const returnBeats = b.num('returnBeats', { optional: true })

  // The preview reflects EVERY numeric param - the MORE drawer's center and
  // axis-aim knobs included - so it reads the raw parameter list rather than
  // only the claimed bindings.
  const settings = useMemo(() => {
    const values: Record<string, number> = {}
    for (const parameter of parameters as readonly UserInterfaceParameter[]) {
      if (typeof parameter.value === 'number') values[parameter.definition.key] = parameter.value
    }
    return { ...SR_DEFAULTS, ...values } as SymmetricRotationSettings
  }, [parameters])

  if (b.missing) return <ParameterList parameters={parameters} />

  const burst = mode?.value === SYMMETRIC_ROTATION_MODE_BURST
  const constant = mode?.value === SYMMETRIC_ROTATION_MODE_CONSTANT
  const oscillate = mode?.value === SYMMETRIC_ROTATION_MODE_OSCILLATE

  return (
    <Console accent={ACCENT} testId="symmetric-rotation-user-interface">
      <TwistPreview settings={settings} />
      <ControlRow spill className="flex-col items-stretch gap-2 px-3 pb-3 pt-2">
        <CaptionedSegments b={axis} />
        <CaptionedSegments b={mode} caption="Mode" />
        <CaptionedSegments b={falloff} glyphs />
        <CaptionedSegments b={anchor} />

        <div className="flex flex-col gap-1.5 pt-1">
          <ChannelStrip b={twist} label="TWIST" />
          <ChannelStrip b={fold} label="FOLD" />
          <ChannelStrip b={roll} label="ROLL" />
        </div>

        <div className="flex items-end justify-around gap-4 pt-1">
          <Knob b={span} label="SPAN" />
          <Knob b={curve} label="CURVE" />
          <Knob b={angle} label="ANGLE ×" />
        </div>

        {burst && (
          <div className="flex items-end justify-around gap-4">
            <Knob b={burstBeats} label="BEATS" suffix="b" />
            <Knob b={sharpness} label="SHARP" />
          </div>
        )}
        {burst && easing && (
          <ParamControl
            param={easing.def}
            numValue={easing.value}
            strValue={undefined}
            onNum={(value) => easing.set(value)}
          />
        )}
        {constant && (
          <div className="flex items-end justify-between gap-3">
            <CaptionedSegments b={drive} />
            <Knob b={returnBeats} label="RETURN" suffix="b" />
          </div>
        )}
        {oscillate && (
          <div className="flex items-end justify-around gap-4">
            <Knob b={cyclesPerBeat} label="CYCLES" suffix="/b" />
            <Knob b={returnBeats} label="RETURN" suffix="b" />
          </div>
        )}

        <More parameters={b.rest()} label="MORE" className="" />
      </ControlRow>
    </Console>
  )
}
