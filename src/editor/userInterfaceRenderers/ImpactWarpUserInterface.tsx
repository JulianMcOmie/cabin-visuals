import { useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { PreviewCanvas } from './console'
import { EffectComposer } from '@react-three/postprocessing'
import { Effect } from 'postprocessing'
import { Uniform } from 'three'
import {
  IMPACT_WARP_FIELD_GLSL,
  IMPACT_WARP_SECONDS,
  IMPACT_WARP_DEFAULT,
  impactEnvelope,
  impactDrive,
} from '../instruments/ImpactWarp'
import { isNumberParam } from '../instruments/types'
import { ParameterList } from './ParametersUserInterface'
import { LaserKnob } from './laserKnob'
import { hexToHsv, hsvToHex, towardWhite, withAlpha } from './colorWheel'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

/** Impact Warp exposes no color param, so its accent is the orange its identity
 *  color, library icon and 2D preview card already use - one identity across
 *  the app. */
const ACCENT = '#ff6a00'

function parameter(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((candidate) => candidate.definition.key === key)
}

function numericValue(bound: UserInterfaceParameter | undefined, fallback: number): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

// The inspector uses the same envelope, limiter and shader as the stage.
const PREVIEW_IMPACT_FRAGMENT = `
uniform float amount;
${IMPACT_WARP_FIELD_GLSL}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = texture2D(inputBuffer, impactWarpWrap(uv + impactWarpOffset(uv, amount)));
}`

class ImpactWarpPreviewEffect extends Effect {
  constructor() {
    super('ImpactWarpPreviewEffect', PREVIEW_IMPACT_FRAGMENT, {
      uniforms: new Map([['amount', new Uniform(0)]]),
    })
  }
}

function ImpactPass({ impact }: { impact: number }) {
  const effect = useMemo(() => new ImpactWarpPreviewEffect(), [])
  useFrame(({ clock }) => {
    const age = (clock.getElapsedTime() % 1.5) / IMPACT_WARP_SECONDS
    effect.uniforms.get('amount')!.value = impactDrive(impactEnvelope(age)) * impact
  })
  return <primitive object={effect} dispose={null} />
}

// A regular lattice is what makes a positional warp legible: straight rows and
// even gaps have somewhere to bend FROM, and symmetric motion needs a fixed reference.
const SPACING = 1.02
const CUBE = 0.56
/** Rings of cubes past the edge keep the small rebound filled. */
const OVERSCAN = 2

/**
 * The lattice is sized from the VIEWPORT rather than being a fixed 5×3.
 * The inspector is fluid - this canvas runs anywhere from about 4:1 to 6.5:1
 * depending on window width and whether the library is showing - and a fixed
 * count that fits the narrow case leaves a small cluster of cubes marooned in
 * the middle of the wide one, with nothing near the edges for the warp to bend.
 */
function PreviewCubes() {
  const { viewport } = useThree()
  const cubes = useMemo(() => {
    const columns = Math.ceil(viewport.width / SPACING) + OVERSCAN * 2
    const rows = Math.ceil(viewport.height / SPACING) + OVERSCAN * 2
    return Array.from({ length: columns * rows }, (_, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      const checker = (column + row) % 2 === 0
      return {
        key: index,
        position: [
          (column - (columns - 1) / 2) * SPACING,
          ((rows - 1) / 2 - row) * SPACING,
          checker ? -0.4 : 0,
        ] as [number, number, number],
        // Alternating lightness so neighbouring faces stay distinguishable once
        // the hit moves the whole lattice toward the viewer.
        tint: checker ? towardWhite(ACCENT, 0.3) : ACCENT,
      }
    })
  }, [viewport.width, viewport.height])

  return (
    <group>
      {cubes.map((cube) => (
        <mesh key={cube.key} position={cube.position}>
          <boxGeometry args={[CUBE, CUBE, CUBE]} />
          <meshStandardMaterial color={cube.tint} roughness={0.28} metalness={0.2} />
        </mesh>
      ))}
    </group>
  )
}

function ImpactPreview({ impact }: { impact: number }) {
  return (
    <div
      data-testid="impact-warp-preview"
      className="relative h-[148px] overflow-hidden border-b border-[color-mix(in_srgb,var(--text)_6%,transparent)] bg-[var(--bg-canvas-deep)]"
    >
      <PreviewCanvas dpr={[1, 2]} camera={{ position: [0, 0, 6.1], fov: 40 }} gl={{ antialias: true, alpha: true }}>
        {/* Opaque in-scene background: the field samples the rendered image, and
            a transparent canvas would drag alpha seams around with it. */}
        <color attach="background" args={['#05070c']} />
        {/* Low ambient with one strong key: flat lighting makes the lattice a
            field of identical orange squares, and displacement needs edges. */}
        <ambientLight intensity={0.22} />
        <directionalLight position={[2.4, 3, 4]} intensity={2.6} />
        <pointLight position={[-3, -1.5, 2.5]} color={ACCENT} intensity={22} distance={14} decay={2} />
        <PreviewCubes />
        <EffectComposer multisampling={0}>
          <ImpactPass impact={impact} />
        </EffectComposer>
      </PreviewCanvas>
    </div>
  )
}

// ── Controls ────────────────────────────────────────────────────────────────

/** A knob bound to a numeric param, on the guide's shared LaserKnob. */
function ParamKnob({ bound, label, ariaLabel, large = false, suffix }: {
  bound: UserInterfaceParameter
  label: string
  ariaLabel?: string
  large?: boolean
  suffix?: string
}) {
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null
  return (
    <LaserKnob
      value={bound.value}
      min={definition.min}
      max={definition.max}
      step={definition.step} integer={definition.integer}
      defaultValue={definition.default}
      curve={definition.curve}
      label={label}
      ariaLabel={ariaLabel ?? definition.label}
      accent={ACCENT}
      large={large}
      suffix={suffix}
      onChange={bound.setValue}
    />
  )
}

// ── The panel ───────────────────────────────────────────────────────────────

export const ImpactWarpUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const impact = parameter(parameters, 'impact')
  if (!impact) return <ParameterList parameters={parameters} />

  const accentHsv = hexToHsv(ACCENT)
  // A hue-true dark shade, not an alpha tint - low-alpha accent over the panel's
  // mid-gray mixes into mud (see the design guide).
  const shade = hsvToHex(accentHsv.h, Math.min(accentHsv.s, 0.5), 0.075)

  return (
    <section
      data-testid="impact-warp-user-interface"
      className="-mx-3 -mt-3"
      style={{ background: shade }}
    >
      <ImpactPreview impact={numericValue(impact, IMPACT_WARP_DEFAULT)} />
      <div
        className="flex items-end justify-center gap-6 px-4 pb-4 pt-3"
        // The preview's light spilling through the seam onto the console - the
        // one earned gradient, per the guide.
        style={{ background: `radial-gradient(58% 30px at 50% 0, ${withAlpha(ACCENT, 0.14)}, transparent)` }}
      >
        <ParamKnob bound={impact} label="IMPACT" large />
      </div>
    </section>
  )
}
