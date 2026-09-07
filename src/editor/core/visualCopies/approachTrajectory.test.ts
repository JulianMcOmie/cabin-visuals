import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import { approachTrajectory } from './approachTrajectory'
import { allocateApproachFlights, approachFlightsAt, approachFlightTransform, approachSplitter, type ApproachSettings } from './approach'
import { mergeDefinitionSettings } from './definitions'
import { resolveVisualCopies } from './resolveVisualCopies'
import type { ResolvedNote } from '../visual/types'

const defaults = mergeDefinitionSettings(approachSplitter, undefined) as unknown as ApproachSettings
const config = (overrides: Partial<ApproachSettings> = {}): ApproachSettings => ({ ...defaults, spawnMode: 2, ...overrides })
const note = (beat: number): ResolvedNote => ({ beat, pitch: 60, velocity: 1, durationBeats: 0.25, blockStartBeat: beat, blockEndBeat: beat + 4 })
const near = (actual: number, expected: number, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`)

test('both trajectories join rest at launch with continuous velocity and acceleration', () => {
  const h = 1e-4
  for (const settle of [false, true]) {
    const f = (u: number) => approachTrajectory(u, settle)
    assert.equal(f(-1), 0)
    assert.equal(f(0), 0)
    near((f(h) - f(0)) / h, 0, 1e-6)
    near((f(2 * h) - 2 * f(h) + f(0)) / (h * h), 0, 0.007)
  }
})

test('fly-through accelerates into and beyond the onset, with no derivative seam', () => {
  const f = (u: number) => approachTrajectory(u, false)
  const h = 1e-4
  assert.equal(f(1), 1)
  assert.ok(f(1 + h) > 1)
  for (const u of [0.25, 0.5, 1, 1.5]) {
    near((f(u + h) - f(u - h)) / (2 * h), 3 * u * u)
    near((f(u + h) - 2 * f(u) + f(u - h)) / (h * h), 6 * u, 1e-6)
  }
})

test('settle is monotonic and joins the target with zero velocity and acceleration', () => {
  const f = (u: number) => approachTrajectory(u, true)
  for (let i = 1; i <= 100; i++) assert.ok(f(i / 100) >= f((i - 1) / 100))
  assert.equal(f(1), 1)
  assert.equal(f(100), 1)
  const h = 1e-4
  near((f(1) - f(1 - h)) / h, 0, 1e-6)
  near((f(1) - 2 * f(1 - h) + f(1 - 2 * h)) / (h * h), 0, 0.007)
})

test('full splitter launches ahead of a future note and hits arbitrary XYZ exactly', () => {
  for (const arrival of [0, 1]) {
    const settings = config({ density: 1, startX: -3, startY: 2, startZ: -40, targetX: 5, targetY: -4, targetZ: 2, flightBeats: 3, arrival })
    const allocation = allocateApproachFlights(settings, [note(8)])
    assert.equal(allocation[0].startBeat, 5)
    const sample = (beat: number) => approachFlightTransform(approachFlightsAt(settings, allocation, beat)[0], settings, [1, 1, 1])
    assert.equal(sample(4.99).opacity, 0)
    assert.deepEqual(sample(5).transform.elements.slice(12, 15), [-3, 2, -40])
    assert.ok(sample(6).opacity > 0)
    assert.deepEqual(sample(8).transform.elements.slice(12, 15), [5, -4, 2])
    assert.equal(sample(8).opacity, 1)
    if (arrival) assert.deepEqual(sample(9).transform.elements.slice(12, 15), [5, -4, 2])
    else assert.ok(sample(9).transform.elements[14] > 2)
    assert.equal(sample(10).opacity, 0)
  }
})

test('onsets at beat zero still use pre-roll; coincident points remain finite', () => {
  const settings = config({ startZ: 0, targetZ: 0 })
  const claims = allocateApproachFlights(settings, [note(0)])
  assert.equal(claims[0].startBeat, -4)
  for (const beat of [-4, -2, 0, 1]) {
    const sample = approachFlightTransform(approachFlightsAt(settings, claims, beat)[0], settings, [1, 1, 1])
    assert.ok(sample.transform.elements.every(Number.isFinite))
    assert.deepEqual(sample.transform.elements.slice(12, 15), [0, 0, 0])
  }
})

test('placement compensation and local composition preserve target offsets', () => {
  const settings = config({ targetX: 4, targetY: 6, targetZ: 8 })
  const entry = approachSplitter.resolve({ settings, notes: [note(4)] })
  const previous = new Matrix4().makeTranslation(10, 20, 30)
  const [copy] = entry.apply({ transform: previous, opacity: 0.8, colorShift: { hue: 0, saturation: 0, lightness: 0, tint: null, tintAmount: 0 } },
    { beat: 4, index: 0, count: 1, placementTransform: new Matrix4().makeScale(2, 3, 4) })
  assert.deepEqual(copy.transform.elements.slice(12, 15), [12, 22, 32])
  assert.deepEqual(previous.elements.slice(12, 15), [10, 20, 30])
  assert.equal(copy.opacity, 0.8)
})

test('density exhaustion preserves admitted trajectories and reuses freed slots', () => {
  const settings = config({ density: 2, flightBeats: 2, afterBeats: 1 })
  const notes = [note(8), note(4), note(4), note(5)]
  const claims = allocateApproachFlights(settings, notes)
  assert.deepEqual(claims.map((claim) => claim.noteBeat), [4, 4, 8])
  assert.deepEqual(claims.map((claim) => claim.endBeat - claim.startBeat), [3, 3, 3])
  assert.deepEqual(notes.map((n) => n.beat), [8, 4, 4, 5], 'input is immutable')
})

test('playback, backwards seeks and export-style sampling agree on every matrix and opacity', () => {
  const settings = config({ density: 3 })
  const notes = [note(0), note(4), note(7)]
  const chain = [approachSplitter.resolve({ settings, notes })]
  const sample = (beat: number) => resolveVisualCopies(chain, beat).map((copy) => [copy.transform.elements, copy.opacity])
  const beats = [-4, -2, 0, 1, 2, 4, 5.99, 6, 7, 8.8, 9]
  const frames = beats.map(sample)
  for (let i = beats.length - 1; i >= 0; i--) assert.deepEqual(sample(beats[i]), frames[i])
  assert.ok(frames.every((frame) => frame.length === 3))
})

test('new defaults are opt-in for saved content and fly through is the flight default', () => {
  assert.equal(defaults.spawnMode, 0)
  assert.equal(defaults.arrival, 0)
  assert.equal(defaults.startZ, -24)
  for (const spawnMode of [0, 1]) {
    const original = { density: 8, speed: 5, depth: 24, size: 2, direction: 0, spawnMode, nearEnd: 12 }
    const merged = { ...defaults, ...original }
    for (const beat of [0, 3, 4, 5]) {
      const sample = (settings: ApproachSettings) => resolveVisualCopies([approachSplitter.resolve({ settings, notes: [note(4)] })], beat)
      assert.deepEqual(sample(original), sample(merged))
    }
  }
})
