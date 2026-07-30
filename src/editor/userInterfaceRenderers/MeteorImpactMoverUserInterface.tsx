'use client'

// Bespoke settings for the Meteor Impact mover, following
// docs/instrument-panel-design-guide.md (Laser Sphere is the reference): a
// full-bleed panel washed in the meteor's ember shade, a LIVE preview up top,
// then rows of flat knobs grouped by what they mean - IMPACT, FEEL, MOTION,
// VORTEX - with the housekeeping params tucked behind a MORE disclosure.
//
// The preview is not a mockup: it feeds the mover's real resolve() - the RK4
// spring integration, shockwave propagation, dispersion, swirl, and vortex -
// with a looping note pattern (one hard impact, a vortex hold, a soft impact
// riding the spin) and applies the returned transforms to a field of small
// gem icosahedra every frame. What ripples here is exactly what ripples on
// stage, so every knob reads live.

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Color, InstancedMesh, Matrix4, Object3D } from 'three'
import {
  METEOR_IMPACT_PITCH,
  VORTEX_OUT_PITCH,
  meteorImpactMover,
  type MeteorImpactSettings,
} from '../core/visualCopies/meteorImpact'
import { mergeDefinitionSettings } from '../core/visualCopies/definitions'
import type { ResolvedNote } from '../core/visual/types'
import { isNumberParam } from '../instruments/types'
import { ParameterList } from './ParametersUserInterface'
import { towardWhite, withAlpha } from './colorWheel'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

// The meteor's signature ember. The mover has no color param (its flash is a
// SHIFT of each object's own color), so the panel wears the material it
// evokes: molten rock.
const EMBER = '#ff8a3c'
const EMBER_SHADE = '#140b06'
const ROOM = '#05070c'

// ── The looping demo performance ─────────────────────────────────────────────
// An 8-beat loop at a notional 120 BPM: one full-power impact out of rest, a
// vortex hold spinning the field up, and a softer impact riding the flow -
// impact, vortex, and their composition all read in one pass. The loop wraps
// at a quiet moment (vortex released, springs settled).

const LOOP_BEATS = 8

const note = (beat: number, pitch: number, durationBeats: number, velocity: number): ResolvedNote => ({
  beat,
  pitch,
  durationBeats,
  velocity,
  blockStartBeat: 0,
  blockEndBeat: LOOP_BEATS,
})

const PREVIEW_NOTES: ResolvedNote[] = [
  note(0.5, METEOR_IMPACT_PITCH, 0.25, 1),
  note(3, VORTEX_OUT_PITCH, 3, 0.9),
  note(4.75, METEOR_IMPACT_PITCH, 0.25, 0.6),
]

// ── The gem field ────────────────────────────────────────────────────────────
// Concentric rings around the impact center, in the plane the swirl axis
// spins - so the shockwave front, the swirl, and the vortex all read at
// their best. Deterministic jitter keeps it organic without playback state.

interface FieldSlot {
  offset: [number, number, number]
  tone: number
}

const RINGS: Array<{ radius: number; count: number }> = [
  { radius: 1.3, count: 6 },
  { radius: 2.15, count: 10 },
  { radius: 3.0, count: 13 },
  { radius: 3.85, count: 16 },
  { radius: 4.7, count: 19 },
]

function hash(n: number): number {
  return ((Math.sin(n * 127.1) * 43758.5453) % 1 + 1) % 1
}

function buildField(swirlAxis: number): FieldSlot[] {
  const slots: FieldSlot[] = []
  let seed = 1
  for (const ring of RINGS) {
    for (let i = 0; i < ring.count; i++) {
      seed += 1
      const angle = (i / ring.count) * Math.PI * 2 + hash(seed) * 0.5
      const radius = ring.radius * (0.92 + hash(seed + 0.3) * 0.16)
      const u = Math.cos(angle) * radius
      const v = Math.sin(angle) * radius
      const w = (hash(seed + 0.6) - 0.5) * 0.7
      // The ring plane is perpendicular to the swirl axis: 0=X → YZ plane,
      // 1=Y → ground XZ, 2=Z → face-on XY wall.
      const offset: [number, number, number] = swirlAxis === 0 ? [w, u, v] : swirlAxis === 1 ? [u, w, v] : [u, v, w]
      slots.push({ offset, tone: hash(seed + 0.9) })
    }
  }
  return slots
}

