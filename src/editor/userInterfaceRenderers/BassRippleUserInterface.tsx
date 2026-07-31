'use client'

// Bespoke settings for Bass Ripple, following docs/instrument-panel-design-guide.md
// and the Laser Sphere reference: full-bleed in the panel, no card chrome, no
// in-panel title, washed with a hue-true dark shade of the instrument's accent.
// A live preview of a cube lattice being shaken by the warp, then one row of
// four flat knobs - INTENSITY largest, then WAVE, SPEED, RELEASE.
//
// Two things are specific to this instrument. It has no `color` param, so the
// accent is fixed to the violet the library icon already wears rather than a
// live one. And it draws nothing of its own - the honest preview is therefore
// something ELSE being bent, which is why the panel supplies its own cubes and
// runs the instrument's real field shader over them.

import { useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { EffectComposer } from '@react-three/postprocessing'
import { Effect } from 'postprocessing'
import { Uniform, type Group } from 'three'
import { BASS_RIPPLE_FIELD_GLSL } from '../instruments/BassRipple'
import { isNumberParam } from '../instruments/types'
import { ParameterList } from './ParametersUserInterface'
import { hexToHsv, hsvToHex, towardWhite, withAlpha } from './colorWheel'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Bass Ripple exposes no color param, so its accent is the violet its library
 *  icon and 2D preview card already use - one identity across the app. */
const ACCENT = '#a78bfa'

function parameter(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((candidate) => candidate.definition.key === key)
}

function numericValue(bound: UserInterfaceParameter | undefined, fallback: number): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

// ── Live preview ────────────────────────────────────────────────────────────

// The preview plays a note on a loop so the knobs have something to act on:
// held for HOLD beats of every LOOP, then released. RELEASE is invisible
// without this - a static warp never shows a tail.
const PREVIEW_LOOP_BEATS = 4
const PREVIEW_HOLD_BEATS = 1.5
/** Preview beats per wall-clock second (120bpm), so the drift reads musically. */
const PREVIEW_BEATS_PER_SECOND = 2
/** The field displaces by a fraction of the FRAME, so at full Intensity a
 *  148px-tall preview moves pixels further than a cube is wide and the lattice
 *  dissolves into soup. Scaling the preview's displacement keeps the shape
 *  readable while it shakes - the guide's "map params into preview-safe
 *  ranges" rule. The stage is unaffected; only this canvas is scaled. */
const PREVIEW_AMOUNT_SCALE = 0.4

/** The looping note's amount envelope. Deliberately the same squared tail as
 *  resolveActiveBassRipple's release, so the knob shows its real shape. */
function previewEnvelope(beat: number, release: number): number {
  const phase = ((beat % PREVIEW_LOOP_BEATS) + PREVIEW_LOOP_BEATS) % PREVIEW_LOOP_BEATS
  if (phase < PREVIEW_HOLD_BEATS) return 1
  if (release <= 0) return 0
  const age = (phase - PREVIEW_HOLD_BEATS) / release
  if (age >= 1) return 0
  return (1 - age) * (1 - age)
}

// A UV-displacement pass over the preview's own render. `mainUv` is exactly the
// right hook: the effect moves where each pixel is sampled from and contributes
// no color of its own, which is what the instrument does on stage.
const PREVIEW_WARP_FRAGMENT = `
uniform float pattern;
uniform float amount;
uniform float scale;
uniform float speed;
uniform float time;
uniform float aspect;

${BASS_RIPPLE_FIELD_GLSL}

void mainUv(inout vec2 uv) {
  uv = clamp(uv + bassRippleOffset(uv, pattern, amount, scale, speed, time, aspect), 0.0, 1.0);
}`

class BassRippleWarpEffect extends Effect {
  constructor() {
    super('BassRippleWarpEffect', PREVIEW_WARP_FRAGMENT, {
      uniforms: new Map<string, Uniform>([
        ['pattern', new Uniform(0)],
        ['amount', new Uniform(0)],
        ['scale', new Uniform(3)],
        ['speed', new Uniform(0.6)],
        ['time', new Uniform(0)],
        ['aspect', new Uniform(1)],
      ]),
    })
  }
}

function WarpPass({ pattern, amount, scale, speed, release }: {
  pattern: number
  amount: number
  scale: number
  speed: number
  release: number
}) {
  const effect = useMemo(() => new BassRippleWarpEffect(), [])
  useFrame(({ clock, size }) => {
    const beat = clock.getElapsedTime() * PREVIEW_BEATS_PER_SECOND
    const uniforms = effect.uniforms
    uniforms.get('pattern')!.value = pattern
    uniforms.get('time')!.value = beat
    uniforms.get('scale')!.value = scale
    uniforms.get('speed')!.value = speed
    uniforms.get('amount')!.value = amount * previewEnvelope(beat, release) * PREVIEW_AMOUNT_SCALE
    uniforms.get('aspect')!.value = size.width / Math.max(1, size.height)
  })
  return <primitive object={effect} dispose={null} />
}

// A regular lattice is what makes a positional warp legible: straight rows and
// even gaps have somewhere to bend FROM. Scattered geometry just looks
// scattered whatever the field does to it. Five columns suit the preview's
// letterbox shape; three rows fit its height with margin to tilt in.
const COLUMNS = 5
const ROWS = 3
const SPACING = 0.78

const CUBES = Array.from({ length: COLUMNS * ROWS }, (_, index) => {
  const column = index % COLUMNS
  const row = Math.floor(index / COLUMNS)
  const checker = (column + row) % 2 === 0
  return {
    key: index,
    position: [
      (column - (COLUMNS - 1) / 2) * SPACING,
      ((ROWS - 1) / 2 - row) * SPACING,
      checker ? -0.3 : 0,
    ] as [number, number, number],
    // Alternating lightness so neighbouring faces stay distinguishable once the
    // warp starts sliding them across each other.
    tint: checker ? towardWhite(ACCENT, 0.3) : ACCENT,
  }
})

function PreviewCubes() {
  const group = useRef<Group>(null)
  useFrame(({ clock }) => {
    const time = clock.getElapsedTime()
    if (!group.current) return
    // A slow drift rather than a spin: the lattice should stay readable as a
    // lattice, so the warp is the thing that moves. The x tilt stays small -
    // enough to show the cubes are solid, never enough to swing a row out of
    // the 148px frame.
    group.current.rotation.y = Math.sin(time * 0.32) * 0.3
    group.current.rotation.x = Math.sin(time * 0.21) * 0.07
  })
  return (
    <group ref={group}>
      {CUBES.map((cube) => (
        <mesh key={cube.key} position={cube.position}>
          <boxGeometry args={[0.42, 0.42, 0.42]} />
          <meshStandardMaterial color={cube.tint} roughness={0.28} metalness={0.2} />
        </mesh>
      ))}
    </group>
  )
}

function RipplePreview({ pattern, amount, scale, speed, release }: {
  pattern: number
  amount: number
  scale: number
  speed: number
  release: number
}) {
  return (
    <div
      data-testid="bass-ripple-preview"
      title="Drag to orbit the lattice"
      className="relative h-[148px] cursor-grab overflow-hidden border-b border-white/[0.06] bg-[#05070c] active:cursor-grabbing"
    >
      <Canvas dpr={[1, 2]} camera={{ position: [0, 0, 6.1], fov: 40 }} gl={{ antialias: true, alpha: true }}>
        {/* Opaque in-scene background: the warp samples the rendered image, and
            a transparent canvas would drag alpha seams around with it. */}
        <color attach="background" args={['#05070c']} />
        {/* Low ambient with one strong key: flat lighting makes the lattice a
            field of identical violet squares, and the warp needs edges. */}
        <ambientLight intensity={0.22} />
        <directionalLight position={[2.4, 3, 4]} intensity={2.6} />
        <pointLight position={[-3, -1.5, 2.5]} color={ACCENT} intensity={22} distance={14} decay={2} />
        <PreviewCubes />
        <EffectComposer multisampling={0}>
          <WarpPass pattern={pattern} amount={amount} scale={scale} speed={speed} release={release} />
        </EffectComposer>
        <OrbitControls
          makeDefault
          enablePan={false}
          enableZoom={false}
          enableDamping
          dampingFactor={0.08}
          minPolarAngle={Math.PI * 0.3}
          maxPolarAngle={Math.PI * 0.7}
          minAzimuthAngle={-0.6}
          maxAzimuthAngle={0.6}
        />
      </Canvas>
    </div>
  )
}

// ── Controls ────────────────────────────────────────────────────────────────

/** The pattern picker, to the design guide's segmented-control spec: recessed
 *  track, one lit segment wearing the accent as light, inactive labels neutral.
 *  Segments rather than a <select> because the field's KIND is this panel's
 *  biggest decision - all five choices should be visible at once. */
function PatternSegments({ parameter: bound }: { parameter: UserInterfaceParameter }) {
  const definition = bound.definition
  if (definition.type !== 'select' || typeof bound.value !== 'number') return null
  const active = Math.round(bound.value)
  return (
    <div
      role="radiogroup"
      aria-label={definition.label}
      className="mx-4 mt-3 flex rounded-md border border-white/[0.08] bg-black/30 p-[2px]"
    >
      {definition.options.map((option) => {
        const selected = option.value === active
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => bound.setValue(option.value)}
            className="min-w-0 flex-1 rounded px-1 py-[5px] text-[9px] font-semibold uppercase tracking-[0.1em] transition-colors"
            style={selected
              ? { background: withAlpha(ACCENT, 0.22), color: towardWhite(ACCENT, 0.6) }
              : { color: 'rgba(255,255,255,0.4)' }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** The panel's one control vocabulary, to the design guide's knob spec: flat
 *  face, 270° accent arc from 7 o'clock built as three stacked copies so the
 *  light lives only along the lit portion, white needle, white-hot dot at the
 *  arc's tip. Vertical drag over ~140px of travel, double-click resets, arrows
 *  nudge, and the param's response curve is honored the way ParamSlider does. */
function RippleKnob({ parameter: bound, label, large = false }: {
  parameter: UserInterfaceParameter
  label: string
  /** The instrument's primary param (INTENSITY) reads a step larger. */
  large?: boolean
}) {
  const dragRef = useRef<{ y: number; norm: number } | null>(null)
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null

  const value = bound.value
  const curve = definition.curve ?? 1
  const range = definition.max - definition.min
  const norm = range === 0 ? 0 : clamp((value - definition.min) / range, 0, 1)
  const percent = Math.pow(norm, 1 / curve)
  const angle = -135 + percent * 270

  const commitNorm = (t: number) => {
    const raw = definition.min + Math.pow(clamp(t, 0, 1), curve) * range
    const snapped = curve === 1
      ? definition.min + Math.round((raw - definition.min) / definition.step) * definition.step
      : raw === 0 ? 0 : Number(raw.toPrecision(3))
    bound.setValue(clamp(Number(snapped.toFixed(8)), definition.min, definition.max))
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    // Capture can throw for exotic/synthetic pointers; the drag still works
    // through the move/up handlers on the element itself.
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
    dragRef.current = { y: event.clientY, norm: percent }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    commitNorm(dragRef.current.norm + (dragRef.current.y - event.clientY) / 140)
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
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
        title="Drag vertically · double-click to reset"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => bound.setValue(definition.default)}
        onKeyDown={onKeyDown}
        className={`relative ${large ? 'h-[52px] w-[52px]' : 'h-11 w-11'} cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/50`}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(from 225deg, ${ACCENT} 0deg ${percent * 270}deg, transparent ${percent * 270}deg 360deg)`,
            filter: 'blur(6px)',
            transform: 'scale(1.16)',
            opacity: 0.9,
          }}
        />
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(from 225deg, ${towardWhite(ACCENT, 0.35)} 0deg ${percent * 270}deg, transparent ${percent * 270}deg 360deg)`,
            filter: 'blur(1.5px)',
          }}
        />
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(from 225deg, ${towardWhite(ACCENT, 0.82)} 0deg ${percent * 270}deg, rgba(255,255,255,0.08) ${percent * 270}deg 270deg, transparent 270deg)`,
          }}
        />
        <div className="absolute inset-[3px] rounded-full border border-white/10 bg-[#14171f]" />
        <div className="absolute inset-0" style={{ transform: `rotate(${angle}deg)` }}>
          <span className="absolute left-1/2 top-[5px] h-2.5 w-[2px] -translate-x-1/2 rounded-full bg-white/90" />
          <span
            className="absolute left-1/2 top-[-1px] h-1 w-1 -translate-x-1/2 rounded-full bg-white"
            style={{ boxShadow: `0 0 5px 1.5px ${ACCENT}` }}
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

// ── The panel ───────────────────────────────────────────────────────────────

export const BassRippleUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const pattern = parameter(parameters, 'pattern')
  const amount = parameter(parameters, 'amount')
  const scale = parameter(parameters, 'scale')
  const speed = parameter(parameters, 'speed')
  const release = parameter(parameters, 'release')

  if (!pattern || !amount || !scale || !speed || !release) return <ParameterList parameters={parameters} />

  const accentHsv = hexToHsv(ACCENT)
  // A hue-true dark shade, not an alpha tint - low-alpha accent over the
  // panel's mid-gray mixes into mud (see the design guide).
  const shade = hsvToHex(accentHsv.h, Math.min(accentHsv.s, 0.5), 0.075)

  return (
    <section
      data-testid="bass-ripple-user-interface"
      className="-mx-3 -mt-3"
      style={{ background: shade }}
    >
      <RipplePreview
        pattern={Math.round(numericValue(pattern, 0))}
        amount={numericValue(amount, 0.5)}
        scale={numericValue(scale, 3)}
        speed={numericValue(speed, 0.6)}
        release={numericValue(release, 0.5)}
      />
      <div
        // The preview's light spilling through the seam onto the console - the
        // one earned gradient, per the guide. Wraps segments AND knobs so the
        // spill stays at the seam under the preview.
        style={{ background: `radial-gradient(58% 30px at 50% 0, ${withAlpha(ACCENT, 0.14)}, transparent)` }}
      >
        <PatternSegments parameter={pattern} />
        <div className="flex items-end gap-5 px-4 pb-4 pt-3">
          <RippleKnob parameter={amount} label="INTENSITY" large />
          <RippleKnob parameter={scale} label="WAVE" />
          <RippleKnob parameter={speed} label="SPEED" />
          <RippleKnob parameter={release} label="RELEASE" />
        </div>
      </div>
    </section>
  )
}
