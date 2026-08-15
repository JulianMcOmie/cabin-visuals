import type { Ref } from 'react'
import {
  BoxGeometry,
  CanvasTexture,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
  OctahedronGeometry,
  RepeatWrapping,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  TorusKnotGeometry,
  type BufferGeometry,
  type Color,
  type Mesh,
  type MeshPhysicalMaterial,
} from 'three'

// Cool off-white — an icy tint of the accent family: reads clean against the
// default ice-blue scene backdrop (DEFAULT_SCENE_BACKGROUND) without
// competing with it, and stays on the brand's blue axis where a warm paper
// white drifted yellow.
export const DEFAULT_FUNDAMENTAL_COLOR = '#e4f0fa'

// The vocabulary is APPEND-ONLY: tracks store the id string, so new solids go
// at the end and the original six never move or rename.
export const FUNDAMENTAL_GEOMETRIES = [
  { id: 'cube', label: 'Cube', shortLabel: 'CUBE' },
  { id: 'tetrahedron', label: 'Tetrahedron', shortLabel: 'TETRA' },
  { id: 'octahedron', label: 'Octahedron', shortLabel: 'OCTA' },
  { id: 'dodecahedron', label: 'Dodecahedron', shortLabel: 'DODECA' },
  { id: 'icosahedron', label: 'Icosahedron', shortLabel: 'ICOSA' },
  { id: 'sphere', label: 'Sphere', shortLabel: 'SPHERE' },
  { id: 'cylinder', label: 'Cylinder', shortLabel: 'CYL' },
  { id: 'prism', label: 'Prism', shortLabel: 'PRISM' },
  { id: 'cone', label: 'Cone', shortLabel: 'CONE' },
  { id: 'capsule', label: 'Capsule', shortLabel: 'CAPS' },
  { id: 'torus', label: 'Torus', shortLabel: 'TORUS' },
  { id: 'torusKnot', label: 'Torus Knot', shortLabel: 'KNOT' },
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
export const FUNDAMENTAL_SOLID_RADIUS = Math.sqrt(3) * 0.8
const SOLID_RADIUS = FUNDAMENTAL_SOLID_RADIUS

/** Solids whose cross-section thickness (the TUBE param) is a real dimension. */
export const TUBED_GEOMETRIES: ReadonlySet<FundamentalGeometryId> = new Set(['torus', 'torusKnot'])

export const DEFAULT_TUBE_FRACTION = 0.38

/** Solids that are an extruded/tapered N-gon: the SIDES param picks the polygon.
 *  3 = triangular prism / pyramid, 4 = square, high counts approach round. */
export const SIDED_GEOMETRIES: ReadonlySet<FundamentalGeometryId> = new Set(['prism', 'cone'])

export const DEFAULT_SIDES = 3
export const MIN_SIDES = 3
export const MAX_SIDES = 24

export function normalizeSides(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : DEFAULT_SIDES
  return Math.max(MIN_SIDES, Math.min(MAX_SIDES, n))
}

const clamp01ish = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Ring + tube radii for the torus. The tube fraction trades ring for tube
 *  inside the shared radius, so thickness never changes the overall size. */
export function torusRadii(tubeFraction = DEFAULT_TUBE_FRACTION): { ring: number; tube: number } {
  const f = clamp01ish(tubeFraction, 0.05, 0.95)
  const ring = SOLID_RADIUS / (1 + f)
  return { ring, tube: ring * f }
}

/** The knot's loops swing wider than the nominal ring, so it gets a smaller
 *  ring for the same tube fraction to stay near the shared radius. */
export function torusKnotRadii(tubeFraction = DEFAULT_TUBE_FRACTION): { ring: number; tube: number } {
  const f = clamp01ish(tubeFraction, 0.05, 0.95)
  const ring = SOLID_RADIUS / (1.1 + f)
  return { ring, tube: ring * f }
}

// Segment counts shared by the declarative geometry below and buildTubedGeometry,
// so a tube edit swaps in an identically-tessellated solid.
const TORUS_SEGMENTS = [20, 56] as const
const TORUS_KNOT_SEGMENTS = [128, 16] as const

/** An imperative build of the tube-driven solids, for callers whose geometry
 *  must follow a track param without a React re-render (Cube's frame callback).
 *  The caller owns disposal. */
export function buildTubedGeometry(geometry: 'torus' | 'torusKnot', tubeFraction: number): BufferGeometry {
  if (geometry === 'torus') {
    const { ring, tube } = torusRadii(tubeFraction)
    return new TorusGeometry(ring, tube, ...TORUS_SEGMENTS)
  }
  const { ring, tube } = torusKnotRadii(tubeFraction)
  return new TorusKnotGeometry(ring, tube, ...TORUS_KNOT_SEGMENTS)
}

// Prism/cone proportions shared by the declarative geometry and buildSidedGeometry.
const PRISM_ARGS = [0.96, 0.96, 2] as const
const CONE_ARGS = [0.98, 1.96] as const

/** The sided solids' imperative sibling of buildTubedGeometry: an N-gon prism
 *  or pyramid/cone, for the SIDES param. The caller owns disposal. */
export function buildSidedGeometry(geometry: 'prism' | 'cone', sides: number): BufferGeometry {
  const n = normalizeSides(sides)
  return geometry === 'prism'
    ? new CylinderGeometry(...PRISM_ARGS, n)
    : new ConeGeometry(...CONE_ARGS, n)
}

/** Imperative build of ANY fundamental solid - the instanced path's single
 *  live geometry (one InstancedMesh2 holds one geometry at a time, unlike the
 *  per-copy path's twelve mounted meshes). Must stay in step with the JSX
 *  `Geometry` switch below: same constructors, same args, so the two render
 *  paths tessellate identically. The caller owns disposal. */
export function buildFundamentalGeometry(
  geometry: FundamentalGeometryId,
  tube = DEFAULT_TUBE_FRACTION,
  sides = DEFAULT_SIDES,
): BufferGeometry {
  switch (geometry) {
    case 'tetrahedron': return new TetrahedronGeometry(SOLID_RADIUS, 0)
    case 'octahedron': return new OctahedronGeometry(SOLID_RADIUS, 0)
    case 'dodecahedron': return new DodecahedronGeometry(SOLID_RADIUS, 0)
    case 'icosahedron': return new IcosahedronGeometry(SOLID_RADIUS, 0)
    case 'sphere': return new SphereGeometry(SOLID_RADIUS, 32, 16)
    case 'cylinder': return new CylinderGeometry(0.84, 0.84, 2.2, 48)
    case 'prism': return new CylinderGeometry(...PRISM_ARGS, normalizeSides(sides))
    case 'cone': return new ConeGeometry(...CONE_ARGS, normalizeSides(sides))
    case 'capsule': return new CapsuleGeometry(0.62, 1.53, 8, 24)
    case 'torus':
    case 'torusKnot': return buildTubedGeometry(geometry, tube)
    default: return new BoxGeometry(1.6, 1.6, 1.6)
  }
}

// ── Surface (the reflective / refractive / lit / textured toggles) ──────────

export interface FundamentalSurface {
  reflective: boolean
  refractive: boolean
  shaded: boolean
  textured: boolean
}

/** What the material should be for a given surface + note energy, as plain
 *  numbers (pure, so it is testable without three). The default surface
 *  (shaded, nothing else) reproduces the instrument's original material
 *  exactly - existing projects keep their look. */
export interface FundamentalMaterialSettings {
  metalness: number
  roughness: number
  clearcoat: number
  clearcoatRoughness: number
  envMapIntensity: number
  transmission: number
  thickness: number
  ior: number
  emissiveIntensity: number
  /** Flat silhouette: the color is emitted, the scene's light is ignored. */
  unlit: boolean
  textured: boolean
}

export function fundamentalMaterialSettings(surface: FundamentalSurface, energy: number): FundamentalMaterialSettings {
  if (!surface.shaded) {
    // Unlit overrides the physical toggles: a surface that ignores light has
    // nothing to reflect or refract. The pulse still glows through emissive.
    return {
      metalness: 0, roughness: 1, clearcoat: 0, clearcoatRoughness: 0,
      envMapIntensity: 0, transmission: 0, thickness: 0, ior: 1.45,
      emissiveIntensity: 1 + energy * 1.2, unlit: true, textured: surface.textured,
    }
  }
  const settings: FundamentalMaterialSettings = {
    // The legacy baseline - byte-for-byte the material the instrument shipped with.
    metalness: 0.08, roughness: 0.24, clearcoat: 0.9, clearcoatRoughness: 0.16,
    envMapIntensity: 1.25, transmission: 0, thickness: 0, ior: 1.45,
    emissiveIntensity: 0.25 + energy * 2.5, unlit: false, textured: surface.textured,
  }
  if (surface.reflective) {
    settings.metalness = 0.92
    settings.roughness = 0.07
    settings.clearcoat = 1
    settings.clearcoatRoughness = 0.06
    settings.envMapIntensity = 2.3
  }
  if (surface.refractive) {
    // Glass wins the conflicts: metal cannot transmit, so refractive zeroes
    // metalness even when reflective is also on (which then only keeps the
    // stronger environment response).
    settings.transmission = 0.95
    settings.thickness = 1.4
    settings.metalness = 0
    settings.roughness = Math.min(settings.roughness, 0.05)
  }
  return settings
}

/** The instrument's original emissive - kept for the shaded look so existing
 *  projects' glow color does not change. */
const SHADED_EMISSIVE = '#312e81'

let grainTexture: CanvasTexture | null = null

/** The shared TEXTURE-toggle surface grain: smooth deterministic value noise
 *  (seeded - Math.random would make two exports disagree), built lazily so the
 *  module stays importable outside the browser. */
export function fundamentalGrainTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') return null
  if (grainTexture) return grainTexture
  const size = 256
  const cells = 16
  // mulberry32 with a fixed seed.
  let s = 0x9e3779b9
  const rand = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const lattice = new Float32Array((cells + 1) * (cells + 1))
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand()
  const at = (x: number, y: number) => lattice[(y % cells) * (cells + 1) + (x % cells)]
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const image = ctx.createImageData(size, size)
  const step = size / cells
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.floor(x / step), cy = Math.floor(y / step)
      const fx = (x / step) - cx, fy = (y / step) - cy
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
      const v =
        at(cx, cy) * (1 - sx) * (1 - sy) +
        at(cx + 1, cy) * sx * (1 - sy) +
        at(cx, cy + 1) * (1 - sx) * sy +
        at(cx + 1, cy + 1) * sx * sy
      const g = Math.round(105 + v * 92)
      const i = (y * size + x) * 4
      image.data[i] = g; image.data[i + 1] = g; image.data[i + 2] = g; image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  grainTexture = new CanvasTexture(canvas)
  grainTexture.wrapS = RepeatWrapping
  grainTexture.wrapT = RepeatWrapping
  return grainTexture
}

