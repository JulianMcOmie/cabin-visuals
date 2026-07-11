import assert from 'node:assert/strict'
import test from 'node:test'
import type { Block, Note } from '../../types'
import { flattenBlocks, loopLengthBeats, tileLoopNotes } from './noteFlatten'

function note(id: string, startBeat: number, durationBeats: number, pitch = 60): Note {
  return { id, startBeat, durationBeats, pitch, velocity: 1 }
}

function block(over: Partial<Block>): Block {
  return { id: 'b', startBar: 0, durationBars: 4, loop: false, notes: [], ...over }
}

test('non-looped blocks flatten unchanged, clipped at the block end', () => {
  const out = flattenBlocks([
    block({
      durationBars: 2, // 8 beats
      notes: [
        note('a', 0, 1),
        note('b', 5, 2),
        note('c', 7, 4), // duration crosses the block end
        note('d', 9, 1), // starts past the block end
        note('e', -1, 1), // starts before the block
      ],
    }),
  ], 4)

  assert.deepEqual(out.map((n) => [n.beat, n.durationBeats]), [
    [0, 1],
    [5, 2],
    [7, 1],
  ])
})

test('a looped block repeats its pattern to fill the block', () => {
  const out = flattenBlocks([
    block({
      durationBars: 3,
      loop: true,
      loopLengthBars: 1,
      notes: [note('a', 0.5, 0.25)],
    }),
  ], 4)

  assert.deepEqual(out.map((n) => n.beat), [0.5, 4.5, 8.5])
  assert.deepEqual(out.map((n) => n.durationBeats), [0.25, 0.25, 0.25])
})

test('the partial final repeat truncates at the block end', () => {
  const out = flattenBlocks([
    block({
      durationBars: 2.5, // 10 beats
      loop: true,
      loopLengthBars: 2, // 8-beat pattern
      notes: [
        note('a', 1, 4), // second occurrence at 9 clips to 1 beat
        note('b', 3, 0.5), // second occurrence at 11 falls past the end
      ],
    }),
  ], 4)

  assert.deepEqual(out.map((n) => [n.beat, n.durationBeats]), [
    [1, 4],
    [3, 0.5],
    [9, 1],
  ])
})

test('loop length is inferred from the note extent when unset', () => {
  const looped = block({
    durationBars: 4,
    loop: true,
    notes: [note('a', 0, 5)], // 5 beats -> rounds up to 2 bars
  })
  assert.equal(loopLengthBeats(looped, 4), 8)
  assert.equal(loopLengthBeats(block({ notes: [] }), 4), 4) // empty pattern: one bar

  const out = flattenBlocks([looped], 4)
  assert.deepEqual(out.map((n) => n.beat), [0, 8])
})

test('split-shifted phases fold modulo the loop length', () => {
  // The right half of a split looped block historically stored negative
  // startBeats; the fold keeps every repeat, including the trailing ones.
  const out = flattenBlocks([
    block({
      startBar: 1.5,
      durationBars: 2.5, // beats 6..16
      loop: true,
      loopLengthBars: 1,
      notes: [note('a', -5, 0.25)], // phase 3 in a 4-beat loop
    }),
  ], 4)

  assert.deepEqual(out.map((n) => n.beat), [9, 13])
})

test('project totalBars clips loop expansion', () => {
  const out = flattenBlocks([
    block({
      durationBars: 4,
      loop: true,
      loopLengthBars: 1,
      notes: [note('a', 0, 1)],
    }),
  ], 4, 2)

  assert.deepEqual(out.map((n) => n.beat), [0, 4])
})

test('loop expansion is capped so a tiny pattern cannot explode', () => {
  const out = flattenBlocks([
    block({
      durationBars: 512,
      loop: true,
      loopLengthBars: 0.25, // one beat
      notes: [
        note('a', 0, 0.25), note('b', 0.25, 0.25), note('c', 0.5, 0.25),
        note('d', 0.75, 0.25), note('e', 0.875, 0.125),
      ],
    }),
  ], 4)

  assert.equal(out.length, 10000)
})

test('tileLoopNotes marks repeat indices and preserves in-window phases exactly', () => {
  const tiled = tileLoopNotes([note('a', 0.1, 0.5)], 4, 10)
  assert.deepEqual(tiled.map((t) => t.repeat), [0, 1, 2])
  // The pattern occurrence must be bit-identical to the authored startBeat so
  // previews can tell the note itself from its ghosts.
  assert.equal(tiled[0].startBeat, 0.1)
  assert.equal(tiled[2].durationBeats, 0.5)

  // Loop expansion never runs on nonsense windows.
  assert.deepEqual(tileLoopNotes([note('a', 0, 1)], 0, 8), [])
  assert.deepEqual(tileLoopNotes([note('a', 0, 1)], 4, 0), [])
})
