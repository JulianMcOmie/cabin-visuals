import test from 'node:test'
import assert from 'node:assert/strict'
import { Matrix4 } from 'three'
import {
  copyIsTargeted,
  copyTargetMask,
  copyTargetSliceOf,
  copyTargetSlices,
  gatedMoverOrSplitter,
  normalizeCopyTargets,
  type CopyTargetSelection,
} from './copyTargets'
import { identityVisualCopy } from './identityVisualCopy'
import { resolveVisualCopies, structuralCopyCount } from './resolveVisualCopies'
import type { MoverOrSplitter, VisualCopy } from './types'

const every = (slices: number, on: number[]): CopyTargetSelection => ({ rule: 'every', slices, on })
const runs = (slices: number, on: number[]): CopyTargetSelection => ({ rule: 'runs', slices, on })

/** A splitter that fans each copy into `n`, tagged by lightness so the test can
 *  tell an untouched pass-through from a copy the entry actually produced. */
function fanOut(n: number): MoverOrSplitter {
  return {
    apply(visualCopy) {
      return Array.from({ length: n }, (_, i) => ({
        transform: visualCopy.transform.clone().multiply(new Matrix4().makeTranslation(i, 0, 0)),
        opacity: visualCopy.opacity,
        colorShift: { ...visualCopy.colorShift, lightness: visualCopy.colorShift.lightness + 1 },
      }))
    },
  }
}

/** Every entry bumps lightness, so a copy that went through BOTH entries reads 2
 *  and one the gated entry skipped still reads 1. */
const touchedTwice = (copies: VisualCopy[]) => copies.map((c) => c.colorShift.lightness > 1)

test('every cuts interleaved slices, runs cuts contiguous ones', () => {
  const n = 12
  const everySlice = Array.from({ length: n }, (_, i) => copyTargetSliceOf(i, n, every(3, [0])))
  assert.deepEqual(everySlice, [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2])
  const runSlice = Array.from({ length: n }, (_, i) => copyTargetSliceOf(i, n, runs(3, [0])))
  assert.deepEqual(runSlice, [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2])
})

test('every other copy is slice 0 of 2', () => {
  assert.deepEqual(copyTargetMask(6, every(2, [0])), [true, false, true, false, true, false])
  assert.deepEqual(copyTargetMask(6, every(2, [1])), [false, true, false, true, false, true])
})

test('no selection targets everything', () => {
  assert.deepEqual(copyTargetMask(4, undefined), [true, true, true, true])
})

test('an empty slice list targets nothing', () => {
  assert.deepEqual(copyTargetMask(4, every(2, [])), [false, false, false, false])
})

test('slices never exceed the copy count', () => {
  // Asking for 8 slices of 3 copies would leave five permanently empty and the
  // stepper would keep moving with no effect on the picture.
  assert.equal(copyTargetSlices(every(8, [0]), 3), 3)
  assert.equal(copyTargetSlices(every(8, [0]), 20), 8)
  // ...but never below the minimum, so a lone copy still resolves to a slice.
  assert.equal(copyTargetSlices(every(8, [0]), 1), 2)
  assert.equal(copyTargetSliceOf(0, 1, every(8, [0])), 0)
})

test('normalize collapses "all slices on" to absence', () => {
  assert.equal(normalizeCopyTargets(every(3, [0, 1, 2]), 12), undefined)
  assert.equal(normalizeCopyTargets(undefined, 12), undefined)
  // Out-of-range entries are dropped, and duplicates collapse, before that test -
  // so [0,1,1,5] at 2 slices is [0,1], which IS all of them.
  assert.equal(normalizeCopyTargets(every(2, [0, 1, 1, 5]), 12), undefined)
  assert.deepEqual(normalizeCopyTargets(every(3, [2, 0, 0]), 12), { rule: 'every', slices: 3, on: [0, 2] })
})

test('an untargeted copy passes through untouched', () => {
  const chain = [fanOut(4), gatedMoverOrSplitter(fanOut(3), every(2, [0]))]
  const copies = resolveVisualCopies(chain, 0)
  // Copies 0 and 2 of the four fan out into three; 1 and 3 pass through alone.
  assert.equal(copies.length, 3 + 1 + 3 + 1)
  assert.deepEqual(touchedTwice(copies), [true, true, true, false, true, true, true, false])
})

test('the gate is what the structural probe counts', () => {
  const ungated = structuralCopyCount([fanOut(4), fanOut(3)])
  const gated = structuralCopyCount([fanOut(4), gatedMoverOrSplitter(fanOut(3), every(2, [0]))])
  assert.equal(ungated, 12)
  assert.equal(gated, 8)
})

test('gating the same entry twice over is stable across beats', () => {
  const chain = [fanOut(6), gatedMoverOrSplitter(fanOut(2), runs(3, [1]))]
  const at = (beat: number) => resolveVisualCopies(chain, beat).length
  assert.equal(at(0), at(7.5))
  assert.equal(at(0), at(-3))
})

test('warpBeat is not gated - a time remap reaches the whole object', () => {
  const freeze: MoverOrSplitter = {
    apply: (visualCopy) => [visualCopy],
    warpBeat: () => 4,
  }
  const gated = gatedMoverOrSplitter(freeze, every(2, [0]))
  assert.equal(gated.warpBeat?.(9), 4)
})

test('structural variants are gated too', () => {
  const entry: MoverOrSplitter = { ...fanOut(2), structuralVariants: [fanOut(9)] }
  const gated = gatedMoverOrSplitter(entry, every(2, [0]))
  // Four copies in: two fan out to nine, two pass through.
  assert.equal(structuralCopyCount([fanOut(4), gated]), 9 + 1 + 9 + 1)
})

test('composition and applyFramed survive the wrapper', () => {
  const framed: MoverOrSplitter = {
    apply: (visualCopy) => [visualCopy],
    composition: 'chainRoot',
    applyFramed: (visualCopy) => [{ visualCopy, internalTransform: new Matrix4().makeTranslation(0, 5, 0) }],
  }
  const gated = gatedMoverOrSplitter(framed, every(2, [0]))
  assert.equal(gated.composition, 'chainRoot')
  const ctx = { beat: 0, index: 1, count: 2 }
  // Index 1 is not in slice 0, so no internal motion is contributed.
  assert.equal(gated.applyFramed?.(identityVisualCopy(), ctx)[0].internalTransform, undefined)
  assert.ok(gated.applyFramed?.(identityVisualCopy(), { ...ctx, index: 0 })[0].internalTransform)
})

test('copyIsTargeted matches the mask it is derived from', () => {
  const sel = runs(4, [0, 3])
  const mask = copyTargetMask(10, sel)
  for (let i = 0; i < 10; i++) assert.equal(copyIsTargeted(i, 10, sel), mask[i])
})
