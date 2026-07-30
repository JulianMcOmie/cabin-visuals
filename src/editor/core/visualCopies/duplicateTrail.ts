// Duplicate: the note leaves a copy of the object behind, and the copies
// stream away from the camera.
//
// The original never moves. Every spawn is born EXACTLY on top of it - same
// place, same size - and then recedes, so a duplicate never pops into
// existence: it peels off the object you were already looking at. Hold the note
// and the peeling repeats on a beat division, which is what turns one hit into
// a corridor of selves receding into the dark.
//
// ── The three knobs ──────────────────────────────────────────────────────────
//
//   SIZE is APPARENT size at the far end - how much bigger or smaller a copy
//   LOOKS by the time it gets there - so the perspective shrink is divided out
//   before the knob is applied. Measuring it in world units instead makes the
//   whole splitter invisible at its own defaults: a copy exactly behind a
//   convex object is hidden by it unless it covers more of the screen, and
//   perspective beats any sane world-scale value (a 6x copy 50 units back
//   still reads at half the original's size). With the shrink divided out,
//   above 1 the trail blooms outward past the original, below 1 it collapses
//   toward a vanishing point, and at 1 it hides exactly behind itself.
//
//   It is a far-end target, not a per-copy ratio: apparent size is
//   `size ^ (distance / reach)`, so equally-spaced copies sit at a CONSTANT
//   ratio to each other (the compounding ladder) while the total stays bounded
//   by what the knob says. A per-step ratio would instead compound with
//   DENSITY - 1.4x per 16th note over a 50-unit trail is a four-thousand-fold
//   object, and the knob would mean something different at every density.
//
//   SPEED is units per beat of retreat, and with DENSITY it also fixes the
//   spacing of the ladder (`speed * interval` units between neighbours).
//
//   DENSITY is a beat division, never a free rate: spawns land on the grid the
//   music is written on, so the corridor pulses with the track instead of
//   drifting against it.
//
// ── Why the trail length is not a fourth knob ────────────────────────────────
//
// Copy count must be structural (fixed at resolve; see types.ts), and it is -
// but it is DERIVED rather than asked for. The trail runs a fixed depth into
// the scene and needs `depth / (speed * interval)` slots to fill it, clamped to
// a copy budget. A "trail length" knob would only ever be spent re-balancing
// against the other three, and every copy is a whole instrument, so the budget
// is a ceiling the user should not be able to raise by accident.
//
// `reach` closes the loop: when the budget truncates the trail, the far end IS
// where the slots run out, so both the fade-out and the size ramp normalise to
// it. That is what keeps the oldest copy from popping - it is always already
// invisible by the time the next spawn recycles its slot.
//
// Everything is a closed-form function of the beat (the spawn timeline is built
// once at resolve, and a copy's state is just `beat - spawnBeat`), so pause,
// scrub, playback, and export agree exactly.

