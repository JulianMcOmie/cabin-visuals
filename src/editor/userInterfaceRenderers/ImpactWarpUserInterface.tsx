'use client'

// Bespoke settings for Impact Warp, following docs/instrument-panel-design-guide.md
// and the Bass Ripple panel: full-bleed, no card chrome, no in-panel title,
// washed with a hue-true dark shade of the instrument's accent. A live preview of
// a lattice taking hits, the STYLE strip, then IMPACT / RELEASE / SIZE.
//
// Three things are specific to this instrument.
//
// The preview PERFORMS. A held warp shows itself standing still; a strike is
// nothing but its envelope, so the panel plays a metronomic hit every two beats
// and every knob change reads on the next one. The performance runs the
// instrument's own `impactEnvelope` and `impactShoveDirection` over its own GLSL
// field, summed exactly the way resolveActiveImpactWarp sums overlapping hits -
// so a long RELEASE compounds here for the same reason it compounds on stage.
//
// Unlike Bass Ripple's preview, nothing is scaled down for the small canvas. The
// field displaces by a fraction of the FRAME with no absolute length anywhere in
// it, so a 148px preview is hit exactly as hard as a 4K export.
//
// STYLE gets a full-width strip rather than a slot in the knob row: four options
// need four words, and the third knob's caption CHANGES with the style (the same
// number means bulge, ring width, roll or slab height depending on which shape
// is being thrown), which only makes sense if the style is the thing above it.

