import { useContext, useRef } from 'react'
import { createPortal, useThree } from '@react-three/fiber'
import { Color, type Mesh, type PointLight, type ShaderMaterial } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { getPeakVisualCopyOpacity, getVisualCopy } from '../core/visual/VisualEngine'
import { InstrumentCopyContext } from '../core/visual/instrumentColor'
import { paramDefault, type ObjectInstrumentDef } from './types'
import { DEFAULT_WHITE_CORE, evaluateCoreAppearance } from './laserSphereCore'

const DEFAULT_COLOR = '#25dfff'
const WHITE = new Color(1, 1, 1)

const LASER_VERTEX_SHADER = `
varying float vFacing;

void main() {
  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  vec3 viewNormal = normalize(normalMatrix * normal);
  vec3 viewDirection = normalize(-viewPosition.xyz);
  vFacing = clamp(dot(viewNormal, viewDirection), 0.0, 1.0);
  gl_Position = projectionMatrix * viewPosition;
}`

const LASER_FRAGMENT_SHADER = `
uniform vec3 coreColor;
uniform vec3 rimColor;
// A raw ShaderMaterial ignores Material.opacity, so the value the opacity
// wrapper writes each frame (visibility movers, fades) is fed back in here.
uniform float uOpacity;
varying float vFacing;

void main() {
  // The center can stay below bloom threshold while the grazing-angle rim
  // remains HDR. The real mip-chain bloom turns that rim energy into the halo.
  float rim = pow(clamp(1.0 - vFacing, 0.0, 1.0), 1.7);
  float bloomCarrier = smoothstep(0.04, 0.88, rim);
  gl_FragColor = vec4(mix(coreColor, rimColor, bloomCarrier), uOpacity);
}`

export const laserSphereInstrument: ObjectInstrumentDef = {
  id: 'laserSphere',
  name: 'Laser Sphere',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  params: [
    { key: 'size', label: 'Size', min: 0.01, max: 4, step: 0.05, default: 1.6 },
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
  localTransform: ({ params, energy }) => ({
    position: [
      params.x ?? paramDefault(laserSphereInstrument, 'x'),
      params.y ?? paramDefault(laserSphereInstrument, 'y'),
      params.z ?? paramDefault(laserSphereInstrument, 'z'),
    ],
    scale: (params.size ?? paramDefault(laserSphereInstrument, 'size')) / 1.6 * (1 + energy * 0.22),
  }),
  component: LaserSphere,
}

/**
 * One sphere per copy, plus one real point light for the track. The material emits scene-linear HDR
 * color above 1.0; the compositor's luminance threshold and mip-chain bloom do
 * all halo generation. There are deliberately no glow shells or blurred cards.
 */
export function LaserSphere({ trackId }: { trackId: string }) {
  const meshRef = useRef<Mesh>(null)
  const lightRef = useRef<PointLight>(null)
  const baseColor = useRef(new Color())
  const coreColor = useRef(new Color())
  const rimColor = useRef(new Color())
  const copyContext = useContext(InstrumentCopyContext)
  // The uniforms object must keep ONE identity for the mesh's lifetime: an
  // inline literal would be a new object on every React re-render, and r3f
  // then replaces material.uniforms wholesale - but three's compiled program
  // keeps uploading from the holder objects it captured at compile time, so
  // the frame callback's writes land in holders the GPU never reads and the
  // laser freezes at its last look until a remount.
  const uniforms = useRef({
    coreColor: { value: new Color(DEFAULT_COLOR) },
    rimColor: { value: new Color(DEFAULT_COLOR).multiplyScalar(5.5) },
    uOpacity: { value: 1 },
  }).current
  // ONE scene light per track, not per copy - see the same guard in LaserLine:
  // per-copy point lights make every lit material loop over N lights, and the
  // count changing as copies fade invalidates their shader programs. It is
  // portalled out of this copy's placement group so a copy fading (a Tunnel
  // wraps copy 0 every cycle) can't take the track's light with it.
  const litCopy = (copyContext?.visualCopyIndex ?? 0) === 0
  const renderScene = useThree((three) => three.scene)

  useInstrumentFrame(trackId, (state) => {
    const mesh = meshRef.current
    const light = lightRef.current
    if (!mesh || (litCopy && !light)) return false

    const glow = state.params.glow ?? paramDefault(laserSphereInstrument, 'glow')
    const whiteCore = state.params.whiteCore ?? paramDefault(laserSphereInstrument, 'whiteCore')
    const sceneLight = state.params.light ?? paramDefault(laserSphereInstrument, 'light')
    const flare = 1 + state.energy * 1.65

    baseColor.current.set(state.stringParams.color || DEFAULT_COLOR)
    const core = evaluateCoreAppearance(whiteCore, glow, state.energy)
    coreColor.current.copy(baseColor.current)
      .lerp(WHITE, core.whiteMix)
      .multiplyScalar(core.intensity)
    rimColor.current.copy(baseColor.current)
      .lerp(WHITE, 0.13 + state.energy * 0.1)
      .multiplyScalar(glow * flare)
    // Visibility/mover fades, computed from engine state THIS frame - the
    // same product the placement wrapper writes into Material.opacity. Do NOT
    // read Material.opacity instead: this callback runs before the wrapper's
    // pass, so that value is one frame stale, and the paused editor renders
    // exactly one frame per change - the staleness never converges.
    const copyOpacity = copyContext ? getVisualCopy(trackId, copyContext.visualCopyIndex)?.opacity ?? 1 : 1
    const fade = Math.max(0, Math.min(1, state.opacity * copyOpacity))
    const material = mesh.material as ShaderMaterial
    // The fade scales the HDR COLORS too, not just alpha. Alpha alone reads as
    // on/off: the rim runs several times over the bloom threshold (1.15), so a
    // linear alpha ramp keeps the halo at full blaze until the last ~20% and
    // then snaps. With color and alpha both scaled the emitted energy falls as
    // fade², dropping out of bloom early - the glow dies WITH the envelope.
    ;(material.uniforms.coreColor.value as Color).copy(coreColor.current).multiplyScalar(fade)
    ;(material.uniforms.rimColor.value as Color).copy(rimColor.current).multiplyScalar(fade)
    material.uniforms.uOpacity.value = fade

    if (light) {
      // Brightest copy, not this one - the shared light must not blink on the
      // private schedule of whichever copy hosts it, but must still die when a
      // gate dims the whole track.
      const trackFade = state.blackedOut
        ? 0
        : Math.max(0, Math.min(1, state.opacity * getPeakVisualCopyOpacity(trackId)))
      light.position.setFromMatrixPosition(state.world)
      light.color.copy(baseColor.current)
      light.intensity = sceneLight * flare * trackFade
    }
  })

  return (
    <>
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.9, 64, 48]} />
        <shaderMaterial
          key="laser-sphere-rim-v2"
          vertexShader={LASER_VERTEX_SHADER}
          fragmentShader={LASER_FRAGMENT_SHADER}
          uniforms={uniforms}
          toneMapped={false}
        />
      </mesh>
      {litCopy && createPortal(
        <pointLight ref={lightRef} color={DEFAULT_COLOR} intensity={0} distance={14} decay={2} />,
        renderScene,
      )}
    </>
  )
}