/** Writes a surface onto the physical material - shared by the instrument's
 *  frame callback and the settings panel's preview, so the two cannot drift.
 *  Cheap per frame; recompiles (needsUpdate) only when a toggle actually flips
 *  a shader feature (transmission or the grain maps) on or off. */
export function applyFundamentalSurface(
  material: MeshPhysicalMaterial,
  surface: FundamentalSurface,
  baseColor: Color,
  energy: number,
) {
  const settings = fundamentalMaterialSettings(surface, energy)
  material.metalness = settings.metalness
  material.roughness = settings.roughness
  material.clearcoat = settings.clearcoat
  material.clearcoatRoughness = settings.clearcoatRoughness
  material.envMapIntensity = settings.envMapIntensity
  material.transmission = settings.transmission
  material.thickness = settings.thickness
  material.ior = settings.ior
  material.emissiveIntensity = settings.emissiveIntensity
  if (settings.unlit) {
    // The color is carried entirely by emission; black diffuse keeps the
    // scene's lights from shading the silhouette.
    material.color.set('#000000')
    material.emissive.copy(baseColor)
  } else {
    material.color.copy(baseColor)
    material.emissive.set(SHADED_EMISSIVE)
  }
  const grain = settings.textured ? fundamentalGrainTexture() : null
  if (material.bumpMap !== grain) {
    material.bumpMap = grain
    material.roughnessMap = grain
  }
  material.bumpScale = 0.6
  const featureKey = (settings.transmission > 0 ? 1 : 0) | (grain ? 2 : 0)
  if (material.userData.__fundamentalFeatureKey !== featureKey) {
    material.userData.__fundamentalFeatureKey = featureKey
    material.needsUpdate = true
  }
}

