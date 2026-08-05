import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import { mergeDefinitionSettings } from './definitions'
import { identityVisualCopy } from './identityVisualCopy'
import { gridSplitter, type GridSettings } from './library'
import { resolveVisualCopies, structuralCopyCount } from './resolveVisualCopies'
import { splitterWithChildChain } from './splitterChildChain'
import type { MoverOrSplitter, MoverOrSplitterContext, VisualCopy } from './types'

// The semantics under test: a mover child of a splitter moves the splitter's
// copies in the SPLITTER'S reference frame - its origin is the origin the
// motion happens about - where the same mover as a chain sibling below the
// splitter acts in each copy's own frame.

/** A 1×N grid along X: slot positions (col − (N−1)/2) · spacing. */
function gridRow(columns: number, spacing = 2): MoverOrSplitter {
  const settings = {
    ...mergeDefinitionSettings(gridSplitter, undefined),
    rows: 1,
    columns,
    spacing,
  } as GridSettings
  return gridSplitter.resolve({ settings, notes: [] })
}

function cloneCopy(copy: VisualCopy): VisualCopy {
  return { transform: copy.transform.clone(), opacity: copy.opacity, colorShift: { ...copy.colorShift } }
}

/** LOCAL mover: post-multiplies a fixed rotation about Z. */
function rotateZ(degrees: number): MoverOrSplitter {
  const delta = new Matrix4().makeRotationZ((degrees * Math.PI) / 180)
  return {
    apply(visualCopy) {
      const next = cloneCopy(visualCopy)
      next.transform.multiply(delta)
      return [next]
    },
  }
}

/** LOCAL mover: post-multiplies a translation, scaled per copy by `perIndex`. */
function shiftX(distance: number, perIndex = false): MoverOrSplitter {
  return {
    apply(visualCopy, { index }) {
      const next = cloneCopy(visualCopy)
      next.transform.multiply(new Matrix4().makeTranslation(distance * (perIndex ? index : 1), 0, 0))
      return [next]
    },
  }
}

function positions(copies: VisualCopy[]): Vector3[] {
  return copies.map((copy) => new Vector3().setFromMatrixPosition(copy.transform))
}

function assertNear(actual: Vector3, expected: [number, number, number], label: string) {
  assert.ok(
    actual.distanceTo(new Vector3(...expected)) < 1e-9,
    `${label}: expected (${expected.join(', ')}), got (${actual.toArray().map((n) => n.toFixed(3)).join(', ')})`,
  )
}

const ctx: MoverOrSplitterContext = { beat: 0, index: 0, count: 1 }

test('empty children return the splitter untouched', () => {
  const grid = gridRow(2)
  assert.equal(splitterWithChildChain(grid, []), grid)
})

test('a rotation child turns the formation about the splitter origin, not each copy in place', () => {
  // Grid slots at x = ±1. As a chain sibling BELOW the grid, a 90° Z rotation
  // composes locally and spins each copy in place - positions stay put.
  const sibling = positions(resolveVisualCopies([gridRow(2), rotateZ(90)], 0))
  assertNear(sibling[0], [-1, 0, 0], 'sibling slot 0 stays')
  assertNear(sibling[1], [1, 0, 0], 'sibling slot 1 stays')

  // As a CHILD of the grid the same rotation orbits the copies about the
  // grid's center: (±1, 0) → (0, ±1).
  const nested = positions(resolveVisualCopies([splitterWithChildChain(gridRow(2), [rotateZ(90)])], 0))
  assertNear(nested[0], [0, -1, 0], 'nested slot 0 orbits')
  assertNear(nested[1], [0, 1, 0], 'nested slot 1 orbits')
})

test("the child's motion lives in the splitter's frame, so upstream rotation carries it", () => {
  // The incoming copy is rotated 90° about Z, so the splitter's frame axes are
  // turned: a +X shift in that frame is +Y in the world.
  const incoming = identityVisualCopy()
  incoming.transform.makeRotationZ(Math.PI / 2)
  const [a, b] = splitterWithChildChain(gridRow(2), [shiftX(1)]).apply(incoming, ctx)
  assertNear(new Vector3().setFromMatrixPosition(a.transform), [0, 0, 0], 'slot 0: (−1+1) along frame X')
  assertNear(new Vector3().setFromMatrixPosition(b.transform), [0, 2, 0], 'slot 1: (+1+1) along frame X, turned to +Y')
})

