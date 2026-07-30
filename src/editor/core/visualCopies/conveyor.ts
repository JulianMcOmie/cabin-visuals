// Conveyor: endless constant motion in one direction. A held note means "the
// belt is running"; which note picks which of the six orthogonal directions, so
// one lane can send the field right for a bar, then up, then back.
//
//   62 / 63   up / down     (+Y / −Y)
//   60 / 61   right / left  (+X / −X)
//   64 / 65   forward / back (+Z / −Z)
//
// The same six-direction vocabulary Burst and Motion's Step block use, at the
// same pitches, so the muscle memory carries.
//
// What makes it endless is that the loop is measured against the FORMATION the
// chain above already built (`context.formation`), never against a box of this
// mover's own choosing:
//
//   BELT (the default) folds each copy back by one lattice PERIOD - the
//   formation's extent plus its spacing. A Grid, a Tunnel or a Radial above this
//   mover therefore tiles: copy for copy, the arrangement maps onto itself, so
//   the one that leaves the leading end IS the one that arrives at the trailing
//   end and there is no seam to hide. Neighbours never move relative to each
//   other, at any speed, forever.
//
//   GROUP moves the whole formation as one rigid body, `span` units out and
//   back, dissolving through the turn. Also arrangement-preserving, because
//   every copy takes the same displacement.
//
// Both of those replaced a first version that folded every copy into a fixed
// frame-sized box. That tore any formation apart - a copy hit the face while its
// neighbours were mid-frame and teleported ten units away from its own row - and
// it folded axes the belt was not even running along, quietly rearranging a
// splitter's layout the moment the mover was added. Wrapping at a distance the
// formation does not repeat at cannot be made to look right; the period has to
// come from the formation itself.
//
// An axis with no travel is left strictly untouched: no fold, no fade.
//
// COMPOSITION is chain-root (PRE-multiplied), the documented opt-out from the
// LOCAL default. Two reasons, both about the loop: the fold is measured along
// fixed axes, so the displacement that performs it has to be expressed in the
// same frame; and a rotation above this mover (a Radial) must not turn the belt,
// or "everything streams one way" stops being true.
//
// Everything is relative to where the copies actually are, not to the world
// origin, so a Conveyor keeps working on a track parked anywhere in the scene -
// and one with several targets gives each of them its own loop.

import { Matrix4 } from 'three'
import type { MidiRowDef, ParamDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import { wrapToBound } from './motion'
import { SIGNED_BASIS_DIRECTIONS, normalizedVelocity } from './motionBasis'
import type { VisualCopy } from './types'

export interface ConveyorSettings {
  /** Units travelled per beat while a direction note is held. */
  speed: number
  /** Beats the belt takes to reach speed, and to coast back to rest. */
  glide: number
  /** BELT_LOOP or GROUP_LOOP - see the constants. */
  loopStyle: number
  /** How far the group travels before it loops, per axis. 0 = never loop. */
  spanX: number
  spanY: number
  spanZ: number
  /** Beats a copy takes to dissolve through a loop face (group looping only). */
  fadeBeats: number
}

/**
 * Loop each copy at the FORMATION's own repeat distance: the copies above this
 * mover form a lattice, and folding each one back by exactly one lattice period
 * is the only per-copy wrap that leaves the arrangement intact. Neighbours stay
 * one spacing apart forever, so the copy that leaves one end IS the copy that
 * arrives at the other and the seam is not merely hidden, it does not exist.
 *
 * Falls back to GROUP_LOOP when there is no lattice to tile (a single copy, or
 * an unevenly spaced formation).
 */
export const BELT_LOOP = 0
/**
 * Loop the whole formation together, `span` units out and back, dissolving
 * through the turn. Every copy gets the SAME displacement, so the arrangement
 * is again untouched - a clump of objects that sails out of frame and returns,
 * rather than a belt.
 */
export const GROUP_LOOP = 1

/** The six direction rows, in the reading order every other directional mover
 *  presents (up first), on Burst's pitches. */
const CONVEYOR_ROWS: MidiRowDef[] = [
  { pitch: 62, label: 'Up (+Y)' },
  { pitch: 63, label: 'Down (−Y)' },
  { pitch: 60, label: 'Right (+X)' },
  { pitch: 61, label: 'Left (−X)' },
  { pitch: 64, label: 'Forward (+Z)' },
  { pitch: 65, label: 'Back (−Z)' },
]

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t))
  return x * x * (3 - 2 * x)
}

/**
 * Area under a velocity ramp that eases 0 → 1 over one unit of time and holds:
 * the integral of smoothstep. `x` is time in glide-lengths.
 *
 * This is why the glide costs nothing in accuracy: a note's travel is the
 * difference of this at its start and at its end, so the belt still covers
 * exactly speed × held beats once it has spun up and down, and the whole thing
 * stays a closed-form function of the beat (no integration over frames, so
 * scrub, pause, playback and export land the same position).
 */
