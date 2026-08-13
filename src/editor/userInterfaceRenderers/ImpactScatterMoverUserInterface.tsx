'use client'

// Bespoke settings for the Impact Scatter mover, following
// docs/instrument-panel-design-guide.md (Laser Sphere is the reference): a
// full-bleed panel washed in the mover's shock-blue shade, a LIVE preview up
// top, then three knobs - IMPACT (a size larger, with an overdrive detent at
// 100%), RECOVER, CHAOS - and a segmented CURVE selector, with placement behind
// MORE.
//
// The preview is not a mockup: it runs the mover's real resolve() - the same
// integrated impulse simulation, the same leash and pileup - over a looping
// performance, and applies the returned transforms to a FIELD OF OBJECTS, the
// same wide flat grid the Colorizer's panel uses and indexed row-major exactly
// the way a Grid splitter indexes its copies.
//
// Why a GRID and not a scatter of debris: the whole promise of this mover is
// "blown apart, then back into place", and you cannot see something return to
// place unless the place is obvious. A dead-straight lattice makes both halves
// legible - it shatters into chaos and then resolves back to perfect rows, which
// is the moment that sells the effect.
//
// Under it, a metronomic hit every two beats: the knobs are what the panel is
// about, so the performance stays out of the way and lets every change read on
// the next hit.

