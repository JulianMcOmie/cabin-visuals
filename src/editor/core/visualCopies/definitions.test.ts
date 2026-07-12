import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import {
  getMoverOrSplitterDefinition,
  hasMoverOrSplitterDefinition,
  registerMoverOrSplitterDefinition,
  unregisterMoverOrSplitterDefinitionForTests,
} from './registry'
import { identityVisualCopy } from './identityVisualCopy'
import { resolveVisualCopies } from './resolveVisualCopies'
import type { VisualCopy } from './types'

// -- Test-only fake definitions ----------------------------------------------
// These exist to verify the contract shape: private MIDI evaluation inside a
// resolved closure, and deterministic pure-function-of-beat behavior. They are
// NOT production movers - those arrive only with explicit specifications.

function note(beat: number, pitch: number, velocity = 1, durationBeats = 1): ResolvedNote {
  return { beat, blockStartBeat: 0, blockEndBeat: 1024, pitch, velocity, durationBeats }
}

/** This fake's private MIDI grammar: the gate is the velocity of any note
 *  active at the beat (its [beat, beat+duration) region), else zero. */
function activeVelocity(notes: ResolvedNote[], beat: number, pitch?: number): number {
  for (const n of notes) {
    if (pitch !== undefined && n.pitch !== pitch) continue
    if (beat >= n.beat && beat < n.beat + n.durationBeats) return n.velocity
  }
  return 0
}

function cloneCopy(copy: VisualCopy): VisualCopy {
  return {
    transform: copy.transform.clone(),
    opacity: copy.opacity,
    colorShift: { ...copy.colorShift },
  }
}

interface FakeLiftSettings {
  distance: number
}

/** Translates the copy up (local composition) by distance * gate. Declares no
 *  midiRows - any pitch gates - so its editor keeps the full piano roll. */
const fakeLiftMover: MoverOrSplitterDefinition<FakeLiftSettings> = {
  id: 'test.fakeLift',
  label: 'Fake Lift',
  kind: 'mover',
  params: [{ key: 'distance', label: 'Distance', min: 0, max: 10, step: 0.1, default: 1 }],
  resolve({ settings, notes }) {
    return {
      apply(visualCopy, context) {
        const gate = activeVelocity(notes, context.beat)
        const next = cloneCopy(visualCopy)
        next.transform.multiply(new Matrix4().makeTranslation(0, settings.distance * gate, 0))
        return [next]
      },
    }
  },
}

interface FakeSymmetrySettings {
  spacing: number
  leftPitch: number
  rightPitch: number
}

/** Two structural slots (left/right); each pitch gates its slot's OPACITY.
 *  An inactive slot stays present with opacity zero - never removed. */
const fakeSymmetrySplitter: MoverOrSplitterDefinition<FakeSymmetrySettings> = {
  id: 'test.fakeSymmetry',
  label: 'Fake Symmetry',
  kind: 'splitter',
  params: [
    { key: 'spacing', label: 'Spacing', min: 0, max: 20, step: 0.5, default: 5 },
    { key: 'leftPitch', label: 'Left pitch', min: 0, max: 127, step: 1, default: 60 },
    { key: 'rightPitch', label: 'Right pitch', min: 0, max: 127, step: 1, default: 62 },
  ],
  midiRows: (settings) => [
    { pitch: settings.leftPitch, label: 'Left gate' },
    { pitch: settings.rightPitch, label: 'Right gate' },
  ],
  resolve({ settings, notes }) {
    return {
      apply(visualCopy, context) {
        const leftGate = activeVelocity(notes, context.beat, settings.leftPitch)
        const rightGate = activeVelocity(notes, context.beat, settings.rightPitch)
        const left = cloneCopy(visualCopy)
        left.transform.multiply(new Matrix4().makeTranslation(-settings.spacing, 0, 0))
        left.opacity = visualCopy.opacity * leftGate
        const right = cloneCopy(visualCopy)
        right.transform.multiply(new Matrix4().makeTranslation(settings.spacing, 0, 0))
        right.opacity = visualCopy.opacity * rightGate
        return [left, right]
      },
    }
  },
}

function yOf(copy: VisualCopy): number {
  return copy.transform.elements[13]
}

// -- Registry ------------------------------------------------------------------

test('registry: register and look up movers and splitters by id', () => {
  registerMoverOrSplitterDefinition(fakeLiftMover)
  registerMoverOrSplitterDefinition(fakeSymmetrySplitter)
  try {
    const mover = getMoverOrSplitterDefinition('test.fakeLift')
    assert.equal(mover?.kind, 'mover')
    assert.equal(mover?.label, 'Fake Lift')
    const splitter = getMoverOrSplitterDefinition('test.fakeSymmetry')
    assert.equal(splitter?.kind, 'splitter')
    assert.equal(hasMoverOrSplitterDefinition('test.fakeLift'), true)
  } finally {
    unregisterMoverOrSplitterDefinitionForTests('test.fakeLift')
    unregisterMoverOrSplitterDefinitionForTests('test.fakeSymmetry')
  }
})

