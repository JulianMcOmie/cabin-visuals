import { useEffect, useMemo, useRef } from 'react'
import { Color, Matrix4 } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { paramDefault, stringParamDefault } from './types'
import { particleStreamInstrument } from './ParticleStream'
import { createParticlePool, disposeParticlePool } from './particleCore'
import { STREAM_CAPACITY, streamCount, streamDensity, streamNoteEvents, streamPatternWeights, buildStreamPaths, sampleStreamJourney, streamParticleJourney, buildStreamTiming } from './particleStreamCore'

export function ParticleStreamVisual({ trackId }: { trackId: string }) {
  const pool = useMemo(() => {
    const batch = createParticlePool(STREAM_CAPACITY, true)
    batch.mesh.name = 'Particle Stream'
    return batch
  }, [])
  const scratch = useMemo(() => ({ matrix: new Matrix4(), color: new Color(), point: { x: 0, y: 0, z: 0, fade: 0 } }), [])
  const noteCache = useRef<{ notes: unknown; events: ReturnType<typeof streamNoteEvents> }>({ notes: null, events: [] })
  const timingCache = useRef<{ events: unknown; key: string; timing: ReturnType<typeof buildStreamTiming> } | null>(null)
  const pathCache = useRef<{ key: string; layouts: Map<string, ReturnType<typeof buildStreamPaths>> }>({ key: '', layouts: new Map() })
  useEffect(() => () => disposeParticlePool(pool), [pool])

  useInstrumentFrame(trackId, state => {
    const value = (key: string) => state.params[key] ?? Number(paramDefault(particleStreamInstrument, key))
    const count = streamCount(value('count'))
    const twist = value('twist'), speed = value('speed'), spread = value('spread'), size = value('size')
    const settings = { count, twist, spread, meetX: value('meetX'), meetY: value('meetY') }
    if (noteCache.current.notes !== state.notes) noteCache.current = { notes: state.notes, events: streamNoteEvents(state.notes) }
    const events = noteCache.current.events
    const density = streamDensity(value('density'))
    const timingKey = [density, speed].join(',')
    if (timingCache.current?.events !== events || timingCache.current.key !== timingKey) {
      timingCache.current = { events, key: timingKey, timing: buildStreamTiming(events, density, speed) }
    }
    const pathKey = [count, twist, spread, settings.meetX, settings.meetY].join(',')
    if (pathCache.current.key !== pathKey) pathCache.current = { key: pathKey, layouts: new Map() }
    // Look ahead to each slot's planned intersection, not its entry beat.
    // Retain only current layouts; the cache never determines the choreography.
    const layouts = new Map<string, ReturnType<typeof buildStreamPaths>>()
    const journeys = Array.from({ length: density }, (_, dot) => {
      const journey = streamParticleJourney(dot, density, state.beat, speed, timingCache.current!.timing)
      const weights = streamPatternWeights(events, journey.crossBeat, value('pattern'))
      const key = weights.join(',')
      const paths = layouts.get(key) ?? pathCache.current.layouts.get(key) ?? buildStreamPaths(settings, weights)
      layouts.set(key, paths)
      return { fraction: journey.fraction, paths }
    })
    pathCache.current.layouts = layouts
    const { mesh, colors } = pool
    const { matrix, color, point } = scratch
    color.set(state.stringParams.color ?? stringParamDefault(particleStreamInstrument, 'color'))
    mesh.material.uniforms.uGlow.value = value('glow')
    matrix.makeScale(size, size, size)
    for (let stream = 0; stream < count; stream++) {
      for (let dot = 0; dot < density; dot++) {
        const { fraction, paths } = journeys[dot]
        sampleStreamJourney(point, paths[stream], fraction)
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
