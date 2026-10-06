import type { ResolvedNote } from '../core/visual/types'

// The pure half of Dust Sphere: which spheres exist at a beat, and where.
//
// The MIDI vocabulary is three five-row bands, one per axis. A note names ONE
// coordinate; the other two sit at their default (the centre) unless a note of
// that axis starts WITH it - a chord is one sphere at the combined position.
// "With" means same onset, never "still held": note length carries no meaning
// here, so stretching a note in the editor can never move a sphere.

/** Positions per axis: -2 … +2 steps about the centre. */
export const DUST_AXIS_STEPS = 5
const HALF_STEPS = (DUST_AXIS_STEPS - 1) / 2

// FROZEN: a project stores the pitch, so these bands can only ever be extended
// at the ends (see "A row's PITCH is the saved value" in this dir's guide).
// X sits highest so the row list reads X, Y, Z top to bottom with pitch
// descending the whole way.
export const DUST_PITCH_Z = 60
export const DUST_PITCH_Y = 65
export const DUST_PITCH_X = 70

/** Onsets closer than this are one chord. Wide enough to forgive a played-in
 *  chord's flam, far narrower than the shortest deliberate repeat. */
export const DUST_CHORD_WINDOW_BEATS = 1 / 32

export type DustAxis = 0 | 1 | 2

/** The coordinate a pitch names, or null for a pitch outside the three bands.
 *  `step` is signed and centred: the middle row of a band is 0. */
export function dustPitchAxis(pitch: number): { axis: DustAxis; step: number } | null {
  const bands: [number, DustAxis][] = [[DUST_PITCH_X, 0], [DUST_PITCH_Y, 1], [DUST_PITCH_Z, 2]]
  for (const [base, axis] of bands) {
    const index = pitch - base
    if (index >= 0 && index < DUST_AXIS_STEPS) return { axis, step: index - HALF_STEPS }
  }
  return null
}

export interface DustSphere {
  /** Position in STEPS (-2 … +2 per axis); the caller scales by its spread. */
  x: number
  y: number
  z: number
  /** Onset of the chord that spawned it (its earliest note). */
  beat: number
  /** Loudest note of the chord, as stored (callers normalize). */
  velocity: number
}

const CENTRE = [0]

/**
 * Every sphere alive at `state.beat`: spawned at or before it and younger than
 * `lifeBeats`. Oldest first; when more than `max` are alive the oldest go.
 *
 * Chords are grouped over the WHOLE note list, future notes included, and only
 * then filtered by the playhead. Grouping just the notes already played would
 * make a flammed chord spawn at (x, centre) and jump to (x, y) a few
 * milliseconds later - a position that depends on where the playhead is
 * inside the chord window, which scrubbing would expose.
 *
 * Two notes of the SAME axis in one chord are two positions on that axis, so
 * the chord spawns the cross product: X-left + X-right + Y-top is two spheres
 * along the top.
 */
export function collectDustSpheres(
  state: { beat: number; notes: readonly ResolvedNote[] },
  lifeBeats: number,
  max: number,
): DustSphere[] {
  const out: DustSphere[] = []
  let anchor = -Infinity
  let steps: [number[], number[], number[]] = [[], [], []]
  let velocity = 0

  const flush = () => {
    if (anchor === -Infinity) return
    const age = state.beat - anchor
    if (age < 0 || age >= lifeBeats) return
    for (const x of steps[0].length ? steps[0] : CENTRE) {
      for (const y of steps[1].length ? steps[1] : CENTRE) {
        for (const z of steps[2].length ? steps[2] : CENTRE) {
          out.push({ x, y, z, beat: anchor, velocity })
        }
      }
    }
  }

  // Notes arrive sorted by beat (the flattener's contract).
  for (const note of state.notes) {
    if (note.beat > state.beat + DUST_CHORD_WINDOW_BEATS) break
    const placed = dustPitchAxis(note.pitch)
    if (!placed) continue
    if (note.beat - anchor > DUST_CHORD_WINDOW_BEATS) {
      flush()
      anchor = note.beat
      steps = [[], [], []]
      velocity = 0
    }
    const list = steps[placed.axis]
    if (!list.includes(placed.step)) list.push(placed.step)
    velocity = Math.max(velocity, note.velocity)
  }
  flush()

  return out.length > max ? out.slice(out.length - max) : out
}

/** A stable per-sphere number for the shader's noise, so two spheres never
 *  crumble along the same ragged edge and a scrub regenerates the same one. */
export function dustSphereSeed(sphere: DustSphere): number {
  const raw = sphere.beat * 7.13 + sphere.x * 3.1 + sphere.y * 5.7 + sphere.z * 9.3
  return ((raw % 64) + 64) % 64
}

/** How long a sphere occupies a slot: the front's crossing plus the longest
 *  grain life (the LIFE knob is the longest-lived grain - see the shader). */
export function dustSphereLifeBeats(dissolveBeats: number, dustLifeBeats: number): number {
  return dissolveBeats + dustLifeBeats
}

/** Centre-to-centre grain spacing of `count` points spread evenly over a unit
 *  sphere. The grain size is a multiple of this, which is what keeps the ball
 *  solid at ANY count: fewer grains are bigger grains, never a sieve. */
export function dustGrainSpacing(count: number): number {
  return Math.sqrt((4 * Math.PI) / Math.max(1, count))
}

/** Uniformly distributed unit directions, deterministic. Random rather than a
 *  Fibonacci lattice ON PURPOSE: any prefix of a random set is itself uniform,
 *  so the preview budget can shorten the draw range without redrawing the ball
 *  as a polar cap (and without re-uploading a million points). */
export function buildDustDirections(count: number): Float32Array {
  const out = new Float32Array(count * 3)
  let seed = 0x9e3779b9
  const next = () => {
    // mulberry32
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let i = 0; i < count; i++) {
    const z = next() * 2 - 1
    const angle = next() * Math.PI * 2
    const r = Math.sqrt(1 - z * z)
    out[i * 3] = Math.cos(angle) * r
    out[i * 3 + 1] = Math.sin(angle) * r
    out[i * 3 + 2] = z
  }
  return out
}
