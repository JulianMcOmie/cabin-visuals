'use client'

// Bespoke settings for the Colorizer, following
// docs/instrument-panel-design-guide.md (Laser Sphere is the reference).
//
// The preview is a FIELD OF OBJECTS, not a diagram: a grid of solids, indexed
// row-major exactly the way a Grid splitter indexes its copies, each one fed
// the definition's real evaluateColorizer() over a looping performance. What
// you see is what the colorizer does - INTENSITY is how far the objects go,
// ATTACK and RELEASE and SHAPE are how they get there and back, STAGGER rakes
// the flash across the field, and COLOR is the color they flash.
//
// The accent is the instrument's own color param, per the guide: the COLOR pill
// is both the panel's light source and the input for it, and it wears the
// INTENSITY-driven halo.

import { useMemo, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { Color, InstancedMesh, Object3D, type OrthographicCamera } from 'three'
import {
  COLORIZER_FLASH_PITCH,
  SHAPE_EVEN,
  SHAPE_SPIKE,
  SHAPE_SWELL,
  evaluateColorizer,
  noteColorizer,
  type ColorizerSettings,
} from '../core/visualCopies/colorizer'
import { mergeDefinitionSettings } from '../core/visualCopies/definitions'
import type { ResolvedNote } from '../core/visual/types'
import { isNumberParam } from '../instruments/types'
import { ParameterList } from './ParametersUserInterface'
import { ColorWheelPill, towardWhite, withAlpha } from './colorWheel'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

// The stand-in for "the objects' own color". Cool and dim so the flash is
// unmistakably the colorizer's doing and not the material's - but not so dark
// that the field disappears between hits: you have to see the objects sitting
// there to read what the flash does to them.
const OBJECT_COLOR = '#2c3760'
const PANEL_SHADE = '#080a12'
const ROOM = '#05070c'
const FIELD_HEIGHT = 150

// ── The looping demo performance ─────────────────────────────────────────────
// Two bars at a notional 120 BPM on the single flash row: accents, ghost notes
// and one held note, so dynamics (velocity) and sustain (note length) both read
// without needing a second MIDI row to explain them.

const LOOP_BEATS = 8

const note = (beat: number, durationBeats: number, velocity: number): ResolvedNote => ({
  beat,
  pitch: COLORIZER_FLASH_PITCH,
  durationBeats,
  velocity,
  blockStartBeat: 0,
  blockEndBeat: LOOP_BEATS,
})

const PERFORMANCE: ResolvedNote[] = [
  note(0, 0.05, 1),
  note(1, 0.05, 0.45),
  note(1.5, 0.05, 0.75),
  note(2, 0.05, 1),
  note(3, 0.05, 0.5),
  note(3.5, 0.05, 0.9),
  note(5, 1, 0.95),
  note(6.5, 0.05, 0.6),
  note(7, 0.05, 0.9),
]

// The loop is seamless: the neighbouring passes are present as real notes, so a
// tail crosses the wrap and a negative STAGGER can reach into the next bar.
const LOOP_NOTES: ResolvedNote[] = [-LOOP_BEATS, 0, LOOP_BEATS].flatMap((offset) =>
  PERFORMANCE.map((n) => ({ ...n, beat: n.beat + offset })),
)

// ── The field ────────────────────────────────────────────────────────────────

// Wide enough to bleed off both edges at any panel width - a field that stops
// short of the frame reads as a diagram of a field rather than as one.
const FIELD_COLUMNS = 26
const FIELD_ROWS = 4
const FIELD_COUNT = FIELD_COLUMNS * FIELD_ROWS
const SPACING = 1.15
/** World-space height the camera frames: the rows plus a little air. */
const FIELD_WORLD_HEIGHT = (FIELD_ROWS - 1) * SPACING + 1.6

function ObjectField({ settings }: { settings: ColorizerSettings }) {
  const meshRef = useRef<InstancedMesh>(null)
  const scratch = useRef({
    dummy: new Object3D(),
    color: new Color(),
    base: new Color(OBJECT_COLOR),
    tint: new Color(),
  }).current

  const resolved = useMemo(() => noteColorizer.resolve({ settings, notes: LOOP_NOTES }), [settings])
  const live = useRef({ resolved, settings })
  live.current = { resolved, settings }

  useFrame(({ clock, camera, gl }) => {
    const mesh = meshRef.current
    if (!mesh) return
    const { dummy, color, base, tint } = scratch
    const current = live.current
    tint.set(current.settings.color)
    const beat = (clock.getElapsedTime() * 2) % LOOP_BEATS

    // The frustum is derived from the canvas ELEMENT rather than left to the
    // renderer's measured size: this panel lives in a resizable pane and can
    // mount while it is still collapsed, and a stale measurement leaves the
    // field framed for a width the panel no longer has. Reading the DOM is the
    // one source that cannot go stale.
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

    // Placement is rewritten every frame rather than cached: a settings change
    // rebuilds the instanced mesh's buffers, and a "laid out once" flag that
    // outlives them leaves every cube stacked at the origin.
    for (let index = 0; index < FIELD_COUNT; index++) {
      const column = index % FIELD_COLUMNS
      const row = Math.floor(index / FIELD_COLUMNS)
      dummy.position.set(
        (column - (FIELD_COLUMNS - 1) / 2) * SPACING,
        ((FIELD_ROWS - 1) / 2 - row) * SPACING,
        0,
      )
      dummy.rotation.set(0.35, 0.62, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
      // Row-major, the order a Grid splitter hands its copies downstream, so
      // STAGGER sweeps the field the same way it will sweep a real split.
      const { tintAmount } = evaluateColorizer(LOOP_NOTES, current.settings, beat, index)
      color.copy(base).lerp(tint, clamp(tintAmount, 0, 1))
      mesh.setColorAt(index, color)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, FIELD_COUNT]} frustumCulled={false}>
      <boxGeometry args={[0.72, 0.72, 0.72]} />
      <meshStandardMaterial metalness={0.25} roughness={0.42} color="#ffffff" />
    </instancedMesh>
  )
}

function FieldPreview({ settings }: { settings: ColorizerSettings }) {
  return (
    <div
      data-testid="colorizer-preview"
      className="relative border-b border-white/[0.06]"
      style={{ height: FIELD_HEIGHT, background: ROOM }}
    >
      {/* Orthographic on purpose: the panel is short and very wide, so a
          perspective frustum wide enough to fill it shears the outer columns
          into trapezoids. Flat projection keeps every object in the field the
          same size and shape, which is what makes the color comparable across
          it. The frustum itself is set per frame in ObjectField. */}
      <Canvas orthographic dpr={[1, 2]} camera={{ position: [0, 0, 12] }} gl={{ antialias: true }}>
        <color attach="background" args={[ROOM]} />
        <ObjectField settings={settings} />
        <directionalLight position={[3, 5, 6]} intensity={1.5} color="#cfd8ff" />
        <ambientLight intensity={0.55} />
        {/* Only a flashed object crosses the threshold, so the field blooms
            exactly when the colorizer fires and stays dark otherwise. */}
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.7} luminanceThreshold={0.5} luminanceSmoothing={0.2} mipmapBlur radius={0.72} levels={6} />
        </EffectComposer>
      </Canvas>
    </div>
  )
}

// ── Knobs ────────────────────────────────────────────────────────────────────

/** Per the guide: the value arc IS the light - a wide soft bloom under a hot
 *  core, white-hot dot at the terminus - lit by the panel's accent, which is
 *  the colorizer's own COLOR. */
function ChromaKnob({ parameter: bound, label, large = false }: {
  parameter: UserInterfaceParameter
  label: string
  large?: boolean
}) {
  const dragRef = useRef<{ y: number; norm: number } | null>(null)
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null

  const value = bound.value
  const range = definition.max - definition.min
  const curve = definition.curve ?? 1
  // Travel is in curve space so a curved param's low end gets the room it
  // exists for; the arc follows the hand, not the raw value.
  const percent = range === 0 ? 0 : Math.pow(clamp((value - definition.min) / range, 0, 1), 1 / curve)
  const angle = -135 + percent * 270

  const commitNorm = (t: number) => {
    const raw = definition.min + Math.pow(clamp(t, 0, 1), curve) * range
    const snapped = curve === 1
      ? definition.min + Math.round((raw - definition.min) / definition.step) * definition.step
      : (raw === 0 ? 0 : Number(raw.toPrecision(3)))
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

  const readout = definition.step >= 1
    ? value.toFixed(0)
    : value !== 0 && Math.abs(value) < 0.01 ? value.toPrecision(1) : value.toFixed(2)

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
            background: `conic-gradient(from 225deg, var(--cz-accent) 0deg ${percent * 270}deg, transparent ${percent * 270}deg 360deg)`,
            filter: 'blur(6px)',
            transform: 'scale(1.14)',
            opacity: 0.85,
          }}
        />
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(from 225deg, var(--cz-accent-hot) 0deg ${percent * 270}deg, rgba(255,255,255,0.07) ${percent * 270}deg 270deg, transparent 270deg)`,
          }}
        />
        <div className="absolute inset-[3px] rounded-full border border-white/10 bg-[#101219]" />
        <div className="absolute inset-0" style={{ transform: `rotate(${angle}deg)` }}>
          <span className="absolute left-1/2 top-[5px] h-2.5 w-[2px] -translate-x-1/2 rounded-full bg-white/90" />
          <span
            className="absolute left-1/2 top-[-1px] h-1 w-1 -translate-x-1/2 rounded-full bg-white"
            style={{ boxShadow: '0 0 5px 1.5px var(--cz-accent)' }}
          />
        </div>
      </div>
      <span className="mt-1 text-[8px] font-semibold tracking-[0.12em] text-white/40">{label}</span>
      <span className="font-mono text-[9px] tabular-nums text-white/70">{readout}</span>
    </div>
  )
}

/** Segmented release-curve selector. Each option draws its own falloff, so the
 *  choice is legible without reading the word. */
const SHAPE_GLYPHS: Record<number, string> = {
  [SHAPE_SPIKE]: 'M1 11 L3 1 C4.5 8 7 10 15 10.6',
  [SHAPE_EVEN]: 'M1 11 L3 1 L15 10.6',
  [SHAPE_SWELL]: 'M1 11 L3 1 C9 1.4 11 4 15 10.6',
}

function ShapeSelector({ bound }: { bound: UserInterfaceParameter }) {
  const definition = bound.definition
  if (definition.type !== 'select') return null
  const selected = typeof bound.value === 'number' ? Math.round(bound.value) : definition.default
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
              title={`${option.label} falloff`}
              onClick={() => bound.setValue(option.value)}
              className={`px-1 pb-0.5 pt-1 transition-colors ${active ? 'bg-[var(--cz-accent)]' : 'bg-black/25 hover:bg-white/5'}`}
            >
              <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
                <path
                  d={SHAPE_GLYPHS[option.value] ?? SHAPE_GLYPHS[SHAPE_EVEN]}
                  stroke={active ? '#000' : 'rgba(255,255,255,0.45)'}
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )
        })}
      </div>
      <span className="text-[8px] font-semibold tracking-[0.12em] text-white/40">SHAPE</span>
      <span className="font-mono text-[9px] text-white/70">
        {definition.options.find((option) => option.value === selected)?.label.toUpperCase() ?? ''}
      </span>
    </div>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

const REQUIRED_KEYS = ['intensity', 'attackBeats', 'releaseBeats', 'staggerBeats', 'color', 'shape']

export const ColorizerUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const bound = Object.fromEntries(parameters.map((p) => [p.definition.key, p]))

  // Memoized on the VALUES, so the field's resolve() reruns only on a real
  // change. Computed before the fallback return - hooks run unconditionally.
  const valuesKey = parameters.map((p) => `${p.definition.key}:${p.value}`).join('|')
  const settings = useMemo(() => {
    const values: Record<string, number> = {}
    const strings: Record<string, string> = {}
    for (const p of parameters) {
      if (typeof p.value === 'number') values[p.definition.key] = p.value
      else strings[p.definition.key] = p.value
    }
    return mergeDefinitionSettings(noteColorizer, values, strings) as unknown as ColorizerSettings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuesKey])

  if (REQUIRED_KEYS.some((key) => !bound[key])) return <ParameterList parameters={parameters} />

  const accent = settings.color
  const intensity = clamp(settings.intensity, 0, 1)

  return (
    <section
      data-testid="colorizer-user-interface"
      className="-mx-3 -mt-3"
      style={{
        background: PANEL_SHADE,
        '--cz-accent': accent,
        '--cz-accent-hot': towardWhite(accent, 0.4),
        '--cz-glow': withAlpha(accent, 0.16),
      } as CSSProperties}
    >
      <FieldPreview settings={settings} />
      <div
        className="flex items-end gap-1 px-3 pb-3 pt-2.5"
        style={{ background: 'radial-gradient(58% 30px at 50% 0, var(--cz-glow), transparent)' }}
      >
        <ChromaKnob parameter={bound.intensity} label="INTENSITY" large />
        <ChromaKnob parameter={bound.attackBeats} label="ATTACK" />
        <ChromaKnob parameter={bound.releaseBeats} label="RELEASE" />
        <ChromaKnob parameter={bound.staggerBeats} label="STAGGER" />
        <ShapeSelector bound={bound.shape} />
        <div className="ml-auto">
          <ColorWheelPill
            value={accent}
            onChange={(hex) => bound.color.setValue(hex)}
            label="COLOR"
            ariaLabel="Flash color"
            title="The color every note flashes toward"
            // The pill is the emitter: turn INTENSITY up and it blazes, while
            // the rest of the console stays calm.
            halo={`0 0 ${5 + intensity * 16}px ${withAlpha(accent, 0.2 + intensity * 0.5)}`}
            pillTestId="colorizer-color-pill"
          />
        </div>
      </div>
    </section>
  )
}
