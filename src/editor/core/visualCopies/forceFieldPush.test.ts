import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { mergeDefinitionSettings } from './definitions'
import {
  FORCE_FIELD_IN_OUT_PITCH,
  FORCE_FIELD_INWARD_PITCH,
  FORCE_FIELD_OUT_IN_PITCH,
  FORCE_FIELD_OUTWARD_PITCH,
  FORCE_FIELD_TWIST_PITCH,
  evaluateForceFieldPulse,
  evaluateForceFieldTwist,
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

function localX(copy: VisualCopy): [number, number, number] {
  const e = copy.transform.elements
  const round = (value: number) => Math.round(value * 1e9) / 1e9 || 0
  return [round(e[0]), round(e[1]), round(e[2])]
}

function apply(input: VisualCopy, p: ForceFieldPushSettings, notes: ResolvedNote[], beat: number): VisualCopy {
  return forceFieldPushMover.resolve({ settings: p, notes }).apply(input, { beat, index: 0, count: 1 })[0]
}

test('force field pulse is registered with five discrete gesture rows', () => {
  const definition = getMoverOrSplitterDefinition('forceFieldPush')
  assert.equal(definition?.kind, 'mover')
  assert.equal(definition?.label, 'Force Field Pulse')
  assert.equal(definition?.strictMidiRows, true)
  assert.deepEqual(definition!.midiRows!(settings()), [
    { pitch: FORCE_FIELD_OUTWARD_PITCH, label: 'Pulse outward' },
    { pitch: FORCE_FIELD_INWARD_PITCH, label: 'Pulse inward' },
    { pitch: FORCE_FIELD_IN_OUT_PITCH, label: 'Anticipate inward → strike outward' },
    { pitch: FORCE_FIELD_OUT_IN_PITCH, label: 'Anticipate outward → strike inward' },
    { pitch: FORCE_FIELD_TWIST_PITCH, label: 'Spiral twist pulse' },
  ])
})

test('direction notes make fluid temporary pulses and overlapping strikes stack', () => {
  const p = settings({ pulseBeats: 1 })
  const outward = note(1, FORCE_FIELD_OUTWARD_PITCH, 0.01)
  const inward = note(1, FORCE_FIELD_INWARD_PITCH, 10)
  assert.equal(evaluateForceFieldPulse([outward], p, 1), 0)
  assert.equal(evaluateForceFieldPulse([outward], p, 1.2), 1, 'quick attack reaches its outward peak')
  assert.ok(evaluateForceFieldPulse([outward], p, 1.6) > 0, 'the return remains fluid')
  assert.equal(evaluateForceFieldPulse([outward], p, 2), 0, 'the pulse returns home')
  assert.equal(evaluateForceFieldPulse([inward], p, 1.2), -1)
  assert.equal(evaluateForceFieldPulse([outward, outward], p, 1.2), 2, 'same-direction hits add')
  assert.equal(evaluateForceFieldPulse([outward, inward], p, 1.2), 0, 'opposite hits cancel')
})

test('velocity scales push and unknown pitches are ignored', () => {
  const p = settings()
  assert.equal(evaluateForceFieldPulse(
    [note(0, 30, 4), note(0, FORCE_FIELD_OUTWARD_PITCH, 2, 0.5)],
    p,
    0.2,
  ), 0.5)
  assert.equal(evaluateForceFieldPulse([note(5, FORCE_FIELD_OUTWARD_PITCH)], p, 4), 0)
})

test('transition rows anticipate before onset, reverse at the strike, and return home', () => {
  const p = settings({ anticipationBeats: 0.5, pulseBeats: 1, rebound: 0.65 })
  const inwardThenOut = note(2, FORCE_FIELD_IN_OUT_PITCH)
  const outwardThenIn = note(2, FORCE_FIELD_OUT_IN_PITCH)

  assert.equal(evaluateForceFieldPulse([inwardThenOut], p, 1.5), 0)
  assert.equal(evaluateForceFieldPulse([inwardThenOut], p, 1.75), -0.5)
  assert.equal(evaluateForceFieldPulse([inwardThenOut], p, 2), -1, 'fully sucked inward at onset')
  assert.equal(evaluateForceFieldPulse([inwardThenOut], p, 2.2), 0.65, 'then strikes outward')
  assert.equal(evaluateForceFieldPulse([inwardThenOut], p, 3), 0)

  assert.equal(evaluateForceFieldPulse([outwardThenIn], p, 1.75), 0.5)
  assert.equal(evaluateForceFieldPulse([outwardThenIn], p, 2), 1)
  assert.equal(evaluateForceFieldPulse([outwardThenIn], p, 2.2), -0.65)
})

test('twist notes form a radius-dependent spiral around the field center', () => {
  const p = settings({ pulseBeats: 1, twistDegrees: 90 })
  const twist = note(0, FORCE_FIELD_TWIST_PITCH, 0.01)
  assert.equal(evaluateForceFieldTwist([twist], p, 0), 0)
  assert.equal(evaluateForceFieldTwist([twist], p, 0.2), 90)
  assert.equal(evaluateForceFieldTwist([twist, twist], p, 0.2), 180)
  assert.equal(evaluateForceFieldTwist([twist], p, 1), 0)

  const near = apply(copyAt(1, 0, 0), p, [twist], 0.2)
  assert.deepEqual(positionOf(near), [0, 1, 0], 'one unit out turns 90°')
  assert.deepEqual(localX(near), [0, 1, 0])
  const far = apply(copyAt(2, 0, 0), p, [twist], 0.2)
  assert.deepEqual(positionOf(far), [-2, 0, 0], 'two units out turns 180°')
  assert.deepEqual(localX(far), [-1, 0, 0])
  const angled = apply(copyAt(0, 1, 0), p, [twist], 0.2)
  assert.deepEqual(positionOf(angled), [-1, 0, 0], 'the turn starts from each copy’s polar angle')
  const atCenter = apply(copyAt(0, 0, 0), p, [twist], 0.2)
  assert.deepEqual(positionOf(atCenter), [0, 0, 0])
  assert.deepEqual(localX(atCenter), [1, 0, 0], 'the spiral has a quiet, well-defined center')
  assert.deepEqual(positionOf(apply(copyAt(2, 0, 0), p, [twist], 1)), [2, 0, 0])
})

test('radial and twist notes combine into one spiral pulse', () => {
  const p = settings({ distanceMode: 0, strength: 1, twistDegrees: 90 })
  const output = apply(copyAt(2, 0, 0), p, [
    note(0, FORCE_FIELD_OUTWARD_PITCH),
    note(0, FORCE_FIELD_TWIST_PITCH),
  ], 0.2)
  // The push first expands radius 2 → 3, making the 90°/unit twist turn 270°.
  assert.deepEqual(positionOf(output), [0, -3, 0])
})

test('proportional mode offsets along the center-to-copy ray', () => {
  const input = copyAt(4, 6, 0)
  const output = apply(
    input,
    settings({ centerX: 1, centerY: 2, strength: 2, distanceFactor: 0.5 }),
    [note(0, FORCE_FIELD_OUTWARD_PITCH)],
    0.2,
  )
  // Relative position is (3, 4, 0), distance 5. Peak push magnitude is
  // pulse 1 * strength 2 * distance 5 * factor 0.5 = 5.
  assert.deepEqual(positionOf(output), [7, 10, 0])
  assert.deepEqual(positionOf(input), [4, 6, 0], 'input copy is not mutated')
})

test('inward notes reverse the ray and constant mode ignores distance', () => {
  const p = settings({ distanceMode: 0, strength: 2, distanceFactor: 9 })
  const near = apply(copyAt(1, 0, 0), p, [note(0, FORCE_FIELD_INWARD_PITCH)], 0.2)
  const far = apply(copyAt(10, 0, 0), p, [note(0, FORCE_FIELD_INWARD_PITCH)], 0.2)
  assert.deepEqual(positionOf(near), [-1, 0, 0])
  assert.deepEqual(positionOf(far), [8, 0, 0])
})

test('a copy at the center stays put because no radial direction exists', () => {
  const p = settings({ centerX: 2, centerY: -3, centerZ: 4 })
  const output = apply(copyAt(2, -3, 4), p, [note(0, FORCE_FIELD_OUTWARD_PITCH)], 0.2)
  assert.deepEqual(positionOf(output), [2, -3, 4])
})

test('runtime placement makes unsplit objects respond to their actual position', () => {
  const mover = forceFieldPushMover.resolve({
    settings: settings(),
    notes: [note(0, FORCE_FIELD_OUTWARD_PITCH)],
  })
  const placement = new Matrix4().makeTranslation(3, 4, 0)
  const output = resolveVisualCopies([mover], 0.2, placement)[0]
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
    0.2,
  )
  assert.deepEqual(positionOf(output), [0, 3, 0])
  assert.equal(output.opacity, 0.4)
  assert.equal(output.colorShift.hue, 0.2)
})

test('evaluation is pure when scrubbing between beats', () => {
  const resolved = forceFieldPushMover.resolve({
    settings: settings(),
    notes: [note(1, FORCE_FIELD_OUTWARD_PITCH, 0.01, 0.7)],
  })
  const at = (beat: number) => positionOf(resolved.apply(copyAt(2, 1, 0), { beat, index: 0, count: 1 })[0])
  const first = at(2.35)
  at(0)
  at(100)
  assert.deepEqual(at(2.35), first)
})
