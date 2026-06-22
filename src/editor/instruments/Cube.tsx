import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Mesh, MeshStandardMaterial } from 'three'
import { useTimeStore } from '../store/TimeStore'
import { useProjectStore } from '../store/ProjectStore'
import { paramDefault, type InstrumentDef } from './types'

// The cube's definition lives next to its visual — schema and component can't drift.
export const cubeInstrument: InstrumentDef = {
  id: 'cube',
  name: 'Cube',
  params: [
    { key: 'baseSize', label: 'Base Size', min: 0.2, max: 4, step: 0.05, default: 1.6 },
    // Color as a hue slider (0–360) — keeps every param numeric.
    { key: 'baseHue', label: 'Base Color', min: 0, max: 360, step: 1, default: 240 },
  ],
}

function computePulse(currentBeat: number, beatsPerBar: number): number {
  const DECAY_BEATS = 0.45
  const { tracks } = useProjectStore.getState()
  let closestBeatsSinceNote = Infinity
  let pulseIntensity = 1

  for (const track of Object.values(tracks)) {
    if (track.muted || track.instrumentId !== 'cube') continue
    for (const block of track.blocks) {
      const blockStartBeat = block.startBar * beatsPerBar
      const blockEndBeat = blockStartBeat + block.durationBars * beatsPerBar
      if (currentBeat < blockStartBeat || currentBeat > blockEndBeat) continue
      for (const note of block.notes) {
        const absNoteBeat = blockStartBeat + note.startBeat
        if (absNoteBeat <= currentBeat) {
          const beatsSince = currentBeat - absNoteBeat
          if (beatsSince < closestBeatsSinceNote) {
            pulseIntensity = note.pitch - 23
            closestBeatsSinceNote = beatsSince
          }
        }
      }
    }
  }

  console.log("pulseIntensity: " + pulseIntensity)

  if (closestBeatsSinceNote === Infinity) return 0
  return Math.max(0, pulseIntensity / 50 * (1 - closestBeatsSinceNote / DECAY_BEATS))
}

export function Cube() {
  const meshRef = useRef<Mesh>(null)

  useFrame(() => {
    if (!meshRef.current) return
    const { currentBeat, beatsPerBar } = useTimeStore.getState()
    const pulse = computePulse(currentBeat, beatsPerBar)

    // Instrument params from the cube track (fall back to the schema defaults).
    const cubeTrack = Object.values(useProjectStore.getState().tracks).find((t) => t.instrumentId === 'cube')
    const baseSize = cubeTrack?.params?.baseSize ?? paramDefault(cubeInstrument, 'baseSize')
    const baseHue = cubeTrack?.params?.baseHue ?? paramDefault(cubeInstrument, 'baseHue')

    meshRef.current.rotation.y = currentBeat * 0.22
    meshRef.current.rotation.x = currentBeat * 0.09

    const breathe = 1.15 + Math.sin(currentBeat * 0.9) * 0.2
    meshRef.current.scale.setScalar((baseSize / 1.6) * breathe * (1 + pulse * 0.35))

    const mat = meshRef.current.material as MeshStandardMaterial
    mat.color.setHSL(baseHue / 360, 0.65, 0.6)
    mat.emissiveIntensity = 0.2 + pulse * 1.2
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
