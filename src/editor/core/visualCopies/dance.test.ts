import test from 'node:test'
import assert from 'node:assert/strict'
import { Matrix4 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { flattenBlocks } from '../visual/noteFlatten'
import { danceMover } from './dance'
import { prepareDanceCurves, sampleDanceAxis, type DanceSegment } from './danceCurve'
import { identityVisualCopy } from './identityVisualCopy'
import { getMoverOrSplitterDefinition } from './registry'
import { withCopyEvaluation } from './evaluationMemo'

const note = (beat: number, pitch = 60): ResolvedNote => ({
  beat, pitch, blockStartBeat: -100, blockEndBeat: 100000, durationBeats: 0.25, velocity: 1,
})
const defaults = { distanceX: 1, distanceY: 1, distanceZ: 1 }
const close = (actual: number, expected: number, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`)

/** Independently differentiate the stored polynomial with respect to BEATS,
 * not normalized segment time, to catch duration/uneven-spacing mistakes. */
function derivative(segment: DanceSegment, u: number, order: number): number {
  let result = 0
  for (let power = order; power < segment.coefficients.length; power++) {
    let coefficient = segment.coefficients[power]
    for (let k = 0; k < order; k++) coefficient *= power - k
    result += coefficient * u ** (power - order)
  }
  return result / (segment.end - segment.start) ** order
}

for (const times of [[2], [1, 2, 3, 4], [0, 0.125, 3, 3.03, 3.5, 17], [1, 1.00001, 1.00003, 2, 1000]]) {
  test(`C2 at every crossing, turnaround and stationary boundary: ${times}`, () => {
    const curve = prepareDanceCurves(times.map(t => note(t)))[0]
    const segments = curve.segments
    for (let i = 0; i < segments.length; i++) {
      const current = segments[i]
      assert.ok(current.end > current.start)
      for (let order = 0; order <= 2; order++) {
        if (i === 0) close(derivative(current, 0, order), 0)
        if (i === segments.length - 1) close(derivative(current, 1, order), 0)
        else {
          assert.equal(current.end, segments[i + 1].start)
          close(derivative(current, 1, order), derivative(segments[i + 1], 0, order), 2e-7)
        }
      }
      for (let i = 0; i <= 100; i++) {
        const beat = current.start + (current.end - current.start) * i / 100
        assert.ok(Math.abs(sampleDanceAxis(curve, beat)) <= 1 + 1e-8, 'swing must stay bounded')
      }
    }
    curve.beats.forEach((beat, index) => {
      close(sampleDanceAxis(curve, beat), 0)
      const before = segments.find(segment => segment.end === beat)!
      const after = segments.find(segment => segment.start === beat)!
      const speed = derivative(after, 0, 1)
      assert.ok(Math.abs(speed) > 0, 'a beat must never be a turnaround')
      assert.equal(Math.sign(speed), index % 2 === 0 ? 1 : -1)
      close(derivative(before, 1, 1), speed, 2e-7)
      for (let i = 1; i <= 100; i++) {
        const u = i / 100
        assert.ok(Math.abs(derivative(before, 1 - u, 1)) < Math.abs(speed) + 1e-8)
        assert.ok(Math.abs(derivative(after, u, 1)) < Math.abs(speed) + 1e-8)
      }
      assert.ok(Math.abs(derivative(before, 0.99, 1)) < Math.abs(speed))
      assert.ok(Math.abs(derivative(after, 0.01, 1)) < Math.abs(speed))
    })
  })
}

test('finite differences of playback converge to shared velocity and acceleration at joins', () => {
  const curve = prepareDanceCurves([1, 2, 2.3, 5].map(t => note(t)))[0]
  for (const s of curve.segments.slice(1)) {
    const t = s.start, h = 1e-4
    const p = (offset: number) => sampleDanceAxis(curve, t + offset * h)
    close((p(0) - p(-1)) / h, (p(1) - p(0)) / h, 2e-5)
    // Four-point one-sided second derivatives cancel the O(h) jerk term:
    // jerk may jump here, but acceleration must have the same limit.
    close((2 * p(0) - 5 * p(-1) + 4 * p(-2) - p(-3)) / h ** 2,
      (2 * p(0) - 5 * p(1) + 4 * p(2) - p(3)) / h ** 2, 0.001)
  }
})

test('uniform notes give full swings and maximum speed exactly at the crossing', () => {
  const curve = prepareDanceCurves([1, 2, 3].map(t => note(t)))[0]
  close(sampleDanceAxis(curve, 1.5), 1)
  close(sampleDanceAxis(curve, 2.5), -1)
  close((sampleDanceAxis(curve, 1.00001) - sampleDanceAxis(curve, 0.99999)) / 0.00002, 4)
})

test('duplicate and near-coincident notes coalesce, chords keep independent axes, other pitches drop', () => {
  const notes = [note(2), note(1), note(1), note(1 + 0.5e-6), note(1, 62), note(1, 64), note(1, 61), note(NaN), note(Infinity)]
  const snapshot = notes.map(n => ({ ...n }))
  const curves = prepareDanceCurves(notes)
  assert.deepEqual(curves.map(c => c.beats), [[1, 2], [1], [1]])
  assert.deepEqual(notes, snapshot, 'preparation must not mutate source notes')
  assert.deepEqual(curves, prepareDanceCurves([...notes].reverse()))
  const mover = danceMover.resolve({ notes, settings: { distanceX: 2, distanceY: 3, distanceZ: 4 } })
  const [copy] = mover.apply(identityVisualCopy(), { beat: 1.25, index: 0, count: 1 })
  for (let axis = 0; axis < 3; axis++) close(copy.transform.elements[12 + axis], sampleDanceAxis(curves[axis], 1.25) * (axis + 2))
})

test('clip and loop expansion preserve crossings at boundaries without motion resets', () => {
  const notes = flattenBlocks([{
    id: 'loop', startBar: 0, durationBars: 2, loop: true, loopLengthBars: 0.25,
    notes: [{ id: 'hit', startBeat: 0, durationBeats: 0.1, velocity: 100, pitch: 60 }],
  }, {
    id: 'next', startBar: 2, durationBars: 1, loop: false,
    notes: [{ id: 'next-hit', startBeat: 0, durationBeats: 4, velocity: 5, pitch: 60 }],
  }], 4, 3)
  const curve = prepareDanceCurves(notes)[0]
  assert.ok(curve.beats.includes(0) && curve.beats.includes(8))
  close(sampleDanceAxis(curve, 8), 0)
  assert.notEqual(sampleDanceAxis(curve, 7.999), sampleDanceAxis(curve, 8.001))
  assert.notEqual(sampleDanceAxis(curve, -0.25), 0, 'first crossing anticipates even before timeline zero')
  assert.equal(sampleDanceAxis(curve, -2), 0)
  assert.equal(sampleDanceAxis(curve, 10), 0)
  const clipped = prepareDanceCurves([
    { ...note(0), blockStartBeat: 1 }, { ...note(3), blockEndBeat: 3 },
  ])
  assert.equal(clipped[0].beats.length, 0)
})

test('note lengths and MIDI velocity are not movement keyframes', () => {
  const notes = [note(1), note(2), note(4)]
  assert.deepEqual(prepareDanceCurves(notes), prepareDanceCurves(notes.map((n, i) => ({
    ...n, durationBeats: i + 20, velocity: i * 50,
  }))))
})

test('registered local mover preserves copy channels, scales axes and agrees on arbitrary seeks', () => {
  assert.equal(getMoverOrSplitterDefinition('dance'), danceMover)
  assert.deepEqual(danceMover.midiRows!(defaults).map(row => row.pitch), [60, 62, 64])
  const notes = [note(1), note(2), note(3, 62)]
  const input = identityVisualCopy()
  input.transform.makeRotationZ(Math.PI / 2).setPosition(7, 8, 9)
  input.opacity = 0.4
  input.colorShift.tint = '#ff0000'
  const original = input.transform.clone()
  const entry = danceMover.resolve({ notes, settings: defaults })
  const curves = prepareDanceCurves(notes)
  const position = (beat: number) => entry.apply(input, { beat, index: 2, count: 10 })[0]
  const beats = [1.2, -2, 3.1, 1.2, 2, 20, 0, 2.2]
  withCopyEvaluation(() => {
    for (const beat of beats) {
      const copy = position(beat)
      const expected = original.clone().multiply(new Matrix4().makeTranslation(
        sampleDanceAxis(curves[0], beat), sampleDanceAxis(curves[1], beat), 0,
      ))
      assert.deepEqual(copy.transform, expected)
      assert.equal(copy.opacity, input.opacity)
      assert.deepEqual(copy.colorShift, input.colorShift)
      assert.deepEqual(copy, position(beat))
    }
  })
  assert.deepEqual(input.transform, original)
  const zero = danceMover.resolve({ notes, settings: { distanceX: 0, distanceY: 0, distanceZ: 0 } })
  assert.deepEqual(zero.apply(input, { beat: 1.2, index: 0, count: 1 })[0].transform, original)
})

test('curve cache survives knob re-resolution and invalidates with edited notes', () => {
  const notes = [note(1), note(2)]
  const curves = prepareDanceCurves(notes)
  for (let i = 0; i < 100; i++) {
    danceMover.resolve({ notes, settings: { ...defaults, distanceX: i / 10 } })
    assert.equal(prepareDanceCurves(notes), curves)
  }
  const edited = [note(1), note(2.5)]
  assert.notEqual(prepareDanceCurves(edited), curves)
  assert.notEqual(sampleDanceAxis(prepareDanceCurves(edited)[0], 1.5), sampleDanceAxis(curves[0], 1.5))
})

test('empty and invalid sample times rest at home; dense notes stay finite with bounded speed', () => {
  const empty = prepareDanceCurves([])
  for (const t of [-1, 0, 100, NaN, Infinity]) close(sampleDanceAxis(empty[0], t), 0)
  const curve = prepareDanceCurves(Array.from({ length: 10000 }, (_, i) => note(i * 0.00001)))[0]
  assert.equal(curve.beats.length, 10000)
  assert.equal(curve.segments.length, 20002)
  for (const segment of curve.segments) {
    assert.ok(Number.isFinite(sampleDanceAxis(curve, (segment.start + segment.end) / 2)))
    assert.ok(Math.abs(derivative(segment, 0, 1)) <= 256.0001)
  }
})
