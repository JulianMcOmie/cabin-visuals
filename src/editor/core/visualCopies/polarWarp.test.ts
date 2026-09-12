import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { radialSplitter } from './library'
import { getMoverOrSplitterDefinition } from './registry'
import { identityVisualCopy } from './identityVisualCopy'
import { gatedMoverOrSplitter } from './copyTargets'
import { polarWarpMover, polarWarpRadius, resolvePolarWarpMotion } from './polarWarp'

const settings = { attack: 0.5, release: 0.75 }
const note = (petals = 5, beat = 0, durationBeats = 2): ResolvedNote => ({
  pitch: 35 + petals, beat, durationBeats, velocity: 1, blockStartBeat: 0, blockEndBeat: 128,
})
const near = (a: number, b: number, epsilon = 1e-8) => assert.ok(Math.abs(a-b) < epsilon, `${a} ≠ ${b}`)
const input = () => ({ ...identityVisualCopy(), transform: new Matrix4().makeTranslation(7, 2, 3) })

test('registered with only Attack/Release and the same count pitches as Radial', () => {
  assert.equal(getMoverOrSplitterDefinition('polarWarp'), polarWarpMover)
  assert.deepEqual(polarWarpMover.params.map((p) => p.key), ['attack', 'release'])
  const rows = polarWarpMover.midiRows!(settings)
  assert.deepEqual(rows.map((r) => r.pitch), radialSplitter.midiRows!({} as never).map((r) => r.pitch))
  assert.equal(rows[0].label, '32 petals')
  assert.equal(rows.at(-1)!.label, '1 petal')
})

test('one through 32 petals have exactly the requested number of radial maxima', () => {
  for (let petals = 1; petals <= 32; petals++) {
    for (let i = 0; i < petals; i++) {
      near(polarWarpRadius(2*Math.PI*i/petals, petals), 2)
      near(polarWarpRadius(2*Math.PI*(i+0.5)/petals, petals), 0.32)
    }
  }
})

test('attack gathers, hold sustains, release starts at note off and returns exactly home', () => {
  const sample = resolvePolarWarpMotion([note()], settings)
  near(sample(0).weights[4], 0)
  assert.ok(sample(0.1).weights[4] > 0.3)
  near(sample(0.5).weights[4], 1)
  near(sample(2).weights[4], 1)
  assert.ok(sample(2.25).weights[4] < 0.5)
  assert.deepEqual(sample(2.75).weights, Array(32).fill(0))
})

test('retargets and early note-off preserve position and velocity, including release retriggers', () => {
  const notes = [note(3, 0, 0.2), note(8, 0.3, 2), note(2, 0.45, 1)]
  const sample = resolvePolarWarpMotion(notes, settings)
  for (const beat of [0.2, 0.3, 0.45]) {
    const left = sample(beat - 1e-8), right = sample(beat)
    for (let i = 0; i < 32; i++) {
      near(left.weights[i], right.weights[i], 1e-6)
      near(left.velocity[i], right.velocity[i], 1e-5)
    }
  }
})

test('chords latch the largest simultaneous count until every held note releases', () => {
  const sample = resolvePolarWarpMotion([note(8, 0, 1), note(3, 0, 2)], settings)
  near(sample(1.5).weights[7], 1)
  near(sample(1.5).weights[2], 0)
  near(sample(2).weights[7], 1)
  assert.deepEqual(sample(2.75).weights, Array(32).fill(0))
})

test('out-of-range notes and zero-duration notes do not activate or hold the field', () => {
  const notes = [{ ...note(), pitch: 96 }, { ...note(), pitch: 35 }, note(4, 0, 0)]
  assert.deepEqual(resolvePolarWarpMotion(notes, settings)(1).weights, Array(32).fill(0))
})

test('zero attack/release are instantaneous and finite; duration knobs scale the motion', () => {
  const snap = resolvePolarWarpMotion([note()], { attack: 0, release: 0 })
  near(snap(0).weights[4], 1)
  near(snap(2).weights[4], 0)
  const slow = resolvePolarWarpMotion([note()], { attack: 1, release: 1.5 })
  const fast = resolvePolarWarpMotion([note()], settings)
  near(slow(0.4).weights[4], fast(0.2).weights[4])
  near(slow(2.6).weights[4], fast(2.3).weights[4])
})

test('strong attraction reshapes position and basis, preserves appearance, and does not mutate input', () => {
  const copy = input(), before = copy.transform.clone()
  copy.opacity = 0.43; copy.colorShift.hue = 0.2
  const entry = polarWarpMover.resolve({ settings, notes: [note()] })
  const out = entry.apply(copy, { beat: 1, index: 0, count: 1 })[0]
  const r = Math.hypot(7, 2), target = polarWarpRadius(Math.atan2(2, 7), 5)
  near(Math.hypot(out.transform.elements[12], out.transform.elements[13]), r + 0.96*(target-r))
  assert.ok(out.transform.elements[0] !== 1 && out.transform.elements[5] !== 1)
  assert.equal(out.opacity, 0.43); assert.equal(out.colorShift.hue, 0.2)
  assert.deepEqual(copy.transform, before)
  assert.deepEqual(entry.apply(copy, { beat: 2.75, index: 0, count: 1 })[0].transform, before)
})

test('world-space field is invariant to placement decomposition, including rotated scaled parents', () => {
  const entry = polarWarpMover.resolve({ settings, notes: [note()] })
  const placement = new Matrix4().makeTranslation(3, -2, 1)
    .multiply(new Matrix4().makeRotationZ(0.7)).scale(new Vector3(2, 0.6, 1.2))
  const copy = input()
  const world = placement.clone().multiply(copy.transform)
  const placed = entry.apply(copy, { beat: 1, index: 0, count: 1, placementTransform: placement })[0]
  const direct = entry.apply({ ...copy, transform: world }, { beat: 1, index: 0, count: 1 })[0]
  placement.multiply(placed.transform).elements.forEach((v, i) => near(v, direct.transform.elements[i]))
})

test('center and singular placement remain finite; seeking backwards reproduces the same transform', () => {
  const entry = polarWarpMover.resolve({ settings, notes: [note(), note(9, 3)] })
  const copy = identityVisualCopy()
  const at = (beat: number) => entry.apply(copy, { beat, index: 0, count: 1 })[0].transform.elements
  const first = [...at(0.25)]
  at(4); at(0); assert.deepEqual(at(0.25), first)
  assert.ok(at(1).every(Number.isFinite))
  const singular = new Matrix4().makeScale(0, 0, 0)
  assert.deepEqual(entry.apply(input(), { beat: 1, index: 0, count: 1, placementTransform: singular })[0].transform, input().transform)
})

test('copy targeting leaves unselected copies unchanged', () => {
  const entry = gatedMoverOrSplitter(polarWarpMover.resolve({ settings, notes: [note()] }), { rule: 'every', slices: 2, on: [0] })
  const copy = input()
  assert.notDeepEqual(entry.apply(copy, { beat: 1, index: 0, count: 4 })[0].transform, copy.transform)
  assert.deepEqual(entry.apply(copy, { beat: 1, index: 1, count: 4 })[0].transform, copy.transform)
})
