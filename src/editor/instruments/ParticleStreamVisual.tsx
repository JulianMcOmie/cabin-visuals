import { useEffect, useMemo, useRef } from 'react'
import { Color, Matrix4 } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { paramDefault, stringParamDefault } from './types'
import { particleStreamInstrument } from './ParticleStream'
import { createParticlePool, disposeParticlePool } from './particleCore'
import { STREAM_CAPACITY, streamCount, streamNoteEvents, streamPacketsAtBeat, streamPacketAge, streamTrajectory } from './particleStreamCore'

export function ParticleStreamVisual({ trackId }: { trackId: string }) {
  const pool = useMemo(() => {
    const batch = createParticlePool(STREAM_CAPACITY, true)
    batch.mesh.name = 'Particle Stream'
    return batch
  }, [])
  const scratch = useMemo(() => ({ matrix: new Matrix4(), color: new Color(), point: { x: 0, y: 0, z: 0, fade: 0 } }), [])
  const noteCache = useRef<{ notes: unknown; events: ReturnType<typeof streamNoteEvents> }>({ notes: null, events: [] })
  useEffect(() => () => disposeParticlePool(pool), [pool])

  useInstrumentFrame(trackId, state => {
    const value = (key: string) => state.params[key] ?? Number(paramDefault(particleStreamInstrument, key))
    const count = streamCount(value('count'))
    const twist = value('twist'), speed = value('speed'), spread = value('spread'), size = value('size')
    const settings = { count, twist, spread, meetX: value('meetX'), meetY: value('meetY') }
    if (noteCache.current.notes !== state.notes) noteCache.current = { notes: state.notes, events: streamNoteEvents(state.notes) }
    const events = noteCache.current.events
    const { packets, lifetime } = streamPacketsAtBeat(events, state.beat, speed, value('density'), value('pattern'))
    const { mesh, colors } = pool
    const { matrix, color, point } = scratch
    color.set(state.stringParams.color ?? stringParamDefault(particleStreamInstrument, 'color'))
    mesh.material.uniforms.uGlow.value = value('glow')
    matrix.makeScale(size, size, size)
    let live = 0
    for (const packet of packets) {
      const age = streamPacketAge(state.beat, packet.crossingBeat, lifetime)
      for (let stream = 0; stream < count; stream++) {
        streamTrajectory(point, stream, age, packet.pattern, settings)
        matrix.setPosition(point.x, point.y, point.z)
        mesh.setMatrixAt(live, matrix)
        colors.setXYZW(live++, color.r, color.g, color.b, point.fade)
      }
    }
    mesh.count = live
    mesh.instanceMatrix.needsUpdate = true
    colors.needsUpdate = true
  })
  return <primitive object={pool.mesh} />
}
