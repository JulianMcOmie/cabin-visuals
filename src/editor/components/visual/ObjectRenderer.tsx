import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group, Vector3 } from 'three'
import { getInstrument } from '../../instruments'
import { getObjectState } from '../../core/engine/VisualEngine'
import { useProjectStore } from '../../store/ProjectStore'
import { getPlugin } from '../../plugins'
import { TransformWrapper } from './TransformWrapper'
import { CloneWrapper } from './CloneWrapper'
import { ShaderWrapper } from './ShaderWrapper'

/**
 * Renders one object. A placement group carries the object's world transform (composed
 * with ancestors by the engine) and the mute blackout; the object's transform effects
 * wrap the instrument component inside it, so they operate in the object's own frame.
 * The instrument component (code Cube or spec renderer) draws the mesh at local origin.
 */
const _camForward = new Vector3()

export function ObjectRenderer({ trackId, instrumentId }: { trackId: string; instrumentId: string }) {
  const def = getInstrument(instrumentId)
  const groupRef = useRef<Group>(null)
  const plugins = useProjectStore((s) => s.tracks[trackId]?.visualPlugins) ?? []
  const shaderInstances = plugins.filter((p) => p.enabled && getPlugin(p.pluginId)?.category === 'shader')

  const isFullFrame = !!def?.fullFrame

  useFrame(({ camera }) => {
    const g = groupRef.current
    if (!g) return
    const state = getObjectState(trackId)
    g.visible = !state?.blackedOut
    if (isFullFrame) {
      // A full-frame instrument is a SCREEN: pinned dead-ahead of the camera and
      // parallel to it, at the same distance r3f's `viewport` sizing assumes
      // (camera → origin), so a viewport-sized plane fills the frame exactly.
      // Without this the plane stands at the world origin and the (pitched)
      // camera views it at an angle — 2D instruments read as a tilted backdrop.
      const dist = camera.position.length()
      camera.getWorldDirection(_camForward)
      g.position.copy(camera.position).addScaledVector(_camForward, dist)
      g.quaternion.copy(camera.quaternion)
    } else if (state) {
      state.world.decompose(g.position, g.quaternion, g.scale)
    }
  })

  if (!def) return null
  const Component = def.component

  // Full-frame instruments (viewport-filling planes) skip the placement transform and the
  // transform/clone effect chain; shaders may still post-process them.
  if (isFullFrame) {
    const frame = <group ref={groupRef}><Component trackId={trackId} /></group>
    return shaderInstances.length > 0
      ? <ShaderWrapper trackId={trackId} plugins={shaderInstances}>{frame}</ShaderWrapper>
      : frame
  }

  const content = (
    <CloneWrapper plugins={plugins}>
      <TransformWrapper plugins={plugins}>
        <Component trackId={trackId} />
      </TransformWrapper>
    </CloneWrapper>
  )

  // Shader path: the object is rendered offscreen (with its world transform) and drawn
  // back as a post-processed full-frame overlay — so no in-scene placement group here.
  if (shaderInstances.length > 0) {
    return <ShaderWrapper trackId={trackId} plugins={shaderInstances}>{content}</ShaderWrapper>
  }

  return <group ref={groupRef}>{content}</group>
}