import { useMemo, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import {
  Color,
  Euler,
  InstancedMesh,
  Matrix4,
  Object3D,
  PointLight,
  Vector3,
  type OrthographicCamera,
} from 'three'
import {
  CURVE_EVEN,
  CURVE_SPIKE,
  CURVE_SWELL,
  IMPACT_DETENT,
  SCATTER_IMPACT_PITCH,
  impactScatterMover,
  tune,
  type ImpactScatterSettings,
} from '../core/visualCopies/impactScatter'
import { mergeDefinitionSettings } from '../core/visualCopies/definitions'
import type { ResolvedNote } from '../core/visual/types'
import {
  bindPanel,
  Console,
  ControlRow,
  More,
  ParameterList,
  PreviewWindow,
  spillOf,
  towardWhite,
  type NumBinding,
  type SelectBinding,
} from './console'
import type { UserInterfaceRendererDefinition } from './types'
import { IMPACT_SCATTER_COLOR } from '../core/visualCopies/identityColors'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

// The mover has no color param (its flash is a SHIFT of each object's own
// colour), so the panel wears the material it evokes: cold kinetic shock.
const SHOCK = IMPACT_SCATTER_COLOR
const ROOM = '#04070a'

// ── The looping demo performance ─────────────────────────────────────────────
// One full-power hit every two beats, forever. The preview's job is to show what
// the knobs do to a single blast-and-recover, and a metronomic pulse shows that
// better than a written performance did - nothing to wait for, and every knob
// change reads on the very next hit.
//
// Two details make the loop seamless:
//
//  - The pulse is TILED well before beat 0 rather than starting there. The mover
//    integrates each cluster of hits from rest, so a list that began at the loop
//    start would show a first hit landing on a dead field and then jump at the
//    wrap. A long lead-in puts the field in steady periodic motion instead.
//  - The loop is TWO pulses long, because consecutive hits scatter in opposite
//    lateral senses (the mover alternates parity so a roll churns rather than
//    repeating). The real period of the motion is therefore two hits, and a
//    one-hit loop would visibly snap every time it wrapped.

const PULSE_BEATS = 2
const LOOP_BEATS = PULSE_BEATS * 2
const LEAD_IN_PULSES = 24

const PREVIEW_NOTES: ResolvedNote[] = Array.from(
  { length: LEAD_IN_PULSES + 3 },
  (_, index): ResolvedNote => ({
    beat: (index - LEAD_IN_PULSES) * PULSE_BEATS,
    pitch: SCATTER_IMPACT_PITCH,
    durationBeats: 0.25,
    velocity: 1,
    blockStartBeat: -LEAD_IN_PULSES * PULSE_BEATS,
    blockEndBeat: LOOP_BEATS + PULSE_BEATS,
  }),
)

// ── The field ────────────────────────────────────────────────────────────────
// Wide enough to bleed off both edges at any panel width - a field that stops
// short of the frame reads as a diagram of a field rather than as one - and tall
// enough that the blast reads as RADIAL rather than as a line being pushed
// around.
//
// Flat and face-on costs the Z component of the throw, which is worth paying:
// measured over the visible window, Z is 0% of the motion at CHAOS 0 (a pure
// radial pulse is entirely in-plane) rising to ~40% at CHAOS 1. So depth is paid
// back as TONE instead of geometry - a piece thrown away from the camera sinks
// toward the room, one thrown forward lifts - which keeps CHAOS reading at full
// strength without shearing the outer columns into a perspective view.

const FIELD_COLUMNS = 26
const FIELD_ROWS = 5
const FIELD_COUNT = FIELD_COLUMNS * FIELD_ROWS
const SPACING = 1.05
/** World-space height the camera frames: the rows plus a little air. */
const FIELD_WORLD_HEIGHT = (FIELD_ROWS - 1) * SPACING + 1.7
const FIELD_HEIGHT = 168
/** Z displacement that reads as fully receded (or fully forward). */
const DEPTH_RANGE = 2

// A full-power blast throws a piece several times further than this window is
// tall, so past a point the field simply leaves the frame and the panel goes
// black - which is how the preview looked before this knee existed.
//
// Beyond PREVIEW_THROW the displacement is COMPRESSED rather than clipped or
// normalized: on-screen travel keeps growing with IMPACT (as peak^0.45), so the
// knob still visibly does something all the way to overdrive, instead of
// saturating at a ceiling. Only the absolute distance is bent - shape, timing,
// falloff and the return are the mover's own. A 168px window cannot convey an
// absolute distance anyway; it has to convey the gesture, which is the same
// trade Bass Ripple's preview makes.
/** Throw, in world units, that the window shows unscaled. */
const PREVIEW_THROW = 1.6
const PREVIEW_COMPRESSION = 0.55

const HOT = new Color('#eaf9ff')
/** Cold steel: what the field is when nothing is happening to it. */
const FIELD_COOL = '#6f86a8'

/** A neutral three-quarter rest pose, so a cube at rest reads as a solid rather
 *  than a flat square and the mover's own tumble has something to turn. */
const REST_POSE = new Euler(0.34, 0.6, 0)

function ScatterField({ settings }: { settings: ImpactScatterSettings }) {
  const meshRef = useRef<InstancedMesh>(null)
  const coreRef = useRef<PointLight>(null)
  const scratch = useRef({
    dummy: new Object3D(),
    base: new Matrix4(),
    rest: new Matrix4().makeRotationFromEuler(REST_POSE),
    home: new Vector3(),
    color: new Color(),
    cool: new Color(FIELD_COOL),
    warm: new Color(SHOCK),
    room: new Color(ROOM),
  }).current

  // Rebuilding on settings identity is deliberate: resolve() integrates the
  // channel tables once per change (a few ms), then apply() is a cheap pure
  // table read per copy per frame.
  const resolved = useMemo(
    () => impactScatterMover.resolve({ settings, notes: PREVIEW_NOTES }),
    [settings],
  )
  // The mover's own falloff, so the warm pool in the field IS its reach - turning
  // IMPACT up visibly widens the area that will be hit hard, before a hit lands.
  const reach = useMemo(() => Math.max(0.0001, tune(settings).reach), [settings])

  // MEASURED, not modelled: peak throw is wildly nonlinear in the settings
  // (quadratic drag, the cubic leash, pileup), so the knee is set by sampling one
  // representative copy across the loop. ~64 table reads, once per settings
  // change, next to a resolve() that already costs a few ms.
  const throwScale = useMemo(() => {
    const home = new Vector3(settings.centerX + SPACING, settings.centerY, settings.centerZ)
    const probe = new Matrix4().makeTranslation(home.x, home.y, home.z)
    const point = new Vector3()
    let peak = 0
    for (let beat = 0; beat < LOOP_BEATS; beat += 1 / 16) {
      const [out] = resolved.apply(
        { transform: probe, opacity: 1, colorShift: { hue: 0, saturation: 0, lightness: 0, tint: null, tintAmount: 0 } },
        { beat, index: 0, count: FIELD_COUNT },
      )
      peak = Math.max(peak, point.setFromMatrixPosition(out.transform).sub(home).length())
    }
    return peak > PREVIEW_THROW ? Math.pow(PREVIEW_THROW / peak, PREVIEW_COMPRESSION) : 1
  }, [resolved, settings])

  const live = useRef({ resolved, settings, reach, throwScale })
  live.current = { resolved, settings, reach, throwScale }

  useFrame(({ clock, camera, gl }) => {
    const mesh = meshRef.current
    if (!mesh) return
    const { dummy, base, rest, home, color, cool, warm, room } = scratch
    const beat = (clock.getElapsedTime() * 2) % LOOP_BEATS
    const current = live.current

    // The frustum is derived from the canvas ELEMENT rather than left to the
    // renderer's measured size: this panel lives in a resizable pane and can
    // mount while it is still collapsed, and a stale measurement leaves the
    // field framed for a width the panel no longer has. Reading the DOM is the
    // one source that cannot go stale. Re-derived per frame so that r3f's own
    // resize handling (it rewrites a non-manual camera's projection into PIXEL
    // units) is corrected on the next tick. Do not switch the camera to
    // `manual` to avoid that: r3f then never initialises the projection at all
    // and the field renders as an invisible speck.
    const width = gl.domElement.clientWidth
    const height = gl.domElement.clientHeight
    const orthographic = camera as OrthographicCamera
    if (width > 0 && height > 0) {
      const halfHeight = FIELD_WORLD_HEIGHT / 2
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

    let energy = 0
    // Placement is rewritten every frame rather than cached: a settings change
    // rebuilds the instanced mesh's buffers, and a "laid out once" flag that
    // outlives them leaves every cube stacked at the origin.
    for (let index = 0; index < FIELD_COUNT; index++) {
      const column = index % FIELD_COLUMNS
      const row = Math.floor(index / FIELD_COLUMNS)
      home.set(
        current.settings.centerX + (column - (FIELD_COLUMNS - 1) / 2) * SPACING,
        current.settings.centerY + ((FIELD_ROWS - 1) / 2 - row) * SPACING,
        current.settings.centerZ,
      )
      // The rest pose rides INSIDE the copy transform: the mover reads the home
      // position off its translation, so the pose is invisible to the physics
      // and the tumble composes on top of it.
      base.makeTranslation(home.x, home.y, home.z).multiply(rest)
      const [result] = current.resolved.apply(
        { transform: base, opacity: 1, colorShift: { hue: 0, saturation: 0, lightness: 0, tint: null, tintAmount: 0 } },
        { beat, index, count: FIELD_COUNT },
      )
      dummy.matrix.copy(result.transform)
      dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale)
      // Only the TRAVEL is compressed - the tumble and the squash keep the
      // magnitudes the mover gave them, so the piece still reads as flying.
      if (current.throwScale < 1) {
        dummy.position.sub(home).multiplyScalar(current.throwScale).add(home)
      }
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)

      // Cold steel far out, shock-blue where the hit will land hardest - the
      // mover's own distance falloff, so the center and its reach are visible.
      const spread = Math.hypot(home.x - current.settings.centerX, home.y - current.settings.centerY)
      const gain = 1 / (1 + (spread / current.reach) * (spread / current.reach))
      color.copy(cool).lerp(warm, clamp(gain * 0.8, 0, 1))
      // The flash's lightness shift IS kinetic energy, so a piece burns while it
      // is flying and cools as it drifts home.
      const heat = clamp(result.colorShift.lightness * 3, 0, 1)
      if (heat > 0) {
        color.lerp(HOT, heat)
        energy += heat
      }
      // Depth as tone, standing in for the Z the flat view cannot show.
      const depth = clamp((dummy.position.z - home.z) / DEPTH_RANGE, -1, 1)
      if (depth < 0) color.lerp(room, -depth * 0.6)
      else if (depth > 0) color.multiplyScalar(1 + depth * 0.3)
      mesh.setColorAt(index, color)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    // The room is lit BY the field: the core light answers the summed heat, so
    // an impact flashes the whole space and a settle lets it go dark.
    if (coreRef.current) {
      coreRef.current.intensity = 1.5 + clamp(energy / FIELD_COUNT, 0, 1) * 42
    }
  })

  return (
    <>
      <instancedMesh ref={meshRef} args={[undefined, undefined, FIELD_COUNT]} frustumCulled={false}>
        <boxGeometry args={[0.62, 0.62, 0.62]} />
        <meshStandardMaterial metalness={0.35} roughness={0.32} color="#ffffff" />
      </instancedMesh>
      <pointLight
        ref={coreRef}
        position={[settings.centerX, settings.centerY, settings.centerZ + 3]}
        color={SHOCK}
        intensity={1.5}
        distance={18}
        decay={2}
      />
    </>
  )
}

function ScatterPreview({ settings }: { settings: ImpactScatterSettings }) {
  return (
    <PreviewWindow height={FIELD_HEIGHT} testId="impact-scatter-preview">
      {/* Orthographic on purpose: the panel is short and very wide, so a
          perspective frustum wide enough to fill it shears the outer columns into
          trapezoids and makes the same throw look bigger at the edges than at the
          middle. Flat projection keeps every piece the same size, which is what
          makes the falloff comparable across the field. The frustum itself is set
          per frame in ScatterField. */}
      <Canvas orthographic dpr={[1, 2]} camera={{ position: [0, 0, 14] }} gl={{ antialias: true, alpha: true }}>
        <color attach="background" args={[ROOM]} />
        <ScatterField settings={settings} />
        <directionalLight position={[3, 6, 8]} intensity={1.35} color="#dfe8ff" />
        <directionalLight position={[-6, -2, 4]} intensity={0.4} color={SHOCK} />
        <ambientLight intensity={0.3} />
        {/* Gentler than the laser pass: the cubes are tone-mapped, so the
            threshold sits below 1 and only white-hot pieces bloom. */}
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.6} luminanceThreshold={0.7} luminanceSmoothing={0.2} mipmapBlur radius={0.72} levels={6} />
        </EffectComposer>
      </Canvas>
    </PreviewWindow>
  )
}

