import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResolvedNote } from '../visual/types'
import { mergeDefinitionSettings } from './definitions'
import {
  evaluateRadialMotionRadiusScale,
  evaluateRadialMotionSpinBeats,
  radialMotionMover,
  radialMotionRadiusPitch,
  radialMotionSpinPitch,
  type RadialMotionSettings,
} from './radialMotion'
import { getMoverOrSplitterDefinition } from './registry'
import { resolveVisualCopies } from './resolveVisualCopies'
import type { VisualCopy } from './types'

const DEFAULTS = mergeDefinitionSettings(radialMotionMover, undefined) as unknown as RadialMotionSettings

function settings(overrides: Partial<RadialMotionSettings> = {}): RadialMotionSettings {
  return { ...DEFAULTS, ...overrides }
}

/** One depth only, so a position is a single ring's arithmetic. */
function singleRing(overrides: Partial<RadialMotionSettings> = {}): RadialMotionSettings {
  return settings({
    copies0: 1, copies1: 1, copies2: 1,
    radius0: 1, radius1: 0, radius2: 0,
    spinZ0: 0, spinZ1: 0, spinZ2: 0,
    transitionBeats: 0,
    ...overrides,
  })
}

function note(beat: number, pitch: number): ResolvedNote {
  return { beat, blockStartBeat: 0, blockEndBeat: 1024, pitch, velocity: 1, durationBeats: 0.25 }
}

function positionOf(copy: VisualCopy): [number, number, number] {
  const e = copy.transform.elements
  const rounded = (value: number) => Math.round(value * 1e8) / 1e8 || 0
  return [rounded(e[12]), rounded(e[13]), rounded(e[14])]
}

function positionsAt(s: RadialMotionSettings, beat: number, notes: ResolvedNote[] = []) {
  return resolveVisualCopies([radialMotionMover.resolve({ settings: s, notes })], beat).map(positionOf)
}

test('Radial Motion is one registered mover with 12 radius and 15 spin rows', () => {
  const def = getMoverOrSplitterDefinition('radialMotion')
  assert.equal(def?.kind, 'mover')
  assert.equal(def?.label, 'Radial Motion')
  assert.equal(radialMotionMover.strictMidiRows, true)
  const rows = radialMotionMover.midiRows!(settings())
  assert.equal(rows.length, 27)
  assert.equal(rows.filter((row) => row.pitch < 60).length, 12)
  assert.equal(rows.filter((row) => row.pitch >= 60).length, 15)
  assert.equal(new Set(rows.map((row) => row.pitch)).size, 27)
  // Three depths, no layers: nothing in the vocabulary says "layer" any more.
  assert.ok(rows.every((row) => /^(outer|middle|inner) /.test(row.label)))
})

test('the default arrangement is three nested rings of 8, 4 and 2 at non-zero radii', () => {
  const s = settings()
  assert.deepEqual([s.copies0, s.copies1, s.copies2], [8, 4, 2])
  assert.ok(s.radius0 > 0 && s.radius1 > 0 && s.radius2 > 0, 'every depth starts spread out')
  assert.ok(s.radius0 > s.radius1 && s.radius1 > s.radius2, 'each depth nests inside the one above')
  assert.equal(positionsAt(s, 0).length, 8 * 4 * 2)
})

test('every depth turns on its own, with no MIDI at all', () => {
  const s = settings()
  assert.ok(s.spinZ0 !== 0 && s.spinZ1 !== 0 && s.spinZ2 !== 0, 'all three depths spin by default')
  // Differing rates AND signs: the nest must not read as one rigid body.
  assert.notEqual(Math.sign(s.spinZ0), Math.sign(s.spinZ1))
  const rest = positionsAt(s, 0)
  const later = positionsAt(s, 1)
  assert.ok(rest.some((position, index) => position.join() !== later[index].join()))

  // The rate is exactly the knob: one beat of the default 18°/beat outer spin
  // puts a lone copy 18° around from where it started.
  const spun = positionsAt(singleRing({ spinZ0: 90 }), 1)
  assert.deepEqual(spun, [[0, 1, 0]])
})

test('X and Y spin default to zero, so the resting nest stays in the XY plane', () => {
  const s = settings()
  assert.deepEqual(
    [s.spinX0, s.spinX1, s.spinX2, s.spinY0, s.spinY1, s.spinY2],
    [0, 0, 0, 0, 0, 0],
  )
  assert.ok(positionsAt(s, 3.5).every(([, , z]) => z === 0))
  // Dialing one in tips that depth's whole ring out of the plane.
  assert.deepEqual(positionsAt(singleRing({ spinY0: 90 }), 1), [[0, 0, -1]])
  // X tips the ring the other way; a seat on the X axis is on the hinge, so it
  // takes a four-seat ring to see it move at all.
  assert.deepEqual(
    positionsAt(singleRing({ radius0: 0, copies1: 4, radius1: 1, spinX1: 90 }), 1),
    [[1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1]],
  )
})

