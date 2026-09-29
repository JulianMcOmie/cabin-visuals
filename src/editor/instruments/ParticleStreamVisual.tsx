import { useEffect, useMemo } from 'react'
import { Color, Matrix4 } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { paramDefault, stringParamDefault } from './types'
import { particleStreamInstrument } from './ParticleStream'
import { createParticlePool, disposeParticlePool } from './particleCore'
import { STREAM_CAPACITY } from './particleStreamCore'
import { sampleParticleStream } from './particleStreamFrame'

export function ParticleStreamVisual({ trackId }: { trackId: string }) {
  const pool = useMemo(() => {
    const batch = createParticlePool(STREAM_CAPACITY, true)
    batch.mesh.name = 'Particle Stream'
    return batch
  }, [])
  const scratch = useMemo(() => ({ matrix: new Matrix4(), color: new Color() }), [])
  useEffect(() => () => disposeParticlePool(pool), [pool])

  useInstrumentFrame(trackId, state => {
    const value = (key: string) => state.params[key] ?? Number(paramDefault(particleStreamInstrument, key))
    const { positions, count } = sampleParticleStream(state)
    const { mesh, colors } = pool
    const { matrix, color } = scratch
    color.set(state.stringParams.color ?? stringParamDefault(particleStreamInstrument, 'color'))
    mesh.material.uniforms.uGlow.value = value('glow')
    const size = value('size')
    matrix.makeScale(size, size, size)
    for (let i = 0; i < count; i++) {
      const p = i * 4
      matrix.setPosition(positions[p], positions[p + 1], positions[p + 2])
      mesh.setMatrixAt(i, matrix)
      colors.setXYZW(i, color.r, color.g, color.b, positions[p + 3])
    }
    mesh.count = count
    mesh.instanceMatrix.clearUpdateRanges()
    mesh.instanceMatrix.addUpdateRange(0, count * 16)
    colors.clearUpdateRanges()
    colors.addUpdateRange(0, count * 4)
    mesh.instanceMatrix.needsUpdate = true
    colors.needsUpdate = true
  })
  return <primitive object={pool.mesh} />
}