import { Matrix4 } from 'three'
import type { MidiRowDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
// Same default-camera assumption the Tunnel already makes and documents: the
// corridor is a camera-relative illusion, so its geometry is measured from
// where the lens actually is.
import { TUNNEL_CAMERA_Z as CAMERA_Z, placementAxisScale } from './tunnel'
import type { VisualCopy } from './types'

/** The one row this definition answers: everything it does is one function. */
export const DUPLICATE_PITCH = 60

export interface DuplicateTrailSettings {
  /** How large a copy at the far end LOOKS relative to the original; copies in
   *  between ride a geometric ramp toward it. 1 = the trail holds its apparent
   *  size all the way back (and hides behind the original). */
  size: number
  /** Units of retreat per beat. */
  speed: number
  /** Index into DUPLICATE_SPAWN_INTERVALS - beats between spawns while held. */
  density: number
  /** 1 = walk the hue a full turn down the trail. */
  rainbow: number
}

/** Beats between spawns, sparse first. Every entry is a division of the beat,
 *  which is the whole point of quantising: 1/3 is there so triplet feels can
 *  spawn on their own grid rather than against the straight one. */
export const DUPLICATE_SPAWN_INTERVALS = [4, 2, 1, 0.5, 1 / 3, 0.25]

const DENSITY_LABELS = [
  'Every 4 beats',
  'Every 2 beats',
  'Every beat',
  '2 per beat (8ths)',
  '3 per beat (triplets)',
  '4 per beat (16ths)',
]

/** How far into the scene the trail runs before it has faded out entirely. */
const TRAIL_DEPTH = 50
/** Fraction of the reach spent fading out. No fade IN: a copy is born as an
 *  exact overlay of the original, so there is nothing to ease. */
const FADE_FRACTION = 0.35
/** Every copy is a full instrument (own material, geometry, lights), so this
 *  is the setting that costs frames - hence a ceiling rather than a knob. */
const MAX_DUPLICATES = 64
/** A note held for ten minutes at 16ths is ~2400 spawns; this only exists so a
 *  pathological block cannot allocate without bound. */
const MAX_SPAWNS = 8192

const DUPLICATE_ROWS: MidiRowDef[] = [{ pitch: DUPLICATE_PITCH, label: 'Duplicate' }]

export function duplicateSpawnInterval(settings: Pick<DuplicateTrailSettings, 'density'>): number {
  const index = Math.round(settings.density)
  return DUPLICATE_SPAWN_INTERVALS[index] ?? DUPLICATE_SPAWN_INTERVALS[2]
}

/**
 * Slot count and the distance the trail actually covers.
 *
 * `reach` is the far end for every purpose - size ramp, fade, rainbow sweep -
 * and it is the smaller of the depth budget and what the slots can span. Both
 * ramps therefore complete before the last slot, so a copy is always at opacity
 * zero by the time a new spawn takes its slot away.
 */
export function duplicateTrailGeometry(
  settings: Pick<DuplicateTrailSettings, 'speed' | 'density'>,
): { duplicates: number; reach: number } {
  const perStep = Math.max(1e-6, Math.max(0, settings.speed) * duplicateSpawnInterval(settings))
  const duplicates = Math.max(1, Math.min(MAX_DUPLICATES, Math.ceil(TRAIL_DEPTH / perStep)))
  return { duplicates, reach: Math.min(TRAIL_DEPTH, duplicates * perStep) }
}

/**
 * Every beat a duplicate is born at, ascending.
 *
 * A note's onset always spawns - a percussive zero-length note is one duplicate
 * shot backwards - and a held note keeps spawning every `intervalBeats` for as
 * long as it is held. The grid is anchored to each onset rather than to beat 0,
 * so the first copy leaves on the hit itself instead of waiting for the next
 * gridline; notes written on the grid (which is all of them, in a quantised
 * piano roll) therefore spawn on the grid too.
 *
 * Beat-independent, so the chain builds this once per resolve.
 */
export function duplicateSpawnTimeline(
  notes: readonly ResolvedNote[],
  intervalBeats: number,
): number[] {
  const interval = Math.max(1e-3, intervalBeats)
  const spawns: number[] = []
  for (const note of notes) {
    if (note.pitch !== DUPLICATE_PITCH) continue
    const held = Math.max(0, note.durationBeats)
    for (let step = 0; ; step++) {
      const offset = step * interval
      // Strictly inside the note: a spawn exactly on the note-off belongs to
      // whatever plays next, not to the note that just ended.
      if (step > 0 && offset >= held - 1e-9) break
      spawns.push(note.beat + offset)
      if (spawns.length >= MAX_SPAWNS) return finishTimeline(spawns)
    }
  }
  return finishTimeline(spawns)
}

/** Overlapping notes can ask for the same instant twice; two copies in exactly
 *  the same place are one copy that cost twice as much, so collapse them. */
function finishTimeline(spawns: number[]): number[] {
  spawns.sort((a, b) => a - b)
  const unique: number[] = []
  for (const spawn of spawns) {
    if (unique.length === 0 || spawn - unique[unique.length - 1] > 1e-9) unique.push(spawn)
  }
  return unique
}

/** Index of the newest spawn at or before `beat`, or -1 before the first one. */
export function lastSpawnIndex(spawns: readonly number[], beat: number): number {
  let low = 0
  let high = spawns.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (spawns[mid] <= beat + 1e-9) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}

/** One duplicate's state from how far it has travelled. `progress` is its
 *  position along the trail in 0..1, which every appearance ramp keys off.
 *
 *  `scale` is a WORLD scale, reached by taking the apparent size the knob asks
 *  for and undoing the perspective shrink at this distance - which assumes the
 *  object is near the origin, the same thing the Tunnel assumes. An object
 *  parked far off-axis gets a trail that grows slightly wrong, and that is a
 *  better trade than a knob whose every value is invisible. */
export function duplicateStateAt(
  distance: number,
  reach: number,
  size: number,
): { scale: number; opacity: number; progress: number } {
  const progress = Math.max(0, Math.min(1, distance / Math.max(1e-6, reach)))
  const fade = Math.max(1e-6, FADE_FRACTION)
  const linear = Math.max(0, Math.min(1, (1 - progress) / fade))
  const perspective = (CAMERA_Z + distance) / CAMERA_Z
  return {
    scale: Math.pow(Math.max(1e-4, size), progress) * perspective,
    // Energy-linear ramp, as in the Tunnel: an emissive instrument scales both
    // its HDR colour and its alpha by opacity, so a linear ramp reads as a dull
    // streak that suddenly ignites. The square root makes emitted energy fall
    // off linearly instead.
    opacity: Math.sqrt(linear),
    progress,
  }
}

export const duplicateTrailSplitter: MoverOrSplitterDefinition<DuplicateTrailSettings> = {
  id: 'duplicateTrail',
  label: 'Duplicate',
  kind: 'splitter',
  params: [
    // 1 is the invisible identity (a copy exactly behind the original), so the
    // default sits well clear of it: 2.5 blooms the trail outward into a halo
    // that frames the object, which is what the splitter is FOR.
    { key: 'size', label: 'Size (far end)', min: 0.05, max: 4, step: 0.05, default: 2.5 },
    { key: 'speed', label: 'Speed / beat', min: 0.5, max: 40, step: 0.5, default: 6 },
    {
      key: 'density',
      label: 'Density',
      type: 'select',
      options: DENSITY_LABELS.map((label, value) => ({ value, label })),
      default: 2,
    },
    { key: 'rainbow', label: 'Rainbow', type: 'boolean', default: 0 },
  ],
  midiRows: () => DUPLICATE_ROWS,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const { duplicates, reach } = duplicateTrailGeometry(settings)
    const speed = Math.max(0, settings.speed)
    const spawns = duplicateSpawnTimeline(notes, duplicateSpawnInterval(settings))
    const rainbow = settings.rainbow >= 0.5
    return {
      apply(visualCopy, { beat, placementTransform }) {
        // Slot 0 is the object itself, untouched and always present: this
        // splitter ADDS selves, it does not replace the one you placed.
        const copies: VisualCopy[] = [{
          transform: visualCopy.transform.clone(),
          opacity: visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }]
        const newest = lastSpawnIndex(spawns, beat)
        // The trail is world-metric: the renderer composes placement *
        // transform, which would otherwise multiply the retreat by however
        // large the instrument draws itself, so an object at half size would
        // get a half-depth corridor. Only the OFFSET is normalised - each copy
        // still renders at the object's own size times its own ramp.
        const placementScale = placementAxisScale(placementTransform)
        for (let age = 0; age < duplicates; age++) {
          // Slot `age` holds the age-th most recent spawn. Slots therefore
          // recycle as new copies are born (the same trade the Tunnel's wrap
          // makes): the SET of copies on screen is continuous, but a
          // downstream index-based mover sees the assignment shift.
          const spawnIndex = newest - age
          const spawnBeat = spawnIndex >= 0 ? spawns[spawnIndex] : null
          if (spawnBeat === null) {
            // Nothing born into this slot yet. It still has to exist - copy
            // count is structural, so silence is opacity, never a missing slot.
            copies.push({
              transform: visualCopy.transform.clone(),
              opacity: 0,
              colorShift: { ...visualCopy.colorShift },
            })
            continue
          }
          const distance = Math.max(0, beat - spawnBeat) * speed
          const { scale, opacity, progress } = duplicateStateAt(distance, reach, settings.size)
          const transform = new Matrix4()
            .makeScale(scale, scale, scale)
            .setPosition(0, 0, -distance / placementScale[2])
          // LOCAL composition (previous * delta), the chain default: a copy's
          // transform is the reference frame for movers BELOW it, so a Burst
          // under a Duplicate walks each copy along its own retreating axes.
          copies.push({
            transform: visualCopy.transform.clone().multiply(transform),
            opacity: visualCopy.opacity * opacity,
            colorShift: {
              ...visualCopy.colorShift,
              // A full turn spread over the trail, keyed to DISTANCE rather
              // than slot index so a copy's hue drifts smoothly as it retreats
              // instead of jumping each time the slots shift. Relative, so the
              // rainbow rides on whatever colour the object already is; the
              // original at slot 0 is never touched.
              hue: visualCopy.colorShift.hue + (rainbow ? progress : 0),
            },
          })
        }
        return copies
      },
    }
  },
}
