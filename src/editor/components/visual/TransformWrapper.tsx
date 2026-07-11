import { useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group } from 'three'
import { useTimeStore } from '../../store/TimeStore'
import { getBeatOverride } from '../../core/visual/beatOverride'
import { getObjectState } from '../../core/visual/VisualEngine'
import { getEffect } from '../../effects'
import { effectiveEffectState } from '../../effects/automation'
import type { EffectInstance } from '../../types'

/** One transform plugin on its own nested group, reset then re-applied each frame. */
function SingleTransform({ trackId, instance, children }: { trackId: string; instance: EffectInstance; children: ReactNode }) {
  const groupRef = useRef<Group>(null)
  const plugin = getEffect(instance.pluginId)
  useFrame(() => {
    const g = groupRef.current
    if (!g || !plugin?.applyTransform) return
    g.position.set(0, 0, 0)
    g.rotation.set(0, 0, 0)
    g.scale.set(1, 1, 1)
    // Settings/enabled as of this frame: stored values merged with any
    // automation lanes sampled by the engine.
    const eff = effectiveEffectState(instance, getObjectState(trackId)?.effectOverrides)
    if (!eff.enabled) return
    // Same clock rule as VisualBeatSync: an export walk drives time through the
    // beat override while the transport stays frozen - reading currentBeat
    // alone would pin this effect to the parked playhead for the whole export.
    plugin.applyTransform(g, eff.settings, getBeatOverride() ?? useTimeStore.getState().currentBeat)
  })
  return <group ref={groupRef}>{children}</group>
}

/**
 * Wrap an object in its transform-effect chain. The placement group above this (in
 * ObjectRenderer) carries the object's world transform, so these effects operate in
 * the object's own frame - rotate spins it in place, offset shifts it, etc. First
 * plugin is innermost, last is outermost (later transforms wrap earlier ones, e.g.
 * offset-then-rotate ⇒ orbital motion).
 */
export function TransformWrapper({ trackId, plugins, children }: { trackId: string; plugins: EffectInstance[]; children: ReactNode }) {
  const transforms = plugins.filter((i) => getEffect(i.pluginId)?.category === 'transform')
  let element: ReactNode = children
  for (let i = 0; i < transforms.length; i++) {
    element = <SingleTransform key={transforms[i].id} trackId={trackId} instance={transforms[i]}>{element}</SingleTransform>
  }
  return <>{element}</>
}
