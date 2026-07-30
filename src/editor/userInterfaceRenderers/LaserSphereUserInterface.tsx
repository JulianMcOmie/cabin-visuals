'use client'

// Bespoke settings for Laser Sphere, following docs/instrument-panel-design-guide.md:
// the UI fills the rounded chassis card the settings panel wraps it in (no
// in-panel title, nothing that needs scrolling), washed with a dark shade of
// the instrument's color. A live bloomed orb you can orbit, then one row of four
// flat knobs - SIZE, GLOW, CORE, LIGHT - with the color pill on the far right.
// The pill opens a continuous HSV wheel, not the native swatch picker. Every
// control takes its accent from the color param, and the knobs carry a passive
// halo whose strength IS the glow param - the instrument speaking, not the
// cursor. The preview reuses the instrument's real rim shader and the app's
// laser bloom pass, so what glows here is what glows on stage.

import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { Color, type ShaderMaterial } from 'three'
import {
  DEFAULT_LASER_SPHERE_COLOR,
  LASER_FRAGMENT_SHADER,
  LASER_VERTEX_SHADER,
} from '../instruments/LaserSphere'
import { evaluateCoreAppearance } from '../instruments/laserSphereCore'
import { isNumberParam } from '../instruments/types'
import { ParameterList } from './ParametersUserInterface'
import { ColorWheelPill, hexToHsv, hsvToHex, withAlpha } from './colorWheel'
import { LaserKnob } from './laserKnob'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const WHITE = new Color(1, 1, 1)

function parameter(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((candidate) => candidate.definition.key === key)
}

function numericValue(bound: UserInterfaceParameter | undefined, fallback: number): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

function stringValue(bound: UserInterfaceParameter | undefined, fallback: string): string {
  return typeof bound?.value === 'string' ? bound.value : fallback
}

// ── Live preview ────────────────────────────────────────────────────────────

/** The orb, driven by the same shader + color math as the instrument at rest
 *  (energy 0, full opacity). Uniform values are written in useFrame so color
 *  edits land without remounting the material (same one-identity rule as the
 *  instrument's uniforms object). */
function PreviewOrb({ color, size, glow, whiteCore }: {
  color: string
  size: number
  glow: number
  whiteCore: number
}) {
  const base = useRef(new Color())
  const uniforms = useRef({
    coreColor: { value: new Color(DEFAULT_LASER_SPHERE_COLOR) },
    rimColor: { value: new Color(DEFAULT_LASER_SPHERE_COLOR).multiplyScalar(5.5) },
    uOpacity: { value: 1 },
  }).current
  const materialRef = useRef<ShaderMaterial>(null)

  useFrame(() => {
    const material = materialRef.current
    if (!material) return
    base.current.set(color)
    const core = evaluateCoreAppearance(whiteCore, glow, 0)
    ;(material.uniforms.coreColor.value as Color).copy(base.current)
      .lerp(WHITE, core.whiteMix)
      .multiplyScalar(core.intensity)
    ;(material.uniforms.rimColor.value as Color).copy(base.current)
      .lerp(WHITE, 0.13)
      .multiplyScalar(glow)
  })

  return (
    <mesh scale={clamp(size / 1.6, 0.22, 1.25) * 0.78}>
      <sphereGeometry args={[0.9, 64, 48]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={LASER_VERTEX_SHADER}
        fragmentShader={LASER_FRAGMENT_SHADER}
        uniforms={uniforms}
        toneMapped={false}
      />
    </mesh>
  )
}

function OrbPreview({ color, size, glow, whiteCore, light }: {
  color: string
  size: number
  glow: number
  whiteCore: number
  light: number
}) {
  return (
    <div
      data-testid="laser-orb-preview"
      title="Drag to orbit the laser"
      className="relative h-[148px] cursor-grab overflow-hidden rounded-t-[9px] border-b border-white/[0.06] bg-[#05070c] active:cursor-grabbing"
    >
      <Canvas dpr={[1, 2]} camera={{ position: [0, 0.9, 4.3], fov: 40 }} gl={{ antialias: true, alpha: true }}>
        {/* Opaque scene background: bloom composited onto a transparent canvas
            leaves visible alpha seams around the halo; an in-scene near-black
            keeps the glow falloff clean like the main compositor's. */}
        <color attach="background" args={['#05070c']} />
        <PreviewOrb color={color} size={size} glow={glow} whiteCore={whiteCore} />
        {/* The instrument's scene light at rest, dimmed for the tiny room so
            the floor pool stays a hint - it still tracks the LIGHT knob live. */}
        <pointLight position={[0, 0, 0]} color={color} intensity={light * 0.4} distance={14} decay={2} />
        <ambientLight intensity={0.05} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.5, 0]}>
          <circleGeometry args={[4.2, 48]} />
          <meshStandardMaterial color="#080b11" roughness={1} metalness={0} />
        </mesh>
        {/* Same pass as LaserPreviewBloom (InstrumentHoverPreview) - kept inline
            to avoid importing the sidebar module graph into the settings panel. */}
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.9} luminanceThreshold={1.15} luminanceSmoothing={0.08} mipmapBlur radius={0.72} levels={7} />
        </EffectComposer>
        <OrbitControls
          makeDefault
          target={[0, -0.1, 0]}
          enablePan={false}
          enableZoom={false}
          enableDamping
          dampingFactor={0.08}
          minPolarAngle={0.2}
          maxPolarAngle={Math.PI * 0.66}
        />
      </Canvas>
    </div>
  )
}

