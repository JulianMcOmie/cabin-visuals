import { useEffect, useRef } from 'react'
import { Color, Group, Mesh, MeshPhysicalMaterial, type BufferGeometry } from 'three'
import { cubeSpinRotation } from '../core/visual/cubeSpin'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import {
  DEFAULT_FUNDAMENTAL_COLOR,
  DEFAULT_SIDES,
  DEFAULT_TUBE_FRACTION,
  FUNDAMENTAL_GEOMETRIES,
  FundamentalMesh,
  MAX_SIDES,
  MIN_SIDES,
  SIDED_GEOMETRIES,
  TUBED_GEOMETRIES,
  applyFundamentalSurface,
  buildSidedGeometry,
  buildTubedGeometry,
  normalizeFundamentalGeometry,
  normalizeSides,
  type FundamentalGeometryId,
} from './FundamentalGeometry'
import { paramDefault, type ObjectInstrumentDef } from './types'

const DEFAULT_BASE_COLOR = DEFAULT_FUNDAMENTAL_COLOR

// The cube's definition lives next to its visual - schema and component can't drift.
export const cubeInstrument: ObjectInstrumentDef = {
  id: 'cube',
  name: '3D Shape',
  kind: 'object',
  userInterfaceRenderer: 'cube',
  // Position and size are the canonical track transform now (core/transform.ts,
  // edited via the track strip's panel) - instruments keep only behavior params.
  params: [
    { key: 'baseColor', label: 'Base Color', type: 'color', default: DEFAULT_BASE_COLOR },
    { key: 'geometry', label: 'Geometry', type: 'string', default: 'cube' },
    // Per-INSTANCE size: a mesh-local scale (first in the chain), so each copy
    // a splitter mints grows in place - unlike the canonical tfSize, which is
    // a group fader scaling the whole formation and its layout offsets.
    { key: 'size', label: 'Size', min: 0.05, max: 4, step: 0.01, default: 1 },
    // The solid's proportions: per-axis stretch applied to the mesh itself
    // (a cube becomes a slab or a pillar, a cylinder a disc), kept out of the
    // placement matrix so movers and children never inherit the stretch.
    { key: 'dimX', label: 'Width', min: 0.25, max: 3, step: 0.01, default: 1 },
    { key: 'dimY', label: 'Height', min: 0.25, max: 3, step: 0.01, default: 1 },
    { key: 'dimZ', label: 'Depth', min: 0.25, max: 3, step: 0.01, default: 1 },
    // Tube thickness for the torus family, as a fraction of the ring radius -
    // the ring shrinks as the tube grows, so overall size holds still.
    { key: 'tube', label: 'Tube', min: 0.12, max: 0.85, step: 0.01, default: DEFAULT_TUBE_FRACTION },
    // The N-gon family: how many sides the prism/cone cross-section has -
    // 3 = triangular prism / pyramid, high counts approach round.
    { key: 'sides', label: 'Sides', min: MIN_SIDES, max: MAX_SIDES, step: 1, default: DEFAULT_SIDES },
    // Spin is opt-in: 0 = still (the default), 1 = the classic steady tumble.
    { key: 'spinSpeed', label: 'Spin Speed', min: 0, max: 4, step: 0.05, default: 0 },
    // Surface toggles - resolved through fundamentalMaterialSettings. Defaults
    // reproduce the original material exactly, so existing projects keep their look.
    { key: 'reflective', label: 'Reflective', type: 'boolean', default: 0 },
    { key: 'refractive', label: 'Refractive', type: 'boolean', default: 0 },
    { key: 'shaded', label: 'Lit', type: 'boolean', default: 1 },
    { key: 'textured', label: 'Textured', type: 'boolean', default: 0 },
  ],
  // Notes drive the pulse envelope (scale swell + emissive glow); higher pitch = stronger pulse.
  midiRows: [
    { pitch: 76, label: 'Pulse · max', emphasized: true },
    { pitch: 68, label: 'Pulse · strong' },
    { pitch: 60, label: 'Pulse · medium' },
    { pitch: 52, label: 'Pulse · soft' },
    { pitch: 44, label: 'Pulse · gentle' },
    { pitch: 36, label: 'Pulse · faint' },
  ],
  // The instrument's signature ability: play a note on its Shatter lane and the solid bursts
  // into fragments that fly out and reassemble over the note's length (its velocity
  // sets the blast radius). Bespoke and intrinsic to this instrument.
  abilities: [
    { key: 'shatter', label: 'Shatter', color: '#f472b6' },
  ],
  // The note-pulse swell is the only local transform left: it is a mesh property
  // (kept out of the placement matrix), so movers and children never inherit the
  // pulse. Placement itself comes from the canonical track transform. Spin is
  // applied inside each rendered copy below, so splitters duplicate a spinning
  // solid without rotating their own layout offsets.
  localTransform: ({ energy, params }) => ({
    scale: (1 + energy * 0.35) * (params.size ?? 1),
  }),
  component: Cube,
}

