import { Matrix4 } from 'three'
import type { MoverOrSplitterDefinition } from './definitions'
import { prepareDanceCurves, sampleDanceAxis, DANCE_PITCHES } from './danceCurve'
import { memoizeEvaluation } from './evaluationMemo'
import { DANCE_COLOR } from './identityColors'

export interface DanceSettings {
  distanceX: number
  distanceY: number
  distanceZ: number
}

export const danceMover: MoverOrSplitterDefinition<DanceSettings> = {
  id: 'dance',
  label: 'Dance',
  kind: 'mover',
  identityColor: DANCE_COLOR,
  params: ['X', 'Y', 'Z'].map(axis => ({
    key: `distance${axis}`, label: `Swing ${axis}`, min: 0, max: 10,
    step: 0.05, default: 1, curve: 2,
  })),
  midiRows: () => DANCE_PITCHES.map((pitch, i) => ({ pitch, label: `${['X', 'Y', 'Z'][i]} crossing` })),
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const curves = prepareDanceCurves(notes)
    const distances = [settings.distanceX, settings.distanceY, settings.distanceZ]
      .map(value => Number.isFinite(value) ? Math.max(0, value) : 1)
    const atBeat = memoizeEvaluation((beat: number) => new Matrix4().makeTranslation(
      sampleDanceAxis(curves[0], beat) * distances[0],
      sampleDanceAxis(curves[1], beat) * distances[1],
      sampleDanceAxis(curves[2], beat) * distances[2],
    ))
    return {
      maxOutputCount: 1,
      // LOCAL: the preceding chain establishes the axes of the dance.
      composition: 'local',
      apply(copy, { beat }) {
        return [{
          transform: copy.transform.clone().multiply(atBeat(beat)),
          opacity: copy.opacity,
          colorShift: { ...copy.colorShift },
        }]
      },
    }
  },
}
