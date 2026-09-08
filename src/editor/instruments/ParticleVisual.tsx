import { useContext, useEffect, useMemo, useRef } from 'react'
import { Color, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, PlaneGeometry } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { useInstancedCopyFrame } from '../core/visual/instancedFrame'
import { VisualEngineContext } from '../core/visual/VisualEngineContext'
import { useThree } from '@react-three/fiber'
import { PARTICLE_COLOR, PARTICLE_GLOW } from './Particle'
import { configureParticlePicking, createParticleMaterial } from './particleCore'

export function ParticleVisual({ trackId }: { trackId: string }) {
  const preview = useContext(VisualEngineContext)
  const height = useThree(s => s.size.height)
  const mesh = useMemo(() => {
    const particle = new Mesh(new PlaneGeometry(2, 2), createParticleMaterial())
    particle.name = 'Particle'
    particle.frustumCulled = false
    configureParticlePicking(particle)
    return particle
  }, [])
  useEffect(() => () => {
    mesh.geometry.dispose()
    mesh.material.dispose()
  }, [mesh])
  useInstrumentFrame(trackId, state => {
    mesh.material.uniforms.uMinRadiusNdc.value = preview ? 8 / height : 0
    mesh.material.uniforms.uColor.value.set(state.stringParams.color ?? PARTICLE_COLOR)
    mesh.material.uniforms.uGlow.value = state.params.glow ?? PARTICLE_GLOW
  })
  return <primitive object={mesh} />
}

function createParticlePool(capacity: number) {
  const geometry = new PlaneGeometry(2, 2)
  const colors = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage)
  geometry.setAttribute('particleColor', colors)
  const mesh = new InstancedMesh(geometry, createParticleMaterial(), capacity)
  mesh.name = 'Particle instances'
  mesh.count = 0
  mesh.frustumCulled = false
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  configureParticlePicking(mesh)
  return { mesh, colors, capacity }
}

function disposePool(pool: ReturnType<typeof createParticlePool>) {
  pool.mesh.geometry.dispose()
  pool.mesh.material.dispose()
  pool.mesh.dispose()
}

export function ParticleInstanced({ trackId }: { trackId: string }) {
  const preview = useContext(VisualEngineContext)
  const height = useThree(s => s.size.height)
  const root = useRef<Group>(null)
  const pool = useRef<ReturnType<typeof createParticlePool> | null>(null)
  const matrix = useMemo(() => new Matrix4(), [])
  const color = useMemo(() => new Color(), [])

  useEffect(() => {
    const group = root.current
    return () => {
      if (pool.current) {
        group?.remove(pool.current.mesh)
        disposePool(pool.current)
      }
      pool.current = null
    }
  }, [])

  useInstancedCopyFrame(trackId, frame => {
    if (!root.current) return
    const count = Math.max(1, frame.copies.length)
    if (!pool.current || pool.current.capacity < count) {
      if (pool.current) {
        root.current.remove(pool.current.mesh)
        disposePool(pool.current)
      }
      pool.current = createParticlePool(2 ** Math.ceil(Math.log2(count)))
      root.current.add(pool.current.mesh)
    }
    const { mesh, colors } = pool.current
    mesh.material.uniforms.uMinRadiusNdc.value = preview ? 8 / height : 0
    const baseColor = frame.state.stringParams.color ?? PARTICLE_COLOR
    mesh.material.uniforms.uGlow.value = frame.state.params.glow ?? PARTICLE_GLOW
    // copyFade inlined: this loop runs over every slot of the pool (tens of
    // thousands on a dense cloud), and a call per slot was its biggest cost.
    // Same product, same blacked-out rule as InstancedCopyFrame.copyFade.
    const { state, copies } = frame
    const objectOpacity = state.blackedOut ? 0 : state.opacity
    let live = 0
    for (let i = 0; i < count; i++) {
      const fade = Math.min(1, objectOpacity * (copies[i]?.opacity ?? 1))
      if (fade <= 0.001) continue
      frame.composeCopyMatrix(i, matrix)
      mesh.setMatrixAt(live, matrix)
      frame.copyColor(i, baseColor, color)
      colors.setXYZW(live++, color.r, color.g, color.b, fade)
    }
    mesh.count = live
    mesh.visible = live > 0
    mesh.instanceMatrix.needsUpdate = true
    colors.needsUpdate = true
  })
  return <group ref={root} />
}
