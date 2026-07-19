import type { Ref } from 'react'
import type { Mesh } from 'three'

export const DEFAULT_FUNDAMENTAL_COLOR = '#5757db'

export const FUNDAMENTAL_GEOMETRIES = [
  { id: 'cube', label: 'Cube', shortLabel: 'CUBE' },
  { id: 'tetrahedron', label: 'Tetrahedron', shortLabel: 'TETRA' },
  { id: 'octahedron', label: 'Octahedron', shortLabel: 'OCTA' },
  { id: 'dodecahedron', label: 'Dodecahedron', shortLabel: 'DODECA' },
  { id: 'icosahedron', label: 'Icosahedron', shortLabel: 'ICOSA' },
  { id: 'sphere', label: 'Sphere', shortLabel: 'SPHERE' },
] as const

export type FundamentalGeometryId = (typeof FUNDAMENTAL_GEOMETRIES)[number]['id']

const FUNDAMENTAL_GEOMETRY_IDS = new Set<string>(FUNDAMENTAL_GEOMETRIES.map(({ id }) => id))

export function normalizeFundamentalGeometry(value: unknown): FundamentalGeometryId {
  return typeof value === 'string' && FUNDAMENTAL_GEOMETRY_IDS.has(value)
    ? value as FundamentalGeometryId
    : 'cube'
}

/** The cube's 1.6-unit side has this circumscribed radius. Giving every solid
 *  the same radius makes geometry switching preserve the instrument's scale. */
const SOLID_RADIUS = Math.sqrt(3) * 0.8

function Geometry({ geometry }: { geometry: FundamentalGeometryId }) {
  switch (geometry) {
    case 'tetrahedron': return <tetrahedronGeometry args={[SOLID_RADIUS, 0]} />
    case 'octahedron': return <octahedronGeometry args={[SOLID_RADIUS, 0]} />
    case 'dodecahedron': return <dodecahedronGeometry args={[SOLID_RADIUS, 0]} />
    case 'icosahedron': return <icosahedronGeometry args={[SOLID_RADIUS, 0]} />
    case 'sphere': return <sphereGeometry args={[SOLID_RADIUS, 32, 16]} />
    default: return <boxGeometry args={[1.6, 1.6, 1.6]} />
  }
}

/** Shared by the scene instrument and its inspector preview. Geometry and
 *  baseline material therefore cannot drift into two different objects again. */
export function FundamentalMesh({
  geometry,
  color = DEFAULT_FUNDAMENTAL_COLOR,
  visible = true,
  meshRef,
}: {
  geometry: FundamentalGeometryId
  color?: string
  visible?: boolean
  meshRef?: Ref<Mesh>
}) {
  return (
    <mesh ref={meshRef} visible={visible} castShadow receiveShadow>
      <Geometry geometry={geometry} />
      <meshPhysicalMaterial
        color={color}
        metalness={0.08}
        roughness={0.24}
        clearcoat={0.9}
        clearcoatRoughness={0.16}
        envMapIntensity={1.25}
        emissive="#312e81"
        emissiveIntensity={0.25}
      />
    </mesh>
  )
}
