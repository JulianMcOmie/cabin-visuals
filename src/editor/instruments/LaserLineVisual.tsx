import { useContext, useRef } from 'react'
import { createPortal, useThree } from '@react-three/fiber'
import { Color, DoubleSide, type Mesh, type PointLight, type ShaderMaterial } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { getPeakVisualCopyOpacity, getVisualCopy } from '../core/visual/VisualEngine'
import { InstrumentCopyContext } from '../core/visual/instrumentColor'
import { paramDefault } from './types'
import { evaluateCoreAppearance } from './laserSphereCore'
import { DEFAULT_COLOR, laserLineInstrument } from './LaserLine'

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

/** A single shader emitter whose HDR edges feed the shared scene bloom. */
export function LaserLine({ trackId }: { trackId: string }) {
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
  // ONE scene light per track, not per copy. Every visual copy mounts its own
  // instance of this component, so a splitter that makes 48 copies would
  // otherwise put 48 point lights in the scene: every lit material's fragment
  // shader loops over all of them, and because the placement wrapper hides a
  // faded copy's whole group, three drops those lights from the render list -
  // the changing light count invalidates every lit material's shader program
  // (numPointLights is part of the program cache key). A tunnel of lasers
  // fading in and out thrashed that cache every frame. The emitter itself is
  // per-copy; only the fill light is shared.
  const litCopy = (copyContext?.visualCopyIndex ?? 0) === 0
  // It is PORTALLED to the render scene rather than left inside this copy's
  // placement group, and driven from the object's own world placement: hosted
  // in a copy's group it would inherit that copy's transform and, worse, that
  // copy's visibility - a Tunnel hides copy 0 on every wrap, which killed the
  // whole track's light once per cycle no matter where the copies were.
  const renderScene = useThree((three) => three.scene)

  useInstrumentFrame(trackId, (state) => {
    const mesh = meshRef.current
    const light = lightRef.current
    if (!mesh || (litCopy && !light)) return false

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

    // Visibility/mover fades, computed from engine state THIS frame - the
    // same product the placement wrapper writes into Material.opacity. Do NOT
    // read Material.opacity instead: this callback runs before the wrapper's
    // pass, so that value is one frame stale, and the paused editor renders
    // exactly one frame per change - the staleness never converges.
    const copyOpacity = copyContext ? getVisualCopy(trackId, copyContext.visualCopyIndex)?.opacity ?? 1 : 1
    const fade = Math.max(0, Math.min(1, state.opacity * copyOpacity))
    const material = mesh.material as ShaderMaterial
    // The fade scales the HDR COLORS too, not just alpha. Alpha alone reads as
    // on/off: the edge energy runs several times over the bloom threshold
    // (1.15), so a linear alpha ramp keeps the halo at full blaze until the
    // last ~20% and then snaps. With color and alpha both scaled the emitted
    // energy falls as fade², dropping out of bloom early - the glow dies WITH
    // the envelope.
    ;(material.uniforms.coreColor.value as Color).copy(coreColor.current).multiplyScalar(fade)
    ;(material.uniforms.rimColor.value as Color).copy(rimColor.current).multiplyScalar(fade)
    material.uniforms.uOpacity.value = fade

    if (light) {
      // The shared light follows the BRIGHTEST copy, not this one: it must not
      // blink on the private schedule of whichever copy happens to host it,
      // but must still die when a gate dims the whole track.
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
        <planeGeometry args={[4, 0.06]} />
        <shaderMaterial
          key="laser-line-edge-v2"
          vertexShader={LASER_LINE_VERTEX_SHADER}
          fragmentShader={LASER_LINE_FRAGMENT_SHADER}
          uniforms={uniforms}
          side={DoubleSide}
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
