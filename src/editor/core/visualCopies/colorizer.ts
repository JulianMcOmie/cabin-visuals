// The Colorizer: every note is a COLOR EVENT. Two rows, two kinds of event.
//
// FLASH (row 1) pulls the objects toward one absolute colour. RAINBOW (row 2)
// sweeps hue across them instead: a travelling wave whose phase comes from each
// copy's position along the XY diagonal and advances rapidly with the beat, so
// a field of objects reads as a band of colour running corner to corner. The
// two compose - hold both and the objects flash to the chosen colour and then
// sweep the wheel from there - because the flash writes the absolute `tint`
// channel while the rainbow writes the relative `hue` one.
//
// Both rows are shaped by the same envelope, so both inherit the same range of
// character: a short note with no attack and a fast release is a percussive hit
// synced to a snare's amplitude curve, while a held note with a slow attack is
// a sustained wash. There is no mode switch, because the difference between the
// two IS the envelope plus the note length already written on the timeline.
//
// The COLOR is absolute, not an offset: a mover never sees the object's own
// color, so it travels as `colorShift.tint` + `tintAmount` and gets mixed where
// the source IS known (core/visual/instrumentColor.ts). That is the whole
// reason the VisualCopy contract carries a tint at all - "flash this gold"
// cannot be said in relative HSL.

