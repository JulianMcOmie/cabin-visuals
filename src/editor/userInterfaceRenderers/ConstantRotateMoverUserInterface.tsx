'use client'

// Bespoke settings surface for the Constant Rotate mover, styled like a clean
// modern plugin and sized to fill the detail panel with no scrolling: the left
// side is a live preview rendering the ACTUAL affected object (resolved through
// the project graph) spinning at the configured speeds, with the mover's name
// floating over the animation; the right side is a control column holding the
// dials - one large SPEED knob, the per-axis X/Y/Z knobs, and RETURN - with
// the 3x3 rotation-basis matrix tucked into a collapsible strip at its foot.
// Objects that can't render standalone (video/photo/2D vignettes, full-frame
// screens) fall back to a wireframe cube.

import { Suspense, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { ChevronDown } from 'lucide-react'
import { Group, Matrix4, Vector3 } from 'three'
import { resolveBasis } from '../core/visualCopies/motionBasis'
import { isNumberParam } from '../instruments/types'
import { getInstrument } from '../instruments'
import { setPreviewObjectState } from '../core/visual/VisualEngine'
import { applyMaterialOpacity } from '../core/visual/animatedOpacity'
import { useProjectStore } from '../store/ProjectStore'
import { useTimeStore } from '../store/TimeStore'
import {
  LaserPreviewBloom,
  computeProjectState,
  resolveAffectedObject,
  type AffectedObjectPreview,
} from '../components/InstrumentHoverPreview'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const DEG = Math.PI / 180

const AXES = [
  { letter: 'X', color: '#e0685f' },
  { letter: 'Y', color: '#7dc37d' },
  { letter: 'Z', color: '#5fa8e0' },
] as const

function parameter(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((candidate) => candidate.definition.key === key)
}

function numericValue(bound: UserInterfaceParameter | undefined, fallback = 0): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg - 90) * DEG
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number) {
  if (to - from >= 359.9) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r}`
  }
  const [sx, sy] = polar(cx, cy, r, from)
  const [ex, ey] = polar(cx, cy, r, to)
  const large = to - from > 180 ? 1 : 0
  return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`
}

// --- Flat plugin knob --------------------------------------------------------

function PluginKnob({
  bound,
  label,
  unit = '',
  color = 'var(--accent)',
  digits = 2,
  size = 50,
}: {
  bound: UserInterfaceParameter
  label: string
  unit?: string
  color?: string
  digits?: number
  size?: number
}) {
  const definition = bound.definition
  const dragRef = useRef<{ y: number; value: number } | null>(null)
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null

  const large = size >= 64
  const micro = size < 44
  const arcWidth = large ? 5 : 3.5
  const value = bound.value
  const range = definition.max - definition.min
  const percent = range === 0 ? 0 : clamp((value - definition.min) / range, 0, 1)
  const angle = -135 + percent * 270

  const commit = (raw: number) => {
    const snapped = definition.min + Math.round((raw - definition.min) / definition.step) * definition.step
    bound.setValue(clamp(Number(snapped.toFixed(8)), definition.min, definition.max))
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { y: event.clientY, value }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    commit(dragRef.current.value + ((dragRef.current.y - event.clientY) / 110) * range)
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
    event.preventDefault()
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1
    commit(value + direction * definition.step)
  }

  const c = size / 2
  const r = c - arcWidth / 2 - 1
  const body = r - arcWidth / 2 - (large ? 5 : 3)
  const [ix, iy] = polar(c, c, body * 0.4, angle)
  const [ox, oy] = polar(c, c, body - 1.5, angle)

  return (
    <div className="flex min-w-0 flex-col items-center">
      <div
        role="slider"
        tabIndex={0}
        aria-label={definition.label}
        aria-valuemin={definition.min}
        aria-valuemax={definition.max}
        aria-valuenow={value}
        title="Drag vertically · double-click to reset"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => bound.setValue(definition.default)}
        onKeyDown={onKeyDown}
        className="cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <svg width={size} height={size} aria-hidden="true">
          <path d={arcPath(c, c, r, -135, 135)} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth={arcWidth} strokeLinecap="round" />
          {percent > 0.004 && (
            <path d={arcPath(c, c, r, -135, angle)} fill="none" stroke={color} strokeWidth={arcWidth} strokeLinecap="round" />
          )}
          <circle cx={c} cy={c} r={body} fill="#181b23" stroke="rgba(255,255,255,0.13)" strokeWidth="1" />
          <line x1={ix} y1={iy} x2={ox} y2={oy} stroke={color} strokeWidth={large ? 3 : 2.25} strokeLinecap="round" />
        </svg>
      </div>
      {micro ? (
        <div className="mt-0.5 flex flex-col items-center leading-tight">
          <span className="text-[7px] font-semibold tracking-[0.06em] text-[var(--text-muted)]">{label}</span>
          <span className="font-mono text-[7px] tabular-nums text-[var(--text-3)]">
            {value.toFixed(digits)}{unit}
          </span>
        </div>
      ) : (
        <div className={`${large ? 'mt-1.5' : 'mt-1'} flex max-w-full items-baseline justify-center gap-1`}>
          <span
            className={`${large ? 'text-[9px]' : 'text-[8px]'} font-semibold tracking-[0.12em] text-[var(--text-muted)]`}
            style={label.length === 1 ? { color } : undefined}
          >
            {label}
          </span>
          <span className={`font-mono ${large ? 'text-[9px]' : 'text-[8px]'} tabular-nums text-[var(--text-3)]`}>
            {value.toFixed(digits)}{unit}
          </span>
        </div>
      )}
    </div>
  )
}