import { useMemo, useRef, type ReactElement } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { PreviewCanvas } from './console'
import { OrbitControls } from '@react-three/drei'
import { EffectComposer } from '@react-three/postprocessing'
import { Effect } from 'postprocessing'
import { Uniform, Vector2, type Group } from 'three'
import {
  IMPACT_STYLE_PUNCH,
  IMPACT_STYLE_RUPTURE,
  IMPACT_STYLE_SHOCKWAVE,
  IMPACT_STYLE_SLAM,
  IMPACT_WARP_FIELD_GLSL,
  impactEnvelope,
  impactShoveDirection,
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

// ── The style vocabulary ────────────────────────────────────────────────────

/** Each style DRAWS its own shape of hit, so the choice is legible before the
 *  word is read - the Colorizer's ShapeSelector move. */
const STYLE_GLYPHS: Record<number, ReactElement> = {
  // A face flying at you, corners first.
  [IMPACT_STYLE_PUNCH]: (
    <>
      <rect x="5.5" y="3.5" width="5" height="5" rx="0.6" />
      <path d="M4.4 2.4 L1.6 0.9M11.6 2.4 L14.4 0.9M4.4 9.6 L1.6 11.1M11.6 9.6 L14.4 11.1" />
    </>
  ),
  // One ring on its way out.
  [IMPACT_STYLE_SHOCKWAVE]: (
    <>
      <circle cx="8" cy="6" r="1.1" />
      <circle cx="8" cy="6" r="3.2" />
      <circle cx="8" cy="6" r="5.3" opacity="0.45" />
    </>
  ),
  // The frame shoved off its mark, with the trail it left.
  [IMPACT_STYLE_SLAM]: (
    <>
      <rect x="7.5" y="2.6" width="6.8" height="6.8" rx="0.6" />
      <path d="M1.2 4.2 H4.8M2.4 6 H5.6M1.2 7.8 H4.8" opacity="0.7" />
    </>
  ),
  // Intact bands, torn off their line.
  [IMPACT_STYLE_RUPTURE]: (
    <>
      <path d="M2.2 2.4 H11.8M4.8 5 H14.4M1.6 7.4 H11.2M4.2 9.8 H13.8" />
    </>
  ),
}

/** What the SIZE knob means per style, as its caption. One param, because it is
 *  one idea - the spatial scale of the disturbance - but the word has to be the
 *  one that names it in the shape actually selected. */
const SIZE_CAPTIONS: Record<number, string> = {
  [IMPACT_STYLE_PUNCH]: 'BULGE',
  [IMPACT_STYLE_SHOCKWAVE]: 'WIDTH',
  [IMPACT_STYLE_SLAM]: 'ROLL',
  [IMPACT_STYLE_RUPTURE]: 'SLABS',
}

const STYLE_HINTS: Record<number, string> = {
  [IMPACT_STYLE_PUNCH]: 'The frame slams toward you and springs back — SIZE bulges the edges',
  [IMPACT_STYLE_SHOCKWAVE]: 'One ring of compression leaves the center — SIZE is its thickness',
  [IMPACT_STYLE_SLAM]: 'The frame is shoved from a new side each hit — SIZE rolls it into the blow',
  [IMPACT_STYLE_RUPTURE]: 'Bands tear sideways and snap back — SIZE is how tall they are',
}

// ── Live preview ────────────────────────────────────────────────────────────

/** Preview beats per wall-clock second (120bpm), matching Bass Ripple's and
 *  Strobe's previews so the panels all tick alike. */
const PREVIEW_BEATS_PER_SECOND = 2
/** A hit every two beats: the knobs are what the panel is about, so the
 *  performance stays metronomic and out of the way. */
const PREVIEW_HIT_BEATS = 2
/** How many past hits can still be decaying. RELEASE tops out at 3 beats, so
 *  two are always enough; a third is free insurance against re-tuning that. */
const PREVIEW_HIT_HISTORY = 3

/**
 * The preview's performance, resolved exactly as resolveActiveImpactWarp
 * resolves a track: every hit still inside its release contributes a signed
 * envelope, they sum, the sum saturates, and the freshest hit owns the ring's
 * phase and the rupture's seed. Velocity is 1 - the panel is showing what the
 * knobs do, not what the keyboard does.
 */
function previewStrike(beat: number, release: number, style: number) {
  const newest = Math.floor(beat / PREVIEW_HIT_BEATS)
  let drive = 0
  let shoveX = 0
  let shoveY = 0
  let freshest = -Infinity
  let seed = 0
  for (let index = Math.max(0, newest - PREVIEW_HIT_HISTORY); index <= newest; index++) {
    const hitBeat = index * PREVIEW_HIT_BEATS
    if (hitBeat > beat) continue
    const envelope = impactEnvelope((beat - hitBeat) / release)
    if (envelope === 0) continue
    drive += envelope
    const direction = impactShoveDirection(index)
    shoveX += direction.x * envelope
    shoveY += direction.y * envelope
    if (hitBeat >= freshest) {
      freshest = hitBeat
      seed = index
    }
  }
  const shoveLength = Math.hypot(shoveX, shoveY)
  const shoveScale = shoveLength > 1 ? 1 / shoveLength : 1
  const phase = freshest === -Infinity ? 1 : Math.min(1, (beat - freshest) / release)
  return {
    // Shockwave's monotonic, non-compounding amplitude, exactly as the resolve
    // special-cases it - a wavefront crossing the frame rather than the frame
    // being deformed.
    amount: style === IMPACT_STYLE_SHOCKWAVE ? 1 - phase : Math.max(-1, Math.min(1, drive)),
    dirX: shoveX * shoveScale,
    dirY: shoveY * shoveScale,
    phase,
    seed,
  }
}

// The instrument's own field over the preview's own render. `mainImage` rather
// than `mainUv` because the stage pass splits the channels, which needs three
// taps of the input buffer - a UV-only hook could only move all three together
// and the preview would be missing the fringe that makes a hit read as a hit.
const PREVIEW_IMPACT_FRAGMENT = `
uniform float style;
uniform float amount;
uniform vec2 dir;
uniform float phase;
uniform float size;
uniform float seed;
uniform float aspect;

${IMPACT_WARP_FIELD_GLSL}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 offset = impactWarpOffset(uv, style, amount, dir, phase, size, seed, aspect);
  vec2 split = impactWarpSplit(offset);
  vec4 mid = texture2D(inputBuffer, impactWarpWrap(uv + offset));
  float red = texture2D(inputBuffer, impactWarpWrap(uv + offset + split)).r;
  float blue = texture2D(inputBuffer, impactWarpWrap(uv + offset - split)).b;
  outputColor = vec4(red, mid.g, blue, mid.a);
}`

class ImpactWarpPreviewEffect extends Effect {
  constructor() {
    super('ImpactWarpPreviewEffect', PREVIEW_IMPACT_FRAGMENT, {
      uniforms: new Map<string, Uniform>([
        ['style', new Uniform(0)],
        ['amount', new Uniform(0)],
        ['dir', new Uniform(new Vector2())],
        ['phase', new Uniform(0)],
        ['size', new Uniform(0.5)],
        ['seed', new Uniform(0)],
        ['aspect', new Uniform(1)],
      ]),
    })
  }
}

function ImpactPass({ style, impact, release, size }: {
  style: number
  impact: number
  release: number
  size: number
}) {
  const effect = useMemo(() => new ImpactWarpPreviewEffect(), [])
  useFrame(({ clock, size: canvasSize }) => {
    const beat = clock.getElapsedTime() * PREVIEW_BEATS_PER_SECOND
    const strike = previewStrike(beat, Math.max(0.01, release), style)
    const uniforms = effect.uniforms
    uniforms.get('style')!.value = style
    uniforms.get('amount')!.value = strike.amount * impact
    ;(uniforms.get('dir')!.value as Vector2).set(strike.dirX * impact, strike.dirY * impact)
    uniforms.get('phase')!.value = strike.phase
    uniforms.get('size')!.value = size
    uniforms.get('seed')!.value = strike.seed
    uniforms.get('aspect')!.value = canvasSize.width / Math.max(1, canvasSize.height)
  })
  return <primitive object={effect} dispose={null} />
}

// A regular lattice is what makes a positional warp legible: straight rows and
// even gaps have somewhere to bend FROM, and a rupture needs lines to break.
const SPACING = 1.02
const CUBE = 0.56
/** Rings of cubes past the edge, so the drift never swings a gap into frame. */
const OVERSCAN = 2

/**
 * The lattice is sized from the VIEWPORT rather than being a fixed 5×3.
 * The inspector is fluid - this canvas runs anywhere from about 4:1 to 6.5:1
 * depending on window width and whether the library is showing - and a fixed
 * count that fits the narrow case leaves a small cluster of cubes marooned in
 * the middle of the wide one, with nothing near the edges for the warp to bend.
 */
function PreviewCubes() {
  const group = useRef<Group>(null)
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
        // the hit starts sliding them across each other.
        tint: checker ? towardWhite(ACCENT, 0.3) : ACCENT,
      }
    })
  }, [viewport.width, viewport.height])

  useFrame(({ clock }) => {
    if (!group.current) return
    // A slow drift rather than a spin: the lattice should stay readable as a
    // lattice, so the hit is the thing that moves.
    const time = clock.getElapsedTime()
    group.current.rotation.y = Math.sin(time * 0.32) * 0.18
    group.current.rotation.x = Math.sin(time * 0.21) * 0.05
  })

  return (
    <group ref={group}>
      {cubes.map((cube) => (
        <mesh key={cube.key} position={cube.position}>
          <boxGeometry args={[CUBE, CUBE, CUBE]} />
          <meshStandardMaterial color={cube.tint} roughness={0.28} metalness={0.2} />
        </mesh>
      ))}
    </group>
  )
}

