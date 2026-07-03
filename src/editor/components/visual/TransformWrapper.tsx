import { useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group } from 'three'
import { useTimeStore } from '../../store/TimeStore'
import { getEffect } from '../../effects'
import type { EffectInstance } from '../../types'

/** One transform plugin on its own nested group, reset then re-applied each frame. */
function SingleTransform({ instance, children }: { instance: EffectInstance; children: ReactNode }) {
  const groupRef = useRef<Group>(null)
  const plugin = getEffect(instance.pluginId)
  useFrame(() => {
    const g = groupRef.current
    if (!g || !plugin?.applyTransform) return
    g.position.set(0, 0, 0)
    g.rotation.set(0, 0, 0)
    g.scale.set(1, 1, 1)
    if (!instance.enabled) return
    plugin.applyTransform(g, instance.settings, useTimeStore.getState().currentBeat)
  })
  return <group ref={groupRef}>{children}</group>
}

/**
 * Wrap an object in its transform-effect chain. The placement group above this (in
 * ObjectRenderer) carries the object's world transform, so these effects operate in
 * the object's own frame — rotate spins it in place, offset shifts it, etc. First
 * plugin is innermost, last is outermost (later transforms wrap earlier ones, e.g.
 * offset-then-rotate ⇒ orbital motion).
 */
export function TransformWrapper({ plugins, children }: { plugins: EffectInstance[]; children: ReactNode }) {
  const transforms = plugins.filter((i) => getEffect(i.pluginId)?.category === 'transform')
  let element: ReactNode = children
  for (let i = 0; i < transforms.length; i++) {
    element = <SingleTransform key={transforms[i].id} instance={transforms[i]}>{element}</SingleTransform>
  }
  return <>{element}</>
}
