import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import { identityVisualCopy } from './identityVisualCopy'
import { MAX_VISUAL_COPIES, resolveVisualCopies } from './resolveVisualCopies'
import type { MoverOrSplitter, MoverOrSplitterContext, VisualCopy } from './types'

// -- Test-only chain entries ------------------------------------------------

/** Returns a new copy with `transform = previous * delta` (local composition). */
function cloneCopy(copy: VisualCopy): VisualCopy {
  return {
    transform: copy.transform.clone(),
    opacity: copy.opacity,
    colorShift: { ...copy.colorShift },
  }
}

function translateMover(x: number, y = 0, z = 0): MoverOrSplitter {
  return {
    apply(visualCopy) {
      const next = cloneCopy(visualCopy)
      next.transform.multiply(new Matrix4().makeTranslation(x, y, z))
      return [next]
    },
  }
}

function rotateZMover(angle: number): MoverOrSplitter {
  return {
    apply(visualCopy) {
      const next = cloneCopy(visualCopy)
      next.transform.multiply(new Matrix4().makeRotationZ(angle))
      return [next]
    },
  }
}

/** Emits `slots` copies of its input, offsetting slot s by s*spacing on X. */
function splitter(slots: number, spacing: number): MoverOrSplitter {
  return {
    apply(visualCopy) {
      const copies: VisualCopy[] = []
      for (let s = 0; s < slots; s++) {
        const next = cloneCopy(visualCopy)
        next.transform.multiply(new Matrix4().makeTranslation(s * spacing, 0, 0))
        copies.push(next)
      }
      return copies
    },
  }
}

/** Records every context it sees, passing copies through untouched (as clones). */
function recordingMover(seen: MoverOrSplitterContext[]): MoverOrSplitter {
  return {
    apply(visualCopy, context) {
      seen.push({ ...context })
      return [cloneCopy(visualCopy)]
    },
  }
}

function positionOf(copy: VisualCopy): [number, number, number] {
  const e = copy.transform.elements
  return [e[12], e[13], e[14]]
}

// -- Tests ------------------------------------------------------------------

test('empty chain returns one identity copy', () => {
  const copies = resolveVisualCopies([], 0)
  assert.equal(copies.length, 1)
  assert.deepEqual(copies[0].transform.elements, new Matrix4().elements)
  assert.equal(copies[0].opacity, 1)
  assert.deepEqual(copies[0].colorShift, { hue: 0, saturation: 0, lightness: 0 })
})

test('movers receive the current index and count', () => {
  const seen: MoverOrSplitterContext[] = []
  resolveVisualCopies([splitter(3, 1), recordingMover(seen)], 7.5)
  assert.deepEqual(seen, [
    { beat: 7.5, index: 0, count: 3 },
    { beat: 7.5, index: 1, count: 3 },
    { beat: 7.5, index: 2, count: 3 },
  ])
})

test('a splitter expands one copy into multiple copies', () => {
  const copies = resolveVisualCopies([splitter(3, 2)], 0)
  assert.equal(copies.length, 3)
  assert.deepEqual(copies.map(positionOf), [
    [0, 0, 0],
    [2, 0, 0],
    [4, 0, 0],
  ])
})

test('downstream movers see the expanded count', () => {
  // Alternating mover: offsets odd indices only - possible only if it sees the
  // post-split index/count.
  const alternating: MoverOrSplitter = {
    apply(visualCopy, { index, count }) {
      assert.equal(count, 4)
      const next = cloneCopy(visualCopy)
      if (index % 2 === 1) next.transform.multiply(new Matrix4().makeTranslation(0, 10, 0))
      return [next]
    },
  }
  const copies = resolveVisualCopies([splitter(4, 1), alternating], 0)
  assert.deepEqual(copies.map((c) => positionOf(c)[1]), [0, 10, 0, 10])
})

test('mover -> splitter differs from splitter -> mover', () => {
  // rotate 90deg about Z, then split along local X vs the reverse. Rotation
  // turns the splitter's local X offsets into Y offsets - orders must differ.
  const rot = rotateZMover(Math.PI / 2)
  const split = splitter(2, 4)

  const rotThenSplit = resolveVisualCopies([rot, split], 0)
  const splitThenRot = resolveVisualCopies([split, rot], 0)

  const round = (v: number[]) => v.map((n) => Math.round(n * 1e6) / 1e6)
  assert.deepEqual(rotThenSplit.map((c) => round(positionOf(c))), [
    [0, 0, 0],
    [0, 4, 0],
  ])
  assert.deepEqual(splitThenRot.map((c) => round(positionOf(c))), [
    [0, 0, 0],
    [4, 0, 0],
  ])
})