test('a depth spins its children with it, so nesting compounds', () => {
  // Outer ring parked at 3 with the middle ring's single seat 1 further out;
  // turning ONLY the outer depth swings the whole 4-unit arm.
  const s = singleRing({ radius0: 3, radius1: 1, spinZ0: 90 })
  assert.deepEqual(positionsAt(s, 0), [[4, 0, 0]])
  assert.deepEqual(positionsAt(s, 1), [[0, 4, 0]])
  // Turning only the MIDDLE depth leaves the arm's base where it was.
  const inner = singleRing({ radius0: 3, radius1: 1, spinZ1: 90 })
  assert.deepEqual(positionsAt(inner, 1), [[3, 1, 0]])
})

test('seats are spaced evenly around each depth and nest into their parent', () => {
  const s = settings({
    copies0: 2, copies1: 2, copies2: 1,
    radius0: 3, radius1: 1, radius2: 0,
    spinZ0: 0, spinZ1: 0, spinZ2: 0,
  })
  assert.deepEqual(positionsAt(s, 2), [[4, 0, 0], [2, 0, 0], [-4, 0, 0], [-2, 0, 0]])
})

test('radius notes latch a MULTIPLIER on the knob, gliding exponentially', () => {
  const s = settings({ radius0: 4, transitionBeats: 1, curve: 6 })
  const notes = [note(0, radialMotionRadiusPitch(0, 0))] // collapse (x0)
  assert.equal(evaluateRadialMotionRadiusScale(notes, s, 0, 0), 1, 'starts at the knob value')
  const halfway = evaluateRadialMotionRadiusScale(notes, s, 0.5, 0)
  assert.ok(halfway > 0 && halfway < 0.5, 'positive exponential curve eases out')
  assert.equal(evaluateRadialMotionRadiusScale(notes, s, 1, 0), 0)
  assert.equal(evaluateRadialMotionRadiusScale(notes, s, 20, 0), 0, 'the option remains latched')
  assert.equal(evaluateRadialMotionRadiusScale(notes, s, 20, 1), 1, 'another depth is independent')

  // x2 doubles the knob rather than jumping to some radius of its own.
  const doubled = [note(0, radialMotionRadiusPitch(0, 3))]
  const wide = singleRing({ radius0: 4 })
  assert.deepEqual(positionsAt(wide, 4, doubled), [[8, 0, 0]])
})

test('a rapid radius retrigger begins from the exact in-flight value without jumping', () => {
  const s = settings({ transitionBeats: 1, curve: 5 })
  const collapse = note(0, radialMotionRadiusPitch(0, 0))
  const half = note(0.25, radialMotionRadiusPitch(0, 1))
  const beforeRetrigger = evaluateRadialMotionRadiusScale([collapse], s, 0.25)
  const atRetrigger = evaluateRadialMotionRadiusScale([collapse, half], s, 0.25)
  assert.equal(atRetrigger, beforeRetrigger)
  assert.equal(evaluateRadialMotionRadiusScale([collapse, half], s, 1.25), 0.5)
})

test('spin notes multiply the passive rate instead of replacing it', () => {
  // No notes: the multiplier is 1, so spin beats ARE beats.
  assert.equal(evaluateRadialMotionSpinBeats([], 3, 0), 3)

  const freeze = [note(1, radialMotionSpinPitch(0, 1))] // x0
  assert.equal(evaluateRadialMotionSpinBeats(freeze, 1, 0), 1)
  assert.equal(evaluateRadialMotionSpinBeats(freeze, 9, 0), 1, 'held at the pose it stopped in')

  const reverse = [note(1, radialMotionSpinPitch(0, 0))] // x-1
  assert.equal(evaluateRadialMotionSpinBeats(reverse, 3, 0), -1)

  const doubled = [note(1, radialMotionSpinPitch(0, 4))] // x2
  assert.equal(evaluateRadialMotionSpinBeats(doubled, 3, 0), 5)

  assert.equal(evaluateRadialMotionSpinBeats(freeze, 9, 1), 9, 'another depth keeps turning')
})

test('a spin multiplier bends every axis of its depth together, without a jump', () => {
  const s = singleRing({ spinZ0: 90, spinY0: 45 })
  const freeze = [note(1, radialMotionSpinPitch(0, 1))]
  // At the freeze beat the pose is identical whether or not the note exists,
  // so a stop is continuous - and both axes stop, not just Z.
  assert.deepEqual(positionsAt(s, 1, freeze), positionsAt(s, 1))
  assert.deepEqual(positionsAt(s, 9, freeze), positionsAt(s, 1))
})

test('structural output count comes only from settings and stays fixed across MIDI and beat', () => {
  const s = settings({ copies0: 3, copies1: 4, copies2: 2 })
  const notes = [
    note(2, radialMotionRadiusPitch(0, 0)),
    note(4, radialMotionSpinPitch(2, 4)),
  ]
  const empty = radialMotionMover.resolve({ settings: s, notes: [] })
  const active = radialMotionMover.resolve({ settings: s, notes })
  for (const beat of [0, 3, 100]) {
    assert.equal(resolveVisualCopies([empty], beat).length, 24)
    assert.equal(resolveVisualCopies([active], beat).length, 24)
  }
})