const COPY_COUNT = RINGS.reduce((sum, ring) => sum + ring.count, 0)

const scratchWhite = new Color('#fff3dd')

function GemField({ settings }: { settings: MeteorImpactSettings }) {
  const meshRef = useRef<InstancedMesh>(null)
  const scratch = useRef({
    dummy: new Object3D(),
    base: new Matrix4(),
    color: new Color(),
    room: new Color(ROOM),
    cool: new Color('#8f6f5a'),
    warm: new Color(EMBER),
  }).current

  // Rebuilding on settings identity is deliberate: resolve() integrates the
  // spring response once per change (a few ms), then apply() is a cheap pure
  // sample per copy per frame.
  const resolved = useMemo(() => meteorImpactMover.resolve({ settings, notes: PREVIEW_NOTES }), [settings])
  const field = useMemo(() => buildField(Math.round(settings.swirlAxis)), [settings.swirlAxis])
  const live = useRef({ resolved, settings, field })
  live.current = { resolved, settings, field }

  useFrame(({ clock }) => {
    const mesh = meshRef.current
    if (!mesh) return
    const { dummy, base, color, room, cool, warm } = scratch
    const beat = (clock.getElapsedTime() * 2) % LOOP_BEATS
    const current = live.current
    for (let i = 0; i < current.field.length; i++) {
      const slot = current.field[i]
      base.makeTranslation(
        current.settings.centerX + slot.offset[0],
        current.settings.centerY + slot.offset[1],
        current.settings.centerZ + slot.offset[2],
      )
      const [result] = current.resolved.apply(
        { transform: base, opacity: 1, colorShift: { hue: 0, saturation: 0, lightness: 0, tint: null, tintAmount: 0 } },
        { beat, index: i, count: current.field.length },
      )
      dummy.matrix.copy(result.transform)
      dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      // Each gem sits somewhere between cool rock and ember; the flash's
      // lightness shift drives it toward white heat, and the vortex's wrap
      // fade sinks it toward the room instead of alpha (instances can't).
      color.copy(cool).lerp(warm, 0.25 + slot.tone * 0.5)
      const heat = clamp(result.colorShift.lightness * 2.2, 0, 1.6)
      if (heat > 0) color.lerp(scratchWhite, clamp(heat, 0, 1))
      color.offsetHSL(clamp(result.colorShift.hue, -0.5, 0.5) * 0.35, 0, 0)
      color.lerp(room, 1 - clamp(result.opacity, 0, 1))
      mesh.setColorAt(i, color)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, COPY_COUNT]} frustumCulled={false}>
      <icosahedronGeometry args={[0.17, 0]} />
      <meshStandardMaterial metalness={0.55} roughness={0.28} color="#ffffff" />
    </instancedMesh>
  )
}

function ImpactPreview({ settings }: { settings: MeteorImpactSettings }) {
  const groundImpact = Math.round(settings.swirlAxis) === 1
  return (
    <div
      data-testid="meteor-impact-preview"
      title="Drag to orbit the field"
      className="relative h-[188px] cursor-grab overflow-hidden border-b border-white/[0.06] active:cursor-grabbing"
      style={{ background: ROOM }}
    >
      <Canvas
        dpr={[1, 2]}
        camera={{ position: groundImpact ? [0, 5.2, 7.6] : [0, 1.4, 8.6], fov: 42 }}
        gl={{ antialias: true, alpha: true }}
      >
        <color attach="background" args={[ROOM]} />
        <GemField settings={settings} />
        {/* Ember core light at the impact center - the meteor's afterglow. */}
        <pointLight
          position={[settings.centerX, settings.centerY, settings.centerZ]}
          color={EMBER}
          intensity={9}
          distance={16}
          decay={2}
        />
        <directionalLight position={[4, 7, 5]} intensity={1.1} color="#cfd8ff" />
        <ambientLight intensity={0.12} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, groundImpact ? -1.6 : -3.4, 0]}>
          <circleGeometry args={[14, 48]} />
          <meshStandardMaterial color="#080b11" roughness={1} metalness={0} />
        </mesh>
        {/* Gentler pass than the laser's: gems are tone-mapped, so the
            threshold sits below 1 and only the white-hot flash blooms. */}
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.55} luminanceThreshold={0.72} luminanceSmoothing={0.18} mipmapBlur radius={0.7} levels={6} />
        </EffectComposer>
        <OrbitControls
          makeDefault
          target={[settings.centerX, settings.centerY, settings.centerZ]}
          enablePan={false}
          enableZoom={false}
          enableDamping
          dampingFactor={0.08}
          minPolarAngle={0.15}
          maxPolarAngle={Math.PI * 0.72}
        />
      </Canvas>
    </div>
  )
}

