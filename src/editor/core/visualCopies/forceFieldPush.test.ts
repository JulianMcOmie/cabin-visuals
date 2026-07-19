import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { mergeDefinitionSettings } from './definitions'
import {
  FORCE_FIELD_INWARD_PITCH,
  FORCE_FIELD_OUTWARD_PITCH,
  evaluateForceFieldPush,
  forceFieldPushMover,
  type ForceFieldPushSettings,
} from './forceFieldPush'
import { identityVisualCopy } from './identityVisualCopy'
import { getMoverOrSplitterDefinition } from './registry'
import { resolveVisualCopies } from './resolveVisualCopies'
import type { VisualCopy } from './types'

function note(beat: number, pitch: number, durationBeats = 1, velocity = 1): ResolvedNote {
  return { beat, pitch, durationBeats, velocity, blockStartBeat: 0, blockEndBeat: 1024 }
}

function settings(overrides: Partial<ForceFieldPushSettings> = {}): ForceFieldPushSettings {
  return {
    ...mergeDefinitionSettings(forceFieldPushMover, undefined),
    ...overrides,
  } as unknown as ForceFieldPushSettings
}

function copyAt(x: number, y: number, z: number): VisualCopy {
  const copy = identityVisualCopy()
  copy.transform.makeTranslation(x, y, z)
  return copy
}

function positionOf(copy: VisualCopy): [number, number, number] {
  const e = copy.transform.elements
  const round = (value: number) => Math.round(value * 1e9) / 1e9 || 0
  return [round(e[12]), round(e[13]), round(e[14])]
}

function apply(input: VisualCopy, p: ForceFieldPushSettings, notes: ResolvedNote[], beat: number): VisualCopy {
  return forceFieldPushMover.resolve({ settings: p, notes }).apply(input, { beat, index: 0, count: 1 })[0]
}

test('force field push is registered with exactly two direction rows', () => {
  const definition = getMoverOrSplitterDefinition('forceFieldPush')
  assert.equal(definition?.kind, 'mover')
  assert.equal(definition?.label, 'Force Field Push')
  assert.equal(definition?.strictMidiRows, true)
  assert.deepEqual(definition!.midiRows!(settings()), [
    { pitch: FORCE_FIELD_OUTWARD_PITCH, label: 'Push outward' },
    { pitch: FORCE_FIELD_INWARD_PITCH, label: 'Push inward' },
  ])
})

test('direction notes accumulate while held, persist after release, and cancel', () => {
  const outward = note(1, FORCE_FIELD_OUTWARD_PITCH, 2)
  assert.equal(evaluateForceFieldPush([outward], 1), 0)
  assert.equal(evaluateForceFieldPush([outward], 2), 1)
  assert.equal(evaluateForceFieldPush([outward], 20), 2)
  assert.equal(evaluateForceFieldPush([
    outward,
    note(1, FORCE_FIELD_INWARD_PITCH, 2),
  ], 20), 0)
})

test('velocity scales push and unknown pitches are ignored', () => {
  assert.equal(evaluateForceFieldPush([note(0, 30, 4), note(0, FORCE_FIELD_OUTWARD_PITCH, 2, 0.5)], 10), 1)
  assert.equal(evaluateForceFieldPush([note(5, FORCE_FIELD_OUTWARD_PITCH)], 4), 0)
})

test('proportional mode offsets along the center-to-copy ray', () => {
  const input = copyAt(4, 6, 0)
  const output = apply(
    input,
    settings({ centerX: 1, centerY: 2, strength: 2, distanceFactor: 0.5 }),
    [note(0, FORCE_FIELD_OUTWARD_PITCH, 0.5)],
    1,
  )
  // Relative position is (3, 4, 0), distance 5. Push magnitude is
  // 0.5 beats * strength 2 * distance 5 * factor 0.5 = 2.5.
  assert.deepEqual(positionOf(output), [5.5, 8, 0])
  assert.deepEqual(positionOf(input), [4, 6, 0], 'input copy is not mutated')
})

test('inward notes reverse the ray and constant mode ignores distance', () => {
  const p = settings({ distanceMode: 0, strength: 2, distanceFactor: 9 })
  const near = apply(copyAt(1, 0, 0), p, [note(0, FORCE_FIELD_INWARD_PITCH)], 1)
  const far = apply(copyAt(10, 0, 0), p, [note(0, FORCE_FIELD_INWARD_PITCH)], 1)
  assert.deepEqual(positionOf(near), [-1, 0, 0])
  assert.deepEqual(positionOf(far), [8, 0, 0])
})

test('a copy at the center stays put because no radial direction exists', () => {
  const p = settings({ centerX: 2, centerY: -3, centerZ: 4 })
  const output = apply(copyAt(2, -3, 4), p, [note(0, FORCE_FIELD_OUTWARD_PITCH, 10)], 5)
  assert.deepEqual(positionOf(output), [2, -3, 4])
})

test('runtime placement makes unsplit objects respond to their actual position', () => {
  const mover = forceFieldPushMover.resolve({
    settings: settings(),
    notes: [note(0, FORCE_FIELD_OUTWARD_PITCH)],
  })
  const placement = new Matrix4().makeTranslation(3, 4, 0)
  const output = resolveVisualCopies([mover], 1, placement)[0]
  const rendered = placement.clone().multiply(output.transform)
  assert.deepEqual(positionOf({ ...output, transform: rendered }), [6, 8, 0])
})

test('field translation uses chain-root coordinates and preserves appearance', () => {
  const input = identityVisualCopy()
  input.transform = new Matrix4().makeRotationZ(Math.PI / 2)
    .multiply(new Matrix4().makeTranslation(2, 0, 0))
  input.opacity = 0.4
  input.colorShift.hue = 0.2

  // The accumulated position is (0, 2), so the field must push toward +Y.
  // Local post-multiplication would incorrectly push toward -X/+X instead.
  const output = apply(
    input,
    settings({ distanceMode: 0 }),
    [note(0, FORCE_FIELD_OUTWARD_PITCH)],
    1,
  )
  assert.deepEqual(positionOf(output), [0, 3, 0])
  assert.equal(output.opacity, 0.4)
  assert.equal(output.colorShift.hue, 0.2)
})

test('evaluation is pure when scrubbing between beats', () => {
  const resolved = forceFieldPushMover.resolve({
    settings: settings(),
    notes: [note(1, FORCE_FIELD_OUTWARD_PITCH, 4, 0.7)],
  })
  const at = (beat: number) => positionOf(resolved.apply(copyAt(2, 1, 0), { beat, index: 0, count: 1 })[0])
  const first = at(2.35)
  at(0)
  at(100)
  assert.deepEqual(at(2.35), first)
})
