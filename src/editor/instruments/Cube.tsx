import { useRef } from 'react'
import { Mesh, MeshPhysicalMaterial } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { paramDefault, type ObjectInstrumentDef } from './types'

const DEFAULT_BASE_COLOR = '#5757db'

// The cube's definition lives next to its visual - schema and component can't drift.
export const cubeInstrument: ObjectInstrumentDef = {
  id: 'cube',
  name: 'Cube',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  params: [
    { key: 'baseSize', label: 'Base Size', min: 0.2, max: 4, step: 0.05, default: 1.6 },
    { key: 'baseColor', label: 'Base Color', type: 'color', default: DEFAULT_BASE_COLOR },
    { key: 'baseXPosition', label: 'Base X Position', min: -10, max: 10, step: 0.1, default: 0 },
    { key: 'baseYPosition', label: 'Base Y Position', min: -10, max: 10, step: 0.1, default: 0 },
    { key: 'baseZPosition', label: 'Base Z Position', min: -10, max: 10, step: 0.1, default: 0 },
    // Spin is opt-in: 0 = still (the default), 1 = the classic steady tumble.
    { key: 'spinSpeed', label: 'Spin Speed', min: 0, max: 4, step: 0.05, default: 0 },
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
  // The Cube's signature ability: play a note on its Shatter lane and the cube bursts
  // into fragments that fly out and reassemble over the note's length (its velocity
  // sets the blast radius). Bespoke, intrinsic - it IS how a cube performs.
  abilities: [
    { key: 'shatter', label: 'Shatter', color: '#f472b6' },
  ],
  // The cube's transform as data, so the engine can compose it with its parent's:
  // position from the X param, an opt-in spin from the beat, and a static base scale
  // boosted only by note-pulse energy. The engine writes the composed world matrix to state.
  localTransform: ({ params, energy, beat }) => {
    const baseSize = params.baseSize ?? paramDefault(cubeInstrument, 'baseSize')
    const baseXPosition = params.baseXPosition ?? paramDefault(cubeInstrument, 'baseXPosition')
    const baseYPosition = params.baseYPosition ?? paramDefault(cubeInstrument, 'baseYPosition')
    const baseZPosition = params.baseZPosition ?? paramDefault(cubeInstrument, 'baseZPosition')
    const spinSpeed = params.spinSpeed ?? paramDefault(cubeInstrument, 'spinSpeed')
    return {
      position: [baseXPosition, baseYPosition, baseZPosition],
      rotation: [beat * 0.09 * spinSpeed, beat * 0.22 * spinSpeed, 0],
      scale: (baseSize / 1.6) * (1 + energy * 0.35),
    }
  },
  component: Cube,
}

// The eight cube-corner directions the fragments fly along.
const CORNERS: [number, number, number][] = [
  [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
  [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
]

// One cube per cube track. The transform (world matrix) and mute blackout are applied
// by ObjectRenderer's placement group; this draws the mesh at local origin and owns
// appearance (color/emissive) plus its signature Shatter ability.
export function Cube({ trackId }: { trackId: string }) {
  const meshRef = useRef<Mesh>(null)
  const fragRefs = useRef<(Mesh | null)[]>([])

  useInstrumentFrame(trackId, (state) => {
    if (!meshRef.current) return
    // The note-pulse signal, computed directly from the object's own notes.
    const energy = state.energy
    const baseColor = state.stringParams.baseColor
    const legacyBaseHue = state.params.baseHue

    const mat = meshRef.current.material as MeshPhysicalMaterial
    if (baseColor) mat.color.set(baseColor)
    else if (legacyBaseHue !== undefined) mat.color.setHSL(legacyBaseHue / 360, 0.65, 0.6)
    else mat.color.set(DEFAULT_BASE_COLOR)
    mat.emissiveIntensity = 0.25 + energy * 2.5

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
    meshRef.current.scale.setScalar(Math.max(0.001, 1 - 0.85 * a))
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
    <group>
      <mesh ref={meshRef} castShadow receiveShadow>
        <boxGeometry args={[1.6, 1.6, 1.6]} />
        <meshPhysicalMaterial
          color="#6366f1"
          metalness={0.08}
          roughness={0.24}
          clearcoat={0.9}
          clearcoatRoughness={0.16}
          envMapIntensity={1.25}
          emissive="#312e81"
          emissiveIntensity={0.25}
        />
      </mesh>
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
