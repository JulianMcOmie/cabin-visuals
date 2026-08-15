import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import { bypassGated, bypassMover, evaluateBypassed, BYPASS_ON_REST, BYPASS_PITCH } from './bypass'
import { identityVisualCopy } from './identityVisualCopy'
import { resolveVisualCopies, structuralCopyCount } from './resolveVisualCopies'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitter, MoverOrSplitterContext } from './types'

function note(beat: number, durationBeats: number, pitch = BYPASS_PITCH): ResolvedNote {
  return { pitch, beat, durationBeats, velocity: 100 } as ResolvedNote
}

const context = (beat: number): MoverOrSplitterContext => ({ beat, index: 0, count: 1 })

/** A stand-in device: shifts x by 1, so "did the parent run" is one number. */
const shiftMover: MoverOrSplitter = {
  apply(visualCopy) {
    return [{
      transform: visualCopy.transform.clone().multiply(new Matrix4().makeTranslation(1, 0, 0)),
      opacity: visualCopy.opacity,
      colorShift: { ...visualCopy.colorShift },
    }]
  },
}

/** A stand-in splitter: three copies, so "did it fan out" is a length. */
const tripleSplitter: MoverOrSplitter = {
  apply(visualCopy) {
    return [0, 1, 2].map((i) => ({
      transform: visualCopy.transform.clone().multiply(new Matrix4().makeTranslation(i, 0, 0)),
      opacity: visualCopy.opacity,
      colorShift: { ...visualCopy.colorShift },
    }))
  },
}

test('a note switches the parent off for exactly its length', () => {
  const notes = [note(4, 2)]
  const settings = { mode: 0 }
  assert.equal(evaluateBypassed(notes, settings, 3.9), false)
  assert.equal(evaluateBypassed(notes, settings, 4), true)
  assert.equal(evaluateBypassed(notes, settings, 5.9), true)
  // The note's end is exclusive, so back-to-back notes cannot double-count.
  assert.equal(evaluateBypassed(notes, settings, 6), false)
})

test('the mode segment mirrors the gate exactly', () => {
  const notes = [note(4, 2)]
  for (const beat of [0, 3.9, 4, 5.9, 6, 100]) {
    assert.equal(
      evaluateBypassed(notes, { mode: BYPASS_ON_REST }, beat),
      !evaluateBypassed(notes, { mode: 0 }, beat),
      `polarity disagreed at beat ${beat}`,
    )
  }
})

test('an empty lane is inert in Switch off and total in Switch on', () => {
  assert.equal(evaluateBypassed([], { mode: 0 }, 7), false)
  assert.equal(evaluateBypassed([], { mode: BYPASS_ON_REST }, 7), true)
})

test('a zero-length note still holds for a hair', () => {
  assert.equal(evaluateBypassed([note(4, 0)], { mode: 0 }, 4), true)
  assert.equal(evaluateBypassed([note(4, 0)], { mode: 0 }, 4.1), false)
})

test('notes on other pitches are ignored', () => {
  assert.equal(evaluateBypassed([note(4, 2, BYPASS_PITCH + 1)], { mode: 0 }, 5), false)
})

test('a bypassed mover contributes nothing, an ungated one does', () => {
  const gated = bypassGated(shiftMover, [(beat) => beat >= 4 && beat < 6])
  assert.equal(gated.apply(identityVisualCopy(), context(0))[0].transform.elements[12], 1)
  assert.equal(gated.apply(identityVisualCopy(), context(5))[0].transform.elements[12], 0)
})

test('several gates compose by OR', () => {
  const gated = bypassGated(shiftMover, [(beat) => beat < 2, (beat) => beat > 8])
  assert.equal(gated.apply(identityVisualCopy(), context(1))[0].transform.elements[12], 0)
  assert.equal(gated.apply(identityVisualCopy(), context(5))[0].transform.elements[12], 1)
  assert.equal(gated.apply(identityVisualCopy(), context(9))[0].transform.elements[12], 0)
})

test('no gates returns the entry itself, so an ordinary device pays nothing', () => {
  assert.equal(bypassGated(shiftMover, []), shiftMover)
})

test('a bypassed splitter collapses to one copy but keeps its structural pool', () => {
  // The invariant this protects: the mounted pool is sized at resolve, so a
  // splitter bypassed at the beat the probe samples must still report 3.
  const gated = bypassGated(tripleSplitter, [(beat) => beat < 1])
  assert.equal(resolveVisualCopies([gated], 0).length, 1)
  assert.equal(resolveVisualCopies([gated], 5).length, 3)
  assert.equal(structuralCopyCount([gated]), 3)
})

test('a gated entry never exceeds the ungated count', () => {
  const gated = bypassGated(tripleSplitter, [(beat) => beat < 1])
  for (const beat of [0, 0.5, 1, 2, 10]) {
    assert.ok(resolveVisualCopies([gated], beat).length <= structuralCopyCount([tripleSplitter]))
  }
})

test('bypassing a time remap gives the real beat back', () => {
  const frozen: MoverOrSplitter = { ...shiftMover, warpBeat: () => 0 }
  const gated = bypassGated(frozen, [(beat) => beat >= 4])
  assert.equal(gated.warpBeat!(3), 0)
  assert.equal(gated.warpBeat!(5), 5)
})

test('the definition carries its gate on bypassAt and contributes no transform', () => {
  const resolved = bypassMover.resolve({ settings: { mode: 0 }, notes: [note(4, 2)] })
  assert.equal(typeof resolved.bypassAt, 'function')
  assert.equal(resolved.bypassAt!(5), true)
  assert.equal(resolved.bypassAt!(1), false)
  const out = resolved.apply(identityVisualCopy(), context(5))
  assert.equal(out.length, 1)
  assert.deepEqual([...out[0].transform.elements], [...new Matrix4().elements])
  // Its own matrix, per the module contract.
  assert.notEqual(out[0].transform, identityVisualCopy().transform)
})

test('its row label follows the mode, so the piano roll says which way it points', () => {
  assert.match(bypassMover.midiRows!({ mode: 0 })[0].label, /off/)
  assert.match(bypassMover.midiRows!({ mode: BYPASS_ON_REST })[0].label, /on/)
  assert.equal(bypassMover.midiRows!({ mode: 0 }).length, 1)
})
