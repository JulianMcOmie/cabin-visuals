import { useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { useTimeStore } from '../../store/TimeStore'
import { useProjectStore } from '../../store/ProjectStore'
import { setProject, syncParams, computeAtBeat } from './VisualEngine'

/**
 * Mounted once inside <Canvas>. Two jobs:
 *  - useFrame drives the engine each frame (runs first, so every object reads
 *    fresh per-frame state);
 *  - a ProjectStore subscription that splits the work: syncParams runs synchronously
 *    so base-param edits (slider drags) are reactive at 60fps, while the expensive
 *    structural re-resolve stays debounced off the edit's critical path. The scene
 *    keeps rendering the previous resolved graph until the new one lands.
 */
export function VisualBeatSync() {
  useFrame(() => computeAtBeat(useTimeStore.getState().currentBeat))

  useEffect(() => {
    setProject(useProjectStore.getState())
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsub = useProjectStore.subscribe((s) => {
      syncParams(s)
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
