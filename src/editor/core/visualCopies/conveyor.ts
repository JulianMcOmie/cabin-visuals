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
// What makes it endless is that the loop is per COPY, not per mover: each copy's
// own position is folded into the field box, so with a splitter above (a Grid, a
// Tunnel, a Radial) the copies that run off the leading face reappear at the
// trailing one - a belt of objects streaming through the frame forever instead of
// a rigid formation that jumps back all at once. The Edge fade dissolves them
// into the face they leave and back out of the one they enter, which is what
// makes the seam invisible.
//
// COMPOSITION is chain-root (PRE-multiplied), the documented opt-out from the
// LOCAL default. Two reasons, both about the loop: the field box is a set of
// FIXED planes, so the displacement that folds a copy into it has to be measured
// in the same frame the box lives in; and a rotation above this mover (a Radial)
// must not turn the belt, or "everything streams one way" stops being true.
//
// The box is centred on the track's own placement rather than on the world
// origin, so a Conveyor keeps working on a track parked anywhere in the scene -
// and a Conveyor with several targets gives each of them its own box.

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
  /** Half-extents of the field box. 0 turns looping off on that axis. */
  spanX: number
  spanY: number
  spanZ: number
  /** Fraction of each half-extent used to fade a copy out at the face. */
  fade: number
}

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
 * Opacity factor for a copy sitting at `position` along an axis whose box
 * half-extent is `span`: full in the middle, dissolving over the outer `fade`
 * of the way to either face.
 *
 * Symmetric on purpose - the same curve fades a copy out of the face it leaves
 * and in through the face it reappears at, so the two halves of the loop match
 * exactly and the wrap has no seam to see. It is a function of POSITION alone,
 * so a stopped belt looks like a running one paused, and a copy parked near a
 * face stays dim instead of popping when the note ends.
 */
export function edgeFade(position: number, span: number, fade: number): number {
  if (!(span > 0) || !(fade > 0)) return 1
  const width = span * fade
  return smoothstep((span - Math.abs(position)) / width)
}

export const conveyorMover: MoverOrSplitterDefinition<ConveyorSettings> = {
  id: 'conveyor',
  label: 'Conveyor',
  kind: 'mover',
  params: [
    { key: 'speed', label: 'Speed (/beat)', min: 0, max: 20, step: 0.1, default: 3 },
    { key: 'glide', label: 'Glide (beats)', min: 0, max: 4, step: 0.05, default: 0.25 },
    // Roughly the default camera's framing at the origin (z = 5, fov 55, 16:9):
    // a copy leaving one side of the frame reappears at the other. 0 turns
    // looping off for that axis, which lets the belt run away forever.
    { key: 'spanX', label: 'Loop span X (0 = off)', min: 0, max: 50, step: 0.5, default: 5 },
    { key: 'spanY', label: 'Loop span Y (0 = off)', min: 0, max: 50, step: 0.5, default: 3 },
    { key: 'spanZ', label: 'Loop span Z (0 = off)', min: 0, max: 50, step: 0.5, default: 8 },
    { key: 'fade', label: 'Edge fade', min: 0, max: 1, step: 0.01, default: 0.3 },
  ],
  midiRows: () => CONVEYOR_ROWS,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const spans = [settings.spanX, settings.spanY, settings.spanZ]
    return {
      apply(visualCopy, { beat }) {
        const travel = evaluateConveyorTravel(notes, settings, beat)
        const elements = visualCopy.transform.elements
        // The copy's own position in the field: where the entries above this one
        // put it. Read per copy - this is what makes the loop a belt.
        const position: [number, number, number] = [elements[12], elements[13], elements[14]]

        const delta: [number, number, number] = [0, 0, 0]
        let fade = 1
        for (let axis = 0; axis < 3; axis++) {
          const looped = wrapToBound(position[axis] + travel[axis], spans[axis])
          delta[axis] = looped - position[axis]
          fade *= edgeFade(looped, spans[axis], settings.fade)
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
