import type { ResolvedNote } from '../core/visual/types'

export const STREAM_MAX_COUNT = 16
export const STREAM_MAX_DENSITY = 48
export const STREAM_CAPACITY = STREAM_MAX_COUNT * STREAM_MAX_DENSITY
export const STREAM_LIFETIME_BEATS = 8
export const STREAM_FAR_Z = -24
export const STREAM_NEAR_Z = 16
export const STREAM_CROSS_AGE = 0.5
export const STREAM_MORPH_BEATS = 1
const PATH_STEPS = 192
export const STREAM_PATTERNS = [
  { value: 0, label: 'Open' },
  { value: 1, label: 'Center' },
  { value: 2, label: 'Pairs' },
  { value: 3, label: 'Left' },
  { value: 4, label: 'Right' },
]
export const STREAM_MIDI_ROWS = [
  { pitch: 60, label: 'Path · center', emphasized: true },
  { pitch: 61, label: 'Path · adjacent pairs' },
  { pitch: 62, label: 'Path · left' },
  { pitch: 63, label: 'Path · right' },
  { pitch: 64, label: 'Path · separate streams' },
]
const NOTE_PATTERNS = [1, 2, 3, 4, 0]
const TAU = Math.PI * 2
const clamp = (x: number, low: number, high: number) => Math.max(low, Math.min(high, x))
const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t) }
export const streamCount = (value: number) => Math.round(clamp(Number.isFinite(value) ? value : 6, 1, STREAM_MAX_COUNT))

export interface StreamPoint { x: number; y: number; z: number; fade: number }
export interface StreamPathSettings { count: number; twist: number; spread: number; meetX: number; meetY: number }
export interface StreamPatternEvent { beat: number; pattern: number }
export const streamDensity = (value: number) => Math.round(clamp(Number.isFinite(value) ? value : 16, 2, STREAM_MAX_DENSITY))

/** The geometric path runs from behind the default camera into the distance.
 * Arc-length sampling below sets the travel speed, so curved portions do not
 * bunch the dots or slow them to a stop at a crossing. */
export function streamTrajectory(out: StreamPoint, stream: number, age: number, pattern: number, settings: StreamPathSettings): StreamPoint {
  const t = clamp(age, 0, 1)
  const u = t
  const count = streamCount(settings.count)
  const angle = stream / count * TAU + Math.PI / 2
  const sx = Math.cos(angle) * settings.spread
  const sy = Math.sin(angle) * settings.spread
  let tx = settings.meetX, ty = settings.meetY
  if (pattern === 2 && !(count % 2 && stream === count - 1)) {
    const partner = stream % 2 ? stream - 1 : stream + 1
    const partnerAngle = partner / count * TAU + Math.PI / 2
    tx += (sx + Math.cos(partnerAngle) * settings.spread) * 0.5
    ty += (sy + Math.sin(partnerAngle) * settings.spread) * 0.5
  }
  if (pattern === 3) tx -= settings.spread * 0.55
  if (pattern === 4) tx += settings.spread * 0.55
  const dx = pattern === 0 ? sx : sx + settings.meetX - tx
  const dy = pattern === 0 ? sy : sy + settings.meetY - ty
  const turn = settings.twist * TAU * (smooth(u) - 0.5)
  const scale = pattern === 0 ? 1 : 1 - 2 * u
  out.x = tx + scale * (dx * Math.cos(turn) - dy * Math.sin(turn))
  out.y = ty + scale * (dx * Math.sin(turn) + dy * Math.cos(turn))
  out.z = STREAM_NEAR_Z + (STREAM_FAR_Z - STREAM_NEAR_Z) * u
  out.fade = smooth(t / 0.08) * smooth((1 - t) / 0.055)
  return out
}

/** Notes specify intersection times, never add particles. Highest supported
 * pitch wins a chord; unsupported notes do not interrupt a transition. */
export function streamNoteEvents(notes: readonly ResolvedNote[]): StreamPatternEvent[] {
  const events = new Map<number, number>()
  for (const note of notes) {
    if (!Number.isInteger(note.pitch) || note.pitch < 60 || note.pitch > 64 || !Number.isFinite(note.beat)) continue
    events.set(note.beat, Math.max(note.pitch, events.get(note.beat) ?? 60))
  }
  return [...events].sort((a, b) => a[0] - b[0]).map(([beat, pitch]) => ({ beat, pattern: NOTE_PATTERNS[pitch - 60] }))
}

/** Choose a whole route by its planned intersection beat, including future
 * notes. Transitions END on the next note and shorten to fit rapid sequences;
 * a note's own arrival always gets its exact pattern, never a delayed blend. */