// ── Knobs ────────────────────────────────────────────────────────────────────

/** Flat ember knob per the guide: the value arc IS the molten seam - a wide
 *  soft ember bloom under a hot core, white-hot tip dot at the terminus.
 *  Vertical drag, double-click resets, arrows nudge. */
function EmberKnob({ parameter: bound, label, large = false }: {
  parameter: UserInterfaceParameter
  label: string
  large?: boolean
}) {
  const dragRef = useRef<{ y: number; norm: number } | null>(null)
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null

  const value = bound.value
  const range = definition.max - definition.min
  const percent = range === 0 ? 0 : clamp((value - definition.min) / range, 0, 1)
  const angle = -135 + percent * 270

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
    if (!dragRef.current) return
    commitNorm(dragRef.current.norm + (dragRef.current.y - event.clientY) / 140)
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
    event.preventDefault()
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1
    commitNorm(percent + direction * 0.03)
  }

  return (
    <div className="flex min-w-0 flex-col items-center">
      <div
        role="slider"
        tabIndex={0}
        aria-label={definition.label}
        aria-valuemin={definition.min}
        aria-valuemax={definition.max}
        aria-valuenow={value}
        title={`${definition.label} · drag vertically · double-click to reset`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => bound.setValue(definition.default)}
        onKeyDown={onKeyDown}
        className={`relative ${large ? 'h-[50px] w-[50px]' : 'h-10 w-10'} cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/50`}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(from 225deg, ${EMBER} 0deg ${percent * 270}deg, transparent ${percent * 270}deg 360deg)`,
            filter: 'blur(6px)',
            transform: 'scale(1.14)',
            opacity: 0.85,
          }}
        />
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(from 225deg, ${towardWhite(EMBER, 0.4)} 0deg ${percent * 270}deg, rgba(255,255,255,0.07) ${percent * 270}deg 270deg, transparent 270deg)`,
          }}
        />
        <div className="absolute inset-[3px] rounded-full border border-white/10 bg-[#171310]" />
        <div className="absolute inset-0" style={{ transform: `rotate(${angle}deg)` }}>
          <span className="absolute left-1/2 top-[5px] h-2.5 w-[2px] -translate-x-1/2 rounded-full bg-white/90" />
          <span
            className="absolute left-1/2 top-[-1px] h-1 w-1 -translate-x-1/2 rounded-full bg-white"
            style={{ boxShadow: `0 0 5px 1.5px ${EMBER}` }}
          />
        </div>
      </div>
      <span className="mt-1 text-[8px] font-semibold tracking-[0.12em] text-white/40">{label}</span>
      <span className="font-mono text-[9px] tabular-nums text-white/70">
        {definition.step >= 1 ? value.toFixed(0) : value.toFixed(2)}
      </span>
    </div>
  )
}

/** One row of the console: a rotated section word in the gutter, knobs after. */
function KnobRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 px-3">
      <span className="w-[46px] flex-shrink-0 pt-4 text-right text-[7px] font-bold tracking-[0.22em] text-white/25">
        {label}
      </span>
      <div className="flex flex-1 items-end justify-between gap-1">{children}</div>
    </div>
  )
}

