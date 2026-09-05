'use client'

// Bespoke settings for Bass Ripple, built from the console kit (./console):
// full-bleed, no card chrome, washed with the accent's dark shade. A live
// preview of a cube lattice being shaken by the warp, then one row of five
// flat knobs - INTENSITY largest, then WAVE, FREQ, SPEED, RELEASE.
//
// Two things are specific to this instrument. It has no `color` param, so the
// accent is fixed to the violet the library icon already wears rather than a
// live one. And it draws nothing of its own - the honest preview is therefore
// something ELSE being bent, which is why the panel supplies its own cubes and
// runs the instrument's real field shader over them.

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { EffectComposer } from '@react-three/postprocessing'
import { Effect } from 'postprocessing'
import { Uniform, type Group } from 'three'
import { BASS_RIPPLE_FIELD_GLSL } from '../instruments/BassRipple'
import {
  bindPanel,
  Console,
  ControlRow,
  Knob,
  More,
  ParameterList,
  PreviewWindow,
  towardWhite,
  type SelectBinding,
  PreviewCanvas,
} from './console'
import type { UserInterfaceRendererDefinition } from './types'

/** Bass Ripple exposes no color param, so its accent is the violet its library
 *  icon and 2D preview card already use - one identity across the app. */
const ACCENT = '#a78bfa'

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
uniform float frequency;
uniform float time;
uniform float aspect;

${BASS_RIPPLE_FIELD_GLSL}

void mainUv(inout vec2 uv) {
  uv = clamp(uv + bassRippleOffset(uv, pattern, amount, scale, speed, frequency, time, aspect), 0.0, 1.0);
}`

class BassRippleWarpEffect extends Effect {
  constructor() {
    super('BassRippleWarpEffect', PREVIEW_WARP_FRAGMENT, {
      uniforms: new Map<string, Uniform>([
        ['pattern', new Uniform(0)],
        ['amount', new Uniform(0)],
        ['scale', new Uniform(3)],
        ['speed', new Uniform(0.6)],
        ['frequency', new Uniform(1)],
        ['time', new Uniform(0)],
        ['aspect', new Uniform(1)],
      ]),
    })
  }
}

function WarpPass({ pattern, amount, scale, speed, frequency, release }: {
  pattern: number
  amount: number
  scale: number
  speed: number
  frequency: number
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
    uniforms.get('frequency')!.value = frequency
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

function RipplePreview({ pattern, amount, scale, speed, frequency, release }: {
  pattern: number
  amount: number
  scale: number
  speed: number
  frequency: number
  release: number
}) {
  return (
    <PreviewWindow
      height={148}
      testId="bass-ripple-preview"
      title="Drag to orbit the lattice"
      className="cursor-grab active:cursor-grabbing"
    >
      <PreviewCanvas dpr={[1, 2]} camera={{ position: [0, 0, 6.1], fov: 40 }} gl={{ antialias: true, alpha: true }}>
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
          <WarpPass pattern={pattern} amount={amount} scale={scale} speed={speed} frequency={frequency} release={release} />
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

/** One stroke glyph per field, drawn like the Colorizer's SHAPE falloffs so
 *  the choice is legible without reading the word: a squiggle (noise), a
 *  spiral (twist), a sine (waves), a grid (weave), a flower (bloom).
 *  `currentColor` strokes follow the segment's label color, so active glyphs
 *  go dark on the accent automatically. */
const PATTERN_GLYPHS: Record<number, string> = {
  0: 'M1 8 C3 2.5 4.5 9.5 7 6 C9 3.2 10.5 9 13 4.5',
  1: 'M7 6 C7.9 5.1 8.2 7 7 7.2 C5.3 7.5 5 5 6.4 4.2 C8.4 3.1 10.2 4.8 9.7 6.9 C9.1 9.2 5.9 9.6 4.4 8',
  2: 'M1 6 C3 2 5 2 7 6 C9 10 11 10 13 6',
  3: 'M4.5 1 V11 M9.5 1 V11 M1 4 H13 M1 8 H13',
  4: 'M7 6 m-1.1 0 a1.1 1.1 0 1 0 2.2 0 a1.1 1.1 0 1 0 -2.2 0 M7 3.4 V1.6 M7 8.6 V10.4 M4.7 4.7 L3.4 3.4 M9.3 4.7 L10.6 3.4 M4.7 7.3 L3.4 8.6 M9.3 7.3 L10.6 8.6',
}

/** The pattern picker, in the Colorizer's flat segmented idiom (its SHAPE
 *  selector), deliberately NOT the kit's recessed Segmented: hard-cornered
 *  segments in one bordered strip, the active one a solid accent fill carrying
 *  a dark label, the rest near-black. No gradients, no glow, no sliding thumb -
 *  the switch is instant, and the accent block itself is the state. */
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
            style={selected ? { background: ACCENT, color: '#0c0a1a' } : undefined}
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

// ── The panel ───────────────────────────────────────────────────────────────

export const BassRippleUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const pattern = b.select('pattern')
  const amount = b.num('amount')
  const scale = b.num('scale')
  const frequency = b.num('frequency')
  const speed = b.num('speed')
  const release = b.num('release')

  if (!pattern || !amount || !scale || !frequency || !speed || !release) return <ParameterList parameters={parameters} />

  // FREQ multiplies angular symmetry, which only the polar patterns have -
  // dimmed elsewhere rather than hidden, so the console doesn't reflow.
  const activePattern = Math.round(pattern.value)
  const frequencyApplies = activePattern === 1 || activePattern === 4

  return (
    <Console accent={ACCENT} testId="bass-ripple-user-interface">
      <RipplePreview
        pattern={activePattern}
        amount={amount.value}
        scale={scale.value}
        speed={speed.value}
        frequency={frequency.value}
        release={release.value}
      />
      {/* Solid console below the preview - no light-spill gradient. The flat
          segments read as blocks of state, and a wash behind them muddied that. */}
      <PatternSegments b={pattern} />
      <ControlRow>
        <Knob b={amount} label="INTENSITY" large />
        <Knob b={scale} label="WAVE" />
        <div
          className={frequencyApplies ? 'transition-opacity' : 'pointer-events-none opacity-35 transition-opacity'}
          title={frequencyApplies ? undefined : 'Frequency shapes the Twist and Bloom patterns'}
        >
          <Knob b={frequency} label="FREQ" />
        </div>
        <Knob b={speed} label="SPEED" />
        <Knob b={release} label="RELEASE" />
      </ControlRow>
      <More parameters={b.rest()} />
    </Console>
  )
}
