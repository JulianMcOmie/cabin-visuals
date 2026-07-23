import { useContext, useRef } from 'react'
import { Color, DoubleSide, type Mesh, type PointLight, type ShaderMaterial } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { getVisualCopy } from '../core/visual/VisualEngine'
import { InstrumentCopyContext } from '../core/visual/instrumentColor'
import { paramDefault, type ObjectInstrumentDef } from './types'
import { DEFAULT_WHITE_CORE, evaluateCoreAppearance } from './laserSphereCore'

const DEFAULT_COLOR = '#25dfff'
const WHITE = new Color(1, 1, 1)

const LASER_LINE_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const LASER_LINE_FRAGMENT_SHADER = `
uniform vec3 coreColor;
uniform vec3 rimColor;
// A raw ShaderMaterial ignores Material.opacity, so the value the opacity
// wrapper writes each frame (visibility movers, fades) is fed back in here.
uniform float uOpacity;
varying vec2 vUv;

void main() {
  // Keep the middle of the emitter legible and colored while putting the HDR
  // energy at its narrow edges. The scene bloom turns only that energy into
  // the surrounding halo; the instrument itself remains one crisp line.
  float edgeDistance = abs(vUv.y - 0.5) * 2.0;
  float bloomCarrier = smoothstep(0.18, 0.94, edgeDistance);
  gl_FragColor = vec4(mix(coreColor, rimColor, bloomCarrier), uOpacity);
}`

export const laserLineInstrument: ObjectInstrumentDef = {
  id: 'laserLine',
  name: 'Laser Line',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  params: [
    { key: 'length', label: 'Length', min: 0.25, max: 12, step: 0.05, default: 4 },
    { key: 'thickness', label: 'Thickness', min: 0.01, max: 0.5, step: 0.01, default: 0.06 },
    { key: 'color', label: 'Laser Color', type: 'color', default: DEFAULT_COLOR },
    { key: 'glow', label: 'Glow', min: 1.5, max: 12, step: 0.1, default: 5.5 },
    { key: 'whiteCore', label: 'White-hot core', min: 0, max: 1, step: 0.01, default: DEFAULT_WHITE_CORE },
    { key: 'light', label: 'Scene Light', min: 0, max: 50, step: 1, default: 14 },
    { key: 'x', label: 'X Position', min: -10, max: 10, step: 0.1, default: 0 },
    { key: 'y', label: 'Y Position', min: -10, max: 10, step: 0.1, default: 0 },
    { key: 'z', label: 'Z Position', min: -10, max: 10, step: 0.1, default: 0 },
  ],
  midiRows: [
    { pitch: 76, label: 'Flare · max', emphasized: true },
    { pitch: 68, label: 'Flare · strong' },
    { pitch: 60, label: 'Flare · medium' },
    { pitch: 52, label: 'Flare · soft' },
    { pitch: 44, label: 'Flare · gentle' },
    { pitch: 36, label: 'Flare · faint' },
  ],
  localTransform: ({ params, energy }) => {
    const pulse = 1 + energy * 0.22
    return {
      position: [
        params.x ?? paramDefault(laserLineInstrument, 'x'),
        params.y ?? paramDefault(laserLineInstrument, 'y'),
        params.z ?? paramDefault(laserLineInstrument, 'z'),
      ],
      scale: [
        (params.length ?? paramDefault(laserLineInstrument, 'length')) / 4 * pulse,
        (params.thickness ?? paramDefault(laserLineInstrument, 'thickness')) / 0.06 * pulse,
        1,
      ],
    }
  },
  component: LaserLine,
}

/** A single shader emitter whose HDR edges feed the shared scene bloom. */
export function LaserLine({ trackId }: { trackId: string }) {
  const meshRef = useRef<Mesh>(null)
  const lightRef = useRef<PointLight>(null)
  const baseColor = useRef(new Color())
  const coreColor = useRef(new Color())
  const rimColor = useRef(new Color())
  const copyContext = useContext(InstrumentCopyContext)

  useInstrumentFrame(trackId, (state) => {
    const mesh = meshRef.current
    const light = lightRef.current
    if (!mesh || !light) return false

    const glow = state.params.glow ?? paramDefault(laserLineInstrument, 'glow')
    const whiteCore = state.params.whiteCore ?? paramDefault(laserLineInstrument, 'whiteCore')
    const sceneLight = state.params.light ?? paramDefault(laserLineInstrument, 'light')
    const flare = 1 + state.energy * 1.65

    baseColor.current.set(state.stringParams.color || DEFAULT_COLOR)
    const core = evaluateCoreAppearance(whiteCore, glow, state.energy)
    coreColor.current.copy(baseColor.current)
      .lerp(WHITE, core.whiteMix)
      .multiplyScalar(core.intensity)
    rimColor.current.copy(baseColor.current)
      .lerp(WHITE, 0.13 + state.energy * 0.1)
      .multiplyScalar(glow * flare)

    const material = mesh.material as ShaderMaterial
    ;(material.uniforms.coreColor.value as Color).copy(coreColor.current)
    ;(material.uniforms.rimColor.value as Color).copy(rimColor.current)
    // Visibility/mover fades, computed from engine state THIS frame - the
    // same product the placement wrapper writes into Material.opacity. Do NOT
    // read Material.opacity instead: this callback runs before the wrapper's
    // pass, so that value is one frame stale, and the paused editor renders
    // exactly one frame per change - the staleness never converges.
    const copyOpacity = copyContext ? getVisualCopy(trackId, copyContext.visualCopyIndex)?.opacity ?? 1 : 1
    const fade = Math.max(0, Math.min(1, state.opacity * copyOpacity))
    material.uniforms.uOpacity.value = fade
    // TEMP diagnostic (dev only): read `__laserFade` in the console to see the
    // fade each laser last computed - splits "engine never fades" from "shader
    // ignores the fade" without guessing. Remove once visibility is confirmed.
    if (process.env.NODE_ENV !== 'production') {
      const w = window as unknown as { __laserFade?: Record<string, number> }
      ;(w.__laserFade ??= {})[`${trackId}:${copyContext?.visualCopyIndex ?? 0}`] = fade
    }

    light.color.copy(baseColor.current)
    light.intensity = sceneLight * flare * fade
  })

  return (
    <>
      <mesh ref={meshRef}>
        <planeGeometry args={[4, 0.06]} />
        <shaderMaterial
          key="laser-line-edge-v2"
          vertexShader={LASER_LINE_VERTEX_SHADER}
          fragmentShader={LASER_LINE_FRAGMENT_SHADER}
          uniforms={{
            coreColor: { value: new Color(DEFAULT_COLOR) },
            rimColor: { value: new Color(DEFAULT_COLOR).multiplyScalar(5.5) },
            uOpacity: { value: 1 },
          }}
          side={DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <pointLight ref={lightRef} color={DEFAULT_COLOR} intensity={14} distance={14} decay={2} />
    </>
  )
}