function ImpactPreview({ style, impact, release, size }: {
  style: number
  impact: number
  release: number
  size: number
}) {
  return (
    <div
      data-testid="impact-warp-preview"
      title="Drag to orbit the lattice"
      className="relative h-[148px] cursor-grab overflow-hidden border-b border-white/[0.06] bg-[#05070c] active:cursor-grabbing"
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
          <ImpactPass style={style} impact={impact} release={release} size={size} />
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
    </div>
  )
}

// ── Controls ────────────────────────────────────────────────────────────────

function StyleStrip({ bound }: { bound: UserInterfaceParameter }) {
  const definition = bound.definition
  if (definition.type !== 'select') return null
  const selected = typeof bound.value === 'number' ? Math.round(bound.value) : definition.default
  return (
    <div className="grid grid-cols-4 border-b border-white/[0.06]">
      {definition.options.map((option) => {
        const active = option.value === selected
        return (
          <button
            key={option.value}
            aria-pressed={active}
            title={STYLE_HINTS[option.value] ?? option.label}
            onClick={() => bound.setValue(option.value)}
            className={`flex flex-col items-center gap-1 py-2 transition-colors ${active ? '' : 'hover:bg-white/[0.04]'}`}
            style={active ? { background: withAlpha(ACCENT, 0.16), boxShadow: `inset 0 -2px 0 0 ${ACCENT}` } : undefined}
          >
            <svg
              width="16"
              height="12"
              viewBox="0 0 16 12"
              fill="none"
              stroke={active ? towardWhite(ACCENT, 0.55) : 'rgba(255,255,255,0.34)'}
              strokeWidth="1.1"
              strokeLinecap="round"
            >
              {STYLE_GLYPHS[option.value]}
            </svg>
            <span
              className="text-[8px] font-semibold tracking-[0.1em]"
              style={{ color: active ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.38)' }}
            >
              {option.label.toUpperCase()}
            </span>
          </button>
        )
      })}
    </div>
  )
}

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
      step={definition.step}
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
  const style = parameter(parameters, 'style')
  const impact = parameter(parameters, 'impact')
  const release = parameter(parameters, 'release')
  const size = parameter(parameters, 'size')

  if (!style || !impact || !release || !size) return <ParameterList parameters={parameters} />

  const styleValue = Math.round(numericValue(style, IMPACT_STYLE_PUNCH))
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
      <ImpactPreview
        style={styleValue}
        impact={numericValue(impact, 0.7)}
        release={numericValue(release, 0.35)}
        size={numericValue(size, 0.5)}
      />
      <StyleStrip bound={style} />
      <div
        className="flex items-end justify-center gap-6 px-4 pb-4 pt-3"
        // The preview's light spilling through the seam onto the console - the
        // one earned gradient, per the guide.
        style={{ background: `radial-gradient(58% 30px at 50% 0, ${withAlpha(ACCENT, 0.14)}, transparent)` }}
      >
        <ParamKnob bound={impact} label="IMPACT" large />
        <ParamKnob bound={release} label="RELEASE" suffix="b" />
        <ParamKnob bound={size} label={SIZE_CAPTIONS[styleValue] ?? 'SIZE'} ariaLabel="Size" />
      </div>
    </section>
  )
}
