import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group } from 'three'
import { getInstrument } from '../../instruments'
import { getObjectState } from '../../core/engine/VisualEngine'
import { useProjectStore } from '../../store/ProjectStore'
import { TransformWrapper } from './TransformWrapper'

/**
 * Renders one object. A placement group carries the object's world transform (composed
 * with ancestors by the engine) and the mute blackout; the object's transform effects
 * wrap the instrument component inside it, so they operate in the object's own frame.
 * The instrument component (code Cube or spec renderer) draws the mesh at local origin.
 */
export function ObjectRenderer({ trackId, instrumentId }: { trackId: string; instrumentId: string }) {
  const def = getInstrument(instrumentId)
  const groupRef = useRef<Group>(null)
  const plugins = useProjectStore((s) => s.tracks[trackId]?.visualPlugins)

  useFrame(() => {
    const g = groupRef.current
    if (!g) return
    const state = getObjectState(trackId)
    g.visible = !state?.blackedOut
    if (state) state.world.decompose(g.position, g.quaternion, g.scale)
  })

  if (!def) return null
  const Component = def.component
  return (
    <group ref={groupRef}>
      <TransformWrapper plugins={plugins ?? []}>
        <Component trackId={trackId} />
      </TransformWrapper>
    </group>
  )
}
