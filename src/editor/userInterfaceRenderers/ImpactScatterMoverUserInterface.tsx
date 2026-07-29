'use client'

// Bespoke settings for the Impact Scatter mover, following
// docs/instrument-panel-design-guide.md (Laser Sphere is the reference): a
// full-bleed panel washed in the mover's shock-blue shade, a LIVE preview up
// top, then the mover's THREE knobs - IMPACT, RECOVER, CHAOS - each captioned
// in plain English, with placement behind a MORE disclosure.
//
// The preview is not a mockup: it runs the mover's real resolve() - the same
// integrated impulse simulation, the same leash and pileup - over a looping
// performance, and applies the returned transforms to a lattice of small cubes.
//
// Why a LATTICE and not a scatter of debris: the whole promise of this mover is
// "blown apart, then back into place", and you cannot see something return to
// place unless the place is obvious. A perfect crystal grid makes both halves
// legible - it shatters into chaos and then resolves back to dead-straight
// rows, which is the moment that sells the effect.
//
// The performance under it is written to show the three things a knob-turner
// needs to feel: one clean hit out of rest, a five-hit roll where the
// compounding escalates, and an implode. A hit ruler under the canvas marks
// where they land so what you are watching is never a mystery.

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Color, InstancedMesh, Matrix4, Object3D, PointLight } from 'three'
import {
  SCATTER_IMPACT_PITCH,
  SCATTER_IMPLODE_PITCH,
  SCATTER_SETTLE_PITCH,
  impactScatterMover,
  type ImpactScatterSettings,
} from '../core/visualCopies/impactScatter'
import { mergeDefinitionSettings } from '../core/visualCopies/definitions'
import type { ResolvedNote } from '../core/visual/types'
import { isNumberParam } from '../instruments/types'
import { ParameterList } from './ParametersUserInterface'
import { towardWhite, withAlpha } from './colorWheel'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

// The mover has no color param (its flash is a SHIFT of each object's own
// colour), so the panel wears the material it evokes: cold kinetic shock.
const SHOCK = '#5ad8ff'
const SHOCK_SHADE = '#08131a'
const ROOM = '#04070a'

// ── The looping demo performance ─────────────────────────────────────────────
// 12 beats: a full-power hit out of rest with time to drift all the way home,
// then a five-hit roll a beat apart-and-a-half that visibly compounds, then an
// implode, then a snap-home that guarantees the loop wraps from stillness.

const LOOP_BEATS = 12

const note = (beat: number, pitch: number, velocity: number): ResolvedNote => ({
  beat,
  pitch,
  durationBeats: 0.25,
  velocity,
  blockStartBeat: 0,
  blockEndBeat: LOOP_BEATS,
})

const PREVIEW_NOTES: ResolvedNote[] = [
  note(0.75, SCATTER_IMPACT_PITCH, 1),
  note(4, SCATTER_IMPACT_PITCH, 0.55),
  note(4.25, SCATTER_IMPACT_PITCH, 0.6),
  note(4.5, SCATTER_IMPACT_PITCH, 0.7),
  note(4.75, SCATTER_IMPACT_PITCH, 0.8),
  note(5, SCATTER_IMPACT_PITCH, 1),
  note(8.25, SCATTER_IMPLODE_PITCH, 0.85),
  note(11.25, SCATTER_SETTLE_PITCH, 1),
]

// ── The lattice ──────────────────────────────────────────────────────────────
// A 5×5×5 grid with its hidden interior omitted: the shell carries the whole
// read of a crystal, at two thirds of the per-frame cost.

const LATTICE_SPAN = 2
const LATTICE_SPACING = 1.15

function buildLattice(): [number, number, number][] {
  const cells: [number, number, number][] = []
  for (let x = -LATTICE_SPAN; x <= LATTICE_SPAN; x++) {
    for (let y = -LATTICE_SPAN; y <= LATTICE_SPAN; y++) {
      for (let z = -LATTICE_SPAN; z <= LATTICE_SPAN; z++) {
        const interior = Math.abs(x) < LATTICE_SPAN && Math.abs(y) < LATTICE_SPAN && Math.abs(z) < LATTICE_SPAN
        if (interior) continue
        cells.push([x * LATTICE_SPACING, y * LATTICE_SPACING, z * LATTICE_SPACING])
      }
    }
  }
  return cells
}

const LATTICE = buildLattice()

const HOT = new Color('#eaf9ff')