import { Vector3 } from 'three'
import type { MidiRowDef, ParamDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import { COLORIZER_COLOR } from './identityColors'

/** One row per function, so every declared note has a meaning the user can read
 *  off the piano roll instead of guessing at a keyboard. */
export const COLORIZER_FLASH_PITCH = 60
export const COLORIZER_RAINBOW_PITCH = 61

export const SHAPE_SPIKE = 0
export const SHAPE_EVEN = 1
export const SHAPE_SWELL = 2

export interface ColorizerSettings {
  /** How far toward `color` a full-strength event pulls, 0..1. */
  intensity: number
  /** Attack in beats. 0 = the event lands full-strength on the exact beat. */
  attackBeats: number
  /** Release in beats after note-off - the tail. This is the "sound curve". */
  releaseBeats: number
  /** Beats of delay added per upstream copy index, so one hit rolls across a
   *  split as a wave. Negative rolls the other way. */
  staggerBeats: number
  /** The color events flash toward, '#rrggbb'. */
  color: string
  /** Which curve the envelope's ramps bend along (SHAPE_* above). */
  shape: number
  /** Rainbow row: turns of hue per beat. This is the "rapid fire" - the whole
   *  wheel several times a beat at the top of the range. */
  rainbowRate: number
  /** Rainbow row: turns of hue per world unit along the diagonal. This is what
   *  makes it a SWEEP across the objects rather than every copy flickering the
   *  same colour at the same instant. */
  rainbowSpread: number
}

const COLORIZER_PARAMS: ParamDef[] = [
  { key: 'intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.75 },
  { key: 'attackBeats', label: 'Attack', min: 0, max: 4, step: 0.01, default: 0, curve: 2 },
  { key: 'releaseBeats', label: 'Release', min: 0, max: 8, step: 0.01, default: 0.35, curve: 2 },
  { key: 'staggerBeats', label: 'Stagger / copy', min: -0.5, max: 0.5, step: 0.01, default: 0 },
  { key: 'rainbowRate', label: 'Rainbow rate (turns / beat)', min: 0, max: 8, step: 0.05, default: 3 },
  { key: 'rainbowSpread', label: 'Rainbow spread (turns / unit)', min: -1, max: 1, step: 0.01, default: 0.12 },
  { key: 'color', label: 'Color', type: 'color', default: '#ffd166' },
  {
    key: 'shape',
    label: 'Shape',
    type: 'select',
    options: [
      { value: SHAPE_SPIKE, label: 'Spike' },
      { value: SHAPE_EVEN, label: 'Even' },
      { value: SHAPE_SWELL, label: 'Swell' },
    ],
    default: SHAPE_SPIKE,
  },
]

const COLORIZER_ROWS: MidiRowDef[] = [
  { pitch: COLORIZER_FLASH_PITCH, label: 'Color flash' },
  { pitch: COLORIZER_RAINBOW_PITCH, label: 'Rainbow sweep' },
]

/**
 * Where a copy sits along the rainbow's diagonal axis, in world units.
 *
 * The sweep runs across the XY diagonal - up-and-right is "later" in the
 * rainbow - so a grid of copies reads as a band of colour travelling corner to
 * corner rather than in rows or columns. Multiplying by SQRT1_2 keeps it a true
 * distance along that 45-degree axis, so SPREAD means the same thing whichever
 * way the objects happen to be laid out.
 */
export function rainbowDiagonal(x: number, y: number): number {
  return (x + y) * Math.SQRT1_2
}

function normalizedVelocity(velocity: number): number {
  return Math.max(0, Math.min(1, velocity <= 1 ? velocity : velocity / 127))
}

/** Only SWELL softens the onset. SPIKE and EVEN rise linearly so that a
 *  zero-attack note lands on its beat at full intensity with no lead-in. */
function attackRamp(progress: number, shape: number): number {
  return shape === SHAPE_SWELL ? progress * progress : progress
}

/** The release curve is what sells the character. SPIKE drops off a cliff and
 *  rings out in a long tail (a struck drum's amplitude envelope), EVEN fades
 *  linearly, SWELL hangs near full and then falls away (a pad releasing). */
function releaseRamp(remaining: number, shape: number): number {
  if (shape === SHAPE_EVEN) return remaining
  if (shape === SHAPE_SWELL) return remaining * remaining * (3 - 2 * remaining)
  return remaining * remaining * remaining
}

/** One note's envelope at `beat`, in 0..1: attack, hold while the note is
 *  held, release. Deliberately no decay/sustain pair - the two knobs plus the
 *  written note length already span snare to pad, and a four-stage ADSR here
 *  would just be four knobs that all look the same on a 16th note. */
export function evaluateNoteEnvelope(
  note: ResolvedNote,
  beat: number,
  attackBeats: number,
  releaseBeats: number,
  shape: number,
): number {
  const age = beat - note.beat
  if (age < 0) return 0
  const attack = Math.max(0, attackBeats)
  const release = Math.max(0, releaseBeats)
  // A zero-length percussive note still completes its attack: the hold floor is
  // the attack itself, so ATTACK is never truncated by how short the note is.
  const hold = Math.max(Math.max(0, note.durationBeats), attack)
  if (age < attack) return attackRamp(age / attack, shape)
  if (age < hold) return 1
  if (release <= 0) return 0
  const remaining = 1 - (age - hold) / release
  return remaining <= 0 ? 0 : releaseRamp(remaining, shape)
}

export interface ColorizerOutput {
  /** How far toward the settings color to pull this copy right now, 0..1. */
  tintAmount: number
  /**
   * Hue rotation for this copy, in normalized turns - the rainbow row's output.
   *
   * Deliberately a RELATIVE hue offset rather than the flash's absolute tint:
   * a rainbow is a rotation *of whatever the object already is*, so it composes
   * with the flash instead of fighting it. Hold both rows and the object flashes
   * to the chosen colour and then sweeps the wheel from there.
   */
  hue: number
  /**
   * The loudest sounding note's envelope x velocity, in 0..1 - the event's own
   * "sound curve" before INTENSITY scales it. The chain ignores this (only
   * tintAmount reaches a VisualCopy); it is exposed so the settings panel can
   * draw the curve from the same evaluation the stage runs, rather than from
   * its own re-derivation of the envelope.
   */
  envelope: number
}

const NO_OUTPUT: ColorizerOutput = { tintAmount: 0, hue: 0, envelope: 0 }

/**
 * The colorizer's output for one copy at one beat.
 *
 * Overlapping notes take the loudest rather than summing: two flashes at once
 * are still one flash, and a sum would blow past the color the user picked.
 * Velocity scales the event because dynamics are what a flash is *for* - a
 * ghost note should barely tint, a rimshot should land the full color.
 */
export function evaluateColorizer(
  notes: readonly ResolvedNote[],
  settings: ColorizerSettings,
  beat: number,
  index = 0,
  diagonal = 0,
): ColorizerOutput {
  // STAGGER is a per-copy time offset, so the copy simply looks at a slightly
  // earlier (or later) point in the same performance. Everything downstream -
  // envelope, velocity - rolls with it for free.
  const localBeat = beat - settings.staggerBeats * Math.max(0, Math.floor(index))

  let gainPeak = 0
  // The rainbow tracks the loudest sounding note's AGE, not the absolute beat:
  // the sweep starts from hue zero when you play it, so playing the same note
  // twice looks the same both times instead of landing on whatever phase the
  // timeline happened to be at.
  let rainbowGain = 0
  let rainbowAge = 0
  for (const note of notes) {
    if (note.pitch === COLORIZER_FLASH_PITCH) {
      const envelope = evaluateNoteEnvelope(note, localBeat, settings.attackBeats, settings.releaseBeats, settings.shape)
      if (envelope <= 0) continue
      const gain = envelope * normalizedVelocity(note.velocity)
      if (gain > gainPeak) gainPeak = gain
    } else if (note.pitch === COLORIZER_RAINBOW_PITCH) {
      const envelope = evaluateNoteEnvelope(note, localBeat, settings.attackBeats, settings.releaseBeats, settings.shape)
      if (envelope <= 0) continue
      const gain = envelope * normalizedVelocity(note.velocity)
      if (gain > rainbowGain) {
        rainbowGain = gain
        rainbowAge = localBeat - note.beat
      }
    }
  }
  if (gainPeak <= 0 && rainbowGain <= 0) return NO_OUTPUT

  // Position sets the phase, time advances it: the same travelling-wave shape a
  // chase light has. Scaling by the gain means the sweep fades in and out with
  // the envelope instead of snapping on and popping off.
  const hue = rainbowGain > 0
    ? (rainbowAge * settings.rainbowRate + diagonal * settings.rainbowSpread) * rainbowGain
    : 0

  return {
    tintAmount: Math.max(0, Math.min(1, settings.intensity)) * gainPeak,
    hue,
    envelope: Math.max(gainPeak, rainbowGain),
  }
}

/**
 * The id stays `calmHueRotate` because it is the persistence key for every
 * saved mover row (see the registry note in CLAUDE.md); only the label and the
 * params changed. Stale values left in old saves merge through harmlessly.
 */
export const noteColorizer: MoverOrSplitterDefinition<ColorizerSettings> = {
  id: 'calmHueRotate',
  label: 'Colorizer',
  kind: 'colorizer',
  identityColor: COLORIZER_COLOR,
  params: COLORIZER_PARAMS,
  midiRows: () => COLORIZER_ROWS,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    // Closure-scoped scratch: apply() runs once per copy per frame, and the
    // rainbow only needs a position, so this avoids cloning a Matrix4 per copy
    // the way the world-space movers do.
    const scratchPosition = new Vector3()
    return {
      apply(visualCopy, { beat, index, placementTransform }) {
        // The copy's WORLD position. (P * T)'s translation column is P applied
        // to T's translation, so transforming the point is equivalent to
        // building the product matrix - and cheaper.
        scratchPosition.setFromMatrixPosition(visualCopy.transform)
        if (placementTransform) scratchPosition.applyMatrix4(placementTransform)
        const diagonal = rainbowDiagonal(scratchPosition.x, scratchPosition.y)
        const output = evaluateColorizer(notes, settings, beat, index, diagonal)
        return [{
          transform: visualCopy.transform.clone(),
          opacity: visualCopy.opacity,
          colorShift: {
            ...visualCopy.colorShift,
            hue: visualCopy.colorShift.hue + output.hue,
            // Silence leaves whatever is upstream alone rather than clearing
            // it: not flashing is not the same as asking for no color.
            ...(output.tintAmount > 0
              ? { tint: settings.color, tintAmount: output.tintAmount }
              : null),
          },
        }]
      },
    }
  },
}