// --- Collapsible strip for the params too niche for the dial column ---------

function AdvancedSection({ title, parameters }: { title: string; parameters: UserInterfaceParameter[] }) {
  const [open, setOpen] = useState(false)
  if (parameters.length === 0) return null
  return (
    <div className="mt-auto w-full flex-shrink-0 border-t border-[var(--border)]">
      <button
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between py-2 text-[7px] font-semibold tracking-[0.14em] text-[var(--text-muted)] transition-colors hover:text-[var(--text-3)]"
      >
        <span>{title} · {parameters.length}</span>
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <ParameterList parameters={parameters} />}
    </div>
  )
}

// --- Live preview: the affected object, just rotating ------------------------

// A slow preview clock so fast spins stay readable; totals beyond the mover's
// 720°/beat ceiling are damped silently.
const SIM_BEATS_PER_SECOND = 0.75
const MAX_TOTAL_DEG_PER_BEAT = 720

// The paused preview loops a 16-beat window at 120bpm, matching the instrument
// hover preview; while the transport plays it follows the song instead.
const PREVIEW_BEATS_PER_SEC = 2
const LOOP_BEATS = 16
const START_OFFSET_BEATS = 1
const previewBeat = (elapsedSec: number) => (elapsedSec * PREVIEW_BEATS_PER_SEC + START_OFFSET_BEATS) % LOOP_BEATS

interface SpinLiveState {
  speeds: [number, number, number]
  mult: number
  basis: [Vector3, Vector3, Vector3]
}

interface SpinFrame {
  /** The object's local placement, written by the driver each frame. */
  world: Matrix4
  /** The mover rotation, integrated from the live speeds each frame. */
  rotation: Matrix4
  opacity: number
  angles: [number, number, number]
}

const _axisRotation = new Matrix4()

/** basisRotation without per-frame allocation: out = Rx · Ry · Rz over the resolved basis. */
function composeBasisRotation(
  out: Matrix4,
  basis: readonly [Vector3, Vector3, Vector3],
  degrees: readonly [number, number, number],
) {
  out.identity()
  for (let axis = 0; axis < 3; axis++) {
    const radians = degrees[axis] * DEG
    if (Math.abs(radians) > 1e-10) {
      out.multiply(_axisRotation.makeRotationAxis(basis[axis], radians))
    }
  }
}

/** Integrates the per-axis angles at the live speeds and composes this frame's
 *  rotation - the mover's always-on baseline spin, no notes needed. */
function SpinIntegrator({ live, frame }: { live: { current: SpinLiveState }; frame: SpinFrame }) {
  useFrame((_, delta) => {
    const { speeds, mult, basis } = live.current
    const total = (Math.abs(speeds[0]) + Math.abs(speeds[1]) + Math.abs(speeds[2])) * Math.abs(mult)
    const damp = total > MAX_TOTAL_DEG_PER_BEAT ? MAX_TOTAL_DEG_PER_BEAT / total : 1
    const beats = Math.min(delta, 0.1) * SIM_BEATS_PER_SECOND
    for (const axis of [0, 1, 2] as const) {
      frame.angles[axis] = (frame.angles[axis] + speeds[axis] * mult * damp * beats) % 360
    }
    composeBasisRotation(frame.rotation, basis, frame.angles)
  })
  return null
}

