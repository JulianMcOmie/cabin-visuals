'use client'

// Bespoke settings for the Radial Motion mover, following
// docs/instrument-panel-design-guide.md (Laser Sphere is the reference,
// Conveyor the nearest mover sibling): a full-bleed panel washed in the mover's
// orbit violet, a LIVE preview up top, then the console.
//
// The console is a GRID rather than a row, because this mover's parameters are
// genuinely two-dimensional: the same four questions (how far out, how fast
// about Z, about X, about Y) asked once per nesting depth. Rows are the
// question, columns are the depth, so a column reads as one ring and a row
// reads as one gesture across all three. That is also why the knobs carry no
// captions of their own - the rail and the column headers already say what each
// one is, and twelve repeated captions would be pure noise.
//
// The spin knobs are BIPOLAR: their zero sits at 12 o'clock and the arc grows
// either way from it, so the X and Y rows read as dark/off at their defaults
// rather than as half-full. They are also STEPPED, like a tempo-synced rate
// switch on a plugin: the knob walks RADIAL_MOTION_SPIN_DETENTS (one turn per
// 2/4/8/16/32 beats, either way, or off) over an index domain, so the detents
// sit evenly on the arc and the readout speaks beats-per-turn, not degrees. A
// pre-quantization value that sits off the grid keeps its °-readout until the
// knob is touched, at which point it snaps.
//
// The preview is not a mockup - it runs the mover's real resolve() with NO
// NOTES AT ALL, which is precisely the claim the rework is making: the
// choreography is passive, and MIDI only accents it. If this window is still
// while the transport runs, the mover is broken.

import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { PreviewCanvas } from './console'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Color, InstancedMesh, Object3D, type OrthographicCamera } from 'three'
import { mergeDefinitionSettings } from '../core/visualCopies/definitions'
import { identityVisualCopy } from '../core/visualCopies/identityVisualCopy'
import {
  RADIAL_MOTION_DEPTHS,
  RADIAL_MOTION_DEPTH_LABELS,
  RADIAL_MOTION_SPIN_DETENTS,
  radialMotionCopies,
  radialMotionMover,
  radialMotionRadius,
  radialMotionSpinDetentIndex,
  radialMotionSpinDetentLabel,
  type RadialMotionSettings,
} from '../core/visualCopies/radialMotion'
import { isNumberParam } from '../instruments/types'
import { ParameterList } from './ParametersUserInterface'
import { withAlpha } from './colorWheel'
import { LaserKnob } from './laserKnob'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'
import { RADIAL_MOTION_COLOR } from '../core/visualCopies/identityColors'
import { clamp } from '../utils/math'

// The mover has no colour of its own (it only arranges and turns), so the panel
// wears what it evokes: an orbit, violet at the rim and cold blue at the core.
const ORBIT = RADIAL_MOTION_COLOR
const ORBIT_CORE = '#43dcff'
const ORBIT_SHADE = '#0c0a1a'
const ROOM = '#05070c'

// Shorter than the guide's usual ~148: this panel's console is a 4x3 GRID, and
// every pixel the window gives back is one the fourth knob row needs. Even so
// the whole panel lands near 450px - over the guide's ~240 budget, deliberately,
// because all four spin rows were asked to stay visible rather than fold into a
// disclosure. It scrolls, and the pane is draggable.
const PREVIEW_HEIGHT = 132
/** Orb radius as a fraction of the framed half-height, so the constellation
 *  reads the same whether the radii are dialled to 0.5 or to 12. */
const ORB_FRACTION = 0.06

// ── Preview ──────────────────────────────────────────────────────────────────

/** The reach of the whole nest at rest - what the camera has to frame. */
function totalRadius(settings: RadialMotionSettings): number {
  let total = 0
  for (let depth = 0; depth < RADIAL_MOTION_DEPTHS; depth++) {
    total += Math.max(0, radialMotionRadius(settings, depth))
  }
  return total
}

