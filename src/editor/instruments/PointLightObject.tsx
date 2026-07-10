import { useRef } from 'react'
import { Mesh, MeshBasicMaterial, PointLight as ThreePointLight } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { setAnimatedOpacity } from '../core/visual/animatedOpacity'
import { paramDefault, type ObjectInstrumentDef } from './types'

export const pointLightInstrument: ObjectInstrumentDef = {
  id: 'pointLight',
  name: 'Point Light',
  kind: 'object',
  params: [
    { key: 'color', label: 'Color', type: 'color', default: '#ffd28a' },
    { key: 'intensity', label: 'Intensity', min: 0, max: 80, step: 0.5, default: 12 },
    { key: 'distance', label: 'Distance', min: 0, max: 60, step: 0.5, default: 18 },
    { key: 'decay', label: 'Decay', min: 0, max: 4, step: 0.05, default: 1.4 },
    { key: 'bulbSize', label: 'Bulb Size', min: 0, max: 0.6, step: 0.01, default: 0.12 },
    { key: 'baseXPosition', label: 'Base X Position', min: -10, max: 10, step: 0.1, default: 0 },
    { key: 'baseYPosition', label: 'Base Y Position', min: -10, max: 10, step: 0.1, default: 2 },
    { key: 'baseZPosition', label: 'Base Z Position', min: -10, max: 10, step: 0.1, default: 3 },
  ],
  // Notes drive the pulse envelope (light flares brighter, bulb swells); higher pitch = stronger pulse.
  midiRows: [
    { pitch: 76, label: 'Pulse · max', emphasized: true },
    { pitch: 68, label: 'Pulse · strong' },
    { pitch: 60, label: 'Pulse · medium' },
    { pitch: 52, label: 'Pulse · soft' },
    { pitch: 44, label: 'Pulse · gentle' },
    { pitch: 36, label: 'Pulse · faint' },
  ],
  localTransform: ({ params }) => {
    const baseXPosition = params.baseXPosition ?? paramDefault(pointLightInstrument, 'baseXPosition')
    const baseYPosition = params.baseYPosition ?? paramDefault(pointLightInstrument, 'baseYPosition')
    const baseZPosition = params.baseZPosition ?? paramDefault(pointLightInstrument, 'baseZPosition')
    return {
      position: [baseXPosition, baseYPosition, baseZPosition],
    }
  },
  component: PointLightObject,
}

export function PointLightObject({ trackId }: { trackId: string }) {
  const lightRef = useRef<ThreePointLight>(null)
  const bulbRef = useRef<Mesh>(null)

  useInstrumentFrame(trackId, (state) => {
    const light = lightRef.current
    const bulb = bulbRef.current
    const color = state.stringParams.color ?? '#ffd28a'
    const energy = Math.max(0, state.energy)
    const intensity = state.params.intensity ?? paramDefault(pointLightInstrument, 'intensity')
    const distance = state.params.distance ?? paramDefault(pointLightInstrument, 'distance')
    const decay = state.params.decay ?? paramDefault(pointLightInstrument, 'decay')
    const bulbSize = state.params.bulbSize ?? paramDefault(pointLightInstrument, 'bulbSize')

    if (light) {
      light.color.set(color)
      light.intensity = intensity * (1 + energy)
      light.distance = distance
      light.decay = decay
    }

    if (bulb) {
      bulb.visible = bulbSize > 0
      bulb.scale.setScalar(Math.max(0.0001, bulbSize * (1 + energy * 0.35)))
      const mat = bulb.material as MeshBasicMaterial
      mat.color.set(color)
      setAnimatedOpacity(mat, Math.min(1, 0.45 + energy * 0.25))
    }
  })

  return (
    <group>
      <pointLight ref={lightRef} color="#ffd28a" intensity={12} distance={18} decay={1.4} />
      <mesh ref={bulbRef}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial color="#ffd28a" transparent opacity={0.55} toneMapped={false} />
      </mesh>
    </group>
  )
}
