import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Mesh, MeshStandardMaterial } from 'three'
import { getObjectState } from '../core/engine/VisualEngine'
import { useTimeStore } from '../store/TimeStore'
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
  // The Cube's signature ability: play a note on its Shatter lane and the cube bursts
  // into fragments that fly out and reassemble over the note's length (its velocity
  // sets the blast radius). Bespoke, intrinsic — it IS how a cube performs.
  abilities: [
    { key: 'shatter', label: 'Shatter', color: '#f472b6' },
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

  useFrame(() => {
    if (!meshRef.current) return
    const state = getObjectState(trackId)
    // The pulse now arrives via the `energy` port (a Pulse modulator → matrix).
    const energy = state?.portValues.energy ?? 0
    const baseHue = state?.params.baseHue ?? paramDefault(cubeInstrument, 'baseHue')

    const mat = meshRef.current.material as MeshStandardMaterial
    mat.color.setHSL(baseHue / 360, 0.65, 0.6)
    mat.emissiveIntensity = 0.2 + energy * 1.2

    // Shatter: sample this track's Shatter lane at the current beat — a pure function
    // of the beat, so scrubbing mirrors playback exactly. The burst is MAX at the note
    // onset and decays back over the note (the cube flies apart, then reassembles), so
    // the on-grid beat you actually land on when scrubbing (the playhead snaps to 1/4
    // beat) is the peak — not a zero-crossing. Overlapping notes take the strongest.
    const beat = useTimeStore.getState().currentBeat
    const events = state?.abilityEvents.get('shatter') ?? []
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
      {CORNERS.map((_, i) => (
        <mesh key={i} ref={(el) => { fragRefs.current[i] = el }} visible={false}>
          <boxGeometry args={[1.6, 1.6, 1.6]} />
          <meshStandardMaterial
            color="#f472b6"
            metalness={0.4}
            roughness={0.3}
            emissive="#be185d"
            emissiveIntensity={0.9}
          />
        </mesh>
      ))}
    </group>
  )
}
