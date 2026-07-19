import { useRef } from 'react'
import { Color, type Mesh, type MeshBasicMaterial, type PointLight } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { setAnimatedColor } from '../core/visual/animatedColor'
import { paramDefault, type ObjectInstrumentDef } from './types'

const DEFAULT_COLOR = '#25dfff'
const WHITE = new Color(1, 1, 1)

export const laserSphereInstrument: ObjectInstrumentDef = {
  id: 'laserSphere',
  name: 'Laser Sphere',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  params: [
    { key: 'size', label: 'Size', min: 0.2, max: 4, step: 0.05, default: 1.6 },
    { key: 'color', label: 'Laser Color', type: 'color', default: DEFAULT_COLOR },
    { key: 'glow', label: 'Glow', min: 1.5, max: 12, step: 0.1, default: 5.5 },
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
 * One sphere and one real point light. The material emits scene-linear HDR
 * color above 1.0; the compositor's luminance threshold and mip-chain bloom do
 * all halo generation. There are deliberately no glow shells or blurred cards.
 */
export function LaserSphere({ trackId }: { trackId: string }) {
  const meshRef = useRef<Mesh>(null)
  const lightRef = useRef<PointLight>(null)
  const baseColor = useRef(new Color())
  const hotColor = useRef(new Color())

  useInstrumentFrame(trackId, (state) => {
    const mesh = meshRef.current
    const light = lightRef.current
    if (!mesh || !light) return

    const glow = state.params.glow ?? paramDefault(laserSphereInstrument, 'glow')
    const sceneLight = state.params.light ?? paramDefault(laserSphereInstrument, 'light')
    const flare = 1 + state.energy * 1.65

    baseColor.current.set(state.stringParams.color || DEFAULT_COLOR)
    // A slight white-hot contribution gives the emitter a laser-bright core,
    // while the linear multiplier preserves the chosen hue throughout its halo.
    hotColor.current.copy(baseColor.current)
      .lerp(WHITE, 0.13 + state.energy * 0.1)
      .multiplyScalar(glow * flare)
    setAnimatedColor(mesh.material as MeshBasicMaterial, hotColor.current)

    light.color.copy(baseColor.current)
    light.intensity = sceneLight * flare
  })

  return (
    <>
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.9, 64, 48]} />
        <meshBasicMaterial color={DEFAULT_COLOR} toneMapped={false} />
      </mesh>
      <pointLight ref={lightRef} color={DEFAULT_COLOR} intensity={14} distance={14} decay={2} />
    </>
  )
}
