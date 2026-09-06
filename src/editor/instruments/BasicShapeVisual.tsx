import { useRef } from 'react'
import type { Mesh, MeshPhysicalMaterial } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { applyBasicShapeAppearance, BASIC_SHAPE_MATERIALS, type BasicShape } from './basicShapeCore'

function BasicShapeVisual({ trackId, shape }: { trackId: string; shape: BasicShape }) {
  const meshRef = useRef<Mesh>(null)
  useInstrumentFrame(trackId, (state) => {
    if (!meshRef.current) return false
    applyBasicShapeAppearance(meshRef.current.material as MeshPhysicalMaterial, state)
  })
  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      {shape === 'circle'
        ? <sphereGeometry args={[0.9, 32, 24]} />
        : <tetrahedronGeometry args={[1.1]} />}
      <meshPhysicalMaterial
        {...BASIC_SHAPE_MATERIALS[shape]}
        color="#6366f1"
        emissive="#312e81"
        emissiveIntensity={0.2}
      />
    </mesh>
  )
}

export function CircleVisual({ trackId }: { trackId: string }) {
  return <BasicShapeVisual trackId={trackId} shape="circle" />
}

export function TriangleVisual({ trackId }: { trackId: string }) {
  return <BasicShapeVisual trackId={trackId} shape="triangle" />
}
