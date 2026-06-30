import { useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { useTimeStore } from '../../store/TimeStore'
import { useProjectStore } from '../../store/ProjectStore'
import { setProject, computeAtBeat } from './VisualEngine'

/**
 * Mounted once inside <Canvas>. Two jobs:
 *  - useFrame drives the engine each frame (runs first, so every object reads
 *    fresh per-frame state);
 *  - a debounced ProjectStore subscription re-resolves off the edit's critical
 *    path, so editing never blocks on resolve. The scene keeps rendering the
 *    previous resolved graph until the new one lands.
 */
export function VisualBeatSync() {
  useFrame(() => computeAtBeat(useTimeStore.getState().currentBeat))

  useEffect(() => {
    setProject(useProjectStore.getState())
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsub = useProjectStore.subscribe((s) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setProject(s), 80)
    })
    return () => {
      if (timer) clearTimeout(timer)
      unsub()
    }
  }, [])

  return null
}