/** Feeds the resolved object's real ObjectState (its own params, notes, energy)
 *  to the instrument component, like the hover preview's project driver. */
function AffectedObjectDriver({
  preview,
  trackId,
  frame,
}: {
  preview: AffectedObjectPreview
  trackId: string
  frame: SpinFrame
}) {
  useFrame((root) => {
    const time = useTimeStore.getState()
    const beat = time.isPlaying ? time.currentBeat : preview.loopStart + previewBeat(root.clock.elapsedTime)
    const state = computeProjectState(preview.object, beat, preview.bpm, preview.beatsPerBar, frame.world)
    frame.opacity = state.opacity
    setPreviewObjectState(trackId, state)
  })
  useEffect(() => () => setPreviewObjectState(trackId, null), [trackId])
  return null
}

const _placement = new Matrix4()

/** The real instrument component with the mover rotation applied on top of its
 *  own placement - the same `world × copy.transform` composition as ObjectRenderer. */
function AffectedObject({
  component: Component,
  trackId,
  frame,
}: {
  component: NonNullable<ReturnType<typeof getInstrument>>['component']
  trackId: string
  frame: SpinFrame
}) {
  const groupRef = useRef<Group>(null)
  useFrame(() => {
    const g = groupRef.current
    if (!g) return
    _placement.multiplyMatrices(frame.world, frame.rotation)
    _placement.decompose(g.position, g.quaternion, g.scale)
    applyMaterialOpacity(g, frame.opacity)
  })
  return (
    <group ref={groupRef}>
      <Suspense fallback={null}>
        <Component trackId={trackId} />
      </Suspense>
    </group>
  )
}

/** Stand-in for objects that can't render standalone: the wireframe cube,
 *  spinning the same way - no rings, dots, or readouts. */
function FallbackCube({ frame }: { frame: SpinFrame }) {
  const groupRef = useRef<Group>(null)
  useFrame(() => {
    const g = groupRef.current
    if (!g) return
    frame.rotation.decompose(g.position, g.quaternion, g.scale)
  })
  return (
    <group ref={groupRef}>
      <mesh>
        <boxGeometry args={[1.25, 1.25, 1.25]} />
        <meshStandardMaterial color="#35a7e6" wireframe />
      </mesh>
    </group>
  )
}

function ConstantRotatePreview({
  affected,
  live,
  frame,
}: {
  affected: AffectedObjectPreview | null
  live: { current: SpinLiveState }
  frame: SpinFrame
}) {
  const reactId = useId()
  const trackId = `__constant-rotate-preview__${reactId}`
  const def = affected ? getInstrument(affected.object.instrumentId) : undefined
  const Component = def && !def.fullFrame ? def.component : undefined

  return (
    <div
      data-testid="constant-rotate-live-preview"
      className="relative min-w-0 flex-1 overflow-hidden"
      style={{ background: 'radial-gradient(circle at 50% 42%, rgba(53,167,230,0.10), rgba(9,10,14,0.97) 68%), linear-gradient(150deg, #10131a, #090a0e)' }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.07) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          maskImage: 'linear-gradient(to bottom, transparent, black 40%, black)',
        }}
      />
      {/* The mover's name floats over the animation - no title bar. */}
      <div className="pointer-events-none absolute left-2.5 top-2 z-10 text-[9px] font-bold uppercase tracking-[0.13em] text-white/45">
        Constant Rotate
      </div>
      <Canvas dpr={[1, 2]} camera={{ position: [0, 0.9, 4.2], fov: 55 }} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, 4, 5]} intensity={1.1} />
        <SpinIntegrator live={live} frame={frame} />
        {affected && Component ? (
          <>
            <AffectedObjectDriver preview={affected} trackId={trackId} frame={frame} />
            <AffectedObject component={Component} trackId={trackId} frame={frame} />
            <LaserPreviewBloom instrumentId={affected.object.instrumentId} />
          </>
        ) : (
          <FallbackCube frame={frame} />
        )}
      </Canvas>
    </div>
  )
}

// --- Panel ------------------------------------------------------------------

const DEFAULT_SPEEDS: [number, number, number] = [90, 90, 90]

