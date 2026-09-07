import { createContext, useContext, type RefObject } from 'react'
import { useFrame, type RenderCallback } from '@react-three/fiber'
import { visualEngine, type VisualEngineInstance } from './VisualEngine'
import type { Track } from '../../types'

/** A preview owns both its evaluator and its truncated document. The ordinary
 * editor has no provider and keeps using its original singleton. */
export const VisualEngineContext = createContext<{
  engine: VisualEngineInstance
  tracks: Record<string, Track>
  renderFrame: RefObject<boolean>
} | null>(null)

export function useVisualEngine(): VisualEngineInstance {
  return useContext(VisualEngineContext)?.engine ?? visualEngine
}

/** Preview simulations, instruments and shader passes share one frame budget. */
export function useVisualFrame(callback: RenderCallback, priority = 0) {
  const preview = useContext(VisualEngineContext)
  useFrame((...args) => {
    if (!preview || preview.renderFrame.current) callback(...args)
  }, priority)
}
