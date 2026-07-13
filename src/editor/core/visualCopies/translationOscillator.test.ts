import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResolvedNote } from '../visual/types'
import { mergeDefinitionSettings } from './definitions'
import {
  evaluateTranslationOscillation,
  translationOscillatorMover,
  type TranslationOscillatorSettings,
} from './translationOscillator'

function note(beat: number, pitch: number, durationBeats = 2, velocity = 1): ResolvedNote {
  return { beat, pitch, durationBeats, velocity, blockStartBeat: 0, blockEndBeat: 1024 }
}

function settings(overrides: Partial<TranslationOscillatorSettings> = {}): TranslationOscillatorSettings {
  return {
    ...mergeDefinitionSettings(translationOscillatorMover, undefined),
    ...overrides,
  } as unknown as TranslationOscillatorSettings
}

function close(actual: [number, number, number], expected: [number, number, number]): void {
  assert.ok(actual.every((value, index) => Math.abs(value - expected[index]) < 1e-9), `${actual} != ${expected}`)
}

test('a held positive note oscillates origin → signed extent → origin', () => {
  const p = settings({ distanceX: 2, cyclesPerBeat: 1 })
  const notes = [note(0, 60)]
  close(evaluateTranslationOscillation(notes, p, 0), [0, 0, 0])
  close(evaluateTranslationOscillation(notes, p, 0.5), [2, 0, 0])
  close(evaluateTranslationOscillation(notes, p, 1), [0, 0, 0])
  close(evaluateTranslationOscillation(notes, p, 1.5), [2, 0, 0])
  close(evaluateTranslationOscillation(notes, p, 2), [0, 0, 0])
})

test('six signed rows independently choose axis and side', () => {
  const p = settings({ distanceX: 2, distanceY: 3, distanceZ: 4 })
  close(evaluateTranslationOscillation([note(0, 61)], p, 0.5), [-2, 0, 0])
  close(evaluateTranslationOscillation([note(0, 62)], p, 0.5), [0, 3, 0])
  close(evaluateTranslationOscillation([note(0, 63)], p, 0.5), [0, -3, 0])
  close(evaluateTranslationOscillation([note(0, 64)], p, 0.5), [0, 0, 4])
  close(evaluateTranslationOscillation([note(0, 65)], p, 0.5), [0, 0, -4])
})

test('translation oscillation uses the editable basis vectors', () => {
  const p = settings({
    distanceX: 2,
    basisXX: 0,
    basisXY: 1,
    basisXZ: 0,
  })
  close(evaluateTranslationOscillation([note(0, 60)], p, 0.5), [0, 2, 0])
})

test('Return gently damps active oscillation to the origin while held', () => {
  const p = settings({ distanceX: 2, cyclesPerBeat: 0.5, returnBeats: 1 })
  const notes = [note(0, 60, 3), note(0.5, 66, 2)]
  close(evaluateTranslationOscillation(notes, p, 1), [1, 0, 0])
  close(evaluateTranslationOscillation(notes, p, 1.5), [0, 0, 0])
})

test('released direction notes contribute no translation', () => {
  const p = settings({ distanceX: 2 })
  close(evaluateTranslationOscillation([note(0, 60, 0.75)], p, 1), [0, 0, 0])
})

test('translation oscillator exposes six signed rows plus Return', () => {
  const rows = translationOscillatorMover.midiRows!(settings())
  assert.equal(rows.length, 7)
  assert.deepEqual(rows.map((row) => row.pitch), [62, 63, 60, 61, 64, 65, 66])
})

test('translation oscillation is a pure function of the playhead beat', () => {
  const p = settings({ distanceX: 3, cyclesPerBeat: 0.37 })
  const notes = [note(1, 60, 8)]
  const first = evaluateTranslationOscillation(notes, p, 4.25)
  evaluateTranslationOscillation(notes, p, 100)
  assert.deepEqual(evaluateTranslationOscillation(notes, p, 4.25), first)
})
