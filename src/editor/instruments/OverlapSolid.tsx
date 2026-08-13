import { useContext, useEffect, useMemo, useRef } from 'react'
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  FloatType,
  Matrix4,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
  type Group,
  type Mesh,
} from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { getVisualCopy, getVisualCopyCount } from '../core/visual/VisualEngine'
import { InstrumentCopyContext } from '../core/visual/instrumentColor'
import { POSTER_SHADING_GLSL } from './posterShading'
import {
  OVERLAP_SOLID_CONTAINS_GLSL,
  OVERLAP_SOLID_MAX_SIBLINGS,
  OVERLAP_SOLID_OPTIONS,
  OVERLAP_SOLID_TORUS_RADIUS,
  OVERLAP_SOLID_TORUS_TUBE,
  overlapSolidIndex,
  overlapSolidScale,
  packAffineRows,
} from './overlapSolidCore'
import { paramDefault, type MidiRowDef, type ObjectInstrumentDef, type ParamDef } from './types'

// OVERLAP SOLID - the 3D sibling of Overlap Shape. A real solid (sphere, cube,
// cylinder, cone, torus) painted one flat color, with the parity rule decided
// by VOLUME: wherever this copy's surface sits inside an odd number of the
// track's other copies, the fragment cuts away to a true see-through window
// (or flips to the overlap color). Two coincident solids vanish, three come
// back - the same even/odd contract as the 2D instrument.
//
// Mechanism (essay in overlapSolidCore.ts): no stencil here - each occurrence's
// shader receives every sibling copy's inverse world transform in a float
// texture and runs exact point-in-solid tests per fragment. That is also the
// scope boundary: only copies of the SAME track carve each other, because the
// shader only knows its own track's copies.

export const DEFAULT_OVERLAP_SOLID_BASE_COLOR = '#ff5470'
export const DEFAULT_OVERLAP_SOLID_OVERLAP_COLOR = '#2dd4bf'

export const OVERLAP_SOLID_MODE = { cutOut: 0, color: 1 } as const

const PARAMS: ParamDef[] = [
  {
    key: 'solid',
    label: 'Solid',
    type: 'select',
    options: OVERLAP_SOLID_OPTIONS.map(({ value, label }) => ({ value, label })),
    default: 0,
  },
  { key: 'size', label: 'Size', min: 0.1, max: 6, step: 0.05, default: 1.2 },
  { key: 'pulse', label: 'Note Pulse', min: 0, max: 1, step: 0.01, default: 0.35 },
  // 0 = the 2D instrument's poster-flat look; up = a simple lambert term so
  // the solid reads as a volume even before anything overlaps it.
  { key: 'shading', label: 'Shading', min: 0, max: 1, step: 0.01, default: 0.3 },
  { key: 'baseColor', label: 'Color', type: 'color', default: DEFAULT_OVERLAP_SOLID_BASE_COLOR },
  {
    key: 'overlapMode',
    label: 'Overlap',
    type: 'select',
    options: [
      { value: OVERLAP_SOLID_MODE.cutOut, label: 'Cut out' },
      { value: OVERLAP_SOLID_MODE.color, label: 'Color' },
    ],
    default: OVERLAP_SOLID_MODE.cutOut,
  },
  {
    key: 'overlapColor',
    label: 'Overlap Color',
    type: 'color',
    default: DEFAULT_OVERLAP_SOLID_OVERLAP_COLOR,
    showIf: 'overlapMode=1',
  },
]

const MIDI_ROWS: MidiRowDef[] = [
  { pitch: 76, label: 'Pulse · max', emphasized: true },
  { pitch: 68, label: 'Pulse · strong' },
  { pitch: 60, label: 'Pulse · medium' },
  { pitch: 52, label: 'Pulse · soft' },
  { pitch: 44, label: 'Pulse · gentle' },
  { pitch: 36, label: 'Pulse · faint' },
]

// All solids authored at unit radius/half-extent, matching the containment
// tests exactly - one SIZE knob scales geometry and carving identically.
function geometriesForSolids(): BufferGeometry[] {
  return [
    new SphereGeometry(1, 48, 24),
    new BoxGeometry(2, 2, 2),
    new CylinderGeometry(1, 1, 2, 48),
    new ConeGeometry(1, 2, 48),
    new TorusGeometry(OVERLAP_SOLID_TORUS_RADIUS, OVERLAP_SOLID_TORUS_TUBE, 24, 64),
  ]
}

const VERTEX_SHADER = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

