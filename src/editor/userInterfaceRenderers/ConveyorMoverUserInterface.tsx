'use client'

// Bespoke settings for the Conveyor mover, following
// docs/instrument-panel-design-guide.md (Laser Sphere is the reference, Impact
// Scatter the nearest sibling): a full-bleed panel washed in the mover's
// current-mint shade, a LIVE preview up top, then four knobs - SPEED, GLIDE,
// FADE, SPAN X - with the other two spans behind MORE.
//
// The preview is not a mockup: it runs the mover's real resolve() over a belt of
// copies laid out exactly the way a splitter above it would, so the dissolve at
// one face and the reappearance at the other are the mover's own arithmetic. That
// matters more here than on most panels, because the whole point of this mover is
// a seam you cannot see - and a mocked preview would be drawing the seam it is
// supposed to prove is absent.
//
// The performance is one held note per loop: run the belt, then let it coast to a
// stop, forever. Two things make the loop invisible, both derived rather than
// tuned (see cycle()):
//
//  - the run carries the belt a whole number of SPACINGS. A uniformly spaced belt
//    shifted by one spacing is the same picture, so the wrap needs no crossfade;
//  - the rest is longer than the glide, so the belt is at a dead stop at both
//    ends of the cycle and the velocity matches across the seam too.
//
// Which is why the note is not simply held forever: a stop is the only way to see
// what GLIDE does, and the ease-out into it is half of what the knob buys you.

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Color, Euler, InstancedMesh, Matrix4, Object3D, type OrthographicCamera } from 'three'
import { conveyorMover, type ConveyorSettings } from '../core/visualCopies/conveyor'
import { mergeDefinitionSettings } from '../core/visualCopies/definitions'
import type { ResolvedNote } from '../core/visual/types'
import { isNumberParam } from '../instruments/types'
import { ParameterList } from './ParametersUserInterface'
import { towardWhite, withAlpha } from './colorWheel'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

// The mover has no colour of its own (it only moves and dims), so the panel
// wears what it evokes: a cool moving current.
const CURRENT = '#48e5c2'
const CURRENT_SHADE = '#081a16'
const ROOM = '#05070c'

/** The belt streams right in the preview; the other five rows are the same
 *  motion on another axis, which one picture already tells you. */
const RIGHT_PITCH = 60

// ── The belt ─────────────────────────────────────────────────────────────────
// One row, because "conveyor" is the metaphor and a single file of objects is
// the clearest possible statement of it: you can follow ONE copy all the way to
// the face it dissolves into and find it again at the other side.
//
// The copies are laid out to FILL the loop box, evenly - exactly what a Grid
// splitter above this mover produces, and the arrangement the loop is designed
// for. Cube size is fixed while the framing follows the span, so SPAN reads the
// way it actually behaves: as how many objects fit in the loop before it repeats.

/** Target world distance between copies; the count is derived from the span. */
const TARGET_SPACING = 1.5
const CUBE = 0.62
/** Span past which the box is wider than the preview can usefully frame. */
const FRAMED_SPAN = 9
const PREVIEW_HEIGHT = 148

/** A three-quarter rest pose, so a cube reads as a solid rather than a square. */
const REST_POSE = new Euler(0.3, 0.62, 0)

function beltCount(span: number): number {
  if (!(span > 0)) return 7
  return clamp(Math.round((span * 2) / TARGET_SPACING), 3, 40)
}

/** Half-width of the world the camera frames. */
function framedHalfWidth(span: number): number {
  return (span > 0 ? Math.min(span, FRAMED_SPAN) : FRAMED_SPAN * 0.6) * 1.12
}

/**
 * The looping performance, derived from the settings so the loop is seamless at
 * any speed and glide: one note held long enough to carry the belt a whole
 * number of spacings, then a rest long enough for the glide to finish.
 */
