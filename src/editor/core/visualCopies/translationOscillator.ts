import { Matrix4, Vector3 } from 'three'
import type { ParamDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import {
  BASIS_PARAMS,
  RETURN_PITCH,
  SIGNED_BASIS_DIRECTIONS,
  SIGNED_BASIS_ROWS,
  normalizedVelocity,
  resolveBasis,
  type BasisSettings,
} from './motionBasis'

export interface TranslationOscillatorSettings extends BasisSettings {
  distanceX: number
  distanceY: number
  distanceZ: number
  distance: number
  cyclesPerBeat: number
  returnBeats: number
}

const TRANSLATION_OSCILLATOR_PARAMS: ParamDef[] = [
  { key: 'distanceX', label: 'Distance X', min: 0, max: 20, step: 0.1, default: 1 },
  { key: 'distanceY', label: 'Distance Y', min: 0, max: 20, step: 0.1, default: 1 },
  { key: 'distanceZ', label: 'Distance Z', min: 0, max: 20, step: 0.1, default: 1 },
  { key: 'distance', label: 'Distance ×', min: 0, max: 10, step: 0.1, default: 1 },
  { key: 'cyclesPerBeat', label: 'Cycles / beat', min: 0.05, max: 16, step: 0.05, default: 1 },
  { key: 'returnBeats', label: 'Return beats', min: 0.05, max: 16, step: 0.05, default: 1 },
  ...BASIS_PARAMS,
]

const OSCILLATION_ROWS = [
  ...SIGNED_BASIS_ROWS,
  { pitch: RETURN_PITCH, label: 'Return position' },
]

/** Each signed note oscillates from the origin to its signed extent and back,
 * rather than crossing both sides of the origin (which would make + and − rows
 * equivalent). Only held notes contribute. Return damps every active axis to
 * the origin while it is held. */
export function evaluateTranslationOscillation(
  notes: readonly ResolvedNote[],
  settings: TranslationOscillatorSettings,
  beat: number,
): [number, number, number] {
  const basis = resolveBasis(settings)
  const distances = [settings.distanceX, settings.distanceY, settings.distanceZ]
  const offset = new Vector3()

  for (const note of notes) {
    const direction = SIGNED_BASIS_DIRECTIONS[note.pitch]
    if (!direction) continue
    const age = beat - note.beat
    if (age < 0 || age >= Math.max(0, note.durationBeats)) continue
    const phase = age * Math.max(0, settings.cyclesPerBeat) * Math.PI * 2
    const wave = (1 - Math.cos(phase)) / 2
    offset.addScaledVector(
      basis[direction.axis],
      direction.sign * distances[direction.axis] * settings.distance * normalizedVelocity(note.velocity) * wave,
    )
  }

  const returnBeats = Math.max(0.0001, settings.returnBeats)
  let returnProgress = 0
  for (const note of notes) {
    if (note.pitch !== RETURN_PITCH) continue
    const age = beat - note.beat
    if (age < 0 || age >= Math.max(0, note.durationBeats)) continue
    returnProgress = Math.max(returnProgress, Math.min(1, age / returnBeats))
  }
  offset.multiplyScalar(1 - returnProgress)
  return [offset.x, offset.y, offset.z]
}

export const translationOscillatorMover: MoverOrSplitterDefinition<TranslationOscillatorSettings> = {
  id: 'translationOscillator',
  label: 'Translation Oscillator',
  kind: 'mover',
  params: TRANSLATION_OSCILLATOR_PARAMS,
  midiRows: () => OSCILLATION_ROWS,
  resolve({ settings, notes }) {
    return {
      apply(visualCopy, { beat }) {
        const [x, y, z] = evaluateTranslationOscillation(notes, settings, beat)
        return [{
          transform: visualCopy.transform.clone().multiply(new Matrix4().makeTranslation(x, y, z)),
          opacity: visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }]
      },
    }
  },
}
