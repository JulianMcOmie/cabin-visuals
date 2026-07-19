import assert from 'node:assert/strict'
import test from 'node:test'
import type { Block, Track } from '../types'
import { splitBlockAtBeat, useProjectStore } from './ProjectStore'
import { flattenBlocks } from '../core/visual/noteFlatten'

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
  assert.deepEqual(split.blocks.map((b) => b.id), ['block', 'right-block'])
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

test('splitBlockAtBeat makes a literal remainder and resumes at the next loop seam', () => {
  const block: Block = {
    id: 'loop',
    startBar: 0,
    durationBars: 4,
    loop: true,
    loopLengthBars: 1,
    notes: [{ id: 'pulse', startBeat: 3, durationBeats: 0.25, pitch: 60, velocity: 1 }],
  }

  const split = splitBlockAtBeat(block, 6, 4, idFactory([
    'remainder',
    'remainder-pulse',
    'resumed-loop',
    'resumed-pulse',
  ]))

  assert.ok(split)
  assert.deepEqual(split.blocks.map((b) => b.id), ['loop', 'remainder', 'resumed-loop'])
  assert.equal(split.right.id, 'remainder')
  assert.equal(split.right.startBar, 1.5)
  assert.equal(split.right.durationBars, 0.5)
  assert.equal(split.left.loop, true)
  assert.equal(split.right.loop, false)
  assert.equal(split.left.loopLengthBars, 1)
  assert.equal(split.right.loopLengthBars, undefined)
  assert.deepEqual(split.right.notes.map((n) => ({ id: n.id, startBeat: n.startBeat })), [
    { id: 'remainder-pulse', startBeat: 1 },
  ])
  assert.equal(split.blocks[2].startBar, 2)
  assert.equal(split.blocks[2].durationBars, 2)
  assert.equal(split.blocks[2].loop, true)
  assert.equal(split.blocks[2].loopLengthBars, 1)

  // The same pulse events remain at absolute beats 3, 7, 11, and 15.
  assert.deepEqual(
    flattenBlocks(split.blocks, 4).map((n) => n.beat),
    flattenBlocks([block], 4).map((n) => n.beat),
  )
})

test('splitBlockAtBeat cuts a loop seam into two phase-zero loop regions', () => {
  const block: Block = {
    id: 'loop',
    startBar: 0,
    durationBars: 4,
    loop: true,
    loopLengthBars: 1,
    notes: [{ id: 'pulse', startBeat: 1, durationBeats: 0.25, pitch: 60, velocity: 1 }],
  }

  const split = splitBlockAtBeat(block, 8, 4, idFactory(['right-loop', 'right-pulse']))

  assert.ok(split)
  assert.deepEqual(split.blocks.map((b) => b.id), ['loop', 'right-loop'])
  assert.equal(split.right.startBar, 2)
  assert.equal(split.right.durationBars, 2)
  assert.equal(split.right.loop, true)
  assert.equal(split.right.loopLengthBars, 1)
  assert.deepEqual(split.right.notes.map((n) => ({ id: n.id, startBeat: n.startBeat })), [
    { id: 'right-pulse', startBeat: 1 },
  ])
  assert.deepEqual(
    flattenBlocks(split.blocks, 4).map((n) => n.beat),
    flattenBlocks([block], 4).map((n) => n.beat),
  )
})

test('splitBlockAtBeat omits an empty resumed loop when the cut is in the final occurrence', () => {
  const block: Block = {
    id: 'loop',
    startBar: 0,
    durationBars: 2.5,
    loop: true,
    loopLengthBars: 1,
    notes: [{ id: 'pulse', startBeat: 1, durationBeats: 0.25, pitch: 60, velocity: 1 }],
  }

  const split = splitBlockAtBeat(block, 9, 4, idFactory(['remainder']))

  assert.ok(split)
  assert.deepEqual(split.blocks.map((b) => b.id), ['loop', 'remainder'])
  assert.equal(split.right.startBar, 2.25)
  assert.equal(split.right.durationBars, 0.25)
  assert.equal(split.right.loop, false)
})

test('splitBlocksAtBeat selects the region immediately right of the playhead', () => {
  const track: Track = {
    id: 'split-selection-track',
    name: 'Split selection',
    type: 'base',
    instrumentId: 'cube',
    color: '#fff',
    muted: false,
    solo: false,
    childIds: [],
    blocks: [{
      id: 'selected-loop',
      startBar: 0,
      durationBars: 4,
      loop: true,
      loopLengthBars: 1,
      notes: [{ id: 'pulse', startBeat: 1, durationBeats: 0.25, pitch: 60, velocity: 1 }],
    }],
  }
  useProjectStore.getState().addTrack(track)

  const selection = useProjectStore.getState().splitBlocksAtBeat(new Set(['selected-loop']), 6)
  const blocks = useProjectStore.getState().tracks[track.id].blocks

  assert.ok(selection)
  assert.equal(blocks.length, 3)
  assert.deepEqual([...selection], [blocks[1].id])
  assert.equal(blocks[1].startBar, 1.5)
  assert.equal(blocks[1].loop, false)
})