function LatticeField({ settings, playheadRef }: {
  settings: ImpactScatterSettings
  playheadRef: RefObject<HTMLDivElement | null>
}) {
  const meshRef = useRef<InstancedMesh>(null)
  const coreRef = useRef<PointLight>(null)
  const scratch = useRef({
    dummy: new Object3D(),
    base: new Matrix4(),
    color: new Color(),
    cool: new Color('#6f86a8'),
    warm: new Color(SHOCK),
  }).current

  // Rebuilding on settings identity is deliberate: resolve() integrates the
  // channel tables once per change (a few ms), then apply() is a cheap pure
  // table read per copy per frame.
  const resolved = useMemo(
    () => impactScatterMover.resolve({ settings, notes: PREVIEW_NOTES }),
    [settings],
  )
  const live = useRef({ resolved, settings })
  live.current = { resolved, settings }

  useFrame(({ clock }) => {
    const mesh = meshRef.current
    if (!mesh) return
    const { dummy, base, color, cool, warm } = scratch
    const beat = (clock.getElapsedTime() * 2) % LOOP_BEATS
    const current = live.current
    let energy = 0
    for (let i = 0; i < LATTICE.length; i++) {
      const cell = LATTICE[i]
      base.makeTranslation(
        current.settings.centerX + cell[0],
        current.settings.centerY + cell[1],
        current.settings.centerZ + cell[2],
      )
      const [result] = current.resolved.apply(
        { transform: base, opacity: 1, colorShift: { hue: 0, saturation: 0, lightness: 0 } },
        { beat, index: i, count: LATTICE.length },
      )
      dummy.matrix.copy(result.transform)
      dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      // Cool steel at rest, shock-blue toward the outside of the lattice; the
      // flash's lightness shift is kinetic energy, so a piece burns while it is
      // flying and cools as it drifts home.
      const depth = (cell[0] * cell[0] + cell[1] * cell[1] + cell[2] * cell[2]) / 16
      color.copy(cool).lerp(warm, clamp(0.2 + depth * 0.5, 0, 1))
      const heat = clamp(result.colorShift.lightness * 3, 0, 1)
      if (heat > 0) {
        color.lerp(HOT, heat)
        energy += heat
      }
      mesh.setColorAt(i, color)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    // The room is lit BY the field: the core light answers the summed heat, so
    // an impact flashes the whole space and a settle lets it go dark.
    if (coreRef.current) {
      coreRef.current.intensity = 1.5 + clamp(energy / LATTICE.length, 0, 1) * 42
    }
    // Written straight to the DOM: the ruler's playhead must not re-render React
    // sixty times a second.
    if (playheadRef.current) {
      playheadRef.current.style.left = `${(beat / LOOP_BEATS) * 100}%`
    }
  })

  return (
    <>
      <instancedMesh ref={meshRef} args={[undefined, undefined, LATTICE.length]} frustumCulled={false}>
        <boxGeometry args={[0.42, 0.42, 0.42]} />
        <meshStandardMaterial metalness={0.4} roughness={0.25} color="#ffffff" />
      </instancedMesh>
      <pointLight
        ref={coreRef}
        position={[settings.centerX, settings.centerY, settings.centerZ]}
        color={SHOCK}
        intensity={1.5}
        distance={18}
        decay={2}
      />
    </>
  )
}

/** The loop's hits, so what the preview is doing is never a mystery: a tick per
 *  note (bright = impact, dim = implode, hairline = snap home) and a playhead. */
function HitRuler({ playheadRef }: { playheadRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div className="relative h-[9px] border-b border-white/[0.06] bg-black/40">
      {PREVIEW_NOTES.map((hit, index) => (
        <span
          key={index}
          className="absolute top-0 h-full"
          style={{
            left: `${(hit.beat / LOOP_BEATS) * 100}%`,
            width: hit.pitch === SCATTER_SETTLE_PITCH ? 1 : 2,
            background: hit.pitch === SCATTER_IMPACT_PITCH
              ? withAlpha(SHOCK, 0.35 + hit.velocity * 0.65)
              : hit.pitch === SCATTER_IMPLODE_PITCH
                ? withAlpha('#ffffff', 0.35)
                : withAlpha('#ffffff', 0.22),
          }}
        />
      ))}
      <div
        ref={playheadRef}
        className="absolute top-0 h-full w-[1px]"
        style={{ background: towardWhite(SHOCK, 0.6), boxShadow: `0 0 4px 1px ${withAlpha(SHOCK, 0.7)}` }}
      />
    </div>
  )
}

function ScatterPreview({ settings }: { settings: ImpactScatterSettings }) {
  const playheadRef = useRef<HTMLDivElement>(null)
  return (
    <div>
      <div
        data-testid="impact-scatter-preview"
        title="Drag to orbit the lattice"
        className="relative h-[178px] cursor-grab overflow-hidden active:cursor-grabbing"
        style={{ background: ROOM }}
      >
        <Canvas
          dpr={[1, 1.75]}
          camera={{ position: [5.8, 4, 10.4], fov: 40 }}
          gl={{ antialias: true, alpha: true }}
        >
          <color attach="background" args={[ROOM]} />
          <LatticeField settings={settings} playheadRef={playheadRef} />
          <directionalLight position={[5, 7, 4]} intensity={1.15} color="#dfe8ff" />
          <directionalLight position={[-6, -2, -4]} intensity={0.35} color={SHOCK} />
          <ambientLight intensity={0.14} />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -4.6, 0]}>
            <circleGeometry args={[16, 48]} />
            <meshStandardMaterial color="#070a10" roughness={1} metalness={0} />
          </mesh>
          {/* Gentler than the laser pass: the cubes are tone-mapped, so the
              threshold sits below 1 and only white-hot pieces bloom. */}
          <EffectComposer multisampling={0}>
            <Bloom intensity={0.6} luminanceThreshold={0.7} luminanceSmoothing={0.2} mipmapBlur radius={0.72} levels={6} />
          </EffectComposer>
          <OrbitControls
            makeDefault
            target={[settings.centerX, settings.centerY, settings.centerZ]}
            enablePan={false}
            enableZoom={false}
            enableDamping
            dampingFactor={0.08}
            minPolarAngle={0.15}
            maxPolarAngle={Math.PI * 0.78}
          />
        </Canvas>
      </div>
      <HitRuler playheadRef={playheadRef} />
    </div>
  )
}

