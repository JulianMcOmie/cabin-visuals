import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResolvedNote } from '../visual/types'
import { mergeDefinitionSettings } from './definitions'
import {
  COLORIZER_FLASH_PITCH,
  SHAPE_EVEN,
  SHAPE_SPIKE,
  SHAPE_SWELL,
  evaluateColorizer,
  evaluateNoteEnvelope,
  noteColorizer,
  type ColorizerSettings,
} from './colorizer'
import { identityVisualCopy } from './identityVisualCopy'

function note(beat: number, durationBeats = 0.25, velocity = 1, pitch = COLORIZER_FLASH_PITCH): ResolvedNote {
  return { beat, pitch, durationBeats, velocity, blockStartBeat: 0, blockEndBeat: 1024 }
}

function settings(overrides: Partial<ColorizerSettings> = {}): ColorizerSettings {
  return {
    ...mergeDefinitionSettings(noteColorizer, undefined),
    ...overrides,
  } as unknown as ColorizerSettings
}

const close = (actual: number, expected: number, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`)

test('a zero-attack note flashes full intensity on its beat, then falls to nothing', () => {
  const opts = settings({ intensity: 1, attackBeats: 0, releaseBeats: 1, shape: SHAPE_EVEN })
  const notes = [note(2, 0)]
  assert.equal(evaluateColorizer(notes, opts, 1.9).tintAmount, 0)
  close(evaluateColorizer(notes, opts, 2).tintAmount, 1)
  close(evaluateColorizer(notes, opts, 2.5).tintAmount, 0.5)
  assert.equal(evaluateColorizer(notes, opts, 3).tintAmount, 0)
  assert.equal(evaluateColorizer(notes, opts, 9).tintAmount, 0)
})

test('ATTACK is never truncated by a shorter note: the attack always completes', () => {
  // A 16th-note hit with a half-beat swell still reaches full intensity.
  close(evaluateNoteEnvelope(note(0, 0.0625), 0.5, 0.5, 1, SHAPE_EVEN), 1)
  close(evaluateNoteEnvelope(note(0, 0.0625), 0.25, 0.5, 1, SHAPE_EVEN), 0.5)
})

test('the note is held at full while it sounds, then releases over RELEASE', () => {
  const held = note(0, 4)
  close(evaluateNoteEnvelope(held, 3.9, 0, 2, SHAPE_EVEN), 1)
  close(evaluateNoteEnvelope(held, 5, 0, 2, SHAPE_EVEN), 0.5)
  assert.equal(evaluateNoteEnvelope(held, 6, 0, 2, SHAPE_EVEN), 0)
})

test('SHAPE bends the release: SPIKE drops off a cliff, SWELL hangs on', () => {
  const halfway = (shape: number) => evaluateNoteEnvelope(note(0, 0), 0.5, 0, 1, shape)
  close(halfway(SHAPE_SPIKE), 0.125)
  close(halfway(SHAPE_EVEN), 0.5)
  close(halfway(SHAPE_SWELL), 0.5)
  // The distinguishing part of SWELL is the shoulder, not the midpoint.
  const quarter = (shape: number) => evaluateNoteEnvelope(note(0, 0), 0.25, 0, 1, shape)
  assert.ok(quarter(SHAPE_SWELL) > quarter(SHAPE_EVEN))
  assert.ok(quarter(SHAPE_EVEN) > quarter(SHAPE_SPIKE))
})

test('only the declared flash pitch triggers; the rest of the keyboard is inert', () => {
  const opts = settings({ intensity: 1, releaseBeats: 1 })
  assert.equal(evaluateColorizer([note(0, 0, 1, COLORIZER_FLASH_PITCH + 1)], opts, 0).tintAmount, 0)
  assert.equal(evaluateColorizer([note(0, 0, 1, 72)], opts, 0).tintAmount, 0)
  close(evaluateColorizer([note(0, 0)], opts, 0).tintAmount, 1)
})

test('velocity scales the flash, and INTENSITY caps how far it can ever go', () => {
  const opts = settings({ intensity: 0.5, attackBeats: 0, releaseBeats: 1, shape: SHAPE_EVEN })
  close(evaluateColorizer([note(0, 0, 1)], opts, 0).tintAmount, 0.5)
  close(evaluateColorizer([note(0, 0, 0.25)], opts, 0).tintAmount, 0.125)
  // The raw sound curve is reported unscaled, for the panel to draw.
  close(evaluateColorizer([note(0, 0, 0.25)], opts, 0).envelope, 0.25)
})

test('overlapping notes take the loudest rather than summing past the color', () => {
  const opts = settings({ intensity: 1, attackBeats: 0, releaseBeats: 1, shape: SHAPE_EVEN })
  const both = evaluateColorizer([note(0, 0, 0.6), note(0, 0, 0.9)], opts, 0)
  close(both.tintAmount, 0.9)
})

test('STAGGER delays each copy so one hit rolls across the split', () => {
  const opts = settings({ intensity: 1, staggerBeats: 0.25, attackBeats: 0, releaseBeats: 1, shape: SHAPE_EVEN })
  const notes = [note(0, 0)]
  close(evaluateColorizer(notes, opts, 0.5, 0).tintAmount, 0.5)
  close(evaluateColorizer(notes, opts, 0.5, 1).tintAmount, 0.75)
  close(evaluateColorizer(notes, opts, 0.5, 2).tintAmount, 1)
  assert.equal(evaluateColorizer(notes, opts, 0.5, 3).tintAmount, 0)
  // A negative stagger runs the wave the other way: later copies are further
  // along the decay instead of still waiting for the hit.
  const reversed = settings({ ...opts, staggerBeats: -0.25 })
  close(evaluateColorizer(notes, reversed, 0.5, 1).tintAmount, 0.25)
  assert.equal(evaluateColorizer(notes, reversed, 0.5, 2).tintAmount, 0)
})

test('the flash sets an absolute tint and leaves transform, opacity and HSL alone', () => {
  const input = identityVisualCopy()
  input.transform.makeTranslation(2, 3, 4)
  input.opacity = 0.4
  input.colorShift = { hue: 0.1, saturation: 0.2, lightness: -0.15, tint: null, tintAmount: 0 }
  const output = noteColorizer.resolve({
    settings: settings({ intensity: 1, attackBeats: 0, releaseBeats: 1, color: '#ff0066' }),
    notes: [note(0, 0)],
  }).apply(input, { beat: 0, index: 0, count: 1 })[0]

  assert.deepEqual(output.transform.elements, input.transform.elements)
  assert.notEqual(output.transform, input.transform)
  assert.equal(output.opacity, 0.4)
  assert.equal(output.colorShift.hue, 0.1)
  assert.equal(output.colorShift.saturation, 0.2)
  assert.equal(output.colorShift.lightness, -0.15)
  assert.equal(output.colorShift.tint, '#ff0066')
  close(output.colorShift.tintAmount, 1)
})

test('silence passes an upstream tint through instead of clearing it', () => {
  const input = identityVisualCopy()
  input.colorShift.tint = '#00ff88'
  input.colorShift.tintAmount = 0.5
  const output = noteColorizer.resolve({
    settings: settings({ releaseBeats: 0.25 }),
    notes: [note(0, 0)],
  }).apply(input, { beat: 8, index: 0, count: 1 })[0]
  assert.equal(output.colorShift.tint, '#00ff88')
  assert.equal(output.colorShift.tintAmount, 0.5)
})

test('the Colorizer declares exactly one MIDI row and is scrub-deterministic', () => {
  const rows = noteColorizer.midiRows!(settings())
  assert.deepEqual(rows, [{ pitch: COLORIZER_FLASH_PITCH, label: 'Color flash' }])
  assert.equal(noteColorizer.strictMidiRows, true)
  const notes = [note(1, 3, 0.75), note(2, 0.5)]
  const opts = settings({ staggerBeats: 0.1 })
  const first = evaluateColorizer(notes, opts, 2.25, 2)
  evaluateColorizer(notes, opts, 100, 2)
  assert.deepEqual(evaluateColorizer(notes, opts, 2.25, 2), first)
})

test('the color param defaults through mergeDefinitionSettings and can be stored', () => {
  assert.equal(mergeDefinitionSettings(noteColorizer, undefined).color, '#ffd166')
  assert.equal(mergeDefinitionSettings(noteColorizer, undefined, { color: '#123456' }).color, '#123456')
  // Numeric params keep coming from inputValues, untouched by the string pass.
  assert.equal(mergeDefinitionSettings(noteColorizer, { intensity: 0.2 }, { color: '#123456' }).intensity, 0.2)
})
