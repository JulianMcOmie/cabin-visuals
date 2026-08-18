'use client'

// Bespoke settings for the Conveyor mover, following
// docs/instrument-panel-design-guide.md (Laser Sphere is the reference, Impact
// Scatter the nearest sibling): a full-bleed panel washed in the mover's
// current-mint shade, a LIVE preview up top, then SPEED, GLIDE, the LOOP style,
// the group loop distance and FADE - with the other two distances behind MORE.
//
// The preview is not a mockup: it runs the mover's real resolve() over a whole
// FORMATION, the same array the resolver hands over, because that is what the
// mover measures. One copy at a time would tell it nothing about the arrangement
// and it would silently fall back to group looping - so a per-copy preview would
// be showing the wrong behaviour, not merely a rougher one.
//
// The performance is one held note per loop: run, then coast to a stop, forever.
// Two things make the loop invisible, both derived rather than tuned (see
// cycle()):
//
//  - the run covers a whole number of REPEAT distances - one lattice spacing for
//    a belt, one out-and-back for a group - so the picture at the end of the
//    cycle is the picture at its start;
//  - the rest is longer than the glide, so it is at a dead stop at both ends of
//    the cycle and the velocity matches across the seam too.
//
// Which is why the note is not simply held forever: a stop is the only way to see
// what GLIDE does, and the ease-out into it is half of what the knob buys you.

