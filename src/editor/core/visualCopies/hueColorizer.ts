import type { MidiRowDef, ParamDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'

const CLOCKWISE_PITCH = 60
const COUNTER_CLOCKWISE_PITCH = 61

const HUE_PARAMS: ParamDef[] = [
  { key: 'degreesPerBeat', label: 'Degrees / beat', min: 1, max: 360, step: 1, default: 30 },
  { key: 'indexHue', label: 'Hue by copy index', type: 'boolean', default: 1 },
]

export interface CalmHueRotateSettings {
  degreesPerBeat: number
  indexHue: number
}

function hueRows(settings: CalmHueRotateSettings): MidiRowDef[] {
  const subject = settings.indexHue >= 0.5 ? 'Index hue spread' : 'Hue'
  return [
    { pitch: CLOCKWISE_PITCH, label: `${subject} clockwise (+)` },
    { pitch: COUNTER_CLOCKWISE_PITCH, label: `${subject} counter-clockwise (−)` },
  ]
}

function normalizedVelocity(velocity: number): number {
  return Math.max(0, Math.min(1, velocity <= 1 ? velocity : velocity / 127))
}

/** A calm, constant hue travel integrated over each note's held duration.
 * Completed notes retain their turn, so release means "stop here"; opposing
 * notes rotate the other way and overlapping directions cancel naturally. */
export function evaluateCalmHueRotation(
  notes: readonly ResolvedNote[],
  settings: CalmHueRotateSettings,
  beat: number,
): number {
  let degrees = 0
  const rate = Math.max(0, settings.degreesPerBeat)
  for (const note of notes) {
    const direction = note.pitch === CLOCKWISE_PITCH
      ? 1
      : note.pitch === COUNTER_CLOCKWISE_PITCH
        ? -1
        : 0
    if (direction === 0 || beat <= note.beat) continue
    const heldBeats = Math.min(Math.max(0, note.durationBeats), beat - note.beat)
    degrees += direction * heldBeats * rate * normalizedVelocity(note.velocity)
  }
  return degrees / 360
}

/** Converts the signed MIDI rotation into the hue applied to one copy. Copy 0
 * keeps the original calm rotation; each subsequent stable pipeline index adds
 * one more rotation step. Nested splitters already produce their output in
 * mixed-radix order, so their levels stack without needing mutable ancestry. */
export function applyCopyIndexToHueRotation(
  rotation: number,
  index: number,
  indexHue: number,
): number {
  if (indexHue < 0.5) return rotation
  return rotation * (Math.max(0, Math.floor(index)) + 1)
}

export const calmHueRotateColorizer: MoverOrSplitterDefinition<CalmHueRotateSettings> = {
  id: 'calmHueRotate',
  label: 'Calm Hue Rotate',
  kind: 'colorizer',
  params: HUE_PARAMS,
  midiRows: (settings) => hueRows(settings),
  strictMidiRows: true,
  resolve({ settings, notes }) {
    return {
      apply(visualCopy, { beat, index }) {
        const rotation = evaluateCalmHueRotation(notes, settings, beat)
        return [{
          transform: visualCopy.transform.clone(),
          opacity: visualCopy.opacity,
          colorShift: {
            ...visualCopy.colorShift,
            hue: visualCopy.colorShift.hue + applyCopyIndexToHueRotation(rotation, index, settings.indexHue),
          },
        }]
      },
    }
  },
}
