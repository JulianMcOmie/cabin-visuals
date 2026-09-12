import type { ResolvedNote } from '../core/visual/types'

export const STREAM_MAX_COUNT = 16
export const STREAM_MAX_DENSITY = 48
export const STREAM_MAX_NOTE_PACKETS = 128
export const STREAM_CAPACITY = STREAM_MAX_COUNT * (STREAM_MAX_DENSITY + STREAM_MAX_NOTE_PACKETS + 2)
export const STREAM_LIFETIME_BEATS = 8
export const STREAM_FAR_Z = -24
export const STREAM_NEAR_Z = 16
// Solve 0.8t + 0.2t² = 0.5: every particle crosses z = -4 at this age.
export const STREAM_CROSS_AGE = (Math.sqrt(1.04) - 0.8) / 0.4
export const STREAM_PATTERNS = [
  { value: 0, label: 'Open' },
  { value: 1, label: 'Center' },
  { value: 2, label: 'Pairs' },
  { value: 3, label: 'Left' },
  { value: 4, label: 'Right' },
]
export const STREAM_MIDI_ROWS = [
  { pitch: 60, label: 'Meet · center', emphasized: true },
  { pitch: 61, label: 'Meet · adjacent pairs' },
  { pitch: 62, label: 'Meet · left' },
  { pitch: 63, label: 'Meet · right' },
  { pitch: 64, label: 'Open · separate streams' },
]
const NOTE_PATTERNS = [1, 2, 3, 4, 0]
const TAU = Math.PI * 2
const clamp = (x: number, low: number, high: number) => Math.max(low, Math.min(high, x))
const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t) }
export const streamCount = (value: number) => Math.round(clamp(Number.isFinite(value) ? value : 6, 1, STREAM_MAX_COUNT))

export interface StreamPoint { x: number; y: number; z: number; fade: number }
export interface StreamPathSettings { count: number; twist: number; spread: number; meetX: number; meetY: number }
export interface StreamPacket { crossingBeat: number; pattern: number }

/** A smooth fly-through with strictly positive forward velocity and constant
 * forward acceleration. Rotation bends the transverse path without ever stopping
 * at the meeting point. For pairs, reflecting across their midpoint swaps the two
 * streams; an unpaired last stream crosses the center. */
export function streamTrajectory(out: StreamPoint, stream: number, age: number, pattern: number, settings: StreamPathSettings): StreamPoint {
  const t = clamp(age, 0, 1)
  const u = 0.8 * t + 0.2 * t * t
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
  out.z = STREAM_FAR_Z + (STREAM_NEAR_Z - STREAM_FAR_Z) * u
  out.fade = smooth(t / 0.08) * smooth((1 - t) / 0.055)
  return out
}

/** Every note schedules a synchronized packet at its exact onset and latches the
 * pattern for following packets. Plan from the whole note stream: incoming dots
 * anticipate the note, and existing packets never retarget mid-flight. Chords
 * choose the highest supported pitch; unsupported notes are inert. */
export function streamNoteEvents(notes: readonly ResolvedNote[]): StreamPacket[] {
  const events = new Map<number, number>()
  for (const note of notes) {
    if (!Number.isInteger(note.pitch) || note.pitch < 60 || note.pitch > 64 || !Number.isFinite(note.beat)) continue
    events.set(note.beat, Math.max(note.pitch, events.get(note.beat) ?? 60))
  }
  return [...events].sort((a, b) => a[0] - b[0]).map(([crossingBeat, pitch]) => ({ crossingBeat, pattern: NOTE_PATTERNS[pitch - 60] }))
}

/** The continuous background cadence plus exact-time MIDI packets. A nearby
 * cadence packet yields to a note so a grid-aligned note does not double the dots.
 * The density control is dots per stream in flight, not number of trajectories.
 * The cap only affects pathological rolls (>128 note packets within one flight). */
export function streamPacketsAtBeat(events: readonly StreamPacket[], beat: number, speed: number, density: number, defaultPattern: number): { packets: StreamPacket[]; lifetime: number } {
  const lifetime = STREAM_LIFETIME_BEATS / clamp(speed, 0.1, 4)
  const spacing = lifetime / Math.round(clamp(density, 2, STREAM_MAX_DENSITY))
  const min = beat - lifetime * (1 - STREAM_CROSS_AGE)
  const max = beat + lifetime * STREAM_CROSS_AGE
  const packets: StreamPacket[] = []
  let eventIndex = 0, pattern = defaultPattern
  for (let grid = Math.ceil(min / spacing); grid * spacing <= max; grid++) {
    const crossingBeat = grid * spacing
    while (eventIndex < events.length && events[eventIndex].crossingBeat <= crossingBeat) pattern = events[eventIndex++].pattern
    const prev = events[eventIndex - 1], next = events[eventIndex]
    if ((prev && crossingBeat - prev.crossingBeat < spacing * 0.4) || (next && next.crossingBeat - crossingBeat < spacing * 0.4)) continue
    packets.push({ crossingBeat, pattern })
  }
  let added = 0
  for (const event of events) {
    if (event.crossingBeat < min) continue
    if (event.crossingBeat > max) break
    if (added++ >= STREAM_MAX_NOTE_PACKETS) break
    packets.push(event)
  }
  return { packets, lifetime }
}

export function streamPacketAge(beat: number, crossingBeat: number, lifetime: number): number {
  return STREAM_CROSS_AGE + (beat - crossingBeat) / lifetime
}