import { useMemo, useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { Color, Euler, InstancedMesh, Matrix4, Object3D, type OrthographicCamera } from 'three'
import { BELT_LOOP, GROUP_LOOP, conveyorMover, type ConveyorSettings } from '../core/visualCopies/conveyor'
import { mergeDefinitionSettings } from '../core/visualCopies/definitions'
import type { VisualCopy } from '../core/visualCopies/types'
import type { ResolvedNote } from '../core/visual/types'
import {
  bindPanel,
  Console,
  ControlRow,
  Knob,
  More,
  ParameterList,
  PreviewWindow,
  spillOf,
  type NumBinding,
  type SelectBinding,
  PreviewCanvas,
} from './console'
import type { UserInterfaceRendererDefinition } from './types'
import { CONVEYOR_COLOR } from '../core/visualCopies/identityColors'
import { clamp } from '../utils/math'

// The mover has no colour of its own (it only moves and dims), so the panel
// wears what it evokes: a cool moving current.
const CURRENT = CONVEYOR_COLOR
const ROOM = '#05070c'

/** The belt streams right in the preview; the other five rows are the same
 *  motion on another axis, which one picture already tells you. */
const RIGHT_PITCH = 60

// ── The belt ─────────────────────────────────────────────────────────────────
// One row, because "conveyor" is the metaphor and a single file of objects is
// the clearest possible statement of it: you can follow ONE copy all the way to
// the face it dissolves into and find it again at the other side.
//
// The copies are an evenly spaced lattice - exactly what a Grid splitter above
// this mover produces, and the arrangement BELT looping is built for. In belt
// style the lattice runs a little past both edges of the window, so the fold
// happens off-frame and the picture is a genuinely endless stream. In group style
// a short clump sits in the middle and the window widens to the loop distance, so
// you watch the whole trip out and back and see what the fade is doing.

/** World distance between copies in the preview lattice. */
const SPACING = 1.5
const CUBE = 0.62
/** Half-width the window frames in belt style, where the loop is the lattice. */
const BELT_HALF_WIDTH = 5.5
/** Loop distance past which the group's whole trip stops being worth framing. */
const FRAMED_SPAN = 9
const PREVIEW_HEIGHT = 148

/** A three-quarter rest pose, so a cube reads as a solid rather than a square. */
const REST_POSE = new Euler(0.3, 0.62, 0)

const isBelt = (settings: ConveyorSettings) => settings.loopStyle !== GROUP_LOOP

/** Half-width of the world the camera frames. */
function framedHalfWidth(settings: ConveyorSettings): number {
  if (isBelt(settings)) return BELT_HALF_WIDTH
  return (settings.spanX > 0 ? Math.min(settings.spanX, FRAMED_SPAN) : FRAMED_SPAN * 0.7) * 1.15
}

/** Home positions, centred, in the order a splitter would emit them. */
function homes(settings: ConveyorSettings): number[] {
  // Belt: overfill the window by a copy at each end so the lattice - and the
  // fold, which happens at its far end - continues outside the frame.
  // Group: a clump small enough to read as one travelling object.
  const count = isBelt(settings)
    ? clamp(Math.round((framedHalfWidth(settings) * 2) / SPACING) + 2, 4, 24)
    : 4
  return Array.from({ length: count }, (_, index) => (index - (count - 1) / 2) * SPACING)
}

/**
 * The looping performance, derived from the settings so the loop is seamless at
 * any speed, glide and loop style: one note held long enough to carry the field
 * a whole number of REPEAT distances, then a rest long enough for the glide to
 * finish (both ramps have to complete inside the cycle, or the travel would not
 * come out to a whole number of repeats).
 *
 * The repeat distance is what returns the picture to itself: one lattice spacing
 * for a belt, one full out-and-back sawtooth for a group.
 */
function cycle(settings: ConveyorSettings) {
  const glide = Math.max(0, settings.glide)
  const rest = Math.max(0.5, glide * 1.2)
  if (!(settings.speed > 0)) return { hold: 4, loopBeats: 4 + rest }
  const repeat = isBelt(settings)
    ? SPACING
    : (settings.spanX > 0 ? settings.spanX * 2 : FRAMED_SPAN * 2)
  const minimumHold = Math.max(3, glide * 2.2)
  const repeats = Math.max(1, Math.ceil((minimumHold * settings.speed) / repeat))
  const hold = (repeats * repeat) / settings.speed
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

  // Rebuilt on settings change: resolve() closes over the notes, and the notes,
  // the layout and the framing are all derived from the settings.
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
    // The FORMATION the mover measures, built once: belt looping folds each copy
    // at this lattice's own period, so the preview has to hand over the same
    // array the resolver would - one copy at a time tells the mover nothing about
    // the arrangement, and it would fall back to moving the clump as a group.
    const formation: VisualCopy[] = homes(settings).map((home) => ({
      transform: new Matrix4().makeTranslation(home, 0, 0),
      opacity: 1,
      colorShift: { hue: 0, saturation: 0, lightness: 0, tint: null, tintAmount: 0 },
    }))
    return { settings, formation, resolved: conveyorMover.resolve({ settings, notes }), loopBeats }
  }, [settings])
  const live = useRef(belt)
  live.current = belt
  const count = belt.formation.length

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
      const halfWidth = framedHalfWidth(state.settings)
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

    const formation = state.formation
    for (let index = 0; index < formation.length; index++) {
      // The rest pose rides OUTSIDE the copy the mover is handed: it reads home
      // positions off the formation's translations, and a pose baked into them
      // would be invisible to the maths but is cleaner kept apart. It is applied
      // to the result instead, below.
      const [result] = state.resolved.apply(
        formation[index],
        { beat, index, count: formation.length, formation },
      )
      dummy.matrix.copy(base.copy(result.transform).multiply(rest))
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
    <PreviewWindow height={PREVIEW_HEIGHT} testId="conveyor-preview">
      {/* Orthographic on purpose: the belt is a straight line across a short wide
          window, and a perspective frustum wide enough to fill it would make the
          same spacing look bigger at the edges than in the middle - which is
          exactly the comparison this preview exists to support. The frustum is
          set per frame in ConveyorBelt. */}
      <PreviewCanvas orthographic dpr={[1, 2]} camera={{ position: [0, 0, 12] }} gl={{ antialias: true, alpha: true }}>
        <color attach="background" args={[ROOM]} />
        <ConveyorBelt settings={settings} />
        <directionalLight position={[3, 6, 8]} intensity={1.3} color="#e6fff8" />
        <directionalLight position={[-6, -2, 4]} intensity={0.35} color={CURRENT} />
        <ambientLight intensity={0.32} />
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.5} luminanceThreshold={0.72} luminanceSmoothing={0.2} mipmapBlur radius={0.7} levels={6} />
        </EffectComposer>
      </PreviewCanvas>
    </PreviewWindow>
  )
}

// ── Knobs ────────────────────────────────────────────────────────────────────

/** The kit knob in a FIXED 58px column: the readouts here change length as you
 *  turn ("0.25 beats" → "instant"), and a row that reflows mid-drag is
 *  unusable. whitespace-nowrap keeps a long readout on one line. */
