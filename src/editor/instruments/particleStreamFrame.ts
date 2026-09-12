import type { ObjectState } from '../core/visual/types'
import { paramDefault } from './types'
import { particleStreamInstrument } from './ParticleStream'
import { STREAM_CAPACITY, streamCount, streamDensity, streamNoteEvents, streamPatternWeights, buildStreamPaths, sampleStreamJourney, streamParticleJourney, buildStreamTiming } from './particleStreamCore'

/** One bounded field of local positions/fades. Copy placement and color are
 * intentionally absent: a splitter reuses the same choreography, not N caches.
 * Returned storage is reused; consumers upload/copy it before the next sample. */
export function createParticleStreamSampler() {
  let noteCache: { notes: unknown; events: ReturnType<typeof streamNoteEvents> } = { notes: null, events: [] }
  let timingCache: { events: unknown; key: string; timing: ReturnType<typeof buildStreamTiming> } | null = null
  let pathCache: { key: string; layouts: Map<string, ReturnType<typeof buildStreamPaths>> } = { key: '', layouts: new Map() }
  const positions = new Float32Array(STREAM_CAPACITY * 4)
  const point = { x: 0, y: 0, z: 0, fade: 0 }
  const frame = { positions, count: 0 }
  return (state: Pick<ObjectState, 'params' | 'notes' | 'beat'>) => {
    const value = (key: string) => state.params[key] ?? Number(paramDefault(particleStreamInstrument, key))
    const count = streamCount(value('count'))
    const twist = value('twist'), speed = value('speed'), spread = value('spread')
    const settings = { count, twist, spread, meetX: value('meetX'), meetY: value('meetY') }
    if (noteCache.notes !== state.notes) noteCache = { notes: state.notes, events: streamNoteEvents(state.notes) }
    const events = noteCache.events
    const density = streamDensity(value('density'))
    const timingKey = [density, speed].join(',')
    if (timingCache?.events !== events || timingCache.key !== timingKey) {
      timingCache = { events, key: timingKey, timing: buildStreamTiming(events, density, speed) }
    }
    const pathKey = [count, twist, spread, settings.meetX, settings.meetY].join(',')
    if (pathCache.key !== pathKey) pathCache = { key: pathKey, layouts: new Map() }
    // Look ahead to each slot's planned intersection, not its entry beat.
    // Retain only current layouts; the cache never determines the choreography.
    const layouts = new Map<string, ReturnType<typeof buildStreamPaths>>()
    const journeys = Array.from({ length: density }, (_, dot) => {
      const journey = streamParticleJourney(dot, density, state.beat, speed, timingCache!.timing)
      const weights = streamPatternWeights(events, journey.crossBeat, value('pattern'))
      const key = weights.join(',')
      const paths = layouts.get(key) ?? pathCache.layouts.get(key) ?? buildStreamPaths(settings, weights)
      layouts.set(key, paths)
      return { fraction: journey.fraction, paths }
    })
    pathCache.layouts = layouts
    for (let stream = 0; stream < count; stream++) {
      for (let dot = 0; dot < density; dot++) {
        const { fraction, paths } = journeys[dot]
        sampleStreamJourney(point, paths[stream], fraction)
        const index = (stream * density + dot) * 4
        positions[index] = point.x
        positions[index + 1] = point.y
        positions[index + 2] = point.z
        positions[index + 3] = point.fade
      }
    }
    frame.count = count * density
    return frame
  }
}

/** Chain thumbnails resolve their own ObjectStates, even when they show the
 * same local stream. Share the field by the inputs that actually shape it;
 * note-array identity, copy colors, fades and world matrices are irrelevant.
 * A small LRU bounds retained path tables during continuous geometry edits.
 * As with the uncached sampler, callers must consume the returned buffer now. */
export function createSharedParticleStreamSampler(limit = 8) {
  type Input = Pick<ObjectState, 'params' | 'notes' | 'beat'>
  const noteKeys = new WeakMap<Input['notes'], string>()
  const cache = new Map<string, { sample: ReturnType<typeof createParticleStreamSampler>; notes: Input['notes']; beat: number; frame?: ReturnType<ReturnType<typeof createParticleStreamSampler>> }>()
  const keys = ['count', 'density', 'speed', 'twist', 'spread', 'meetX', 'meetY', 'pattern']
  return (state: Input) => {
    let notesKey = noteKeys.get(state.notes)
    if (notesKey === undefined) {
      notesKey = JSON.stringify(streamNoteEvents(state.notes))
      noteKeys.set(state.notes, notesKey)
    }
    const key = notesKey + ':' + keys.map(key => state.params[key] ?? Number(paramDefault(particleStreamInstrument, key))).join(',')
    let entry = cache.get(key)
    if (!entry) entry = { sample: createParticleStreamSampler(), notes: state.notes, beat: NaN }
    cache.delete(key); cache.set(key, entry)
    while (cache.size > Math.max(1, limit)) cache.delete(cache.keys().next().value!)
    if (!entry.frame || entry.beat !== state.beat) {
      entry.frame = entry.sample({ params: state.params, notes: entry.notes, beat: state.beat })
      entry.beat = state.beat
    }
    return entry.frame
  }
}

export const sampleParticleStream = createSharedParticleStreamSampler()