export function streamPatternWeights(events: readonly StreamPatternEvent[], beat: number, defaultPattern: number): number[] {
  const weights = [0, 0, 0, 0, 0]
  let previous = Math.round(clamp(defaultPattern, 0, 4))
  let previousBeat = -Infinity
  for (const event of events) {
    if (event.beat > beat) {
      const start = Math.max(previousBeat, event.beat - STREAM_MORPH_BEATS)
      const t = clamp((beat - start) / (event.beat - start), 0, 1)
      const mix = t * t * t * (10 + t * (-15 + t * 6))
      weights[previous] = 1 - mix
      weights[event.pattern] += mix
      return weights
    }
    previous = event.pattern
    previousBeat = event.beat
  }
  weights[previous] = 1
  return weights
}

export interface StreamPath {
  positions: Float64Array
  distances: Float64Array
  tangents: Float64Array
  length: number
  crossingFraction: number
}

/** Cacheable arc-length tables for the current paths. Three coordinates share
 * one distance parameter; shape-preserving cubic tangents make lookup C1 instead
 * of introducing velocity kinks at every table sample. */
export function buildStreamPaths(settings: StreamPathSettings, weights: readonly number[]): StreamPath[] {
  const scratch = { x: 0, y: 0, z: 0, fade: 0 }
  return Array.from({ length: streamCount(settings.count) }, (_, stream) => {
    const positions = new Float64Array((PATH_STEPS + 1) * 3)
    const distances = new Float64Array(PATH_STEPS + 1)
    const tangents = new Float64Array(positions.length)
    for (let i = 0; i <= PATH_STEPS; i++) {
      for (let pattern = 0; pattern < weights.length; pattern++) {
        if (weights[pattern] === 0) continue
        streamTrajectory(scratch, stream, i / PATH_STEPS, pattern, settings)
        positions[i * 3] += scratch.x * weights[pattern]
        positions[i * 3 + 1] += scratch.y * weights[pattern]
        positions[i * 3 + 2] += scratch.z * weights[pattern]
      }
      if (i > 0) distances[i] = distances[i - 1] + Math.hypot(
        positions[i * 3] - positions[(i - 1) * 3],
        positions[i * 3 + 1] - positions[(i - 1) * 3 + 1],
        positions[i * 3 + 2] - positions[(i - 1) * 3 + 2],
      )
    }
    for (let i = 0; i <= PATH_STEPS; i++) for (let axis = 0; axis < 3; axis++) {
      const left = Math.max(0, i - 1), right = Math.min(PATH_STEPS, i + 1)
      const before = distances[i] - distances[left], after = distances[right] - distances[i]
      const dl = before ? (positions[i * 3 + axis] - positions[left * 3 + axis]) / before : 0
      const dr = after ? (positions[right * 3 + axis] - positions[i * 3 + axis]) / after : 0
      let slope = i === 0 ? dr : i === PATH_STEPS ? dl : 0
      if (i > 0 && i < PATH_STEPS && dl * dr > 0) {
        const w1 = 2 * after + before, w2 = after + 2 * before
        slope = (w1 + w2) / (w1 / dl + w2 / dr)
      }
      tangents[i * 3 + axis] = slope
    }
    return { positions, distances, tangents, length: distances[PATH_STEPS], crossingFraction: distances[PATH_STEPS / 2] / distances[PATH_STEPS] }
  })
}

export function sampleStreamPath(out: StreamPoint, path: StreamPath, fraction: number): StreamPoint {
  const t = clamp(fraction, 0, 1), distance = t * path.length
  let low = 0, high = PATH_STEPS
  while (high - low > 1) {
    const mid = (low + high) >>> 1
    if (path.distances[mid] <= distance) low = mid
    else high = mid
  }
  const span = path.distances[high] - path.distances[low]
  const u = span > 0 ? (distance - path.distances[low]) / span : 0
  const u2 = u * u, u3 = u2 * u
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u
  const h01 = -2 * u3 + 3 * u2, h11 = u3 - u2
  for (let axis = 0; axis < 3; axis++) {
    const value = h00 * path.positions[low * 3 + axis] + h10 * span * path.tangents[low * 3 + axis]
      + h01 * path.positions[high * 3 + axis] + h11 * span * path.tangents[high * 3 + axis]
    if (axis === 0) out.x = value
    else if (axis === 1) out.y = value
    else out.z = value
  }
  out.fade = smooth(t / 0.04) * smooth((1 - t) / 0.04)
  return out
}

/** Arc-length motion with the geometric intersection anchored at half-flight.
 * Blends involving Open are asymmetric: half the distance is not their meeting
 * plane. A monotone C1 remap pins that plane without a speed kink at arrival. */
export function sampleStreamJourney(out: StreamPoint, path: StreamPath, fraction: number): StreamPoint {
  const t = clamp(fraction, 0, 1), cross = path.crossingFraction
  const incoming = 2 * cross, outgoing = 2 * (1 - cross)
  const through = 2 * incoming * outgoing / (incoming + outgoing)
  const distance = t <= 0.5
    ? hermite(t * 2, 0, cross, incoming * 0.5, through * 0.5)
    : hermite((t - 0.5) * 2, cross, 1, through * 0.5, outgoing * 0.5)
  sampleStreamPath(out, path, distance)
  out.fade = smooth(t / 0.04) * smooth((1 - t) / 0.04)
  return out
}

