import { useContext, useEffect, useMemo, useRef } from 'react'
import { Color, Group, Matrix4, Mesh, PlaneGeometry, Vector2 } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { useInstancedCopyFrame } from '../core/visual/instancedFrame'
import { createParticlePlanMesh } from './particlePlanRenderer'
import { matrixScaleBound, type ParticlePlan } from '../core/visualCopies/particlePlan'
import { VisualEngineContext, useVisualEngine } from '../core/visual/VisualEngineContext'
import { useThree } from '@react-three/fiber'
import { PARTICLE_COLOR, PARTICLE_GLOW } from './Particle'
import { configureParticlePicking, createParticleMaterial, createParticlePool, disposeParticlePool } from './particleCore'

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

export function ParticleInstanced({ trackId }: { trackId: string }) {
  const engine = useVisualEngine()
  return engine.getParticlePlan(trackId) ? <ParticleProcedural trackId={trackId} /> : <ParticleCpuInstances trackId={trackId} />
}

function ParticleProcedural({ trackId }: { trackId: string }) {
  const engine = useVisualEngine()
  const preview = useContext(VisualEngineContext)
  const height = useThree(s => s.size.height)
  const renderer = useThree(s => s.gl)
  const camera = useThree(s => s.camera)
  const maxPointSize = useMemo(() => {
    const gl = renderer.getContext()
    return (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array)[1]
  }, [renderer])
  const placement = useMemo(() => new Matrix4(), [])
  const viewport = useMemo(() => new Vector2(), [])
  const root = useRef<Group>(null)
  const pool = useRef<ReturnType<typeof createParticlePlanMesh> | null>(null)
  const renderedPlan = useRef<ParticlePlan | null>(null)
  useEffect(() => {
    const group = root.current
    return () => {
      if (pool.current) { group?.remove(pool.current.mesh); pool.current.dispose() }
      pool.current = null
    }
  }, [])
  useInstancedCopyFrame(trackId, frame => {
    const plan = engine.getParticlePlan(trackId)
    if (!root.current || !plan) return
    frame.composePlacement(placement)
    const physicalHeight = renderer.getDrawingBufferSize(viewport).y
    const near = 'near' in camera ? Number(camera.near) : .1
    const divisor = camera.projectionMatrix.elements[11] === 0 ? 1 : Math.max(near, .00001)
    const sizeBound = plan.scaleBound * matrixScaleBound(placement) * Math.abs(frame.state.meshScale)
      * Math.abs(camera.projectionMatrix.elements[5]) * physicalHeight / divisor
    const points = sizeBound <= maxPointSize
    if (pool.current && pool.current.points !== points) {
      root.current.remove(pool.current.mesh); pool.current.dispose(); pool.current = null
    }
    if (!pool.current) {
      pool.current = createParticlePlanMesh(plan, points)
      root.current.add(pool.current.mesh)
      renderedPlan.current = plan
    } else if (renderedPlan.current !== plan) {
      pool.current.update(plan)
      renderedPlan.current = plan
    }
    const mesh = pool.current.mesh, uniforms = mesh.material.uniforms
    // composeCopyMatrix includes meshScale last; the shader needs it AFTER
    // the factored layouts instead. Request the common unscaled prefix.
    uniforms.uPlacement.value.copy(placement)
    uniforms.uViewportHeight.value = physicalHeight
    uniforms.uMeshScale.value = frame.state.meshScale
    uniforms.uColor.value.set(frame.state.stringParams.color ?? PARTICLE_COLOR)
    // Clamp after the per-slot fade, as the CPU instance path does. An object
    // opacity above one must still brighten a partially faded trail slot.
    uniforms.uOpacity.value = frame.state.blackedOut ? 0 : frame.state.opacity
    uniforms.uGlow.value = frame.state.params.glow ?? PARTICLE_GLOW
    // Keep the cloud's density in thumbnails; enlarging every particle to
    // eight pixels would turn a million-point cloud into solid overdraw.
    uniforms.uMinRadiusNdc.value = preview ? 8 / height / Math.sqrt(plan.count) : 0
    mesh.visible = uniforms.uOpacity.value > 0.001
  })
  return <group ref={root} />
}

function ParticleCpuInstances({ trackId }: { trackId: string }) {
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
        disposeParticlePool(pool.current)
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
        disposeParticlePool(pool.current)
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
    // The pool retains peak capacity, but hidden slots are not drawn. Upload
    // only the freshly packed live prefix, including after a shrink or seek.
    mesh.instanceMatrix.clearUpdateRanges()
    colors.clearUpdateRanges()
    if (live > 0) {
      mesh.instanceMatrix.addUpdateRange(0, live * 16)
      colors.addUpdateRange(0, live * 4)
      mesh.instanceMatrix.needsUpdate = true
      colors.needsUpdate = true
    }
  })
  return <group ref={root} />
}
