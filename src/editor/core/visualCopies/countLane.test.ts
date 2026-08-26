import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import { AUTOMATION_PITCH_MIN, pitchToValueRanged } from '../trackTypes'
import type { ResolvedNote } from '../visual/types'
import { countAt, countLaneRows, extractCountGates, resolveCountLane } from './countLane'
import type { MoverOrSplitter, VisualCopy } from './types'

function note(beat: number, pitch: number): ResolvedNote {
  return { beat, blockStartBeat: 0, blockEndBeat: 1024, pitch, velocity: 1, durationBeats: 1 }
}

const copy = (): VisualCopy => ({
  transform: new Matrix4(),
  opacity: 1,
  colorShift: { hue: 0, saturation: 0, lightness: 0, tint: null, tintAmount: 0 },
})

test('rows are the whole numbers, bottom = min, and match the integer automation encoding', () => {
  const rows = countLaneRows(1, 32, 'copy', 'copies')
  assert.equal(rows.length, 32)
  assert.deepEqual(rows[0], { pitch: 67, label: '32 copies' })
  assert.deepEqual(rows[30], { pitch: 37, label: '2 copies' })
  assert.deepEqual(rows[31], { pitch: 36, label: '1 copy' })
  // The lane and an INT automation lane must never disagree about a pitch.
  for (const row of rows) {
    const value = Number(row.label.split(' ')[0])
    assert.equal(value, pitchToValueRanged({ integer: true }, row.pitch, 1, 32))
  }
})

test('gates sort by beat, chords keep the largest count, out-of-span pitches drop', () => {
  const gates = extractCountGates(
    [note(4, 40), note(0, 37), note(0, 43), note(2, 84), note(2, 127), note(2, 35)],
    1,
    32,
  )
  // Pitches 84/127/35 sit outside 36..67 (a retired vocabulary or a stray
  // note) and are dropped, never clamped to the max.
  assert.deepEqual(gates, [
    { beat: 0, value: 8 },
    { beat: 4, value: 5 },
  ])
})

test('countAt is a step latch: rest before the first onset, then the most recent value', () => {
  const gates = extractCountGates([note(1, 37), note(3, 43)], 1, 32)
  assert.equal(countAt(gates, 0.5, 6), 6)
  assert.equal(countAt(gates, 1, 6), 2, 'jumps exactly on the onset')
  assert.equal(countAt(gates, 2.999, 6), 2)
  assert.equal(countAt(gates, 3, 6), 8)
  assert.equal(countAt(gates, 1000, 6), 8, 'holds for the rest of the timeline')
})

/** A toy splitter: N copies, each stamped with its layout count via opacity,
 *  and a call counter proving the per-count memo holds. */
function toyBase(calls: number[]): (settings: { copies: number }) => MoverOrSplitter {
  return (settings) => {
    calls.push(settings.copies)
    return {
      apply: (visualCopy) =>
        Array.from({ length: settings.copies }, () => ({ ...visualCopy, opacity: settings.copies })),
    }
  }
}

test('an empty lane returns the bare layout - bit-identical to the pre-lane definition', () => {
  const calls: number[] = []
  const base = toyBase(calls)
  const entry = resolveCountLane({ settings: { copies: 5 }, notes: [], key: 'copies', min: 1, max: 32, resolveAt: base })
  assert.equal(entry.apply(copy(), { beat: 0, index: 0, count: 1 }).length, 5)
  assert.deepEqual(calls, [5], 'one bare resolve, no wrapper machinery')
  assert.equal(entry.structuralVariants, undefined)
})

test('the wrapped entry re-lays out at the latched count and memoizes per count', () => {
  const calls: number[] = []
  const entry = resolveCountLane({
    settings: { copies: 4 },
    notes: [note(1, 37), note(3, 43), note(5, 37)],
    key: 'copies',
    min: 1,
    max: 32,
    resolveAt: toyBase(calls),
  })
  const countAtBeat = (beat: number) => entry.apply(copy(), { beat, index: 0, count: 1 }).length
  assert.equal(countAtBeat(0), 4)
  assert.equal(countAtBeat(1.5), 2)
  assert.equal(countAtBeat(3.5), 8)
  assert.equal(countAtBeat(5.5), 2, 'revisiting a count reuses its layout')
  // Variants (8, then 2) resolve up front; rest 4 and latch 2/8 resolve once each.
  assert.deepEqual([...calls].sort((a, b) => a - b), [2, 4, 8])
})

test('structuralVariants bracket the lane reach AND the knob rest', () => {
  const entry = resolveCountLane({
    settings: { copies: 20 },
    notes: [note(1, 37), note(3, 43)],
    key: 'copies',
    min: 1,
    max: 32,
    resolveAt: toyBase([]),
  })
  const context = { beat: 0, index: 0, count: 1 }
  // The knob's 20 exceeds every gate, so the max variant is the REST count.
  assert.equal(entry.structuralVariants![0].apply(copy(), context).length, 20)
  assert.equal(entry.structuralVariants![1].apply(copy(), context).length, 2)
})

test('a wide integer range still tops out exactly on the max (step > 1)', () => {
  // 0..96 cannot fit one row per unit in the 49-pitch span; the grid steps by
  // 2 and the TOP row is pinned to the max, exactly like the automation grid.
  const rows = countLaneRows(0, 96, 'thing', 'things')
  assert.equal(rows[0].label, '96 things')
  assert.equal(rows[rows.length - 1].pitch, AUTOMATION_PITCH_MIN)
  assert.equal(rows[rows.length - 1].label, '0 things')
  const gates = extractCountGates([note(0, rows[0].pitch)], 0, 96)
  assert.deepEqual(gates, [{ beat: 0, value: 96 }])
})