test('nested output ordering is input-major, then splitter-slot order', () => {
  // 2-way split (X spacing) then 3-way split (Y spacing... via a Y splitter).
  const ySplitter: MoverOrSplitter = {
    apply(visualCopy) {
      return [0, 1, 2].map((s) => {
        const next = cloneCopy(visualCopy)
        next.transform.multiply(new Matrix4().makeTranslation(0, s, 0))
        return next
      })
    },
  }
  const copies = resolveVisualCopies([splitter(2, 1), ySplitter], 0)
  assert.deepEqual(copies.map(positionOf), [
    [0, 0, 0],
    [0, 1, 0],
    [0, 2, 0],
    [1, 0, 0],
    [1, 1, 0],
    [1, 2, 0],
  ])
})

test('opacity and color shift survive copying', () => {
  const tint: MoverOrSplitter = {
    apply(visualCopy) {
      const next = cloneCopy(visualCopy)
      next.opacity = visualCopy.opacity * 0.5
      next.colorShift = {
        hue: visualCopy.colorShift.hue + 0.25,
        saturation: visualCopy.colorShift.saturation + 0.1,
        lightness: visualCopy.colorShift.lightness - 0.1,
      }
      return [next]
    },
  }
  const copies = resolveVisualCopies([tint, splitter(2, 1)], 0)
  assert.equal(copies.length, 2)
  for (const copy of copies) {
    assert.equal(copy.opacity, 0.5)
    assert.deepEqual(copy.colorShift, { hue: 0.25, saturation: 0.1, lightness: -0.1 })
  }
})

test('the evaluator does not require or cause input mutation', () => {
  // Capture the copies emitted by step 1, then verify step 2 (which returns
  // fresh clones) left them untouched after the full resolve.
  const emitted: VisualCopy[] = []
  const capture: MoverOrSplitter = {
    apply(visualCopy) {
      const next = cloneCopy(visualCopy)
      next.transform.multiply(new Matrix4().makeTranslation(1, 2, 3))
      emitted.push(next)
      return [next]
    },
  }
  resolveVisualCopies([capture, translateMover(9), splitter(2, 5)], 0)
  assert.equal(emitted.length, 1)
  assert.deepEqual(positionOf(emitted[0]), [1, 2, 3])
  assert.equal(emitted[0].opacity, 1)
})

test('same beat produces identical copies (pure evaluation)', () => {
  const chain = [rotateZMover(0.3), splitter(3, 2), translateMover(1, 1, 1)]
  const a = resolveVisualCopies(chain, 12.25)
  const b = resolveVisualCopies(chain, 12.25)
  assert.equal(a.length, b.length)
  for (let i = 0; i < a.length; i++) {
    assert.deepEqual(a[i].transform.elements, b[i].transform.elements)
    assert.equal(a[i].opacity, b[i].opacity)
    assert.deepEqual(a[i].colorShift, b[i].colorShift)
  }
})

test('the hard copy cap bounds chained splitters', () => {
  // Eleven 2-way splits would produce 2048 copies; the cap truncates to
  // MAX_VISUAL_COPIES and downstream steps see the truncated count.
  const chain = Array.from({ length: 11 }, () => splitter(2, 1))
  const seen: MoverOrSplitterContext[] = []
  const copies = resolveVisualCopies([...chain, recordingMover(seen)], 0)
  assert.equal(copies.length, MAX_VISUAL_COPIES)
  assert.equal(seen.length, MAX_VISUAL_COPIES)
  assert.equal(seen[0].count, MAX_VISUAL_COPIES)
})

test('identityVisualCopy returns independently owned values', () => {
  const a = identityVisualCopy()
  const b = identityVisualCopy()
  a.transform.makeTranslation(5, 0, 0)
  a.colorShift.hue = 1
  assert.deepEqual(b.transform.elements, new Matrix4().elements)
  assert.equal(b.colorShift.hue, 0)
})