// Eight evenly distributed directions for the fragments to fly along.
const CORNERS: [number, number, number][] = [
  [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
  [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
]

// One selected solid per Cube track. The transform (world matrix) and mute blackout are applied
// by ObjectRenderer's placement group; this draws the mesh at local origin and owns
// appearance (color/emissive/surface toggles) plus its signature Shatter ability.
export function Cube({ trackId }: { trackId: string }) {
  const spinRef = useRef<Group>(null)
  const meshRefs = useRef<Partial<Record<FundamentalGeometryId, Mesh | null>>>({})
  const fragRefs = useRef<(Mesh | null)[]>([])
  // The torus family's geometry follows the TUBE param and the prism/cone
  // family the SIDES param, so those are built here (imperatively, only when
  // the value moves) rather than declared - the component never re-renders on
  // a param edit. We own these builds; `value` is whichever param drives the id.
  const paramBuilt = useRef<Partial<Record<FundamentalGeometryId, { value: number; geometry: BufferGeometry }>>>({})
  const tint = useRef(new Color()).current

  useEffect(() => () => {
    for (const entry of Object.values(paramBuilt.current)) entry?.geometry.dispose()
  }, [])

  useInstrumentFrame(trackId, (state) => {
    if (!spinRef.current) return false
    const geometry = normalizeFundamentalGeometry(state.stringParams.geometry)
    const mesh = meshRefs.current[geometry]
    if (!mesh) return false
    for (const option of FUNDAMENTAL_GEOMETRIES) {
      const candidate = meshRefs.current[option.id]
      if (candidate) candidate.visible = option.id === geometry
    }
    // Keep the selected param-shaped solid's geometry in step with its param:
    // TUBE for the torus family, SIDES for the prism/cone family.
    if (geometry === 'torus' || geometry === 'torusKnot' || geometry === 'prism' || geometry === 'cone') {
      const isTubed = geometry === 'torus' || geometry === 'torusKnot'
      const value = isTubed
        ? state.params.tube ?? paramDefault(cubeInstrument, 'tube')
        : normalizeSides(state.params.sides ?? paramDefault(cubeInstrument, 'sides'))
      const built = paramBuilt.current[geometry]
      if (!built || Math.abs(built.value - value) > 1e-4) {
        const next = isTubed
          ? buildTubedGeometry(geometry, value)
          : buildSidedGeometry(geometry, value)
        // First build replaces the mesh's default empty BufferGeometry.
        mesh.geometry.dispose()
        mesh.geometry = next
        paramBuilt.current[geometry] = { value, geometry: next }
      }
    }
    const spinSpeed = state.params.spinSpeed ?? paramDefault(cubeInstrument, 'spinSpeed')
    spinRef.current.rotation.set(...cubeSpinRotation(state.beat, spinSpeed))
    // The note-pulse signal, computed directly from the object's own notes.
    const energy = state.energy
    const baseColor = state.stringParams.baseColor
    const legacyBaseHue = state.params.baseHue

    if (baseColor) tint.set(baseColor)
    else if (legacyBaseHue !== undefined) tint.setHSL(legacyBaseHue / 360, 0.65, 0.6)
    else tint.set(DEFAULT_BASE_COLOR)

    const mat = mesh.material as MeshPhysicalMaterial
    applyFundamentalSurface(mat, {
      reflective: (state.params.reflective ?? paramDefault(cubeInstrument, 'reflective')) >= 0.5,
      refractive: (state.params.refractive ?? paramDefault(cubeInstrument, 'refractive')) >= 0.5,
      shaded: (state.params.shaded ?? paramDefault(cubeInstrument, 'shaded')) >= 0.5,
      textured: (state.params.textured ?? paramDefault(cubeInstrument, 'textured')) >= 0.5,
    }, tint, energy)

    // Shatter: sample this track's Shatter lane at the current beat - a pure function
    // of the beat, so scrubbing mirrors playback exactly. The burst is MAX at the note
    // onset and decays back over the note (the cube flies apart, then reassembles), so
    // the on-grid beat you actually land on when scrubbing (the playhead snaps to 1/4
    // beat) is the peak - not a zero-crossing. Overlapping notes take the strongest.
    const beat = state.beat
    const events = state.abilityEvents.get('shatter') ?? []
    let a = 0
    let vel = 0
    for (const n of events) {
      const dur = n.durationBeats || 0.5
      if (beat >= n.beat && beat < n.beat + dur) {
        const env = Math.pow(1 - (beat - n.beat) / dur, 1.3)
        if (env > a) { a = env; vel = n.velocity }
      }
    }
    const nvel = vel <= 1 ? vel : vel / 127 // tolerate 0–1 or 0–127 velocity scales
    const spread = 1.4 + Math.min(1, nvel) * 2.2

    // The core shrinks as it shatters; fragments grow from nothing and fly outward.
    // The per-axis DIM stretch rides the same mesh scale (a mesh property, so
    // splitter copies stretch in place and mover layouts stay unscaled).
    const shatterScale = Math.max(0.001, 1 - 0.85 * a)
    mesh.scale.set(
      shatterScale * (state.params.dimX ?? paramDefault(cubeInstrument, 'dimX')),
      shatterScale * (state.params.dimY ?? paramDefault(cubeInstrument, 'dimY')),
      shatterScale * (state.params.dimZ ?? paramDefault(cubeInstrument, 'dimZ')),
    )
    for (let i = 0; i < CORNERS.length; i++) {
      const frag = fragRefs.current[i]
      if (!frag) continue
      const [dx, dy, dz] = CORNERS[i]
      const dist = a * spread
      frag.position.set(dx * dist, dy * dist, dz * dist)
      frag.scale.setScalar(0.45 * a)
      frag.rotation.set(beat * 0.6 + i, beat * 0.8 + i, 0)
      frag.visible = a > 0.001
    }
  })

  return (
    <group ref={spinRef}>
      {FUNDAMENTAL_GEOMETRIES.map(({ id }) => (
        <FundamentalMesh
          key={id}
          // Tubed and sided solids omit the declarative geometry: the frame
          // callback above owns theirs, rebuilt from the TUBE / SIDES params.
          geometry={TUBED_GEOMETRIES.has(id) || SIDED_GEOMETRIES.has(id) ? undefined : id}
          visible={id === 'cube'}
          meshRef={(mesh) => { meshRefs.current[id] = mesh }}
        />
      ))}
      {CORNERS.map((_, i) => (
        <mesh key={i} ref={(el) => { fragRefs.current[i] = el }} visible={false} castShadow receiveShadow>
          <boxGeometry args={[1.6, 1.6, 1.6]} />
          <meshPhysicalMaterial
            color="#f472b6"
            metalness={0.65}
            roughness={0.18}
            clearcoat={0.45}
            clearcoatRoughness={0.1}
            envMapIntensity={1.4}
            emissive="#be185d"
            emissiveIntensity={1.4}
          />
        </mesh>
      ))}
    </group>
  )
}