// ── Knobs ────────────────────────────────────────────────────────────────────

/**
 * Flat knob per the guide: the value arc IS the light - a wide soft bloom under
 * a hot core, white-hot tip dot at the terminus. Vertical drag, double-click
 * resets, arrows nudge.
 *
 * Two behaviours beyond a plain knob, both for IMPACT:
 *
 *  - a DETENT at 100%. The knob travels to 110%, but 100% is where the effect
 *    was designed to top out, so the arc catches there and the pointer has to
 *    travel a further ~16px to break past it. You feel the limit before you
 *    choose to exceed it, which is the whole point of an overdrive.
 *  - past the detent the arc, its bloom and the readout go ORANGE. Nothing else
 *    on the panel is warm, so overdrive is visible at a glance.
 */

/** Overdrive. The only warm colour on the panel, so it means one thing. */
const OVERDRIVE = '#ff8a3c'
/** Laser Sphere's knob scale: the primary param one step larger than the rest. */
const PRIMARY_KNOB = 52
const KNOB = 44
/** Pointer travel needed to break past the detent. */
const CATCH_PX = 16

function ShockKnob({ b, label, format, size = KNOB, detent }: {
  b: NumBinding | null
  label: string
  /** Reads the value in the unit a person thinks in (percent, beats, a word). */
  format?: (value: number) => string
  size?: number
  /** Value the arc catches on, if any. */
  detent?: number
}) {
  const dragRef = useRef<{ y: number; norm: number; catchY: number | null } | null>(null)
  if (!b) return null
  const { def: definition, value } = b
  const range = definition.max - definition.min
  const percent = range === 0 ? 0 : clamp((value - definition.min) / range, 0, 1)
  const angle = -135 + percent * 270
  const detentPercent = detent != null && range > 0
    ? clamp((detent - definition.min) / range, 0, 1)
    : null
  const overdriven = detentPercent != null && percent > detentPercent + 1e-6
  const accent = overdriven ? OVERDRIVE : SHOCK

  // Arc geometry in the conic gradient's own frame (0deg = 7 o'clock).
  const arcFrom = 0
  const arcTo = percent * 270
  const detentSweep = detentPercent == null ? null : detentPercent * 270
  /** Cool up to the detent, warm past it - one gradient, two meanings. */
  const arc = (cool: string, warm: string) => {
    const stops = detentSweep != null && arcTo > detentSweep
      ? `transparent 0deg ${arcFrom}deg, ${cool} ${arcFrom}deg ${detentSweep}deg, ${warm} ${detentSweep}deg ${arcTo}deg, transparent ${arcTo}deg 360deg`
      : `transparent 0deg ${arcFrom}deg, ${cool} ${arcFrom}deg ${arcTo}deg, transparent ${arcTo}deg 360deg`
    return `conic-gradient(from 225deg, ${stops})`
  }

  const commitNorm = (t: number) => {
    const raw = definition.min + clamp(t, 0, 1) * range
    const snapped = definition.min + Math.round((raw - definition.min) / definition.step) * definition.step
    b.set(clamp(Number(snapped.toFixed(8)), definition.min, definition.max))
  }
  const crosses = (target: number) => detentPercent != null
    && ((percent < detentPercent && target > detentPercent)
      || (percent > detentPercent && target < detentPercent))

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
    dragRef.current = { y: event.clientY, norm: percent, catchY: null }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const target = drag.norm + (drag.y - event.clientY) / 140
    if (detentPercent != null) {
      if (drag.catchY != null) {
        // Held on the detent until the pointer has clearly kept going.
        if (Math.abs(event.clientY - drag.catchY) < CATCH_PX) return commitNorm(detentPercent)
        // Broken out: re-anchor at the detent so motion resumes from there
        // rather than jumping by the travel spent breaking free.
        drag.norm = detentPercent
        drag.y = event.clientY
        drag.catchY = null
        return
      }
      if (crosses(target)) {
        drag.catchY = event.clientY
        return commitNorm(detentPercent)
      }
    }
    commitNorm(target)
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
    event.preventDefault()
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1
    const target = percent + direction * 0.03
    // The keyboard gets the detent too: one press lands on it, the next passes.
    commitNorm(crosses(target) && detentPercent != null ? detentPercent : target)
  }

  return (
    // Fixed column width: the readouts change length as you turn ("even" →
    // "percussive", "55%" → "110%"), and a row that reflows while you are
    // dragging is unusable. The knob centres inside the column instead.
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
        onDoubleClick={() => b.set(definition.default)}
        onKeyDown={onKeyDown}
        className="relative cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        style={{ width: size, height: size }}
      >
        <div
          className="absolute inset-0 rounded-full transition-shadow duration-150"
          style={{
            background: arc(SHOCK, OVERDRIVE),
            filter: 'blur(6px)',
            transform: 'scale(1.14)',
            opacity: 0.85,
          }}
        />
        <div
          className="absolute inset-0 rounded-full"
          style={{ background: arc(towardWhite(SHOCK, 0.4), towardWhite(OVERDRIVE, 0.35)) }}
        />
        {/* The unlit remainder of the travel, so the arc reads as a fill. */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(from 225deg, transparent 0deg ${arcTo}deg, rgba(255,255,255,0.07) ${arcTo}deg 270deg, transparent 270deg)`,
          }}
        />
        <div className="absolute inset-[3px] rounded-full border border-white/10 bg-[#0f151b]" />
        {/* Where the knob catches: the designed limit, marked. */}
        {detentPercent != null && (
          <div className="absolute inset-0" style={{ transform: `rotate(${-135 + detentPercent * 270}deg)` }}>
            <span
              className="absolute left-1/2 -translate-x-1/2 rounded-full bg-white/45"
              style={{ top: -2, height: 4, width: 1.5 }}
            />
          </div>
        )}
        <div className="absolute inset-0" style={{ transform: `rotate(${angle}deg)` }}>
          <span
            className="absolute left-1/2 -translate-x-1/2 rounded-full bg-white/90"
            style={{ top: size * 0.12, height: size * 0.24, width: 2 }}
          />
          <span
            className="absolute left-1/2 top-[-1px] h-1 w-1 -translate-x-1/2 rounded-full bg-white"
            style={{ boxShadow: `0 0 5px 1.5px ${accent}` }}
          />
        </div>
      </div>
      {/* Laser Sphere's caption scale, on fixed line heights: the knobs differ
          in size, their captions must not, or the row stops reading as a row. */}
      <span className="mt-1 whitespace-nowrap text-[8px] font-semibold leading-[11px] tracking-[0.12em] text-white/40">
        {label}
      </span>
      <span
        className="whitespace-nowrap font-mono text-[9px] leading-[12px] tabular-nums"
        style={{ color: overdriven ? OVERDRIVE : 'rgba(255,255,255,0.7)' }}
      >
        {format ? format(value) : definition.step >= 1 ? value.toFixed(0) : value.toFixed(2)}
      </span>
    </div>
  )
}


// ── Panel ────────────────────────────────────────────────────────────────────

/** Percent reads as "how much" at a glance; 0.55 does not. Straight off the
 *  value, not off the range, so IMPACT's overdrive shows as 110%. */
const asPercent = (value: number) => `${Math.round(value * 100)}%`

const asBeats = (value: number) => `${value.toFixed(value < 10 ? 1 : 0)} beat${value === 1 ? '' : 's'}`

/**
 * Segmented return-curve selector, following the Colorizer's ShapeSelector: each
 * option DRAWS its own falloff, so the choice is legible without reading the
 * word, and the caption stack matches the knobs' so the row keeps one baseline.
 * The glyph paths are the Colorizer's - same curve, same picture, same words.
 */
const SHAPE_GLYPHS: Record<number, string> = {
  [CURVE_SPIKE]: 'M1 11 L3 1 C4.5 8 7 10 15 10.6',
  [CURVE_EVEN]: 'M1 11 L3 1 L15 10.6',
  [CURVE_SWELL]: 'M1 11 L3 1 C9 1.4 11 4 15 10.6',
}

function ShapeSelector({ b }: { b: SelectBinding }) {
  const selected = Math.round(b.value)
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
              title={`${option.label} recovery`}
              onClick={() => b.set(option.value)}
              className={`px-1 pb-0.5 pt-1 transition-colors ${active ? '' : 'bg-black/25 hover:bg-white/5'}`}
              style={active ? { background: SHOCK } : undefined}
            >
              <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
                <path
                  d={SHAPE_GLYPHS[option.value] ?? SHAPE_GLYPHS[CURVE_EVEN]}
                  stroke={active ? '#000' : 'rgba(255,255,255,0.45)'}
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )
        })}
      </div>
      <span className="mt-1 whitespace-nowrap text-[8px] font-semibold leading-[11px] tracking-[0.12em] text-white/40">
        CURVE
      </span>
      <span className="whitespace-nowrap font-mono text-[9px] leading-[12px] text-white/70">
        {b.def.options.find((option) => option.value === selected)?.label.toUpperCase() ?? ''}
      </span>
    </div>
  )
}

export const ImpactScatterMoverUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const impact = b.num('impact')
  const recoverBeats = b.num('recoverBeats')
  const chaos = b.num('chaos')
  const curve = b.select('curve')

  // The preview's settings: every bound numeric value over the definition's
  // defaults. Memoized on the VALUES so resolve() reruns only on real change.
  // Computed before the fallback return below - hooks must run unconditionally.
  const valuesKey = parameters
    .map((p) => `${p.definition.key}:${typeof p.value === 'number' ? p.value : ''}`)
    .join('|')
  const settings = useMemo(() => {
    const values: Record<string, number> = {}
    for (const p of parameters) if (typeof p.value === 'number') values[p.definition.key] = p.value
    return mergeDefinitionSettings(impactScatterMover, values) as unknown as ImpactScatterSettings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuesKey])

  if (!impact || !recoverBeats || !chaos || !curve) return <ParameterList parameters={parameters} />

  return (
    <Console accent={SHOCK} testId="impact-scatter-user-interface">
      <ScatterPreview settings={settings} />
      <div className="flex flex-col gap-2 pb-4 pt-3" style={{ background: spillOf(SHOCK) }}>
        {/* Laser Sphere's console row: knobs gathered at the left, one step of
            size between the primary param and the rest (52 / 44). IMPACT is the
            subject of the mover; the other three qualify it. */}
        <ControlRow className="gap-5 px-4">
          <ShockKnob b={impact} label="IMPACT" format={asPercent} size={PRIMARY_KNOB} detent={IMPACT_DETENT} />
          <ShockKnob b={recoverBeats} label="RECOVER" format={asBeats} size={KNOB} />
          <ShockKnob b={chaos} label="CHAOS" format={asPercent} size={KNOB} />
          <ShapeSelector b={curve} />
        </ControlRow>
        <More parameters={b.rest()} label="MORE" className="px-3" />
      </div>
    </Console>
  )
}