/** Segmented swirl-axis selector: which plane the impact spins. */
function AxisSelector({ bound }: { bound: UserInterfaceParameter }) {
  const definition = bound.definition
  if (definition.type !== 'select') return null
  const selected = typeof bound.value === 'number' ? Math.round(bound.value) : definition.default
  const SHORT: Record<number, string> = { 2: 'FACE', 1: 'GROUND', 0: 'SIDE' }
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex overflow-hidden rounded-md border border-white/10">
        {definition.options.map((option) => {
          const active = option.value === selected
          return (
            <button
              key={option.value}
              aria-label={option.label}
              aria-pressed={active}
              title={option.label}
              onClick={() => bound.setValue(option.value)}
              className={`px-1.5 py-1 text-[7px] font-bold tracking-[0.08em] transition-colors ${
                active ? 'text-black' : 'bg-black/25 text-white/40 hover:text-white/70'
              }`}
              style={active ? { background: EMBER } : undefined}
            >
              {SHORT[option.value] ?? option.label}
            </button>
          )
        })}
      </div>
      <span className="text-[8px] font-semibold tracking-[0.12em] text-white/40">AXIS</span>
    </div>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

const PLACED_KEYS = new Set([
  'strength', 'reach', 'waveSpeed', 'dispersion', 'responseBeats',
  'bounce', 'drag', 'strikeBeats', 'anticipation', 'leadBeats',
  'stretch', 'tumbleDegrees', 'swirl', 'overlapBeats', 'swirlAxis',
  'vortexRate', 'vortexTwist', 'vortexShear', 'vortexGrow', 'vortexOuter',
])

export const MeteorImpactMoverUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const [showMore, setShowMore] = useState(false)

  const bound = Object.fromEntries(parameters.map((p) => [p.definition.key, p]))

  // The preview's settings: every bound numeric value over the definition's
  // defaults. Memoized on the VALUES so resolve() reruns only on real change.
  // Computed before the fallback return below - hooks must run unconditionally.
  const valuesKey = parameters
    .map((p) => `${p.definition.key}:${typeof p.value === 'number' ? p.value : ''}`)
    .join('|')
  const settings = useMemo(() => {
    const values: Record<string, number> = {}
    for (const p of parameters) if (typeof p.value === 'number') values[p.definition.key] = p.value
    return mergeDefinitionSettings(meteorImpactMover, values) as unknown as MeteorImpactSettings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuesKey])

  const required = [
    'strength', 'reach', 'waveSpeed', 'dispersion', 'responseBeats', 'bounce', 'drag',
    'strikeBeats', 'anticipation', 'leadBeats', 'stretch', 'tumbleDegrees', 'swirl',
    'overlapBeats', 'swirlAxis', 'vortexRate', 'vortexTwist', 'vortexShear', 'vortexGrow', 'vortexOuter',
  ]
  if (required.some((key) => !bound[key])) return <ParameterList parameters={parameters} />

  const unplaced = parameters.filter((p) => !PLACED_KEYS.has(p.definition.key))

  return (
    <section
      data-testid="meteor-impact-user-interface"
      className="-mx-3 -mt-3"
      style={{ background: EMBER_SHADE }}
    >
      <ImpactPreview settings={settings} />
      <div
        className="flex flex-col gap-2 pb-3 pt-2"
        style={{ background: `radial-gradient(58% 30px at 50% 0, ${withAlpha(EMBER, 0.13)}, transparent)` }}
      >
        <KnobRow label="IMPACT">
          <EmberKnob parameter={bound.strength} label="STRIKE" large />
          <EmberKnob parameter={bound.reach} label="REACH" />
          <EmberKnob parameter={bound.waveSpeed} label="SPEED" />
          <EmberKnob parameter={bound.dispersion} label="SPREAD" />
          <EmberKnob parameter={bound.responseBeats} label="WEIGHT" />
        </KnobRow>
        <KnobRow label="FEEL">
          <EmberKnob parameter={bound.bounce} label="BOUNCE" />
          <EmberKnob parameter={bound.drag} label="DRAG" />
          <EmberKnob parameter={bound.strikeBeats} label="CRACK" />
          <EmberKnob parameter={bound.anticipation} label="LEAN" />
          <EmberKnob parameter={bound.leadBeats} label="LEAD" />
        </KnobRow>
        <KnobRow label="MOTION">
          <EmberKnob parameter={bound.stretch} label="STRETCH" />
          <EmberKnob parameter={bound.tumbleDegrees} label="TUMBLE" />
          <EmberKnob parameter={bound.swirl} label="SWIRL" />
          <EmberKnob parameter={bound.overlapBeats} label="OVERLAP" />
          <AxisSelector bound={bound.swirlAxis} />
        </KnobRow>
        <KnobRow label="VORTEX">
          <EmberKnob parameter={bound.vortexRate} label="RATE" />
          <EmberKnob parameter={bound.vortexTwist} label="TWIST" />
          <EmberKnob parameter={bound.vortexShear} label="FUNNEL" />
          <EmberKnob parameter={bound.vortexGrow} label="GROW" />
          <EmberKnob parameter={bound.vortexOuter} label="SPAN" />
        </KnobRow>
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