// ── Geometry + mesh ─────────────────────────────────────────────────────────

/** The geometry alone, for instruments that share this solid VOCABULARY but bring
 *  their own material (e.g. KaleidoSolid's generated surface). Exported so the
 *  shapes and their matched radii still cannot drift apart. */
export function FundamentalGeometryShape({ geometry, tube, sides }: {
  geometry: FundamentalGeometryId
  tube?: number
  sides?: number
}) {
  return <Geometry geometry={geometry} tube={tube} sides={sides} />
}

function Geometry({ geometry, tube = DEFAULT_TUBE_FRACTION, sides = DEFAULT_SIDES }: {
  geometry: FundamentalGeometryId
  tube?: number
  sides?: number
}) {
  switch (geometry) {
    case 'tetrahedron': return <tetrahedronGeometry args={[SOLID_RADIUS, 0]} />
    case 'octahedron': return <octahedronGeometry args={[SOLID_RADIUS, 0]} />
    case 'dodecahedron': return <dodecahedronGeometry args={[SOLID_RADIUS, 0]} />
    case 'icosahedron': return <icosahedronGeometry args={[SOLID_RADIUS, 0]} />
    case 'sphere': return <sphereGeometry args={[SOLID_RADIUS, 32, 16]} />
    // The round solids keep their circumscribed extent at SOLID_RADIUS
    // (base-rim/apex for cone and cylinder, cap tip for capsule).
    case 'cylinder': return <cylinderGeometry args={[0.84, 0.84, 2.2, 48]} />
    case 'prism': return <cylinderGeometry args={[...PRISM_ARGS, normalizeSides(sides)]} />
    case 'cone': return <coneGeometry args={[...CONE_ARGS, normalizeSides(sides)]} />
    case 'capsule': return <capsuleGeometry args={[0.62, 1.53, 8, 24]} />
    case 'torus': {
      const { ring, tube: tubeRadius } = torusRadii(tube)
      return <torusGeometry args={[ring, tubeRadius, ...TORUS_SEGMENTS]} />
    }
    case 'torusKnot': {
      const { ring, tube: tubeRadius } = torusKnotRadii(tube)
      return <torusKnotGeometry args={[ring, tubeRadius, ...TORUS_KNOT_SEGMENTS]} />
    }
    default: return <boxGeometry args={[1.6, 1.6, 1.6]} />
  }
}

