import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Mesh, MeshStandardMaterial } from 'three'
import { getObjectState } from '../core/engine/VisualEngine'
import { paramDefault, type ObjectInstrumentDef } from './types'

// The cube's definition lives next to its visual — schema and component can't drift.
export const cubeInstrument: ObjectInstrumentDef = {
  id: 'cube',
  name: 'Cube',
  kind: 'object',
  params: [
    { key: 'baseSize', label: 'Base Size', min: 0.2, max: 4, step: 0.05, default: 1.6 },
    // Color as a hue slider (0–360) — keeps every param numeric.
    { key: 'baseHue', label: 'Base Color', min: 0, max: 360, step: 1, default: 240 },
    { key: 'baseXPosition', label: 'Base X Position', min: -10, max: 10, step: 0.1, default: 0 }
  ],
  // Modulation inputs modulators target (resting at default until the matrix wires
  // them up). `energy` is what the Cube's pulse becomes; scale/hue are headroom.
  ports: [
    { key: 'energy', label: 'Energy', combine: 'add', default: 0 },
    { key: 'scale', label: 'Scale', combine: 'add', default: 0 },
    { key: 'hue', label: 'Hue', combine: 'add', default: 0 },
  ],
  // The cube's transform as data, so the engine can compose it with its parent's:
  // position from the X param, a steady spin from the beat, and a breathing scale
  // boosted by the energy port. The engine writes the composed world matrix to state.
  localTransform: ({ params, ports, beat }) => {
    const baseSize = params.baseSize ?? paramDefault(cubeInstrument, 'baseSize')
    const baseXPosition = params.baseXPosition ?? paramDefault(cubeInstrument, 'baseXPosition')
    const energy = ports.energy ?? 0
    const breathe = 1.15 + Math.sin(beat * 0.9) * 0.2
    return {
      position: [baseXPosition, 0, 0],
      rotation: [beat * 0.09, beat * 0.22, 0],
      scale: (baseSize / 1.6) * breathe * (1 + energy * 0.35),
    }
  },
  component: Cube,
}

// One cube per cube track. The transform (world matrix) and mute blackout are applied
// by ObjectRenderer's placement group; this draws the mesh at local origin and only
// owns appearance (color/emissive) as the object's intrinsic render math.
export function Cube({ trackId }: { trackId: string }) {
  const meshRef = useRef<Mesh>(null)

  useFrame(() => {
    if (!meshRef.current) return
    const state = getObjectState(trackId)
    // The pulse now arrives via the `energy` port (a Pulse modulator → matrix).
    const energy = state?.portValues.energy ?? 0
    const baseHue = state?.params.baseHue ?? paramDefault(cubeInstrument, 'baseHue')

    const mat = meshRef.current.material as MeshStandardMaterial
    mat.color.setHSL(baseHue / 360, 0.65, 0.6)
    mat.emissiveIntensity = 0.2 + energy * 1.2
  })

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[1.6, 1.6, 1.6]} />
      <meshStandardMaterial
        color="#6366f1"
        metalness={0.4}
        roughness={0.35}
        emissive="#312e81"
        emissiveIntensity={0.2}
      />
    </mesh>
  )
}
