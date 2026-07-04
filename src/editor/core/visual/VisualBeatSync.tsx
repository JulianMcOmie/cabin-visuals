import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useTimeStore } from '../../store/TimeStore'
import { useProjectStore } from '../../store/ProjectStore'
import { setProject, syncParams, computeAtBeat } from './VisualEngine'
import { getBeatOverride } from './beatOverride'
import { PauseCanary } from './pauseCanary'

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
  const canary = useRef<PauseCanary | null>(null)
  useFrame((rootState) => {
    const { currentBeat, isPlaying } = useTimeStore.getState()
    // Export walks time through the override so the transport never moves.
    const beat = getBeatOverride() ?? currentBeat
    computeAtBeat(beat)
    // Dev-only pause-invariant tripwire (see pauseCanary.ts). The project state
    // ref is the edit stamp: edits while paused legitimately change the scene.
    if (process.env.NODE_ENV !== 'production') {
      ;(canary.current ??= new PauseCanary()).check(
        rootState.scene, beat, isPlaying, useProjectStore.getState(),
      )
    }
  })

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