/** The baseline physical material, shared by the scene instrument and the
 *  inspector preview so the two cannot drift. `applyFundamentalSurface` writes
 *  the live surface over these fields each frame. */
export const FUNDAMENTAL_MATERIAL_PROPS = {
  color: DEFAULT_FUNDAMENTAL_COLOR,
  metalness: 0.08,
  roughness: 0.24,
  clearcoat: 0.9,
  clearcoatRoughness: 0.16,
  envMapIntensity: 1.25,
  emissive: SHADED_EMISSIVE,
  emissiveIntensity: 0.25,
} as const

/** Shared by the scene instrument and its inspector preview. Geometry and
 *  baseline material therefore cannot drift into two different objects again.
 *  Omit `geometry` when the caller owns the BufferGeometry imperatively
 *  (Cube's tube-driven torus family - built in its frame callback). */
export function FundamentalMesh({
  geometry,
  tube,
  color = DEFAULT_FUNDAMENTAL_COLOR,
  visible = true,
  meshRef,
}: {
  geometry?: FundamentalGeometryId
  tube?: number
  color?: string
  visible?: boolean
  meshRef?: Ref<Mesh>
}) {
  return (
    <mesh ref={meshRef} visible={visible} castShadow receiveShadow>
      {geometry !== undefined && <Geometry geometry={geometry} tube={tube} />}
      <meshPhysicalMaterial {...FUNDAMENTAL_MATERIAL_PROPS} color={color} />
    </mesh>
  )
}
