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

/** Notes steer incoming particles, never add particles. Highest supported
 * pitch wins a chord; unsupported notes do not interrupt a transition. */
export function streamNoteEvents(notes: readonly ResolvedNote[]): StreamPatternEvent[] {
  const events = new Map<number, number>()
  for (const note of notes) {
    if (!Number.isInteger(note.pitch) || note.pitch < 60 || note.pitch > 64 || !Number.isFinite(note.beat)) continue
    events.set(note.beat, Math.max(note.pitch, events.get(note.beat) ?? 60))
  }
  return [...events].sort((a, b) => a[0] - b[0]).map(([beat, pitch]) => ({ beat, pattern: NOTE_PATTERNS[pitch - 60] }))
}

/** Sample this signal at a particle's birth beat to keep its route for the
 * entire journey. Smooth the pattern's step signal with a quintic transition. Summed step
 * differences remain a convex blend even in a rapid roll. Both velocity and
 * acceleration are continuous when another note arrives during a transition. */
export function streamPatternWeights(events: readonly StreamPatternEvent[], beat: number, defaultPattern: number): number[] {
  const weights = [0, 0, 0, 0, 0]
  let previous = Math.round(clamp(defaultPattern, 0, 4))
  weights[previous] = 1
  for (const event of events) {
    if (event.beat > beat) break
    const t = clamp((beat - event.beat) / STREAM_MORPH_BEATS, 0, 1)
    const mix = t * t * t * (10 + t * (-15 + t * 6))
    weights[previous] -= mix
    weights[event.pattern] += mix
    previous = event.pattern
  }
  return weights
}

export interface StreamPath {
  positions: Float64Array
  distances: Float64Array
  tangents: Float64Array
  length: number
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
    return { positions, distances, tangents, length: distances[PATH_STEPS] }
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

/** A permanent ring of slots moving at uniform arc-length speed. Recycling is
 * hidden at the ends of the field. MIDI cannot change slot count or spacing. */
export function streamParticleJourney(index: number, density: number, beat: number, speed: number): { fraction: number; birthBeat: number } {
  const duration = STREAM_LIFETIME_BEATS / clamp(speed, 0.1, 4)
  const offset = index / streamDensity(density)
  const phase = offset + beat / duration
  const cycle = Math.floor(phase)
  // Derive birth from the cycle, not beat minus age: it stays bit-identical
  // between frames and reproduces the same route after a direct/backward seek.
  return { fraction: phase - cycle, birthBeat: (cycle - offset) * duration }
}

export function streamParticleFraction(index: number, density: number, beat: number, speed: number): number {
  return streamParticleJourney(index, density, beat, speed).fraction
}