export function rampArea(x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return x - 0.5
  return x * x * x - (x * x * x * x) / 2
}

/**
 * Beats of travel one note has earned by `beat`: its held time, softened at both
 * ends by the glide. A glide of zero is the plain held time rather than a very
 * short ramp, so "no glide" is exact.
 *
 * Mid-ramp the belt is deliberately BEHIND the raw held time (it spent the first
 * half-glide getting up to speed) and it makes that up during the ramp down,
 * which is why a note that has fully stopped has always travelled exactly its
 * held beats.
 */
function glidedHeldBeats(beat: number, start: number, end: number, glide: number): number {
  if (!(glide > 0)) return Math.min(Math.max(0, beat - start), Math.max(0, end - start))
  return glide * (rampArea((beat - start) / glide) - rampArea((beat - end) / glide))
}

/**
 * How far the belt has carried the field along each axis by `beat`.
 *
 * Every note is integrated independently and summed, so a chord of two
 * directions runs diagonally and stacked notes in one direction run faster,
 * with no mutable playback state. Motion accumulates and is KEPT when the note
 * ends - the belt stops where it stopped rather than springing home - so a lane
 * of held notes choreographs a path, and the loop keeps that path in frame.
 */
export function evaluateConveyorTravel(
  notes: readonly ResolvedNote[],
  settings: ConveyorSettings,
  beat: number,
): [number, number, number] {
  const travel: [number, number, number] = [0, 0, 0]
  for (const note of notes) {
    const direction = SIGNED_BASIS_DIRECTIONS[note.pitch]
    if (!direction || beat <= note.beat) continue
    const end = note.beat + Math.max(0, note.durationBeats)
    const held = glidedHeldBeats(beat, note.beat, end, settings.glide)
    travel[direction.axis] += direction.sign * held * settings.speed * normalizedVelocity(note.velocity)
  }
  return travel
}

/**
 * Opacity for something sitting `offset` from home along an axis that loops at
 * ±`span`: full in the middle, dissolving over the last `width` units into
 * either face.
 *
 * Symmetric on purpose - the same curve fades out through the face it leaves and
 * back in through the face it reappears at, so the two halves of the turn match
 * exactly and the seam has nothing to show.
 *
 * `width` is a DISTANCE, and the caller derives it from the speed (see
 * `fadeWidth`) rather than from the span. A fraction-of-span fade was the
 * original design and it failed at exactly the moment it mattered: a fast belt
 * crosses a narrow band in two frames, so the copy was still at ~40% opacity
 * when it teleported and the loop read as a glitch. Tie the band to how fast the
 * thing is moving and the dissolve always lasts the same number of BEATS.
 */
export function edgeFade(offset: number, span: number, width: number): number {
  if (!(span > 0) || !(width > 0)) return 1
  return smoothstep((span - Math.abs(offset)) / Math.min(width, span))
}

/** Distance the dissolve covers: `fadeBeats` of travel at the set speed, never
 *  more than the span itself (or the middle would never reach full opacity). */
export function fadeWidth(settings: ConveyorSettings, span: number): number {
  return Math.min(span, Math.max(0, settings.speed) * Math.max(0, settings.fadeBeats))
}

/** Coordinates rounded onto a grid fine enough that a lattice built by matrix
 *  multiplication still reads as evenly spaced. */
const LATTICE_EPSILON = 1e-6

/** How a formation is arranged along one axis. */
export interface AxisLattice {
  /** Midpoint of the occupied range - the loop window centers here. */
  center: number
  /** Distance after which the arrangement repeats, or 0 when it does not tile. */
  period: number
}

/**
 * Measures the formation along one axis: its center, and the period it tiles at
 * if it is evenly spaced (extent + one spacing, so wrapping by it maps the
 * lattice exactly onto itself).
 *
 * Unevenly spaced formations report period 0 rather than a guess. A wrong period
 * is worse than no belt: it would fold copies onto each other, which is the
 * failure the whole formation-aware path exists to prevent.
 */
export function latticeAlong(copies: readonly VisualCopy[], axis: 0 | 1 | 2): AxisLattice {
  let min = Infinity
  let max = -Infinity
  const seen = new Set<number>()
  for (const copy of copies) {
    const value = copy.transform.elements[12 + axis]
    if (!Number.isFinite(value)) continue
    if (value < min) min = value
    if (value > max) max = value
    seen.add(Math.round(value / LATTICE_EPSILON))
  }
  if (!Number.isFinite(min)) return { center: 0, period: 0 }
  const center = (min + max) / 2
  if (seen.size < 2) return { center, period: 0 }

  const coordinates = [...seen].map((key) => key * LATTICE_EPSILON).sort((a, b) => a - b)
  const spacing = coordinates[1] - coordinates[0]
  const tolerance = Math.max(1e-4, spacing * 1e-3)
  for (let i = 2; i < coordinates.length; i++) {
    if (Math.abs(coordinates[i] - coordinates[i - 1] - spacing) > tolerance) return { center, period: 0 }
  }
  return { center, period: max - min + spacing }
}

