'use client'

// Bespoke settings for Water Shimmer, built from the console kit (./console)
// to the same plan as its sibling Bass Ripple: a live preview, the pattern
// picker, one row of flat knobs - INTENSITY largest, then WAVE, SPEED, COLOR,
// RELEASE - and, on its own row beneath them, the switch for what a note
// MEANS (flow while held, or always flow and let a note still it).
//
// Like Bass Ripple it draws nothing of its own, so the honest preview is
// something ELSE being re-lit: the panel supplies a few solids and runs the
// instrument's real field and colour law over them. Three large faces rather
// than Bass Ripple's lattice, because the subject here is a texture and a
// texture needs surface to be read on - a lattice of small cubes would show
// one feature each.

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { EffectComposer } from '@react-three/postprocessing'
import { Effect } from 'postprocessing'
import { Uniform, type Group } from 'three'
import {
  WATER_SHIMMER_FIELD_GLSL,
  WATER_SHIMMER_GATE_ALWAYS,
  WATER_SHIMMER_GATE_HELD,
} from '../instruments/WaterShimmer'
import {
  bindPanel,
  Console,
  ControlRow,
  Knob,
  More,
  ParameterList,
  PreviewWindow,
  Segmented,
  towardWhite,
  type SelectBinding,
  PreviewCanvas,
} from './console'
import type { UserInterfaceRendererDefinition } from './types'

/** Water Shimmer exposes no color param, so its accent is the cyan its
 *  library icon and timeline row already wear - one identity across the app. */
const ACCENT = '#22d3ee'

// ── Live preview ────────────────────────────────────────────────────────────

// The preview plays a note on a loop so both gates have something to show:
// held for HOLD beats of every LOOP, then released. Under While held that is
// the water coming and going; under Always on it is the note stilling it.
const PREVIEW_LOOP_BEATS = 4
const PREVIEW_HOLD_BEATS = 1.5
/** Preview beats per wall-clock second (120bpm), so the flow reads musically. */
const PREVIEW_BEATS_PER_SECOND = 2

/** How "held" the looping note is. Deliberately the same squared tail as the
 *  instrument's own release, so the knob shows its real shape. */
function previewHeldLevel(beat: number, release: number): number {
  const phase = ((beat % PREVIEW_LOOP_BEATS) + PREVIEW_LOOP_BEATS) % PREVIEW_LOOP_BEATS
  if (phase < PREVIEW_HOLD_BEATS) return 1
  if (release <= 0) return 0
  const age = (phase - PREVIEW_HOLD_BEATS) / release
  if (age >= 1) return 0
  return (1 - age) * (1 - age)
}

// A colour-only pass over the preview's own render. `mainImage` is exactly the
// right hook: the effect is handed each pixel and returns it re-exposed, at
// the same place - which is the instrument's whole contract.
const PREVIEW_SHIMMER_FRAGMENT = `
uniform float pattern;
uniform float amount;
uniform float scale;
uniform float speed;
uniform float chroma;
uniform float time;
uniform float aspect;

${WATER_SHIMMER_FIELD_GLSL}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = waterShimmerApply(inputColor, waterShimmerField(uv, pattern, scale, speed, time, aspect), amount, chroma);
}`

class WaterShimmerEffect extends Effect {
  constructor() {
    super('WaterShimmerEffect', PREVIEW_SHIMMER_FRAGMENT, {
      uniforms: new Map<string, Uniform>([
        ['pattern', new Uniform(0)],
        ['amount', new Uniform(0)],
        ['scale', new Uniform(3)],
        ['speed', new Uniform(0.6)],
        ['chroma', new Uniform(0.5)],
        ['time', new Uniform(0)],
        ['aspect', new Uniform(1)],
      ]),
    })
  }
}

interface PreviewSettings {
  pattern: number
  amount: number
  scale: number
  speed: number
  chroma: number
  release: number
  gate: number
}

function ShimmerPass({ pattern, amount, scale, speed, chroma, release, gate }: PreviewSettings) {
  const effect = useMemo(() => new WaterShimmerEffect(), [])
  useFrame(({ clock, size }) => {
    const beat = clock.getElapsedTime() * PREVIEW_BEATS_PER_SECOND
    const held = previewHeldLevel(beat, release)
    const uniforms = effect.uniforms
    uniforms.get('pattern')!.value = pattern
    uniforms.get('time')!.value = beat
    uniforms.get('scale')!.value = scale
    uniforms.get('speed')!.value = speed
    uniforms.get('chroma')!.value = chroma
    uniforms.get('amount')!.value = amount * (gate === WATER_SHIMMER_GATE_ALWAYS ? 1 - held : held)
    uniforms.get('aspect')!.value = size.width / Math.max(1, size.height)
  })
  return <primitive object={effect} dispose={null} />
}

// Three solids, each a different lightness of the accent: the same field
// lands differently on a dark face and a pale one, and seeing both is how the
// COLOR knob gets judged.
const SOLIDS = [
  { key: 'deep', x: -1.85, tint: '#0e7490', turn: 0.5 },
  { key: 'accent', x: 0, tint: ACCENT, turn: -0.35 },
  { key: 'pale', x: 1.85, tint: towardWhite(ACCENT, 0.72), turn: 0.2 },
]

