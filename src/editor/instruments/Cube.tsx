import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Mesh, MeshStandardMaterial } from 'three'
import { useTimeStore } from '../store/timeStore'
import { useUIStore } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'

function computePulse(currentBeat: number, beatsPerBar: number): number {
  const DECAY_BEATS = 0.45
  const { tracks } = useProjectStore.getState()
  let closestBeatsSinceNote = Infinity

  for (const track of tracks) {
    if (track.muted || track.instrumentId !== 'cube') continue
    for (const block of track.blocks) {
      const blockStartBeat = block.startBar * beatsPerBar
      const blockEndBeat = blockStartBeat + block.durationBars * beatsPerBar
      if (currentBeat < blockStartBeat || currentBeat > blockEndBeat) continue
      for (const note of block.notes) {
        const absNoteBeat = blockStartBeat + note.startBeat
        if (absNoteBeat <= currentBeat) {
          const beatsSince = currentBeat - absNoteBeat
          if (beatsSince < closestBeatsSinceNote) closestBeatsSinceNote = beatsSince
        }
      }
    }
  }

  if (closestBeatsSinceNote === Infinity) return 0
  return Math.max(0, 1 - closestBeatsSinceNote / DECAY_BEATS)
}

export function Cube() {
  const meshRef = useRef<Mesh>(null)

  useFrame((_, delta) => {
    const { currentBeat, bpm, beatsPerBar, totalBars, setCurrentBeat } = useTimeStore.getState()
    const { isPlaying, pause } = useUIStore.getState()

    if (isPlaying) {
      const next = currentBeat + delta * (bpm / 60)
      const maxBeat = totalBars * beatsPerBar
      if (next >= maxBeat) {
        setCurrentBeat(maxBeat)
        pause()
      } else {
        setCurrentBeat(next)
      }
    }

    if (!meshRef.current) return

    const pulse = computePulse(currentBeat, beatsPerBar)

    meshRef.current.rotation.y = currentBeat * 0.22
    meshRef.current.rotation.x = currentBeat * 0.09

    const breathe = 1.15 + Math.sin(currentBeat * 0.9) * 0.2
    meshRef.current.scale.setScalar(breathe * (1 + pulse * 0.35))

    const mat = meshRef.current.material as MeshStandardMaterial
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