function totalCopies(settings: RadialMotionSettings): number {
  let count = 1
  for (let depth = 0; depth < RADIAL_MOTION_DEPTHS; depth++) {
    count *= radialMotionCopies(settings, depth)
  }
  return count
}

function RadialNest({ settings }: { settings: RadialMotionSettings }) {
  const meshRef = useRef<InstancedMesh>(null)
  const scratch = useRef({
    dummy: new Object3D(),
    color: new Color(),
    rim: new Color(ORBIT),
    core: new Color(ORBIT_CORE),
  }).current

  const nest = useMemo(() => ({
    settings,
    // No notes: the preview shows exactly what the mover does when nobody
    // plays it, which is the whole point of the rework.
    resolved: radialMotionMover.resolve({ settings, notes: [] }),
    source: identityVisualCopy(),
    counts: Array.from(
      { length: RADIAL_MOTION_DEPTHS },
      (_, depth) => radialMotionCopies(settings, depth),
    ),
    reach: totalRadius(settings),
  }), [settings])
  const live = useRef(nest)
  live.current = nest
  const count = totalCopies(settings)

  // Colour is fixed per SEAT, not per frame: an orb keeps its tint as it
  // travels, so the eye can follow one arm of the outer ring all the way round.
  const tints = useMemo(() => {
    const [outerCount, , innerCount] = nest.counts
    const color = new Color()
    return Array.from({ length: count }, (_, index) => {
      const inner = index % innerCount
      const outer = Math.floor(index / (nest.counts[1] * innerCount))
      color.copy(scratch.rim).lerp(scratch.core, outerCount > 1 ? outer / (outerCount - 1) : 0)
      // The innermost seats burn a little hotter, so the deepest nesting is
      // legible even when the rings overlap on screen.
      return color.clone().lerp(new Color(1, 1, 1), innerCount > 1 ? (inner / (innerCount - 1)) * 0.4 : 0.2)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, nest.counts.join()])

  useFrame(({ clock, camera, gl }) => {
    const mesh = meshRef.current
    if (!mesh) return
    const state = live.current
    const beat = clock.getElapsedTime() * 2

    // Framed by HEIGHT, not width: the subject is a disc in a short wide
    // window, so fitting the width would push the top and bottom off-frame.
    // Re-derived per frame from the canvas ELEMENT, like Conveyor's - the panel
    // is resizable and can mount while it is still collapsed, and r3f rewrites
    // a non-manual camera's projection into pixel units on resize.
    const width = gl.domElement.clientWidth
    const height = gl.domElement.clientHeight
    const orthographic = camera as OrthographicCamera
    const halfHeight = Math.max(1.4, state.reach * 1.18)
    if (width > 0 && height > 0) {
      const halfWidth = halfHeight * (width / height)
      if (orthographic.top !== halfHeight || orthographic.right !== halfWidth) {
        orthographic.top = halfHeight
        orthographic.bottom = -halfHeight
        orthographic.right = halfWidth
        orthographic.left = -halfWidth
        orthographic.zoom = 1
        orthographic.updateProjectionMatrix()
      }
    }

    const orb = halfHeight * ORB_FRACTION
    const copies = state.resolved.apply(state.source, { beat, index: 0, count: 1 })
    for (let index = 0; index < copies.length && index < count; index++) {
      const { dummy } = scratch
      dummy.matrix.copy(copies[index].transform)
      dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale)
      // The orb is chrome sized for the window, so its scale replaces whatever
      // the copy carried rather than multiplying it.
      dummy.scale.setScalar(orb)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
      mesh.setColorAt(index, tints[index] ?? scratch.rim)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh key={count} ref={meshRef} args={[undefined, undefined, count]} frustumCulled={false}>
      <sphereGeometry args={[1, 16, 12]} />
      {/* Unlit and over-bright: these are lights in a dark room, and the bloom
          below is what turns each one into an orb rather than a dot. */}
      <meshBasicMaterial color="#ffffff" toneMapped={false} />
    </instancedMesh>
  )
}

function RadialPreview({ settings }: { settings: RadialMotionSettings }) {
  return (
    <div
      data-testid="radial-motion-preview"
      className="relative overflow-hidden border-b border-white/[0.06]"
      style={{ height: PREVIEW_HEIGHT, background: ROOM }}
    >
      {/* Orthographic: concentric rings are the subject, and a perspective
          frustum would make the same radius read differently at the edges of
          the frame than at its centre. The frustum is set per frame above. */}
      <PreviewCanvas orthographic dpr={[1, 2]} camera={{ position: [0, 0, 20] }} gl={{ antialias: true, alpha: true }}>
        <color attach="background" args={[ROOM]} />
        <RadialNest settings={settings} />
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.85} luminanceThreshold={0.6} luminanceSmoothing={0.15} mipmapBlur radius={0.72} levels={6} />
        </EffectComposer>
      </PreviewCanvas>
    </div>
  )
}

// ── Console ──────────────────────────────────────────────────────────────────

const DEPTHS = Array.from({ length: RADIAL_MOTION_DEPTHS }, (_, depth) => depth)

/** Every key the grid places itself; anything else falls to MORE. */
const PLACED_KEYS = new Set(DEPTHS.flatMap((depth) => [
  `copies${depth}`, `radius${depth}`, `spinZ${depth}`, `spinX${depth}`, `spinY${depth}`,
]))

const GRID_ROWS = [
  { key: 'radius', label: 'RADIUS', bipolar: false, stepped: false },
  { key: 'spinZ', label: 'SPIN Z', bipolar: true, stepped: true },
  { key: 'spinX', label: 'SPIN X', bipolar: true, stepped: true },
  { key: 'spinY', label: 'SPIN Y', bipolar: true, stepped: true },
] as const

function GridKnob({ bound, rowLabel, depth, bipolar, stepped }: {
  bound: UserInterfaceParameter | undefined
  rowLabel: string
  depth: number
  bipolar: boolean
  stepped: boolean
}) {
  const definition = bound?.definition
  if (!bound || !definition || !isNumberParam(definition) || typeof bound.value !== 'number') {
    return <span />
  }
  const ariaLabel = `${RADIAL_MOTION_DEPTH_LABELS[depth]} ${rowLabel.toLowerCase()}`
  if (stepped) {
    // The knob turns in DETENT INDICES, not degrees: evenly spaced clicks on
    // the arc, converted back to the stored °/beat rate on the way out. Zero
    // is the middle index by construction, so the bipolar anchor lands on it.
    const value = bound.value
    const index = radialMotionSpinDetentIndex(value)
    const onGrid = RADIAL_MOTION_SPIN_DETENTS[index] === value
    return (
      <div className="flex justify-center">
        <LaserKnob
          value={index}
          min={0}
          max={RADIAL_MOTION_SPIN_DETENTS.length - 1}
          step={1}
          defaultValue={radialMotionSpinDetentIndex(definition.default)}
          label=""
          ariaLabel={ariaLabel}
          accent={ORBIT}
          bipolar
          // An off-grid value from before quantization keeps an honest degree
          // readout until the knob is touched and snaps it to a division.
          format={(knobIndex) => (onGrid
            ? radialMotionSpinDetentLabel(RADIAL_MOTION_SPIN_DETENTS[Math.round(knobIndex)] ?? 0)
            : `${value}°`)}
          onChange={(knobIndex) => {
            const detent = RADIAL_MOTION_SPIN_DETENTS[
              clamp(Math.round(knobIndex), 0, RADIAL_MOTION_SPIN_DETENTS.length - 1)
            ]
            if (detent !== value) bound.setValue(detent)
          }}
        />
      </div>
    )
  }
  return (
    <div className="flex justify-center">
      <LaserKnob
        value={bound.value}
        min={definition.min}
        max={definition.max}
        step={definition.step}
        defaultValue={definition.default}
        curve={definition.curve ?? 1}
        // Captions live on the rail and the column headers; the knob itself
        // only needs a spoken name.
        label=""
        ariaLabel={ariaLabel}
        accent={ORBIT}
        bipolar={bipolar}
        onChange={bound.setValue}
      />
    </div>
  )
}

/** A depth's column header: its name, and the count of copies seated on it.
 *  Counts are small integers where the exact number is the whole point (8, 4, 2
 *  nest; 7, 5, 3 do not), so this is a stepper and not a knob. */
function CountHeader({ bound, depth }: { bound: UserInterfaceParameter | undefined; depth: number }) {
  const definition = bound?.definition
  const value = typeof bound?.value === 'number' ? Math.round(bound.value) : 1
  const min = definition && isNumberParam(definition) ? definition.min : 1
  const max = definition && isNumberParam(definition) ? definition.max : 8
  const name = RADIAL_MOTION_DEPTH_LABELS[depth]

  const step = (direction: -1 | 1) => (
    <button
      aria-label={`${direction < 0 ? 'Fewer' : 'More'} ${name} copies`}
      disabled={direction < 0 ? value <= min : value >= max}
      onClick={() => bound?.setValue(clamp(value + direction, min, max))}
      className="flex h-[15px] w-[15px] items-center justify-center rounded-[3px] border border-white/10 bg-black/30 font-mono text-[10px] leading-none text-white/45 transition-colors hover:text-white/80 disabled:opacity-25 disabled:hover:text-white/45"
    >
      {direction < 0 ? '−' : '+'}
    </button>
  )

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[8px] font-semibold uppercase tracking-[0.14em] text-white/40">{name}</span>
      <div className="flex items-center gap-1">
        {step(-1)}
        <span className="w-3 text-center font-mono text-[10px] tabular-nums text-white/75">{value}</span>
        {step(1)}
      </div>
    </div>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

export const RadialMotionMoverUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
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
    return mergeDefinitionSettings(radialMotionMover, values) as unknown as RadialMotionSettings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuesKey])

  if ([...PLACED_KEYS].some((key) => !bound[key])) return <ParameterList parameters={parameters} />

  const unplaced = parameters.filter((p) => !PLACED_KEYS.has(p.definition.key))

  return (
    <section
      data-testid="radial-motion-user-interface"
      className="-mx-3 -mt-3"
      style={{ background: ORBIT_SHADE }}
    >
      <RadialPreview settings={settings} />
      <div
        className="flex flex-col gap-2 px-3 pb-3 pt-2.5"
        // The nest's light spilling through the seam onto the console - the
        // room is lit by the mover, not painted.
        style={{ background: `radial-gradient(58% 30px at 50% 0, ${withAlpha(ORBIT, 0.13)}, transparent)` }}
      >
        <div
          className="grid items-start gap-x-1 gap-y-1"
          style={{ gridTemplateColumns: '52px repeat(3, minmax(0, 1fr))' }}
        >
          <span />
          {DEPTHS.map((depth) => (
            <CountHeader key={depth} bound={bound[`copies${depth}`]} depth={depth} />
          ))}
          {GRID_ROWS.map((row) => (
            <RowCells key={row.key} row={row} bound={bound} />
          ))}
        </div>
        {unplaced.length > 0 && (
          <div>
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

/** One question asked across all three depths: the rail label, then a knob per
 *  column. Fragment rather than a row element, so the cells stay in the grid. */
function RowCells({ row, bound }: {
  row: (typeof GRID_ROWS)[number]
  bound: Record<string, UserInterfaceParameter>
}) {
  return (
    <>
      {/* h-11 matches the knob face, so the rail label centres on the knob
          rather than on the knob-plus-readout column. */}
      <span className="flex h-11 items-center justify-end pr-1 text-right text-[8px] font-semibold tracking-[0.12em] text-white/35">
        {row.label}
      </span>
      {DEPTHS.map((depth) => (
        <GridKnob
          key={depth}
          bound={bound[`${row.key}${depth}`]}
          rowLabel={row.label}
          depth={depth}
          bipolar={row.bipolar}
          stepped={row.stepped}
        />
      ))}
    </>
  )
}
