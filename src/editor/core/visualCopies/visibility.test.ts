import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResolvedNote } from '../visual/types'
import {
  evaluateVisibilityOpacity,
  visibilityMover,
  type VisibilitySettings,
} from './library'
import { resolveVisualCopies } from './resolveVisualCopies'

const defaults: VisibilitySettings = {
  grouping: 0,
  attackBeats: 0,
  decayBeats: 0,
  sustainLevel: 1,
  releaseBeats: 0.05,
}

function note(beat: number, pitch: number, durationBeats = 1): ResolvedNote {
  return { beat, pitch, durationBeats, velocity: 0.2, blockStartBeat: 0, blockEndBeat: 1024 }
}

function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`)
}

test('visibility defaults are instant attack, full sustain, and quick release', () => {
  assert.equal(evaluateVisibilityOpacity([note(1, 127, 2)], 1, 0, 4, defaults), 1)
  assert.equal(evaluateVisibilityOpacity([note(1, 127, 2)], 2.5, 0, 4, defaults), 1)
  close(evaluateVisibilityOpacity([note(1, 127, 2)], 3.025, 0, 4, defaults), 0.5)
  assert.equal(evaluateVisibilityOpacity([note(1, 127, 2)], 3.05, 0, 4, defaults), 0)
})

test('one MIDI row controls each prior index and inactive indices stay at opacity zero', () => {
  const resolved = visibilityMover.resolve({
    settings: defaults,
    notes: [note(0, 127, 4), note(1, 125, 2)],
  })
  const at = (beat: number) => resolveVisualCopies([{
    apply(copy) {
      return Array.from({ length: 4 }, () => ({
        transform: copy.transform.clone(),
        opacity: copy.opacity,
        colorShift: { ...copy.colorShift },
      }))
    },
  }, resolved], beat).map((copy) => copy.opacity)

  assert.deepEqual(at(0.5), [1, 0, 0, 0])
  assert.deepEqual(at(1.5), [1, 0, 1, 0])
  assert.deepEqual(at(10), [0, 0, 0, 0])
})

test('adding visibility with no notes blacks out every prior copy immediately', () => {
  const resolved = visibilityMover.resolve({ settings: defaults, notes: [] })
  const copies = resolveVisualCopies([{
    apply(copy) {
      return Array.from({ length: 4 }, () => ({
        transform: copy.transform.clone(),
        opacity: copy.opacity,
        colorShift: { ...copy.colorShift },
      }))
    },
  }, resolved], 0)
  assert.deepEqual(copies.map((copy) => copy.opacity), [0, 0, 0, 0])
})

test('percentage grouping maps each note to a proportional range of prior indices', () => {
  const settings = { ...defaults, grouping: 25 }
  const gates = [note(0, 126, 4)] // second 25% group
  const opacities = Array.from({ length: 8 }, (_, index) =>
    evaluateVisibilityOpacity(gates, 1, index, 8, settings),
  )
  assert.deepEqual(opacities, [0, 0, 1, 1, 0, 0, 0, 0])
})

test('visibility ADSR is adjustable and remains a pure function of beat', () => {
  const settings: VisibilitySettings = {
    grouping: 0,
    attackBeats: 0.5,
    decayBeats: 0.5,
    sustainLevel: 0.4,
    releaseBeats: 1,
  }
  const notes = [note(0, 127, 2)]
  assert.equal(evaluateVisibilityOpacity(notes, 0.25, 0, 1, settings), 0.5)
  assert.equal(evaluateVisibilityOpacity(notes, 0.75, 0, 1, settings), 0.7)
  assert.equal(evaluateVisibilityOpacity(notes, 1.5, 0, 1, settings), 0.4)
  assert.equal(evaluateVisibilityOpacity(notes, 2.5, 0, 1, settings), 0.2)
  const first = evaluateVisibilityOpacity(notes, 0.75, 0, 1, settings)
  evaluateVisibilityOpacity(notes, 20, 0, 1, settings)
  assert.equal(evaluateVisibilityOpacity(notes, 0.75, 0, 1, settings), first)
})

test('visibility MIDI rows label indices or percentage groups', () => {
  const indexRows = visibilityMover.midiRows!(defaults, { priorCount: 3 })
  assert.deepEqual(indexRows, [
    { pitch: 127, label: 'Index 1' },
    { pitch: 126, label: 'Index 2' },
    { pitch: 125, label: 'Index 3' },
  ])
  const groupRows = visibilityMover.midiRows!({ ...defaults, grouping: 25 }, { priorCount: 8 })
  assert.deepEqual(groupRows.map((row) => row.label), ['0–25%', '25–50%', '50–75%', '75–100%'])
})
