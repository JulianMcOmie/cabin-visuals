import { useRef } from 'react'
import { Group, Mesh, MeshStandardMaterial } from 'three'
import { useInstrumentFrame, seededRand } from '../core/visual/instrumentFrame'
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
    { key: 'baseXPosition', label: 'Base X Position', min: -10, max: 10, step: 0.1, default: 0 },
    { key: 'baseYPosition', label: 'Base Y Position', min: -10, max: 10, step: 0.1, default: 0 },
    { key: 'baseZPosition', label: 'Base Z Position', min: -10, max: 10, step: 0.1, default: 0 },
    // Spin is opt-in: 0 = still (the default), 1 = the classic steady tumble.
    { key: 'spinSpeed', label: 'Spin Speed', min: 0, max: 4, step: 0.05, default: 0 },
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
  // position from the X param, an opt-in spin from the beat, and a breathing scale
  // boosted by the energy port. The engine writes the composed world matrix to state.
  localTransform: ({ params, ports, beat }) => {
    const baseSize = params.baseSize ?? paramDefault(cubeInstrument, 'baseSize')
    const baseXPosition = params.baseXPosition ?? paramDefault(cubeInstrument, 'baseXPosition')
    const baseYPosition = params.baseYPosition ?? paramDefault(cubeInstrument, 'baseYPosition')
    const baseZPosition = params.baseZPosition ?? paramDefault(cubeInstrument, 'baseZPosition')
    const spinSpeed = params.spinSpeed ?? paramDefault(cubeInstrument, 'spinSpeed')
    const energy = ports.energy ?? 0
    const breathe = 1.15 + Math.sin(beat * 0.9) * 0.2
    return {
      position: [baseXPosition, baseYPosition, baseZPosition],
      rotation: [beat * 0.09 * spinSpeed, beat * 0.22 * spinSpeed, 0],
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
  // The gesture group wraps everything the cube is (core + fragments), so a hop
  // or a shake carries the shatter debris along with it.
  const gestureRef = useRef<Group>(null)
  const fragRefs = useRef<(Mesh | null)[]>([])

  useInstrumentFrame(trackId, (state) => {
    if (!meshRef.current) return
    // The pulse now arrives via the `energy` port (a Pulse modulator → matrix).
    const energy = state.portValues.energy ?? 0
    const baseHue = state.params.baseHue ?? paramDefault(cubeInstrument, 'baseHue')

    const mat = meshRef.current.material as MeshStandardMaterial
    mat.color.setHSL(baseHue / 360, 0.65, 0.6)
    mat.emissiveIntensity = 0.2 + energy * 1.2

    // Shatter: sample this track's Shatter lane at the current beat — a pure function
    // of the beat, so scrubbing mirrors playback exactly. The burst is MAX at the note
    // onset and decays back over the note (the cube flies apart, then reassembles), so
    // the on-grid beat you actually land on when scrubbing (the playhead snaps to 1/4
    // beat) is the peak — not a zero-crossing. Overlapping notes take the strongest.
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

    // Per-row moves: each MIDI row of the cube's main lane is its own gesture,
    // not one shared parameter. Pitch class picks the move (any octave works),
    // velocity sets how hard the cube commits to it, and the note's length is the
    // gesture's length — every move starts and ends at rest, so gestures on
    // different rows layer cleanly. Same pure-function-of-beat sampling as
    // Shatter above: scrubbing mirrors playback. Overlaps on one row keep the
    // strongest gesture.
    let nod = 0     // C  — bows toward the camera and back up
    let shake = 0   // C# — a "no" head-shake around Y, dying out
    let hop = 0     // D  — a parabolic jump off its spot
    let spin = 0    // D# — one full pirouette
    let squash = 0  // E  — cartoon squash-and-stretch
    let tilt = 0    // F  — a quizzical head-cock to the side
    let shiver = 0  // F# — a cold shiver (jitter amplitude)
    let shiverSeed = 0
    for (const n of state.notes) {
      const dur = n.durationBeats || 0.5
      if (beat < n.beat || beat >= n.beat + dur) continue
      const t = (beat - n.beat) / dur
      const v = Math.min(1, n.velocity <= 1 ? n.velocity : n.velocity / 127)
      switch (n.pitch % 12) {
        case 0: { // The Nod: skewing t makes the dip fast and the recovery slow —
          // reads as a nod, not a metronome.
          const env = Math.sin(Math.PI * Math.pow(t, 0.7)) * (0.4 + 0.6 * v)
          if (env > nod) nod = env
          break
        }
        case 1: { // The Shake: three swings, each smaller than the last.
          const env = Math.sin(t * Math.PI * 6) * (1 - t) * (0.15 + 0.35 * v)
          if (Math.abs(env) > Math.abs(shake)) shake = env
          break
        }
        case 2: { // The Hop: up and back down by note end, velocity is leg strength.
          const env = 4 * t * (1 - t) * (0.5 + 1.5 * v)
          if (env > hop) hop = env
          break
        }
        case 3: { // The Pirouette: exactly one turn, eased so it launches and lands
          // softly. Velocity is ignored — a pirouette is a pirouette.
          const env = t * t * (3 - 2 * t) * Math.PI * 2
          if (env > spin) spin = env
          break
        }
        case 4: { // Squash-and-stretch: flattens mid-note, springs back tall.
          const env = Math.sin(Math.PI * t) * (0.2 + 0.4 * v)
          if (env > squash) squash = env
          break
        }
        case 5: { // The Head-cock: a curious sideways lean, then back.
          const env = Math.sin(Math.PI * Math.pow(t, 0.7)) * (0.25 + 0.4 * v)
          if (env > tilt) tilt = env
          break
        }
        case 6: { // The Shiver: amplitude fades as the note warms up.
          const env = (1 - t) * (0.05 + 0.12 * v)
          if (env > shiver) { shiver = env; shiverSeed = n.beat }
          break
        }
      }
    }
    if (gestureRef.current) {
      const g = gestureRef.current
      // Shiver jitter re-rolls every 1/24 beat — frantic to the eye, but seeded
      // from the beat so a scrub to the same spot shivers identically.
      const tick = Math.floor(beat * 24)
      const jx = shiver > 0 ? (seededRand(tick + shiverSeed * 13) - 0.5) * 2 * shiver : 0
      const jz = shiver > 0 ? (seededRand(tick * 7 + shiverSeed * 29) - 0.5) * 2 * shiver : 0
      g.rotation.set(nod * 0.9, shake + spin, tilt * 0.7)
      g.position.set(jx, hop, jz)
      g.scale.set(1 + squash * 0.6, 1 - squash, 1 + squash * 0.6)
    }

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
    <group ref={gestureRef}>
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
