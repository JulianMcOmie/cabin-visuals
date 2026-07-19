import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResolvedNote } from '../visual/types'
import { mergeDefinitionSettings } from './definitions'
import {
  PARAMETRIC_PATTERNS,
  PATTERN_MIDI,
  evaluatePatternMidi,
  parametricPatternPosition,
  parametricPatternSplitter,
  type ParametricPatternSettings,
} from './parametricPattern'
import { getMoverOrSplitterDefinition } from './registry'
import { resolveVisualCopies } from './resolveVisualCopies'

function settings(overrides: Partial<ParametricPatternSettings> = {}): ParametricPatternSettings {
  return {
    ...mergeDefinitionSettings(parametricPatternSplitter, undefined),
    ...overrides,
  } as unknown as ParametricPatternSettings
}

function note(beat: number, pitch: number, durationBeats = 1, velocity = 1): ResolvedNote {
  return { beat, pitch, durationBeats, velocity, blockStartBeat: 0, blockEndBeat: 1024 }
}

function roundedPosition(pattern: number): [number, number, number] {
  const p = parametricPatternPosition(3, 32, settings({ pattern }))
  return [p.x, p.y, p.z].map((value) => Number(value.toFixed(8))) as [number, number, number]
}

test('one registered splitter exposes all six selectable pattern functions', () => {
  const definition = getMoverOrSplitterDefinition('parametricPattern')
  assert.equal(definition?.kind, 'splitter')
  assert.equal(definition?.label, 'Parametric Pattern')
  const patternParam = definition?.params.find((param) => param.key === 'pattern')
  assert.equal(patternParam?.type, 'select')
  if (patternParam?.type === 'select') {
    assert.deepEqual(patternParam.options.map((option) => option.label), [...PARAMETRIC_PATTERNS])
  }
})

test('copy count is structural and unchanged by pattern or MIDI', () => {
  for (let pattern = 0; pattern < PARAMETRIC_PATTERNS.length; pattern++) {
    const p = settings({ pattern, copies: 37 })
    const resolved = parametricPatternSplitter.resolve({
      settings: p,
      notes: [note(0, PATTERN_MIDI.frequencyAUp, 8), note(0, PATTERN_MIDI.amountUp, 8)],
    })
    assert.equal(resolveVisualCopies([resolved], 0).length, 37)
    assert.equal(resolveVisualCopies([resolved], 7.5).length, 37)
  }
})

test('all pattern modes produce finite, distinct geometry', () => {
  const positions = PARAMETRIC_PATTERNS.map((_, pattern) => roundedPosition(pattern))
  for (const position of positions) assert.ok(position.every(Number.isFinite))
  assert.equal(new Set(positions.map((position) => position.join(','))).size, PARAMETRIC_PATTERNS.length)
})

test('polar rose uses both frequencies through the Shape harmonic mix', () => {
  const primary = parametricPatternPosition(1, 12, settings({ pattern: 0, shape: 0 }))
  const secondary = parametricPatternPosition(1, 12, settings({ pattern: 0, shape: 1 }))
  assert.notDeepEqual(primary.toArray(), secondary.toArray())
})

test('continuous MIDI rows integrate duration and velocity in opposite directions', () => {
  const p = settings({ midiAmountRate: 2, midiPhaseRate: 120 })
  const offsets = evaluatePatternMidi([
    note(0, PATTERN_MIDI.amountUp, 2, 0.5),
    note(0, PATTERN_MIDI.amountDown, 0.5),
    note(0, PATTERN_MIDI.phaseForward, 1),
    note(0, PATTERN_MIDI.phaseBackward, 0.25),
  ], p, 10)
  assert.equal(offsets.amount, 1)
  assert.equal(offsets.phaseDegrees, 90)
})

test('frequency notes make integer steps and Reset clears prior MIDI offsets', () => {
  const p = settings()
  const notes = [
    note(0, PATTERN_MIDI.frequencyAUp),
    note(1, PATTERN_MIDI.frequencyAUp),
    note(2, PATTERN_MIDI.frequencyBDown),
    note(3, PATTERN_MIDI.reset),
    note(4, PATTERN_MIDI.frequencyBUp),
  ]
  assert.deepEqual(evaluatePatternMidi(notes, p, 2.5), {
    amount: 0,
    phaseDegrees: 0,
    frequencyA: 2,
    frequencyB: -1,
  })
  assert.deepEqual(evaluatePatternMidi(notes, p, 5), {
    amount: 0,
    phaseDegrees: 0,
    frequencyA: 0,
    frequencyB: 1,
  })
})

test('the splitter exposes only its compact nine-note MIDI palette', () => {
  const rows = parametricPatternSplitter.midiRows!(settings())
  assert.equal(parametricPatternSplitter.strictMidiRows, true)
  assert.equal(rows.length, 9)
  assert.deepEqual(rows.map((row) => row.pitch), [60, 61, 62, 63, 64, 65, 66, 67, 68])
})

test('plane and orientation settings change transforms without changing positions or opacity ownership', () => {
  const fixed = resolveVisualCopies([
    parametricPatternSplitter.resolve({ settings: settings({ copies: 8, orientation: 0 }), notes: [] }),
  ], 0)
  const following = resolveVisualCopies([
    parametricPatternSplitter.resolve({ settings: settings({ copies: 8, orientation: 2 }), notes: [] }),
  ], 0)
  assert.deepEqual(fixed.map((copy) => copy.transform.elements.slice(12, 15)), following.map((copy) => copy.transform.elements.slice(12, 15)))
  assert.notDeepEqual(fixed[0].transform.elements.slice(0, 12), following[0].transform.elements.slice(0, 12))
  assert.ok(following.every((copy) => copy.opacity === 1))

  const xy = parametricPatternPosition(2, 10, settings({ plane: 0 }))
  const yz = parametricPatternPosition(2, 10, settings({ plane: 2 }))
  assert.deepEqual(yz.toArray(), [xy.z, xy.x, xy.y])
})

test('MIDI evaluation and generated transforms are scrub-deterministic', () => {
  const resolved = parametricPatternSplitter.resolve({
    settings: settings({ pattern: 2, copies: 12 }),
    notes: [note(1, PATTERN_MIDI.phaseForward, 5, 0.7), note(2, PATTERN_MIDI.frequencyBUp)],
  })
  const at = (beat: number) => resolveVisualCopies([resolved], beat).map((copy) => [...copy.transform.elements])
  const first = at(3.25)
  at(0)
  at(100)
  assert.deepEqual(at(3.25), first)
})
