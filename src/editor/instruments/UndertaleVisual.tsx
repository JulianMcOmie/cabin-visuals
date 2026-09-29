import { useEffect, useMemo, useRef } from 'react'
import type { Group, Mesh } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { undertaleInstrument } from './Undertale'
import { paramDefault } from './types'
import { undertaleCharacterIndex, undertalePose } from './undertaleCore'
import { UNDERTALE_SPRITES } from './undertaleSprites'
import { createUndertaleGeometry } from './undertaleGeometry'

export function UndertaleVisual({ trackId }: { trackId: string }) {
  const group = useRef<Group>(null)
  const meshes = useRef<(Mesh | null)[]>([])
  const geometries = useMemo(() => UNDERTALE_SPRITES.map(createUndertaleGeometry), [])
  useEffect(() => () => geometries.forEach(geometry => geometry.dispose()), [geometries])
  useInstrumentFrame(trackId, state => {
    if (!group.current || geometries.some((_, index) => !meshes.current[index])) return false
    const value = (key: string) => state.params[key] ?? paramDefault(undertaleInstrument, key)
    const selected = undertaleCharacterIndex(value('character'))
    const pose = undertalePose(state.beat, value('motion'), state.energy, value('reactivity'))
    group.current.position.y = pose.lift
    group.current.rotation.set(0, value('turn') * Math.PI / 180, pose.tilt)
    for (let index = 0; index < geometries.length; index++) {
      const mesh = meshes.current[index]!
      mesh.visible = index === selected
      mesh.scale.set(pose.scale, pose.scale, Math.max(0.02, value('thickness')))
    }
  })
  return (
    <group ref={group}>
      {geometries.map((geometry, index) => (
        <mesh key={index} ref={mesh => { meshes.current[index] = mesh }} castShadow
          visible={index === 0} scale-z={0.16}>
          <primitive object={geometry} attach="geometry" />
          {/* Pixel colors stay legible under every lighting preset. Side colors
              are baked darker, so even unlit artwork has visible thickness. */}
          <meshBasicMaterial vertexColors toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}