function PreviewSolids() {
  const group = useRef<Group>(null)
  useFrame(({ clock }) => {
    const time = clock.getElapsedTime()
    if (!group.current) return
    // A slow sway, not a spin: the faces should stay faces, so the water is
    // the thing that moves across them.
    group.current.rotation.y = Math.sin(time * 0.3) * 0.22
    group.current.rotation.x = Math.sin(time * 0.19) * 0.06
  })
  return (
    <group ref={group}>
      {SOLIDS.map((solid) => (
        <mesh key={solid.key} position={[solid.x, 0, 0]} rotation={[0.32, solid.turn, 0]}>
          <boxGeometry args={[1.3, 1.3, 1.3]} />
          <meshStandardMaterial color={solid.tint} roughness={0.5} metalness={0.05} />
        </mesh>
      ))}
    </group>
  )
}

function ShimmerPreview(settings: PreviewSettings) {
  return (
    <PreviewWindow
      height={148}
      testId="water-shimmer-preview"
      title="Drag to orbit the solids"
      className="cursor-grab active:cursor-grabbing"
    >
      <PreviewCanvas dpr={[1, 2]} camera={{ position: [0, 0, 6.1], fov: 40 }} gl={{ antialias: true, alpha: true }}>
        {/* Near-black in-scene background: the pass scales the colour it finds,
            so the backdrop stays dark and the water reads on the solids. */}
        <color attach="background" args={['#05070c']} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[2.4, 3, 4]} intensity={2.2} />
        <PreviewSolids />
        <EffectComposer multisampling={0}>
          <ShimmerPass {...settings} />
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
      </PreviewCanvas>
    </PreviewWindow>
  )
}

// ── Controls ────────────────────────────────────────────────────────────────

/** One stroke glyph per field, in Bass Ripple's idiom so the two siblings'
 *  pickers read as one family: a net (caustics), stacked rollers (swell),
 *  concentric circles (rings). `currentColor` follows the segment's label. */
const PATTERN_GLYPHS: Record<number, string> = {
  0: 'M1 3.6 C3 1.8 5 5 7 3.2 S11 1.8 13 3.6 M1 8.8 C3 7 5 10.2 7 8.4 S11 7 13 8.8 M4.2 3.6 L3.4 8.2 M9.6 3 L10.4 8.4',
  1: 'M1 4.4 C3 1.4 5 1.4 7 4.4 S11 7.4 13 4.4 M1 8.6 C3 5.6 5 5.6 7 8.6 S11 11.6 13 8.6',
  2: 'M7 6 m-1.3 0 a1.3 1.3 0 1 0 2.6 0 a1.3 1.3 0 1 0 -2.6 0 M7 6 m-4.2 0 a4.2 4.2 0 1 0 8.4 0 a4.2 4.2 0 1 0 -8.4 0',
}

/** The pattern picker, in Bass Ripple's flat segmented idiom (hard-cornered
 *  segments in one bordered strip, the active one a solid accent block) - the
 *  same control on the same shelf should not come in two shapes. */
function PatternSegments({ b }: { b: SelectBinding }) {
  const active = Math.round(b.value)
  return (
    <div
      role="radiogroup"
      aria-label={b.def.label}
      className="mx-4 mt-3 flex overflow-hidden rounded-md border border-white/10"
    >
      {b.def.options.map((option) => {
        const selected = option.value === active
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => b.set(option.value)}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1 px-1 py-[5px] text-[9px] font-semibold uppercase tracking-[0.1em] ${
              selected ? '' : 'bg-black/25 text-white/40 hover:bg-white/5 hover:text-white/60'
            }`}
            style={selected ? { background: ACCENT, color: '#04141a' } : undefined}
          >
            <svg width="14" height="12" viewBox="0 0 14 12" fill="none" aria-hidden>
              <path
                d={PATTERN_GLYPHS[option.value] ?? ''}
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** What each gate does, said in full in the tooltip; the segment itself
 *  carries the two-word name. */
const GATE_SEGMENTS = [
  { value: WATER_SHIMMER_GATE_HELD, label: 'Flows while a note is held', glyph: 'WHILE HELD' },
  { value: WATER_SHIMMER_GATE_ALWAYS, label: 'Always flows - a held note stills it', glyph: 'ALWAYS ON' },
]

// ── The panel ───────────────────────────────────────────────────────────────

export const WaterShimmerUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const pattern = b.select('pattern')
  const amount = b.num('amount')
  const scale = b.num('scale')
  const speed = b.num('speed')
  const chroma = b.num('chroma')
  const release = b.num('release')
  const gate = b.select('gate')

  if (!pattern || !amount || !scale || !speed || !chroma || !release || !gate) return <ParameterList parameters={parameters} />

  return (
    <Console accent={ACCENT} testId="water-shimmer-user-interface">
      <ShimmerPreview
        pattern={Math.round(pattern.value)}
        amount={amount.value}
        scale={scale.value}
        speed={speed.value}
        chroma={chroma.value}
        release={release.value}
        gate={Math.round(gate.value)}
      />
      <PatternSegments b={pattern} />
      <ControlRow>
        <Knob b={amount} label="INTENSITY" large />
        <Knob b={scale} label="WAVE" />
        <Knob b={speed} label="SPEED" />
        <Knob b={chroma} label="COLOR" />
        <Knob b={release} label="RELEASE" />
      </ControlRow>
      {/* Its own centered row beneath the knobs: a choice about what a note
          means, not one more amount, so it does not sit among them. */}
      <div className="flex justify-center px-4 pb-4">
        <Segmented b={gate} options={GATE_SEGMENTS} name="When it runs" className="w-full max-w-[236px]" />
      </div>
      <More parameters={b.rest()} />
    </Console>
  )
}