// ── Controls ────────────────────────────────────────────────────────────────

/** The guide's console knob (laserKnob.tsx - shared with every panel that follows
 *  the guide), bound to one of this instrument's params. */
function ParamKnob({ parameter: bound, label, accent, large = false }: {
  parameter: UserInterfaceParameter
  label: string
  accent: string
  /** The instrument's primary param reads a step larger (SIZE here). */
  large?: boolean
}) {
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null
  return (
    <LaserKnob
      value={bound.value}
      min={definition.min}
      max={definition.max}
      step={definition.step}
      defaultValue={definition.default}
      curve={definition.curve ?? 1}
      label={label}
      ariaLabel={definition.label}
      accent={accent}
      large={large}
      onChange={bound.setValue}
    />
  )
}

/** The laser's color pill: the shared HSV wheel wearing the GLOW-driven halo -
 *  the pill is the panel's emitter, a flat fill of the color with the halo the
 *  GLOW param dictates. */
function ColorWheel({ bound, halo }: { bound: UserInterfaceParameter; halo: string }) {
  if (typeof bound.value !== 'string') return null
  return (
    <ColorWheelPill
      value={bound.value}
      onChange={(hex) => bound.setValue(hex)}
      label="COLOR"
      ariaLabel="Laser color"
      halo={halo}
      align="right"
      pillTestId="laser-color-pill"
      wheelTestId="laser-color-wheel"
    />
  )
}

// ── The panel ───────────────────────────────────────────────────────────────

export const LaserSphereUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const size = parameter(parameters, 'size')
  const color = parameter(parameters, 'color')
  const glow = parameter(parameters, 'glow')
  const whiteCore = parameter(parameters, 'whiteCore')
  const light = parameter(parameters, 'light')

  if (!size || !color || !glow || !whiteCore || !light) return <ParameterList parameters={parameters} />

  const accent = stringValue(color, DEFAULT_LASER_SPHERE_COLOR)
  const accentHsv = hexToHsv(accent)
  const glowValue = numericValue(glow, 5.5)
  // The section background is a hue-true DARK SHADE of the accent, not an
  // alpha tint: low-alpha color over the panel's mid-gray mixes into mud,
  // while keeping the hue at low value stays alive.
  const shade = hsvToHex(accentHsv.h, Math.min(accentHsv.s, 0.5), 0.075)
  // The COLOR pill is the emitter - its halo alone follows the GLOW param
  // (1.5..12) in reach and strength. Knob glow lives in the arcs themselves.
  const pillHalo = `0 0 ${Math.round(5 + glowValue * 1.8)}px ${withAlpha(accent, 0.18 + (glowValue / 12) * 0.55)}`

  return (
    // The instrument fills its chassis: cancel the card's p-3 on all sides so
    // the shade wash runs to the frame. The card can't clip (the color wheel
    // popover must escape it), so the section rounds its own background to
    // sit inside the card's 10px border.
    <section
      data-testid="laser-sphere-user-interface"
      className="-m-3 rounded-[9px]"
      style={{ background: shade }}
    >
      <OrbPreview
        color={accent}
        size={numericValue(size, 1.6)}
        glow={glowValue}
        whiteCore={numericValue(whiteCore, 1)}
        light={numericValue(light, 14)}
      />
      <div
        className="flex items-end gap-5 px-4 pb-4 pt-3"
        // The orb's light spilling through the seam onto the console - the
        // room is lit by the instrument, not painted.
        style={{ background: `radial-gradient(58% 30px at 50% 0, ${withAlpha(accent, 0.14)}, transparent)` }}
      >
        <ParamKnob parameter={size} label="SIZE" accent={accent} large />
        <ParamKnob parameter={glow} label="GLOW" accent={accent} />
        <ParamKnob parameter={whiteCore} label="CORE" accent={accent} />
        <ParamKnob parameter={light} label="LIGHT" accent={accent} />
        <div className="ml-auto">
          <ColorWheel bound={color} halo={pillHalo} />
        </div>
      </div>
    </section>
  )
}