function FixedKnob({ b, label, format, large }: {
  b: NumBinding | null
  label: string
  /** Reads the value in the unit a person thinks in. */
  format?: (value: number) => string
  large?: boolean
}) {
  return (
    <div className="flex w-[58px] flex-col items-center whitespace-nowrap">
      <Knob b={b} label={label} format={format} large={large} />
    </div>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

const asBeats = (value: number) => (value <= 0 ? 'instant' : `${value.toFixed(2)} beat${value === 1 ? '' : 's'}`)
const asFade = (value: number) => (value <= 0 ? 'cut' : `${value.toFixed(2)} beat${value === 1 ? '' : 's'}`)
const perBeat = (value: number) => `${value.toFixed(1)} /beat`
const asSpan = (value: number) => (value <= 0 ? 'off' : `±${value.toFixed(1)}`)

/**
 * The panel's biggest decision, so it is a segmented control rather than a
 * select: BELT tiles the formation the chain above built, GROUP flies that
 * formation out and back as one body. Each segment DRAWS its behaviour - three
 * marks marching on, versus three marks travelling together - because the
 * difference is spatial and a word for it would need a paragraph. Solid-fill
 * family (Colorizer, Bass Ripple), in the knobs' fixed 58px column.
 */
function LoopSelector({ b }: { b: SelectBinding }) {
  const selected = Math.round(b.value)
  const glyphs: Record<number, ReactNode> = {
    [BELT_LOOP]: (
      <>
        <rect x="1" y="5" width="3" height="3" rx="0.5" />
        <rect x="6.5" y="5" width="3" height="3" rx="0.5" />
        <rect x="12" y="5" width="3" height="3" rx="0.5" opacity="0.35" />
      </>
    ),
    [GROUP_LOOP]: (
      <>
        <rect x="2" y="5" width="3" height="3" rx="0.5" />
        <rect x="6" y="5" width="3" height="3" rx="0.5" />
        <rect x="10" y="5" width="3" height="3" rx="0.5" />
        <path d="M1 10.5 H14" strokeWidth="1" stroke="currentColor" opacity="0.45" fill="none" />
      </>
    ),
  }
  return (
    <div className="flex w-[58px] flex-col items-center">
      <div className="flex overflow-hidden rounded-md border border-white/10">
        {b.def.options.map((option) => {
          const active = option.value === selected
          return (
            <button
              key={option.value}
              aria-label={option.label}
              aria-pressed={active}
              title={option.value === BELT_LOOP
                ? 'Belt · each copy loops at the formation\'s own spacing, so the arrangement never breaks'
                : 'Group · the whole formation travels out and back together, dissolving through the turn'}
              onClick={() => b.set(option.value)}
              className={`px-1 pb-0.5 pt-1 transition-colors ${active ? '' : 'bg-black/25 hover:bg-white/5'}`}
              style={active ? { background: CURRENT } : undefined}
            >
              <svg
                width="16"
                height="12"
                viewBox="0 0 16 12"
                fill={active ? '#000' : 'rgba(255,255,255,0.45)'}
                color={active ? '#000' : 'rgba(255,255,255,0.45)'}
              >
                {glyphs[option.value]}
              </svg>
            </button>
          )
        })}
      </div>
      <span className="mt-1 whitespace-nowrap text-[8px] font-semibold leading-[11px] tracking-[0.12em] text-white/40">
        LOOP
      </span>
      <span className="whitespace-nowrap font-mono text-[9px] leading-[12px] text-white/70">
        {b.def.options.find((option) => option.value === selected)?.label.toUpperCase() ?? ''}
      </span>
    </div>
  )
}

export const ConveyorMoverUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const speed = b.num('speed')
  const glide = b.num('glide')
  const loopStyle = b.select('loopStyle')
  const spanX = b.num('spanX')
  const fadeBeats = b.num('fadeBeats')

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

  if (!speed || !glide || !loopStyle || !spanX || !fadeBeats) return <ParameterList parameters={parameters} />

  return (
    <Console accent={CURRENT} testId="conveyor-user-interface">
      <ConveyorPreview settings={settings} />
      <div className="flex flex-col gap-2 pb-4 pt-3" style={{ background: spillOf(CURRENT) }}>
        {/* SPEED is the subject of the mover; the rest qualify it. FADE and the
            loop distance only bite when there is no lattice to tile (a lone
            object, an uneven formation) or when LOOP is set to GROUP - which the
            preview shows, so the pair is left visible rather than hidden. The
            other two loop distances are the same idea on axes the preview is not
            looking down, so they belong in MORE. */}
        <ControlRow className="gap-4 px-4">
          <FixedKnob b={speed} label="SPEED" format={perBeat} large />
          <FixedKnob b={glide} label="GLIDE" format={asBeats} />
          <LoopSelector b={loopStyle} />
          <FixedKnob b={spanX} label="GROUP X" format={asSpan} />
          <FixedKnob b={fadeBeats} label="FADE" format={asFade} />
        </ControlRow>
        <More parameters={b.rest()} label="MORE" className="px-3" />
      </div>
    </Console>
  )
}
