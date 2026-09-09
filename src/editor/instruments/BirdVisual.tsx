import { useEffect, useMemo, useRef } from 'react'
import { MeshStandardMaterial, type Group } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { birdInstrument } from './Bird'
import { paramDefault, stringParamDefault } from './types'

/** Rounded, solid geometry keeps the bird readable when a mover turns it. */
export function BirdVisual({ trackId }: { trackId: string }) {
  const bird = useRef<Group>(null)
  const nearWing = useRef<Group>(null)
  const farWing = useRef<Group>(null)
  const materials = useMemo(() => ({
    feathers: new MeshStandardMaterial({ color: '#52b8d6', roughness: 0.72 }),
    wings: new MeshStandardMaterial({ color: '#36788b', roughness: 0.8 }),
    belly: new MeshStandardMaterial({ color: '#fff1d6', roughness: 0.85 }),
    beak: new MeshStandardMaterial({ color: '#f6b94a', roughness: 0.65 }),
  }), [])
  useEffect(() => () => {
    Object.values(materials).forEach(material => material.dispose())
  }, [materials])

  useInstrumentFrame(trackId, state => {
    if (!bird.current || !nearWing.current || !farWing.current) return false
    const value = (key: string) => state.params[key] ?? paramDefault(birdInstrument, key)
    const color = (key: string) => state.stringParams[key] ?? stringParamDefault(birdInstrument, key)
    materials.feathers.color.set(color('baseColor'))
    materials.wings.color.copy(materials.feathers.color).multiplyScalar(0.65)
    materials.belly.color.set(color('bellyColor'))
    materials.beak.color.set(color('beakColor'))

    // Absolute beat only: paused frames, reverse seeks and exports agree.
    const phase = state.beat * value('flapSpeed') * Math.PI * 2
    const hit = Math.min(1, Math.max(0, state.energy)) * value('reactivity')
    const spread = value('wingSpread') * (0.5 + 0.5 * Math.sin(phase)) + hit * 0.55
    nearWing.current.rotation.x = -spread * 1.8
    farWing.current.rotation.x = spread * 1.8
    bird.current.position.y = hit * 0.12
    bird.current.rotation.z = hit * 0.07
  })

  // Shared materials keep every feather in sync, including colorizer copies.
  return (
    <group ref={bird} rotation-y={-0.3}>
      <mesh castShadow receiveShadow scale={[0.68, 0.53, 0.43]}>
        <sphereGeometry args={[1, 32, 24]} />
        <primitive object={materials.feathers} attach="material" />
      </mesh>
      <mesh castShadow receiveShadow position={[0.43, 0.48, 0]} scale={[0.38, 0.38, 0.35]}>
        <sphereGeometry args={[1, 28, 20]} />
        <primitive object={materials.feathers} attach="material" />
      </mesh>
      <mesh position={[0.25, -0.1, 0]} scale={[0.49, 0.43, 0.435]}>
        <sphereGeometry args={[1, 28, 20]} />
        <primitive object={materials.belly} attach="material" />
      </mesh>
      <mesh castShadow position={[0.87, 0.43, 0]} rotation-z={-Math.PI / 2} scale={[1, 1, 0.8]}>
        <coneGeometry args={[0.15, 0.38, 4]} />
        <primitive object={materials.beak} attach="material" />
      </mesh>
      {([-1, 1] as const).map(side => (
        <group key={side}>
          <mesh position={[0.55, 0.55, side * 0.29]} scale={[0.075, 0.085, 0.055]}>
            <sphereGeometry args={[1, 16, 12]} />
            <meshBasicMaterial color="#142330" toneMapped={false} />
          </mesh>
          <mesh position={[0.57, 0.575, side * 0.336]}>
            <sphereGeometry args={[0.023, 10, 8]} />
            <meshBasicMaterial color="#ffffff" toneMapped={false} />
          </mesh>
          <group ref={side === 1 ? nearWing : farWing} position={[0, 0.16, side * 0.36]}>
            <mesh castShadow rotation-z={-0.48} position={[-0.22, -0.18, side * 0.035]} scale={[0.48, 0.25, 0.1]}>
              <sphereGeometry args={[1, 24, 16]} />
              <primitive object={materials.wings} attach="material" />
            </mesh>
          </group>
          <mesh castShadow position={[0.03, -0.63, side * 0.22]}>
            <cylinderGeometry args={[0.025, 0.025, 0.3, 8]} />
            <primitive object={materials.beak} attach="material" />
          </mesh>
          <mesh castShadow position={[0.12, -0.77, side * 0.22]} scale={[0.17, 0.035, 0.085]}>
            <sphereGeometry args={[1, 16, 10]} />
            <primitive object={materials.beak} attach="material" />
          </mesh>
        </group>
      ))}
      {[-1, 0, 1].map(i => (
        <mesh key={i} castShadow position={[-0.77, 0.13, i * 0.14]} rotation={[0, i * 0.18, -0.45]} scale={[0.45, 0.11, 0.085]}>
          <sphereGeometry args={[1, 20, 12]} />
          <primitive object={materials.wings} attach="material" />
        </mesh>
      ))}
    </group>
  )
}