// ── Knobs ────────────────────────────────────────────────────────────────────

/** Flat knob per the guide: the value arc IS the light - a wide soft bloom under
 *  a hot core, white-hot tip dot at the terminus. Vertical drag, double-click
 *  resets, arrows nudge. */
function ShockKnob({ parameter: bound, label, hint, format, large = false }: {
  parameter: UserInterfaceParameter
  label: string
  /** One plain-English line under the value. With only three controls there is
   *  room to just SAY what each one does, which beats a clever label. */
  hint?: string
  /** Reads the value in the unit a person thinks in (percent, beats). */
  format?: (definition: { min: number; max: number }, value: number) => string
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
        title={`${definition.label}${hint ? ` — ${hint}` : ''} · drag vertically · double-click to reset`}
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
            background: `conic-gradient(from 225deg, ${SHOCK} 0deg ${percent * 270}deg, transparent ${percent * 270}deg 360deg)`,
            filter: 'blur(6px)',
            transform: 'scale(1.14)',
            opacity: 0.85,
          }}
        />
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(from 225deg, ${towardWhite(SHOCK, 0.4)} 0deg ${percent * 270}deg, rgba(255,255,255,0.07) ${percent * 270}deg 270deg, transparent 270deg)`,
          }}
        />
        <div className="absolute inset-[3px] rounded-full border border-white/10 bg-[#0f151b]" />
        <div className="absolute inset-0" style={{ transform: `rotate(${angle}deg)` }}>
          <span className="absolute left-1/2 top-[5px] h-2.5 w-[2px] -translate-x-1/2 rounded-full bg-white/90" />
          <span
            className="absolute left-1/2 top-[-1px] h-1 w-1 -translate-x-1/2 rounded-full bg-white"
            style={{ boxShadow: `0 0 5px 1.5px ${SHOCK}` }}
          />
        </div>
      </div>
      <span className="mt-1.5 text-[9px] font-semibold tracking-[0.14em] text-white/45">{label}</span>
      <span className="font-mono text-[10px] tabular-nums text-white/75">
        {format ? format(definition, value) : definition.step >= 1 ? value.toFixed(0) : value.toFixed(2)}
      </span>
      {hint && (
        <span className="mt-0.5 max-w-[92px] text-center text-[7px] leading-[1.35] text-white/25">
          {hint}
        </span>
      )}
    </div>
  )
}

/** Segmented swirl-axis selector: which plane the blast spins around. */
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
              style={active ? { background: SHOCK } : undefined}
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

// The three macros plus the swirl plane. Everything else the definition still
// exposes is placement, and placement belongs in MORE.
const PLACED_KEYS = new Set(['impact', 'recoverBeats', 'chaos', 'swirlAxis'])

const REQUIRED_KEYS = [...PLACED_KEYS]

/** Percent reads as "how much" at a glance; 0.55 does not. */
const percentOf = (definition: { min: number; max: number }, value: number) =>
  `${Math.round(((value - definition.min) / (definition.max - definition.min)) * 100)}%`

export const ImpactScatterMoverUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
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
    return mergeDefinitionSettings(impactScatterMover, values) as unknown as ImpactScatterSettings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuesKey])

  if (REQUIRED_KEYS.some((key) => !bound[key])) return <ParameterList parameters={parameters} />

  const unplaced = parameters.filter((p) => !PLACED_KEYS.has(p.definition.key))

  return (
    <section
      data-testid="impact-scatter-user-interface"
      className="-mx-3 -mt-3"
      style={{ background: SHOCK_SHADE }}
    >
      <ScatterPreview settings={settings} />
      <div
        className="flex flex-col gap-2 pb-3 pt-3"
        style={{ background: `radial-gradient(58% 30px at 50% 0, ${withAlpha(SHOCK, 0.13)}, transparent)` }}
      >
        {/* Three knobs, generously spaced. There is nothing else to decide. */}
        <div className="flex items-end gap-7 px-4">
          <ShockKnob
            parameter={bound.impact}
            label="IMPACT"
            hint="how hard the hit throws"
            format={percentOf}
            large
          />
          <ShockKnob
            parameter={bound.recoverBeats}
            label="RECOVER"
            hint="beats until everything is home"
            format={(_, value) => `${value.toFixed(value < 10 ? 1 : 0)} beat${value === 1 ? '' : 's'}`}
            large
          />
          <ShockKnob
            parameter={bound.chaos}
            label="CHAOS"
            hint="clean pulse → shrapnel"
            format={percentOf}
            large
          />
          <div className="ml-auto">
            <AxisSelector bound={bound.swirlAxis} />
          </div>
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
