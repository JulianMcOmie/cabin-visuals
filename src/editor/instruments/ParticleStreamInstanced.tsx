import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { useInstancedCopyFrame } from '../core/visual/instancedFrame'
import { paramDefault, stringParamDefault } from './types'
import { particleStreamInstrument } from './ParticleStream'
import { STREAM_CAPACITY } from './particleStreamCore'
import { sampleParticleStream } from './particleStreamFrame'
import { createParticleFieldMesh } from './particleFieldRenderer'

export function ParticleStreamInstanced({ trackId }: { trackId: string }) {
  const maxTextureSize = useThree(s => s.gl.capabilities.maxTextureSize)
  const pool = useMemo(() => createParticleFieldMesh(STREAM_CAPACITY, maxTextureSize), [maxTextureSize])
  useEffect(() => () => pool.dispose(), [pool])
  useInstancedCopyFrame(trackId, frame => {
    const { state } = frame
    const value = (key: string) => state.params[key] ?? Number(paramDefault(particleStreamInstrument, key))
    pool.update(frame, sampleParticleStream(state), state.stringParams.color ?? stringParamDefault(particleStreamInstrument, 'color'), value('size'), value('glow'))
  })
  return <primitive object={pool.mesh} />
}
