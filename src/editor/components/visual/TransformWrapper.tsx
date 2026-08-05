import { useEffect, useRef, type ReactNode } from 'react'
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

/** One material plugin: re-materials the meshes under its group each frame while
 *  enabled, restores the instrument's own materials while disabled. No transform
 *  reset - the group is purely a traversal root. */
function SingleMaterial({ trackId, instance, children }: { trackId: string; instance: EffectInstance; children: ReactNode }) {
  const groupRef = useRef<Group>(null)
  const plugin = getEffect(instance.pluginId)
  useFrame(() => {
    const g = groupRef.current
    if (!g || !plugin?.applyMaterial) return
    const eff = effectiveEffectState(instance, getObjectState(trackId)?.effectOverrides)
    if (!eff.enabled) { plugin.restoreMaterial?.(g); return }
    plugin.applyMaterial(g, eff.settings, getBeatOverride() ?? useTimeStore.getState().currentBeat)
  })
  // Removing the instance usually remounts the instrument subtree (the element
  // reparents), but restore anyway for the paths where the meshes survive.
  useEffect(() => {
    const g = groupRef.current
    return () => { if (g) plugin?.restoreMaterial?.(g) }
  }, [plugin])
  return <group ref={groupRef}>{children}</group>
}

/**
 * Wrap an object in its ordinary transform-effect chain. Scale is the one
 * exception: ObjectRenderer composes it outside the VisualCopy transform so it
 * applies after movers. Rotate and Offset stay here in the object's own frame.
 * First plugin is innermost, last is outermost (later transforms wrap earlier
 * ones, e.g. offset-then-rotate ⇒ orbital motion). Material plugins ride the
 * same chain (order relative to transforms is irrelevant - they only traverse).
 */
export function TransformWrapper({ trackId, plugins, children }: { trackId: string; plugins: EffectInstance[]; children: ReactNode }) {
  const chain = plugins.filter((i) => {
    const category = getEffect(i.pluginId)?.category
    return (category === 'transform' && i.pluginId !== 'scale') || category === 'material'
  })
  let element: ReactNode = children
  for (let i = 0; i < chain.length; i++) {
    const Wrapper = getEffect(chain[i].pluginId)?.category === 'material' ? SingleMaterial : SingleTransform
    element = <Wrapper key={chain[i].id} trackId={trackId} instance={chain[i]}>{element}</Wrapper>
  }
  return <>{element}</>
}
