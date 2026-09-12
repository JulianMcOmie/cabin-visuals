import { useEffect, useMemo, useRef } from 'react'
import { Color, Matrix4 } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { paramDefault, stringParamDefault } from './types'
import { particleStreamInstrument } from './ParticleStream'
import { createParticlePool, disposeParticlePool } from './particleCore'
import { STREAM_CAPACITY, streamCount, streamDensity, streamNoteEvents, streamPatternWeights, buildStreamPaths, sampleStreamPath, streamParticleFraction } from './particleStreamCore'

export function ParticleStreamVisual({ trackId }: { trackId: string }) {
  const pool = useMemo(() => {
    const batch = createParticlePool(STREAM_CAPACITY, true)
    batch.mesh.name = 'Particle Stream'
    return batch
  }, [])
  const scratch = useMemo(() => ({ matrix: new Matrix4(), color: new Color(), point: { x: 0, y: 0, z: 0, fade: 0 } }), [])
  const noteCache = useRef<{ notes: unknown; events: ReturnType<typeof streamNoteEvents> }>({ notes: null, events: [] })
  const pathCache = useRef<{ key: string; paths: ReturnType<typeof buildStreamPaths> }>({ key: '', paths: [] })
  useEffect(() => () => disposeParticlePool(pool), [pool])

  useInstrumentFrame(trackId, state => {
    const value = (key: string) => state.params[key] ?? Number(paramDefault(particleStreamInstrument, key))
    const count = streamCount(value('count'))
    const twist = value('twist'), speed = value('speed'), spread = value('spread'), size = value('size')
    const settings = { count, twist, spread, meetX: value('meetX'), meetY: value('meetY') }
    if (noteCache.current.notes !== state.notes) noteCache.current = { notes: state.notes, events: streamNoteEvents(state.notes) }
    const events = noteCache.current.events
    const density = streamDensity(value('density'))
    const weights = streamPatternWeights(events, state.beat, value('pattern'))
    const pathKey = [count, twist, spread, settings.meetX, settings.meetY, ...weights].join(',')
    if (pathCache.current.key !== pathKey) pathCache.current = { key: pathKey, paths: buildStreamPaths(settings, weights) }
    const { mesh, colors } = pool
    const { matrix, color, point } = scratch
    color.set(state.stringParams.color ?? stringParamDefault(particleStreamInstrument, 'color'))
    mesh.material.uniforms.uGlow.value = value('glow')
    matrix.makeScale(size, size, size)
    for (let stream = 0; stream < count; stream++) {
      const path = pathCache.current.paths[stream]
      for (let dot = 0; dot < density; dot++) {
        const fraction = streamParticleFraction(dot, density, state.beat, speed)
        sampleStreamPath(point, path, fraction)
        matrix.setPosition(point.x, point.y, point.z)
        const index = stream * density + dot
        mesh.setMatrixAt(index, matrix)
        colors.setXYZW(index, color.r, color.g, color.b, point.fade)
      }
    }
    mesh.count = count * density
    mesh.instanceMatrix.needsUpdate = true
    colors.needsUpdate = true
  })
  return <primitive object={pool.mesh} />
}