export const ConstantRotateMoverUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ targetId, parameters }) => {
  const tracks = useProjectStore((s) => s.tracks)
  const rootTrackIds = useProjectStore((s) => s.rootTrackIds)
  const bpm = useProjectStore((s) => s.bpm)
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)
  const totalBars = useProjectStore((s) => s.totalBars)

  const affected = useMemo(
    () => resolveAffectedObject(targetId, { tracks, rootTrackIds, bpm, beatsPerBar, totalBars }),
    [targetId, tracks, rootTrackIds, bpm, beatsPerBar, totalBars],
  )

  // Live spin inputs, re-read every render so the r3f loop sees fresh values
  // without re-subscribing its frame callbacks.
  const live = useRef<SpinLiveState>({ speeds: DEFAULT_SPEEDS, mult: 1, basis: resolveBasis({
    basisXX: 1, basisXY: 0, basisXZ: 0,
    basisYX: 0, basisYY: 1, basisYZ: 0,
    basisZX: 0, basisZY: 0, basisZZ: 1,
  }) })
  live.current = {
    speeds: [
      numericValue(parameter(parameters, 'speedX'), 90),
      numericValue(parameter(parameters, 'speedY'), 90),
      numericValue(parameter(parameters, 'speedZ'), 90),
    ],
    mult: numericValue(parameter(parameters, 'speed'), 1),
    basis: resolveBasis({
      basisXX: numericValue(parameter(parameters, 'basisXX'), 1),
      basisXY: numericValue(parameter(parameters, 'basisXY'), 0),
      basisXZ: numericValue(parameter(parameters, 'basisXZ'), 0),
      basisYX: numericValue(parameter(parameters, 'basisYX'), 0),
      basisYY: numericValue(parameter(parameters, 'basisYY'), 1),
      basisYZ: numericValue(parameter(parameters, 'basisYZ'), 0),
      basisZX: numericValue(parameter(parameters, 'basisZX'), 0),
      basisZY: numericValue(parameter(parameters, 'basisZY'), 0),
      basisZZ: numericValue(parameter(parameters, 'basisZZ'), 1),
    }),
  }

  // One stable frame per mounted preview so the integrated angles never snap
  // back to zero when the project re-resolves (e.g. while dragging a knob).
  const frame = useMemo<SpinFrame>(() => ({
    world: new Matrix4(),
    rotation: new Matrix4(),
    opacity: 1,
    angles: [0, 0, 0],
  }), [])

  const speedX = parameter(parameters, 'speedX')
  const speedY = parameter(parameters, 'speedY')
  const speedZ = parameter(parameters, 'speedZ')
  const speed = parameter(parameters, 'speed')
  const returnBeats = parameter(parameters, 'returnBeats')

  if (!speedX || !speedY || !speedZ || !speed || !returnBeats) {
    return <ParameterList parameters={parameters} />
  }

  // The rotation basis matrix, in definition (row-major) order.
  const basisKnobs = parameters.filter((bound) => bound.definition.key.startsWith('basis'))

  return (
    <section
      data-testid="constant-rotate-user-interface"
      className="-mx-1 flex h-full overflow-hidden rounded-xl border border-[var(--border)] bg-[#0d0f14] text-[var(--text-2)] shadow-[0_16px_38px_rgba(0,0,0,.32)]"
    >
      {/* The visualizer takes the whole left side; every dial lives in the
          control column on the right, so nothing scrolls. */}
      <ConstantRotatePreview affected={affected} live={live} frame={frame} />

      <div className="flex w-[148px] flex-shrink-0 flex-col items-center gap-1.5 overflow-y-auto border-l border-[var(--border)] px-2 py-2 no-scrollbar">
        <PluginKnob bound={speed} label="SPEED" unit="×" digits={1} size={68} />

        <div className="h-px w-full flex-shrink-0 bg-[var(--border)]" />
        <div className="grid grid-cols-3 gap-1">
          <PluginKnob bound={speedX} label="X" color={AXES[0].color} digits={0} unit="°" size={40} />
          <PluginKnob bound={speedY} label="Y" color={AXES[1].color} digits={0} unit="°" size={40} />
          <PluginKnob bound={speedZ} label="Z" color={AXES[2].color} digits={0} unit="°" size={40} />
        </div>

        <div className="h-px w-full flex-shrink-0 bg-[var(--border)]" />
        <PluginKnob bound={returnBeats} label="RETURN" unit="b" digits={2} size={46} />

        <AdvancedSection title="ROTATION BASIS" parameters={basisKnobs} />
      </div>
    </section>
  )
}