test('registry: unknown ids resolve to nothing (the legacy fallback signal)', () => {
  assert.equal(getMoverOrSplitterDefinition('orbit'), undefined)
  assert.equal(getMoverOrSplitterDefinition(undefined), undefined)
  assert.equal(hasMoverOrSplitterDefinition('orbit'), false)
})

test('registry: duplicate ids throw', () => {
  registerMoverOrSplitterDefinition(fakeLiftMover)
  try {
    assert.throws(() => registerMoverOrSplitterDefinition(fakeLiftMover), /already registered/)
    assert.throws(
      () => registerMoverOrSplitterDefinition({ ...fakeSymmetrySplitter, id: 'test.fakeLift' }),
      /already registered/,
    )
  } finally {
    unregisterMoverOrSplitterDefinitionForTests('test.fakeLift')
  }
})

test('midiRows responds to settings', () => {
  const low = fakeSymmetrySplitter.midiRows!({ spacing: 5, leftPitch: 60, rightPitch: 62 })
  const high = fakeSymmetrySplitter.midiRows!({ spacing: 5, leftPitch: 40, rightPitch: 41 })
  assert.deepEqual(low.map((r) => r.pitch), [60, 62])
  assert.deepEqual(high.map((r) => r.pitch), [40, 41])
  assert.deepEqual(low.map((r) => r.label), ['Left gate', 'Right gate'])
})

// -- Private MIDI evaluation and deterministic beat behavior -------------------

test('a mover closure evaluates its own MIDI privately per beat', () => {
  const chain = fakeLiftMover.resolve({
    settings: { distance: 2 },
    notes: [note(4, 60, 0.5, 2)],
  })
  const before = chain.apply(identityVisualCopy(), { beat: 3.9, index: 0, count: 1 })
  const during = chain.apply(identityVisualCopy(), { beat: 4.5, index: 0, count: 1 })
  const after = chain.apply(identityVisualCopy(), { beat: 6.0, index: 0, count: 1 })
  assert.equal(yOf(before[0]), 0)
  assert.equal(yOf(during[0]), 2 * 0.5)
  assert.equal(yOf(after[0]), 0)
})

test('evaluation is a pure function of beat: scrub away and back reproduces exactly', () => {
  const resolved = fakeLiftMover.resolve({
    settings: { distance: 3 },
    notes: [note(0, 60, 1, 1), note(8, 60, 0.25, 4)],
  })
  const chain = [resolved]
  const first = resolveVisualCopies(chain, 9)
  resolveVisualCopies(chain, 0.5)
  resolveVisualCopies(chain, 100)
  const again = resolveVisualCopies(chain, 9)
  assert.deepEqual(again[0].transform.elements, first[0].transform.elements)
  assert.equal(again[0].opacity, first[0].opacity)
})

test('a MIDI-gated splitter changes opacity, never the copy count', () => {
  const resolved = fakeSymmetrySplitter.resolve({
    settings: { spacing: 5, leftPitch: 60, rightPitch: 62 },
    notes: [note(0, 60, 1, 1), note(1, 62, 0.8, 1)],
  })
  const chain = [resolved]

  const leftOnly = resolveVisualCopies(chain, 0.5)
  const rightOnly = resolveVisualCopies(chain, 1.5)
  const neither = resolveVisualCopies(chain, 10)

  for (const copies of [leftOnly, rightOnly, neither]) {
    assert.equal(copies.length, 2, 'structural slot count is beat-independent')
  }
  assert.deepEqual(leftOnly.map((c) => c.opacity), [1, 0])
  assert.deepEqual(rightOnly.map((c) => c.opacity), [0, 0.8])
  assert.deepEqual(neither.map((c) => c.opacity), [0, 0])
  // Slot positions stay put while gates change.
  assert.equal(leftOnly[0].transform.elements[12], -5)
  assert.equal(neither[1].transform.elements[12], 5)
})

test('a downstream mover sees indices created by an upstream MIDI-gated splitter', () => {
  const split = fakeSymmetrySplitter.resolve({
    settings: { spacing: 1, leftPitch: 60, rightPitch: 62 },
    notes: [note(0, 60, 1, 4)],
  })
  const lift = fakeLiftMover.resolve({ settings: { distance: 1 }, notes: [note(0, 60, 1, 4)] })
  const indexAware = {
    apply(visualCopy: VisualCopy, context: { index: number; count: number; beat: number }) {
      assert.equal(context.count, 2)
      const next = cloneCopy(visualCopy)
      next.transform.multiply(new Matrix4().makeTranslation(0, 0, context.index * 10))
      return [next]
    },
  }
  const copies = resolveVisualCopies([split, lift, indexAware], 2)
  assert.equal(copies.length, 2)
  assert.deepEqual(copies.map((c) => c.transform.elements[14]), [0, 10])
  assert.deepEqual(copies.map(yOf), [1, 1])
})
