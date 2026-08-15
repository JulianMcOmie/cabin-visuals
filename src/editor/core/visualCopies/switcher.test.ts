import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResolvedNote } from '../visual/types'
import {
  liveChildrenAt,
  switcherExclusive,
  switcherRows,
  switcherVariantsFor,
  SWITCHER_GATE,
  SWITCHER_LATCH,
  SWITCHER_NONE_PITCH,
  SWITCHER_SOLO,
  SWITCHER_TOGGLE,
  type SwitcherBinding,
} from './switcher'
import type { MoverOrSplitter } from './types'

// The mode arithmetic, isolated from the chain. The wiring - that the span is
// spliced, that Gate with every row held is transparent, that the copy pool is
// sized right - belongs to core/visual/switcherRuntime.test.ts.

const BINDINGS: SwitcherBinding[] = [
  { pitch: 60, index: 0 },
  { pitch: 61, index: 1 },
  { pitch: 62, index: 2 },
]

let nextId = 0
function note(pitch: number, beat: number, durationBeats = 2): ResolvedNote {
  return { beat, blockStartBeat: 0, blockEndBeat: 64, pitch, velocity: 100, durationBeats, ...{ id: `n${nextId++}` } }
}

const live = (notes: ResolvedNote[], mode: number, beat: number) =>
  liveChildrenAt(BINDINGS, notes, { mode }, beat)

test('an empty lane runs every device, in every mode', () => {
  // The non-destructive convention: wrapping devices in a switcher must not
  // change the picture until the lane is played. It is not a special case -
  // it is the full subset, i.e. the transparent span.
  for (const mode of [SWITCHER_GATE, SWITCHER_TOGGLE, SWITCHER_SOLO, SWITCHER_LATCH]) {
    assert.deepEqual(live([], mode, 0), [0, 1, 2])
    assert.deepEqual(live([], mode, 99), [0, 1, 2])
  }
})

test('Gate runs every sounding row at once, and nothing between notes', () => {
  const notes = [note(60, 0, 4), note(62, 2, 4)]
  assert.deepEqual(live(notes, SWITCHER_GATE, 1), [0])
  assert.deepEqual(live(notes, SWITCHER_GATE, 3), [0, 2], 'both rows sounding')
  assert.deepEqual(live(notes, SWITCHER_GATE, 5), [2])
  assert.deepEqual(live(notes, SWITCHER_GATE, 9), [], 'nothing on after the notes')
})

test('Gate returns indices in CHILD order however the notes were played', () => {
  // Chain order is spatial semantics, so performance order must not set it.
  const played = [note(62, 0, 8), note(60, 1, 8), note(61, 2, 8)]
  assert.deepEqual(live(played, SWITCHER_GATE, 4), [0, 1, 2])
})

test('Solo keeps the newest sounding row and drops it at release', () => {
  const notes = [note(60, 0, 8), note(62, 2, 2)]
  assert.deepEqual(live(notes, SWITCHER_SOLO, 1), [0])
  assert.deepEqual(live(notes, SWITCHER_SOLO, 3), [2], 'newest onset wins the overlap')
  assert.deepEqual(live(notes, SWITCHER_SOLO, 5), [0], 'the older note resumes when it ends')
  assert.deepEqual(live(notes, SWITCHER_SOLO, 9), [])
})

test('Latch holds the last row played past its own release', () => {
  const notes = [note(60, 0, 1), note(62, 4, 1)]
  assert.deepEqual(live(notes, SWITCHER_LATCH, 0.5), [0])
  assert.deepEqual(live(notes, SWITCHER_LATCH, 3), [0], 'still on between notes')
  assert.deepEqual(live(notes, SWITCHER_LATCH, 9), [2])
  assert.deepEqual(live(notes, SWITCHER_LATCH, -1), [], 'nothing before the first onset')
})

test('Toggle flips each row independently on its onsets', () => {
  const notes = [note(60, 0, 1), note(62, 1, 1), note(60, 4, 1)]
  assert.deepEqual(live(notes, SWITCHER_TOGGLE, 0.5), [0])
  assert.deepEqual(live(notes, SWITCHER_TOGGLE, 2), [0, 2], 'both latched on')
  assert.deepEqual(live(notes, SWITCHER_TOGGLE, 5), [2], 'the second tap turned row 0 back off')
})

test('the None row means nothing running, in all four modes', () => {
  assert.deepEqual(
    live([note(60, 0, 8), note(SWITCHER_NONE_PITCH, 2, 2)], SWITCHER_GATE, 3),
    [], 'a held None silences the whole rack',
  )
  assert.deepEqual(live([note(60, 0, 1), note(SWITCHER_NONE_PITCH, 4, 1)], SWITCHER_LATCH, 6), [])
  assert.deepEqual(live([note(60, 0, 8), note(SWITCHER_NONE_PITCH, 2, 2)], SWITCHER_SOLO, 3), [])
  // Under Toggle it is a reset: everything latched before it is cleared.
  assert.deepEqual(
    live([note(60, 0, 1), note(62, 1, 1), note(SWITCHER_NONE_PITCH, 4, 1)], SWITCHER_TOGGLE, 5),
    [],
  )
})

test('a note on an unbound pitch addresses nothing', () => {
  assert.deepEqual(live([note(30, 0, 8)], SWITCHER_GATE, 1), [])
  assert.deepEqual(live([note(30, 0, 8)], SWITCHER_LATCH, 1), [])
})

test('a zero-length note still holds for a hair', () => {
  assert.deepEqual(live([note(61, 4, 0)], SWITCHER_GATE, 4), [1])
  assert.deepEqual(live([note(61, 4, 0)], SWITCHER_GATE, 4.2), [])
})

test('the variant publication follows the mode, because the ceiling does', () => {
  // Gate/Toggle can run everything at once, so rank 0 must probe the ungated
  // entry (the product over the span). Solo/Latch run at most one, so rank i
  // carries child i and every other rank passes through - which is what makes
  // the exclusive ceiling the MAX over children rather than the product.
  const entry: MoverOrSplitter = { apply: (c) => [c] }
  assert.deepEqual(switcherVariantsFor(entry, SWITCHER_GATE, 1, 3), [entry])
  assert.equal(switcherExclusive(SWITCHER_GATE), false)
  assert.equal(switcherExclusive(SWITCHER_TOGGLE), false)

  const exclusive = switcherVariantsFor(entry, SWITCHER_LATCH, 1, 3)
  assert.equal(exclusive.length, 3)
  assert.equal(exclusive[1], entry)
  assert.notEqual(exclusive[0], entry)
  assert.notEqual(exclusive[2], entry)
  assert.equal(switcherExclusive(SWITCHER_SOLO), true)
})

test('the rows are the devices in child order, then None', () => {
  const rows = switcherRows(
    [{ label: 'Radial', color: '#3ecf9a' }, { label: 'Grid', color: '#4aa8ff' }],
    [{ pitch: 60, index: 0 }, { pitch: 61, index: 1 }],
  )
  assert.deepEqual(rows.map((r) => r.label), ['Radial', 'Grid', 'None'])
  assert.deepEqual(rows.map((r) => r.pitch), [60, 61, SWITCHER_NONE_PITCH])
  assert.equal(rows[0].color, '#3ecf9a', 'a row wears its device colour')
})
