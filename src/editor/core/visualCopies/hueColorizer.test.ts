import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResolvedNote } from '../visual/types'
import { mergeDefinitionSettings } from './definitions'
import {
  applyCopyIndexToHueRotation,
  calmHueRotateColorizer,
  evaluateCalmHueRotation,
  type CalmHueRotateSettings,
} from './hueColorizer'
import { identityVisualCopy } from './identityVisualCopy'
import { resolveVisualCopies } from './resolveVisualCopies'
import type { MoverOrSplitter } from './types'

function note(beat: number, pitch: number, durationBeats = 1, velocity = 1): ResolvedNote {
  return { beat, pitch, durationBeats, velocity, blockStartBeat: 0, blockEndBeat: 1024 }
}

function settings(overrides: Partial<CalmHueRotateSettings> = {}): CalmHueRotateSettings {
  return {
    ...mergeDefinitionSettings(calmHueRotateColorizer, undefined),
    ...overrides,
  } as unknown as CalmHueRotateSettings
}

test('Calm Hue Rotate turns only while a note is held, then keeps the resulting hue', () => {
  const notes = [note(0, 60, 2)]
  assert.equal(evaluateCalmHueRotation(notes, settings({ degreesPerBeat: 30 }), 1), 30 / 360)
  assert.equal(evaluateCalmHueRotation(notes, settings({ degreesPerBeat: 30 }), 3), 60 / 360)
})

test('the two MIDI rows rotate hue in opposite directions and velocity scales travel', () => {
  const opts = settings({ degreesPerBeat: 90 })
  assert.equal(evaluateCalmHueRotation([note(0, 60, 1)], opts, 1), 0.25)
  assert.equal(evaluateCalmHueRotation([note(0, 61, 1)], opts, 1), -0.25)
  assert.equal(evaluateCalmHueRotation([note(0, 60, 1, 0.5)], opts, 1), 0.125)
  assert.equal(evaluateCalmHueRotation([note(0, 60), note(0, 61)], opts, 1), 0)
})

test('the colorizer changes hue without changing transform, opacity, saturation, or lightness', () => {
  const input = identityVisualCopy()
  input.transform.makeTranslation(2, 3, 4)
  input.opacity = 0.4
  input.colorShift = { hue: 0.1, saturation: 0.2, lightness: -0.15 }
  const output = calmHueRotateColorizer.resolve({
    settings: settings({ degreesPerBeat: 36 }),
    notes: [note(0, 60, 1)],
  }).apply(input, { beat: 1, index: 0, count: 1 })[0]

  assert.deepEqual(output.transform.elements, input.transform.elements)
  assert.notEqual(output.transform, input.transform)
  assert.equal(output.opacity, 0.4)
  assert.deepEqual(output.colorShift, { hue: 0.2, saturation: 0.2, lightness: -0.15 })
})

test('MIDI hue amount offsets each prior splitter copy by its stable index', () => {
  const colorizer = calmHueRotateColorizer.resolve({
    settings: settings({ degreesPerBeat: 36, indexHue: 1 }),
    notes: [note(0, 60, 1)],
  })
  const split = (count: number): MoverOrSplitter => ({
    apply(visualCopy) {
      return Array.from({ length: count }, () => ({
        transform: visualCopy.transform.clone(),
        opacity: visualCopy.opacity,
        colorShift: { ...visualCopy.colorShift },
      }))
    },
  })

  const copies = resolveVisualCopies([split(2), split(3), colorizer], 1)
  assert.deepEqual(
    copies.map((copy) => Math.round(copy.colorShift.hue * 10) / 10),
    [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
  )
})

test('copy indexing can be disabled without changing the original MIDI hue rotation', () => {
  assert.equal(applyCopyIndexToHueRotation(0.25, 7, 0), 0.25)
  assert.equal(applyCopyIndexToHueRotation(-0.25, 2, 1), -0.75)
})

test('Calm Hue Rotate exposes exactly two signed MIDI rows and is scrub-deterministic', () => {
  const rows = calmHueRotateColorizer.midiRows!(settings())
  assert.deepEqual(rows.map((row) => row.pitch), [60, 61])
  assert.deepEqual(rows.map((row) => row.label), [
    'Index hue spread clockwise (+)',
    'Index hue spread counter-clockwise (−)',
  ])
  assert.deepEqual(
    calmHueRotateColorizer.midiRows!(settings({ indexHue: 0 })).map((row) => row.label),
    ['Hue clockwise (+)', 'Hue counter-clockwise (−)'],
  )
  const notes = [note(1, 60, 3, 0.75), note(2, 61, 0.5)]
  const first = evaluateCalmHueRotation(notes, settings(), 2.25)
  evaluateCalmHueRotation(notes, settings(), 100)
  assert.equal(evaluateCalmHueRotation(notes, settings(), 2.25), first)
})