// A sentinel in the first packed component marks a slot the loop must skip:
// this occurrence's own slot, and siblings faded to nothing.
const INACTIVE_SENTINEL = 1e30

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uOverlapColor;
uniform int uMode;   // 0 = cut out, 1 = color
uniform int uShape;
uniform int uCount;  // copies packed into uSiblings (3 texels each)
uniform float uShade;
uniform float uOpacity;
uniform sampler2D uSiblings;
varying vec3 vWorld;
varying vec3 vNormal;
${OVERLAP_SOLID_CONTAINS_GLSL}
${POSTER_SHADING_GLSL}
void main() {
  int inside = 0;
  for (int i = 0; i < ${OVERLAP_SOLID_MAX_SIBLINGS}; i++) {
    if (i >= uCount) break;
    vec4 r0 = texelFetch(uSiblings, ivec2(i * 3 + 0, 0), 0);
    if (r0.x > 0.5e30) continue;
    vec4 r1 = texelFetch(uSiblings, ivec2(i * 3 + 1, 0), 0);
    vec4 r2 = texelFetch(uSiblings, ivec2(i * 3 + 2, 0), 0);
    vec4 p = vec4(vWorld, 1.0);
    if (solidContains(uShape, vec3(dot(r0, p), dot(r1, p), dot(r2, p)))) inside++;
  }
  // The parity rule: contained in an ODD number of siblings = the overlap
  // region (total coverage including this surface's own solid is even).
  if ((inside & 1) == 1) {
    if (uMode == 0) discard;
    gl_FragColor = vec4(uOverlapColor * uOpacity, uOpacity);
    return;
  }
  vec3 col = posterShade(uColor, vNormal, uShade);
  gl_FragColor = vec4(col * uOpacity, uOpacity);
}
`

const _world = new Matrix4()
const _scale = new Matrix4()

function OverlapSolidVisual({ trackId }: { trackId: string }) {
  const copyContext = useContext(InstrumentCopyContext)
  const groupRef = useRef<Group>(null)
  const meshRef = useRef<Mesh>(null)
  const solidRef = useRef(-1)
  const geometries = useMemo(geometriesForSolids, [])
  const siblingsRef = useRef<{ texture: DataTexture; data: Float32Array; capacity: number } | null>(null)
  const material = useMemo(() => new ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uColor: { value: new Color(DEFAULT_OVERLAP_SOLID_BASE_COLOR) },
      uOverlapColor: { value: new Color(DEFAULT_OVERLAP_SOLID_OVERLAP_COLOR) },
      uMode: { value: 0 },
      uShape: { value: 0 },
      uCount: { value: 0 },
      uShade: { value: 0.3 },
      uOpacity: { value: 1 },
      uSiblings: { value: null as DataTexture | null },
    },
  }), [])
  useEffect(() => () => {
    for (const g of geometries) g.dispose()
    material.dispose()
    siblingsRef.current?.texture.dispose()
  }, [geometries, material])

  useInstrumentFrame(trackId, (state) => {
    const group = groupRef.current
    const mesh = meshRef.current
    if (!group || !mesh) return false
    const par = (key: string) => state.params[key] ?? paramDefault(overlapSolidInstrument, key)

    const solid = overlapSolidIndex(par('solid'))
    if (solid !== solidRef.current) {
      solidRef.current = solid
      mesh.geometry = geometries[solid]
    }

    const scale = overlapSolidScale(par('size'), state.energy, par('pulse'))
    group.scale.setScalar(scale)

    // Pack every copy's inverse world transform; the own slot and hidden
    // copies get the sentinel so the shader skips them. Grow-only texture
    // pool, swapped when the structural copy count outgrows it.
    const count = Math.min(getVisualCopyCount(trackId), OVERLAP_SOLID_MAX_SIBLINGS)
    let pool = siblingsRef.current
    if (!pool || pool.capacity < count) {
      pool?.texture.dispose()
      const capacity = Math.max(1, count)
      const data = new Float32Array(capacity * 12)
      const texture = new DataTexture(data, capacity * 3, 1, RGBAFormat, FloatType)
      texture.magFilter = NearestFilter
      texture.minFilter = NearestFilter
      pool = { texture, data, capacity }
      siblingsRef.current = pool
      material.uniforms.uSiblings.value = texture
    }
    const selfIndex = copyContext?.visualCopyIndex ?? 0
    // The full per-copy world transform mirrors ObjectRenderer's composition:
    // shared placement × the copy's chain transform × (engine mesh scale ×
    // this component's own pulse scale).
    const meshScale = state.meshScale * scale
    for (let i = 0; i < count; i++) {
      const copy = getVisualCopy(trackId, i)
      if (i === selfIndex || !copy || copy.opacity <= 0.001) {
        pool.data[i * 12] = INACTIVE_SENTINEL
        continue
      }
      _world.copy(state.world)
      _world.multiply(copy.transform)
      _world.multiply(_scale.makeScale(meshScale, meshScale, meshScale))
      _world.invert()
      packAffineRows(_world.elements, pool.data, i)
    }
    pool.texture.needsUpdate = true

    const u = material.uniforms
    u.uCount.value = count
    u.uShape.value = solid
    u.uMode.value = par('overlapMode') >= 0.5 ? 1 : 0
    u.uShade.value = par('shading')
    // Colorizer shifts already applied to these by useInstrumentFrame.
    ;(u.uColor.value as Color).set(state.stringParams.baseColor || DEFAULT_OVERLAP_SOLID_BASE_COLOR)
    ;(u.uOverlapColor.value as Color).set(state.stringParams.overlapColor || DEFAULT_OVERLAP_SOLID_OVERLAP_COLOR)
  })

  return (
    <group ref={groupRef}>
      <mesh ref={meshRef} material={material} />
    </group>
  )
}

export const overlapSolidInstrument: ObjectInstrumentDef = {
  id: 'overlapSolid',
  name: 'Overlap Solid',
  kind: 'object',
  identityColor: { param: 'baseColor' },
  userInterfaceRenderer: 'overlapSolid',
  params: PARAMS,
  midiRows: MIDI_ROWS,
  component: OverlapSolidVisual,
}