test('a per-copy child sees the splitter multiplicity and moves each copy individually', () => {
  const counts: number[] = []
  const spy: MoverOrSplitter = {
    apply(visualCopy, context) {
      counts.push(context.count)
      return shiftX(1, true).apply(visualCopy, context)
    },
  }
  const out = positions(resolveVisualCopies([splitterWithChildChain(gridRow(2), [spy])], 0))
  assert.deepEqual(counts, [2, 2], 'child addressed once per slot with the slot count')
  assertNear(out[0], [-1, 0, 0], 'index 0 shifts by 0')
  assertNear(out[1], [2, 0, 0], 'index 1 shifts by 1, measured from the grid frame')
})

test('children compose opacity and colorShift onto the slots they move', () => {
  const dim: MoverOrSplitter = {
    apply(visualCopy) {
      const next = cloneCopy(visualCopy)
      next.opacity *= 0.5
      next.colorShift.tint = '#ff0000'
      next.colorShift.tintAmount = 1
      return [next]
    },
  }
  const incoming = identityVisualCopy()
  incoming.opacity = 0.8
  const copies = splitterWithChildChain(gridRow(2), [dim]).apply(incoming, ctx)
  for (const copy of copies) {
    assert.ok(Math.abs(copy.opacity - 0.4) < 1e-9, 'slot opacity × child gain')
    assert.equal(copy.colorShift.tint, '#ff0000')
  }
})

test('a splitter child fans the formation out about the parent origin, input-major', () => {
  // Parent slots at ±1 (spacing 2); child grid slots at ±2 (spacing 4), applied
  // as deltas about the parent's origin.
  const out = positions(resolveVisualCopies([splitterWithChildChain(gridRow(2), [gridRow(2, 4)])], 0))
  assert.equal(out.length, 4)
  assertNear(out[0], [-3, 0, 0], 'parent 0 / child 0')
  assertNear(out[1], [1, 0, 0], 'parent 0 / child 1')
  assertNear(out[2], [-1, 0, 0], 'parent 1 / child 0')
  assertNear(out[3], [3, 0, 0], 'parent 1 / child 1')
})

test("a child's time remap reaches the wrapper, deltas summed", () => {
  const freezeIsh: MoverOrSplitter = {
    apply: (visualCopy) => [cloneCopy(visualCopy)],
    warpBeat: (beat) => beat - 2,
  }
  const wrapper = splitterWithChildChain(gridRow(2), [freezeIsh, freezeIsh])
  assert.equal(wrapper.warpBeat?.(10), 6)
  assert.equal(splitterWithChildChain(gridRow(2), [shiftX(1)]).warpBeat, undefined)
})

test('a degenerate incoming frame falls back to the bare splitter output', () => {
  const incoming = identityVisualCopy()
  incoming.transform.makeScale(0, 0, 0)
  const copies = splitterWithChildChain(gridRow(2), [rotateZ(90)]).apply(incoming, ctx)
  assert.equal(copies.length, 2)
  for (const copy of copies) {
    assert.ok(copy.transform.elements.every(Number.isFinite), 'no NaNs from a zero-scale frame')
  }
})

// ── Internal motion: the child never re-frames the chain below ──────────────

test('a grid below duplicates the SPINNING sub-grid; the layout itself stays put', () => {
  // The user-facing case that motivated the frame/internal split: sub-grid
  // first (spacing 4 → slots ±2) with a rotation child, duplicator grid second
  // (spacing 1 → offsets ±0.5). The duplicates must land on the UNROTATED
  // lattice, each containing the rotated sub-grid: position = dup + R·slot,
  // never R·(slot + dup) (the whole compound orbiting one origin).
  const out = positions(resolveVisualCopies([
    splitterWithChildChain(gridRow(2, 4), [rotateZ(90)]),
    gridRow(2, 1),
  ], 0))
  assertNear(out[0], [-0.5, -2, 0], 'slot −2 rotated to (0,−2), duplicated at −0.5')
  assertNear(out[1], [0.5, -2, 0], 'slot −2 rotated to (0,−2), duplicated at +0.5')
  assertNear(out[2], [-0.5, 2, 0], 'slot +2 rotated to (0,+2), duplicated at −0.5')
  assertNear(out[3], [0.5, 2, 0], 'slot +2 rotated to (0,+2), duplicated at +0.5')
})

