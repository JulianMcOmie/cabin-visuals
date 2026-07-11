import assert from 'node:assert/strict'
import test from 'node:test'
import type { Block } from '../types'
import { splitBlockAtBeat } from './ProjectStore'

function idFactory(ids: string[]) {
  let i = 0
  return () => ids[i++] ?? `id-${i}`
}

test('splitBlockAtBeat splits note data around the playhead', () => {
  const block: Block = {
    id: 'block',
    startBar: 0,
    durationBars: 2,
    loop: false,
    notes: [
      { id: 'left', startBeat: 0, durationBeats: 1, pitch: 60, velocity: 1 },
      { id: 'crossing', startBeat: 3, durationBeats: 2, pitch: 62, velocity: 1 },
      { id: 'right', startBeat: 5, durationBeats: 1, pitch: 64, velocity: 1 },
    ],
  }

  const split = splitBlockAtBeat(block, 4, 4, idFactory(['right-block', 'crossing-right', 'right-right']))

  assert.ok(split)
  assert.equal(split.left.durationBars, 1)
  assert.equal(split.right.id, 'right-block')
  assert.equal(split.right.startBar, 1)
  assert.equal(split.right.durationBars, 1)
  assert.deepEqual(split.left.notes.map((n) => ({ id: n.id, startBeat: n.startBeat, durationBeats: n.durationBeats })), [
    { id: 'left', startBeat: 0, durationBeats: 1 },
    { id: 'crossing', startBeat: 3, durationBeats: 1 },
  ])
  assert.deepEqual(split.right.notes.map((n) => ({ id: n.id, startBeat: n.startBeat, durationBeats: n.durationBeats })), [
    { id: 'crossing-right', startBeat: 0, durationBeats: 1 },
    { id: 'right-right', startBeat: 1, durationBeats: 1 },
  ])
})

test('splitBlockAtBeat keeps loop phase for the right-hand block', () => {
  const block: Block = {
    id: 'loop',
    startBar: 0,
    durationBars: 4,
    loop: true,
    loopLengthBars: 1,
    notes: [{ id: 'pulse', startBeat: 1, durationBeats: 0.25, pitch: 60, velocity: 1 }],
  }

  const split = splitBlockAtBeat(block, 6, 4, idFactory(['right-loop', 'right-pulse']))

  assert.ok(split)
  assert.equal(split.right.id, 'right-loop')
  assert.equal(split.right.startBar, 1.5)
  assert.equal(split.right.durationBars, 2.5)
  assert.equal(split.left.loop, true)
  assert.equal(split.right.loop, true)
  assert.equal(split.left.loopLengthBars, 1)
  assert.equal(split.right.loopLengthBars, 1)
  // Phase preserved modulo the loop length, normalized into the pattern window:
  // the original pulse plays at absolute beats 1, 5, 9, 13; the right half
  // (beats 6..16) keeps 9 and 13 = local phase 3 in a 4-beat loop.
  assert.deepEqual(split.right.notes.map((n) => ({ id: n.id, startBeat: n.startBeat })), [
    { id: 'right-pulse', startBeat: 3 },
  ])
})