function cycle(settings: ConveyorSettings) {
  const span = settings.spanX > 0 ? settings.spanX : FRAMED_SPAN
  const spacing = (span * 2) / beltCount(settings.spanX)
  const glide = Math.max(0, settings.glide)
  const rest = Math.max(0.5, glide * 1.2)
  if (!(settings.speed > 0)) return { hold: 4, loopBeats: 4 + rest }
  // Long enough to be a run rather than a twitch, and long enough for both
  // glide ramps to complete inside it (or the belt would never reach speed and
  // the cycle would not cover a whole number of spacings).
  const minimumHold = Math.max(3, glide * 2.2)
  const spacings = Math.max(2, Math.ceil((minimumHold * settings.speed) / spacing))
  const hold = (spacings * spacing) / settings.speed
  return { hold, loopBeats: hold + rest }
}

function ConveyorBelt({ settings }: { settings: ConveyorSettings }) {
  const meshRef = useRef<InstancedMesh>(null)
  const scratch = useRef({
    dummy: new Object3D(),
    base: new Matrix4(),
    rest: new Matrix4().makeRotationFromEuler(REST_POSE),
    color: new Color(),
    current: new Color(CURRENT),
    room: new Color(ROOM),
  }).current

  const count = beltCount(settings.spanX)
  // Rebuilt on settings change: resolve() closes over the notes, and the notes
  // themselves are derived from the settings.
  const belt = useMemo(() => {
    const { hold, loopBeats } = cycle(settings)
    const notes: ResolvedNote[] = [{
      beat: 0,
      pitch: RIGHT_PITCH,
      durationBeats: hold,
      velocity: 1,
      blockStartBeat: 0,
      blockEndBeat: loopBeats,
    }]
    return { settings, count, resolved: conveyorMover.resolve({ settings, notes }), loopBeats }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, count])
  const live = useRef(belt)
  live.current = belt

  useFrame(({ clock, camera, gl }) => {
    const mesh = meshRef.current
    if (!mesh) return
    const { dummy, base, rest, color, current, room } = scratch
    const state = live.current
    const beat = (clock.getElapsedTime() * 2) % state.loopBeats

    // The frustum is derived from the canvas ELEMENT rather than from the
    // renderer's measured size: this panel lives in a resizable pane and can
    // mount while it is still collapsed, and a stale measurement leaves the belt
    // framed for a width the panel no longer has. Re-derived per frame so r3f's
    // own resize handling (which rewrites a non-manual camera's projection into
    // pixel units) is corrected on the next tick.
    const width = gl.domElement.clientWidth
    const height = gl.domElement.clientHeight
    const orthographic = camera as OrthographicCamera
    if (width > 0 && height > 0) {
      const halfWidth = framedHalfWidth(state.settings.spanX)
      const halfHeight = halfWidth * (height / width)
      if (orthographic.right !== halfWidth || orthographic.top !== halfHeight) {
        orthographic.right = halfWidth
        orthographic.left = -halfWidth
        orthographic.top = halfHeight
        orthographic.bottom = -halfHeight
        orthographic.zoom = 1
        orthographic.updateProjectionMatrix()
      }
    }

    const span = state.settings.spanX > 0 ? state.settings.spanX : FRAMED_SPAN
    const spacing = (span * 2) / state.count
    for (let index = 0; index < state.count; index++) {
      // Home positions fill the box from its trailing face, evenly - a Grid
      // splitter's layout, which is the arrangement the loop is built for.
      const home = -span + (index + 0.5) * spacing
      // The rest pose rides INSIDE the copy transform: the mover reads the home
      // position off the transform's translation, so the pose is invisible to it.
      base.makeTranslation(home, 0, 0).multiply(rest)
      const [result] = state.resolved.apply(
        { transform: base, opacity: 1, colorShift: { hue: 0, saturation: 0, lightness: 0, tint: null, tintAmount: 0 } },
        { beat, index, count: state.count },
      )
      dummy.matrix.copy(result.transform)
      dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
      // The mover's fade, shown as light rather than as alpha: against a
      // near-black room, dimming to the room colour IS fading out, and it costs
      // no sorting or blending to be exact about it.
      color.copy(room).lerp(current, clamp(result.opacity, 0, 1))
      mesh.setColorAt(index, color)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh key={count} ref={meshRef} args={[undefined, undefined, count]} frustumCulled={false}>
      <boxGeometry args={[CUBE, CUBE, CUBE]} />
      <meshStandardMaterial metalness={0.3} roughness={0.35} color="#ffffff" />
    </instancedMesh>
  )
}

function ConveyorPreview({ settings }: { settings: ConveyorSettings }) {
  return (
    <div
      data-testid="conveyor-preview"
      className="relative overflow-hidden border-b border-white/[0.06]"
      style={{ height: PREVIEW_HEIGHT, background: ROOM }}
    >
      {/* Orthographic on purpose: the belt is a straight line across a short wide
          window, and a perspective frustum wide enough to fill it would make the
          same spacing look bigger at the edges than in the middle - which is
          exactly the comparison this preview exists to support. The frustum is
          set per frame in ConveyorBelt. */}
      <Canvas orthographic dpr={[1, 2]} camera={{ position: [0, 0, 12] }} gl={{ antialias: true, alpha: true }}>
        <color attach="background" args={[ROOM]} />
        <ConveyorBelt settings={settings} />
        <directionalLight position={[3, 6, 8]} intensity={1.3} color="#e6fff8" />
        <directionalLight position={[-6, -2, 4]} intensity={0.35} color={CURRENT} />
        <ambientLight intensity={0.32} />
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.5} luminanceThreshold={0.72} luminanceSmoothing={0.2} mipmapBlur radius={0.7} levels={6} />
        </EffectComposer>
      </Canvas>
    </div>
  )
}

// ── Knobs ────────────────────────────────────────────────────────────────────

const KNOB = 44
const PRIMARY_KNOB = 52

/** The guide's knob: the value arc IS the light (wide bloom under a hot core,
 *  white-hot tip dot at the terminus). Vertical drag, double-click resets,
 *  arrows nudge. */
function CurrentKnob({ parameter: bound, label, format, size = KNOB }: {
  parameter: UserInterfaceParameter
  label: string
  /** Reads the value in the unit a person thinks in. */
  format?: (value: number) => string
  size?: number
}) {
  const dragRef = useRef<{ y: number; norm: number } | null>(null)
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null

  const value = bound.value
  const range = definition.max - definition.min
  const percent = range === 0 ? 0 : clamp((value - definition.min) / range, 0, 1)
  const angle = -135 + percent * 270
  const sweep = percent * 270
  const arc = (color: string) =>
    `conic-gradient(from 225deg, ${color} 0deg ${sweep}deg, transparent ${sweep}deg 360deg)`

  const commitNorm = (t: number) => {
    const raw = definition.min + clamp(t, 0, 1) * range
    const snapped = definition.min + Math.round((raw - definition.min) / definition.step) * definition.step
    bound.setValue(clamp(Number(snapped.toFixed(8)), definition.min, definition.max))
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
    dragRef.current = { y: event.clientY, norm: percent }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    commitNorm(drag.norm + (drag.y - event.clientY) / 140)
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
    event.preventDefault()
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1
    commitNorm(percent + direction * 0.03)
  }

  return (
    // Fixed column width: the readouts change length as you turn, and a row that
    // reflows mid-drag is unusable. The knob centres inside the column.
    <div className="flex w-[58px] flex-col items-center">
      <div
        role="slider"
        tabIndex={0}
        aria-label={definition.label}
        aria-valuemin={definition.min}
        aria-valuemax={definition.max}
        aria-valuenow={value}
        aria-valuetext={format ? format(value) : undefined}
        title={`${definition.label} · drag vertically · double-click to reset`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => bound.setValue(definition.default)}
        onKeyDown={onKeyDown}
        className="relative cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        style={{ width: size, height: size }}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{ background: arc(CURRENT), filter: 'blur(6px)', transform: 'scale(1.14)', opacity: 0.85 }}
        />
        <div className="absolute inset-0 rounded-full" style={{ background: arc(towardWhite(CURRENT, 0.4)) }} />
        {/* The unlit remainder of the travel, so the arc reads as a fill. */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(from 225deg, transparent 0deg ${sweep}deg, rgba(255,255,255,0.07) ${sweep}deg 270deg, transparent 270deg)`,
          }}
        />
        <div className="absolute inset-[3px] rounded-full border border-white/10 bg-[#0f1a18]" />
        <div className="absolute inset-0" style={{ transform: `rotate(${angle}deg)` }}>
          <span
            className="absolute left-1/2 -translate-x-1/2 rounded-full bg-white/90"
            style={{ top: size * 0.12, height: size * 0.24, width: 2 }}
          />
          <span
            className="absolute left-1/2 top-[-1px] h-1 w-1 -translate-x-1/2 rounded-full bg-white"
            style={{ boxShadow: `0 0 5px 1.5px ${CURRENT}` }}
          />
        </div>
      </div>
      <span className="mt-1 whitespace-nowrap text-[8px] font-semibold leading-[11px] tracking-[0.12em] text-white/40">
        {label}
      </span>
      <span className="whitespace-nowrap font-mono text-[9px] leading-[12px] tabular-nums text-white/70">
        {format ? format(value) : value.toFixed(definition.step >= 1 ? 0 : 2)}
      </span>
    </div>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

// The four macros. The other two spans are the same idea on axes the preview is
// not looking down, so they belong in MORE.
const PLACED_KEYS = new Set(['speed', 'glide', 'fade', 'spanX'])

const asPercent = (value: number) => `${Math.round(value * 100)}%`
const asBeats = (value: number) => (value <= 0 ? 'instant' : `${value.toFixed(2)} beat${value === 1 ? '' : 's'}`)
const perBeat = (value: number) => `${value.toFixed(1)} /beat`
const asSpan = (value: number) => (value <= 0 ? 'off' : `±${value.toFixed(1)}`)

export const ConveyorMoverUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const [showMore, setShowMore] = useState(false)

  const bound = Object.fromEntries(parameters.map((p) => [p.definition.key, p]))

  // The preview's settings: the bound numeric values over the definition's
  // defaults. Memoized on the VALUES so resolve() reruns only on real change.
  // Computed before the fallback return below - hooks must run unconditionally.
  const valuesKey = parameters
    .map((p) => `${p.definition.key}:${typeof p.value === 'number' ? p.value : ''}`)
    .join('|')
  const settings = useMemo(() => {
    const values: Record<string, number> = {}
    for (const p of parameters) if (typeof p.value === 'number') values[p.definition.key] = p.value
    return mergeDefinitionSettings(conveyorMover, values) as unknown as ConveyorSettings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuesKey])

  if ([...PLACED_KEYS].some((key) => !bound[key])) return <ParameterList parameters={parameters} />

  const unplaced = parameters.filter((p) => !PLACED_KEYS.has(p.definition.key))

  return (
    <section
      data-testid="conveyor-user-interface"
      className="-mx-3 -mt-3"
      style={{ background: CURRENT_SHADE }}
    >
      <ConveyorPreview settings={settings} />
      <div
        className="flex flex-col gap-2 pb-4 pt-3"
        style={{ background: `radial-gradient(58% 30px at 50% 0, ${withAlpha(CURRENT, 0.13)}, transparent)` }}
      >
        {/* SPEED is the subject of the mover; the other three qualify it. */}
        <div className="flex items-end gap-5 px-4">
          <CurrentKnob parameter={bound.speed} label="SPEED" format={perBeat} size={PRIMARY_KNOB} />
          <CurrentKnob parameter={bound.glide} label="GLIDE" format={asBeats} />
          <CurrentKnob parameter={bound.fade} label="FADE" format={asPercent} />
          <CurrentKnob parameter={bound.spanX} label="SPAN X" format={asSpan} />
        </div>
        {unplaced.length > 0 && (
          <div className="px-3">
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
                <ParameterList parameters={unplaced} />
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
