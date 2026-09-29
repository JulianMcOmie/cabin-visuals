import { useRef } from 'react'
import { SphereGeometry, TetrahedronGeometry, type Mesh, type MeshPhysicalMaterial } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { applyBasicShapeAppearance, BASIC_SHAPE_MATERIALS, type BasicShape } from './basicShapeCore'

// Shared across every copy of every Circle / Triangle track (immutable, and a
// prop-supplied geometry is outside r3f's auto-dispose); a splitter with a few
// hundred copies used to tessellate a sphere per copy at mount.
const GEOMETRIES = {
  circle: new SphereGeometry(0.9, 32, 24),
  triangle: new TetrahedronGeometry(1.1),
}

function BasicShapeVisual({ trackId, shape }: { trackId: string; shape: BasicShape }) {
  const meshRef = useRef<Mesh>(null)
  useInstrumentFrame(trackId, (state) => {
    if (!meshRef.current) return false
    applyBasicShapeAppearance(meshRef.current.material as MeshPhysicalMaterial, state)
  })
  return (
    <mesh ref={meshRef} geometry={GEOMETRIES[shape]} castShadow receiveShadow>
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