export const conveyorMover: MoverOrSplitterDefinition<ConveyorSettings> = {
  id: 'conveyor',
  label: 'Conveyor',
  kind: 'mover',
  params: [
    { key: 'speed', label: 'Speed (/beat)', min: 0, max: 20, step: 0.1, default: 3 },
    { key: 'glide', label: 'Glide (beats)', min: 0, max: 4, step: 0.05, default: 0.25 },
    {
      key: 'loopStyle',
      label: 'Loop',
      type: 'select',
      options: [
        { value: BELT_LOOP, label: 'Belt' },
        { value: GROUP_LOOP, label: 'Group' },
      ],
      default: BELT_LOOP,
    },
    // How far a GROUP travels before it turns round (Belt takes its distance
    // from the formation). Roughly the default camera's framing at the origin
    // (z = 5, fov 55, 16:9), so a group leaves frame and comes back. 0 turns
    // looping off for that axis, which lets it run away forever.
    { key: 'spanX', label: 'Group loop X (0 = off)', min: 0, max: 50, step: 0.5, default: 5 },
    { key: 'spanY', label: 'Group loop Y (0 = off)', min: 0, max: 50, step: 0.5, default: 3 },
    { key: 'spanZ', label: 'Group loop Z (0 = off)', min: 0, max: 50, step: 0.5, default: 8 },
    { key: 'fadeBeats', label: 'Fade (beats)', min: 0, max: 4, step: 0.05, default: 0.75 },
  ],
  midiRows: () => CONVEYOR_ROWS,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const spans = [settings.spanX, settings.spanY, settings.spanZ]
    const widths = spans.map((span) => fadeWidth(settings, span))
    const belt = settings.loopStyle !== GROUP_LOOP
    // One measurement per formation per axis instead of one per copy: `apply`
    // runs for every copy of the step and is handed the same array each time, so
    // this turns an O(n²) frame into an O(n) one. Keyed on identity and weak, so
    // it holds nothing alive - and it stays a pure memo because the contract
    // says the incoming copies are immutable.
    const lattices = new WeakMap<readonly VisualCopy[], AxisLattice[]>()
    const latticeFor = (copies: readonly VisualCopy[], axis: 0 | 1 | 2): AxisLattice => {
      let measured = lattices.get(copies)
      if (!measured) {
        measured = []
        lattices.set(copies, measured)
      }
      return (measured[axis] ??= latticeAlong(copies, axis))
    }

    return {
      apply(visualCopy, { beat, formation }) {
        const travel = evaluateConveyorTravel(notes, settings, beat)
        const elements = visualCopy.transform.elements
        // The copy's own position in the field: where the entries above this one
        // put it. Read per copy - this is what makes the loop a belt.
        const position: [number, number, number] = [elements[12], elements[13], elements[14]]
        const copies = formation ?? [visualCopy]

        const delta: [number, number, number] = [0, 0, 0]
        let fade = 1
        for (let axis = 0; axis < 3; axis++) {
          const distance = travel[axis]
          // An axis the belt is not running along is left completely alone: no
          // fold, no fade. It used to be folded into a box regardless, which
          // silently rearranged whatever a splitter had built in the other two
          // axes (a Tunnel's depth, a Grid's rows) the moment the mover was
          // added.
          if (distance === 0) continue

          const { center, period } = latticeFor(copies, axis as 0 | 1 | 2)
          if (belt && period > 0) {
            // Fold this copy back by whole periods, in a window centered on the
            // formation: the lattice maps onto itself, so no neighbour ever
            // moves relative to another.
            delta[axis] = center + wrapToBound(position[axis] + distance - center, period / 2)
              - position[axis]
            continue
          }

          // Nothing to tile (or Group asked for): the formation travels as one
          // rigid body, so every copy takes the SAME wrapped displacement and
          // the whole thing dissolves through the turn together.
          const span = spans[axis]
          if (!(span > 0)) {
            delta[axis] = distance
            continue
          }
          const offset = wrapToBound(distance, span)
          delta[axis] = offset
          fade *= edgeFade(offset, span, widths[axis])
        }

        return [{
          transform: new Matrix4()
            .makeTranslation(delta[0], delta[1], delta[2])
            .multiply(visualCopy.transform),
          opacity: visualCopy.opacity * fade,
          colorShift: { ...visualCopy.colorShift },
        }]
      },
    }
  },
}
