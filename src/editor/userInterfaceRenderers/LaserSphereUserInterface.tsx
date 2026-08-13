'use client'

// Bespoke settings for Laser Sphere — the reference implementation of
// docs/instrument-panel-design-guide.md, built from the console kit
// (./console): a live bloomed orb you can orbit in a PreviewWindow, then one
// ControlRow of four knobs — SIZE, GLOW, CORE, LIGHT — with the color pill on
// the far right. Every control takes its accent from the color param through
// the Console context, and the pill alone wears the GLOW-driven emitter halo —
// the instrument speaking, not the cursor. The preview reuses the instrument's
// real rim shader and the app's laser bloom pass, so what glows here is what
// glows on stage.

import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { Color, type ShaderMaterial } from 'three'
import {
  DEFAULT_LASER_SPHERE_COLOR,
  LASER_FRAGMENT_SHADER,
  LASER_VERTEX_SHADER,
} from '../instruments/LaserSphere'
import { evaluateCoreAppearance } from '../instruments/laserSphereCore'
import { consolePanel, PreviewCanvas, PreviewWindow, type PanelPreviewProps } from './console'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const WHITE = new Color(1, 1, 1)

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
    <PreviewWindow
      height={148}
      rounded
      testId="laser-orb-preview"
      title="Drag to orbit the laser"
      className="cursor-grab active:cursor-grabbing"
    >
      <PreviewCanvas dpr={[1, 2]} camera={{ position: [0, 0.9, 4.3], fov: 40 }} gl={{ antialias: true, alpha: true }}>
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
      </PreviewCanvas>
    </PreviewWindow>
  )
}

/** The spec preview slot → the orb's own props. */
function LaserSpherePanelPreview({ values, accent }: PanelPreviewProps) {
  return (
    <OrbPreview
      color={accent}
      size={values.size ?? 1.6}
      glow={values.glow ?? 5.5}
      whiteCore={values.whiteCore ?? 1}
      light={values.light ?? 14}
    />
  )
}

// ── The panel ───────────────────────────────────────────────────────────────
// Pure composition, so it is a SPEC (see console/spec.tsx): the preview, one
// knob row, and the COLOR pill as the emitter — its halo alone follows the
// GLOW param in reach and strength; knob glow lives in the arcs themselves.

export const LaserSphereUserInterfaceRenderer = consolePanel({
  accent: { param: 'color', fallback: DEFAULT_LASER_SPHERE_COLOR },
  testId: 'laser-sphere-user-interface',
  bleed: 'full',
  preview: LaserSpherePanelPreview,
  rows: [
    { row: ['size*:SIZE', 'glow:GLOW', 'whiteCore:CORE', 'light:LIGHT', { pill: 'color', haloParam: 'glow' }] },
  ],
})