function hermite(t: number, a: number, b: number, da: number, db: number): number {
  const t2 = t * t, t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + t) * da
    + (-2 * t3 + 3 * t2) * b + (t3 - t2) * db
}

export interface StreamTiming {
  beats: number[]
  phases: number[]
  slopes: number[]
  rate: number
}

/** Plan a monotone flow clock from the entire resolved score. Every MIDI beat
 * is an exact crossing of a successive cohort of existing slots. Sparse notes
 * leave room for ambient crossings; dense notes compress travel time instead
 * of allocating particles or dropping hits. Phase units are one dot spacing. */
export function buildStreamTiming(events: readonly StreamPatternEvent[], density: number, speed: number): StreamTiming {
  const count = streamDensity(density)
  const rate = count * clamp(speed, 0.1, 4) / STREAM_LIFETIME_BEATS
  const beats = events.map(event => event.beat)
  const phases: number[] = [], slopes: number[] = []
  for (let i = 0; i < beats.length; i++) {
    // Half-integer crossings for odd densities, integer crossings for even.
    phases.push(i === 0 ? Math.round(beats[i] * rate - count / 2) + count / 2
      : phases[i - 1] + Math.max(1, Math.round((beats[i] - beats[i - 1]) * rate)))
  }
  for (let i = 0; i < beats.length; i++) {
    if (i === 0 || i === beats.length - 1) { slopes.push(rate); continue }
    const before = beats[i] - beats[i - 1], after = beats[i + 1] - beats[i]
    const left = (phases[i] - phases[i - 1]) / before, right = (phases[i + 1] - phases[i]) / after
    const w1 = 2 * after + before, w2 = after + 2 * before
    slopes.push((w1 + w2) / (w1 / left + w2 / right))
  }
  return { beats, phases, slopes, rate }
}

function interval(values: readonly number[], value: number): number {
  let low = 0, high = values.length - 1
  while (high - low > 1) {
    const mid = (low + high) >>> 1
    if (values[mid] <= value) low = mid
    else high = mid
  }
  return low
}

function timingSegment(timing: StreamTiming, i: number, t: number): number {
  const span = timing.beats[i + 1] - timing.beats[i]
  return hermite(t, timing.phases[i], timing.phases[i + 1], timing.slopes[i] * span, timing.slopes[i + 1] * span)
}

export function streamFlowPhase(timing: StreamTiming, beat: number): number {
  const { beats, phases, rate } = timing, last = beats.length - 1
  if (last < 0) return beat * rate
  if (beat <= beats[0]) return phases[0] + (beat - beats[0]) * rate
  if (beat >= beats[last]) return phases[last] + (beat - beats[last]) * rate
  const i = interval(beats, beat)
  return timingSegment(timing, i, (beat - beats[i]) / (beats[i + 1] - beats[i]))
}

export function streamBeatAtPhase(timing: StreamTiming, phase: number): number {
  const { beats, phases, rate } = timing, last = beats.length - 1
  if (last < 0) return phase / rate
  if (phase <= phases[0]) return beats[0] + (phase - phases[0]) / rate
  if (phase >= phases[last]) return beats[last] + (phase - phases[last]) / rate
  const i = interval(phases, phase)
  if (phase === phases[i]) return beats[i]
  let low = 0, high = 1
  for (let step = 0; step < 44; step++) {
    const mid = (low + high) * 0.5
    if (timingSegment(timing, i, mid) < phase) low = mid
    else high = mid
  }
  return beats[i] + (low + high) * 0.5 * (beats[i + 1] - beats[i])
}

/** Permanent slots follow a score-planned clock. Their crossing beat identifies
 * their complete route; it remains stable throughout playback and seeking. */
export function streamParticleJourney(index: number, density: number, beat: number, speed: number, timing?: StreamTiming): { fraction: number; birthBeat: number; crossBeat: number } {
  const count = streamDensity(density)
  const rate = count * clamp(speed, 0.1, 4) / STREAM_LIFETIME_BEATS
  const phase = (index + (timing ? streamFlowPhase(timing, beat) : beat * rate)) / count
  const cycle = Math.floor(phase)
  const birth = cycle * count - index, cross = (cycle + 0.5) * count - index
  return { fraction: phase - cycle,
    birthBeat: timing ? streamBeatAtPhase(timing, birth) : birth / rate,
    crossBeat: timing ? streamBeatAtPhase(timing, cross) : cross / rate }
}

export function streamParticleFraction(index: number, density: number, beat: number, speed: number): number {
  return streamParticleJourney(index, density, beat, speed).fraction
}