test('a mover below composes against the unmoved frame, not the child motion', () => {
  // Shift +X below the wrapped grid: the copies orbit the grid center AND
  // shift along the frame's own X - the shift axis must not rotate with them.
  const out = positions(resolveVisualCopies([
    splitterWithChildChain(gridRow(2), [rotateZ(90)]),
    shiftX(1),
  ], 0))
  assertNear(out[0], [1, -1, 0], 'orbited to (0,−1), shifted along unrotated X')
  assertNear(out[1], [1, 1, 0], 'orbited to (0,+1), shifted along unrotated X')
})

test('downstream steps SEE the unmoved frames', () => {
  const seen: number[][] = []
  const spy: MoverOrSplitter = {
    apply(visualCopy) {
      seen.push(new Vector3().setFromMatrixPosition(visualCopy.transform).toArray())
      return [cloneCopy(visualCopy)]
    },
  }
  resolveVisualCopies([splitterWithChildChain(gridRow(2), [rotateZ(90)]), spy], 0)
  assertNear(new Vector3(...seen[0]), [-1, 0, 0], 'frame handed downstream is the bare slot')
  assertNear(new Vector3(...seen[1]), [1, 0, 0], 'frame handed downstream is the bare slot')
})

test('internal motion is inherited through a downstream fan-out', () => {
  const clone2: MoverOrSplitter = {
    apply: (visualCopy) => [cloneCopy(visualCopy), cloneCopy(visualCopy)],
  }
  const out = positions(resolveVisualCopies([
    splitterWithChildChain(gridRow(2), [rotateZ(90)]),
    clone2,
  ], 0))
  assert.equal(out.length, 4)
  assertNear(out[0], [0, -1, 0], 'both clones of slot 0 carry the orbit')
  assertNear(out[1], [0, -1, 0], 'both clones of slot 0 carry the orbit')
  assertNear(out[2], [0, 1, 0], 'both clones of slot 1 carry the orbit')
})

test('two wrapped splitters compose deepest-contributor-innermost', () => {
  // Outer grid (±2) spinning + inner duplicator (±0.5) spinning, both 90°.
  // Pinned from the documented rule (frame · outer internal · inner internal):
  // position = R₁(slot + (R₂−I)·dup) + dup, which at 90/90 collapses to
  // (0, slot − dup).
  const out = positions(resolveVisualCopies([
    splitterWithChildChain(gridRow(2, 4), [rotateZ(90)]),
    splitterWithChildChain(gridRow(2, 1), [rotateZ(90)]),
  ], 0))
  assertNear(out[0], [0, -1.5, 0], 'slot −2, dup −0.5')
  assertNear(out[1], [0, -2.5, 0], 'slot −2, dup +0.5')
  assertNear(out[2], [0, 2.5, 0], 'slot +2, dup −0.5')
  assertNear(out[3], [0, 1.5, 0], 'slot +2, dup +0.5')
})

test('structural variants compose through the wrapper, so the probe sees child fan-out', () => {
  const childOfCount = (n: number): MoverOrSplitter => ({
    apply: (visualCopy) => Array.from({ length: n }, () => cloneCopy(visualCopy)),
  })
  const automatedChild: MoverOrSplitter = {
    ...childOfCount(2),
    structuralVariants: [childOfCount(4), childOfCount(1)],
  }
  const wrapper = splitterWithChildChain(gridRow(2), [automatedChild])
  // Base 2×2 = 4; max-reach variant 2×4 = 8.
  assert.equal(resolveVisualCopies([wrapper], 0).length, 4)
  assert.equal(structuralCopyCount([wrapper]), 8)
})
