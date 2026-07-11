import { useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group, Mesh, type Material } from 'three'
import { useTimeStore } from '../../store/TimeStore'
import { getBeatOverride } from '../../core/visual/beatOverride'
import { getObjectState } from '../../core/visual/VisualEngine'
import { getEffect } from '../../effects'
import { effectiveEffectState } from '../../effects/automation'
import type { EffectInstance } from '../../types'

function setOpacity(material: Material | Material[], opacity: number) {
  const mats = Array.isArray(material) ? material : [material]
  for (const m of mats) {
    // MeshStandardMaterial etc. all have opacity/transparent.
    const mm = m as Material & { opacity: number }
    mm.transparent = opacity < 1
    mm.opacity = opacity
  }
}

/**
 * One clone plugin: renders `count` React-duplicated copies of `children`, each in a group
 * whose matrix is set from the plugin's `getTransform` every frame (and material opacity
 * from `getOpacity`, for trails). Copies are real R3F subtrees - matches Excellent DAW -
 * fine for the modest counts these plugins produce. Disabled → a single pass-through copy.
 */
function SingleClone({ trackId, instance, children }: { trackId: string; instance: EffectInstance; children: ReactNode }) {
  const plugin = getEffect(instance.pluginId)
  const spec = instance.enabled ? plugin?.getClones?.(instance.settings) : undefined
  const count = spec ? Math.max(1, Math.floor(spec.count)) : 1

  const groupsRef = useRef<(Group | null)[]>([])
  const specRef = useRef(spec)
  specRef.current = spec

  useFrame(() => {
    // Settings/enabled as of this frame (stored values merged with automation).
    // Automation can retune transforms and gate the effect off per frame; the
    // COPY COUNT stays render-derived from the stored settings - automating a
    // count param won't add/remove copies, and automated-off shows copy 0 only.
    const eff = effectiveEffectState(instance, getObjectState(trackId)?.effectOverrides)
    const s = eff.enabled ? specRef.current : undefined
    // Same clock rule as VisualBeatSync: exports drive time through the beat
    // override while the transport stays frozen.
    const time = getBeatOverride() ?? useTimeStore.getState().currentBeat
    for (let i = 0; i < count; i++) {
      const g = groupsRef.current[i]
      if (!g) continue
      g.visible = !!s || i === 0
      if (!s) {
        g.matrix.identity()
        continue
      }
      g.matrix.copy(s.getTransform(i, eff.settings, time))
      if (s.getOpacity) {
        const op = s.getOpacity(i, eff.settings, time)
        g.traverse((o) => {
          const mesh = o as Mesh
          if (mesh.isMesh) setOpacity(mesh.material, op)
        })
      }
    }
  })

  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <group key={i} ref={(el) => { groupsRef.current[i] = el }} matrixAutoUpdate={false}>
          {children}
        </group>
      ))}
    </>
  )
}

/**
 * Wrap an object in its clone-effect chain. Sits between the placement group and the
 * transform chain (plan order: transform ▸ clone), so each copy is the transformed object.
 * Multiple clone plugins nest (clones-of-clones, e.g. a ring of tiles).
 */
export function CloneWrapper({ trackId, plugins, children }: { trackId: string; plugins: EffectInstance[]; children: ReactNode }) {
  const clones = plugins.filter((i) => getEffect(i.pluginId)?.category === 'clone')
  let element: ReactNode = children
  for (let i = clones.length - 1; i >= 0; i--) {
    element = <SingleClone key={clones[i].id} trackId={trackId} instance={clones[i]}>{element}</SingleClone>
  }
  return <>{element}</>
}
