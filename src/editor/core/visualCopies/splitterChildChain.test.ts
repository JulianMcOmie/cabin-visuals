import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { mergeDefinitionSettings } from './definitions'
import { identityVisualCopy } from './identityVisualCopy'
import { gridSplitter, radialSplitter, type GridSettings } from './library'
import { resolveVisualCopies, structuralCopyCount } from './resolveVisualCopies'
import { splitterWithChildChain } from './splitterChildChain'
import { symmetricMotionMover, type SymmetricMotionSettings } from './symmetricMotion'
import type { MoverOrSplitter, MoverOrSplitterContext, VisualCopy } from './types'
import { moverDefinition, type MoverSettings } from './mover'
import { gatedMoverOrSplitter } from './copyTargets'

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

// ── Position-reading children: Symmetric Motion aims per slot ───────────────

function symmetricOut(): MoverOrSplitter {
  const note: ResolvedNote = { beat: 0, pitch: 60, durationBeats: 4, velocity: 1, blockStartBeat: 0, blockEndBeat: 1024 }
  // Constant mode: travel accumulates while the Out note is held, so the
  // offset at beat 1 is deterministic and nonzero.
  const settings = {
    ...mergeDefinitionSettings(symmetricMotionMover, undefined),
    motion: 1,
  } as SymmetricMotionSettings
  return symmetricMotionMover.resolve({ settings, notes: [note] })
}

test('a Symmetric Motion child reads each slot position and pushes the formation outward', () => {
  const base = positions(resolveVisualCopies([gridRow(2)], 1))
  const out = positions(resolveVisualCopies([splitterWithChildChain(gridRow(2), [symmetricOut()])], 1))
  assert.ok(out[0].x < base[0].x - 0.5, `slot −1 pushed further out (-x): ${out[0].x}`)
  assert.ok(out[1].x > base[1].x + 0.5, `slot +1 pushed further out (+x): ${out[1].x}`)
  assert.ok(Math.abs(out[0].x + out[1].x) < 1e-9, 'push stays symmetric about the splitter center')
})

test('nested last-in-chain, Symmetric Motion matches the same mover as a sibling below', () => {
  const sibling = positions(resolveVisualCopies([gridRow(2), symmetricOut()], 1))
  const nested = positions(resolveVisualCopies([splitterWithChildChain(gridRow(2), [symmetricOut()])], 1))
  sibling.forEach((p, i) => assertNear(nested[i], p.toArray() as [number, number, number], `copy ${i} agrees`))
})

test('a grid below duplicates the blooming formation on its unmoved lattice', () => {
  const out = positions(resolveVisualCopies([
    splitterWithChildChain(gridRow(2, 4), [symmetricOut()]),
    gridRow(2, 1),
  ], 1))
  // Slots ±2 bloom outward by the same travel k; duplicates at ±0.5 must ride
  // the UNMOVED lattice: x = ±(2+k) ± 0.5, with each duplicate pair centered
  // on its blooming slot.
  const k = -out[0].x - 2.5
  assert.ok(k > 0.5, `slots actually bloomed (k=${k})`)
  assertNear(out[0], [-2.5 - k, 0, 0], 'slot −2 bloomed, dup −0.5')
  assertNear(out[1], [-1.5 - k, 0, 0], 'slot −2 bloomed, dup +0.5')
  assertNear(out[2], [1.5 + k, 0, 0], 'slot +2 bloomed, dup −0.5')
  assertNear(out[3], [2.5 + k, 0, 0], 'slot +2 bloomed, dup +0.5')
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

test('descendants retain their own singular or mirrored slot frame and clock', () => {
  const parent: MoverOrSplitter = {
    emitsCopyClocks: true,
    apply(copy) { return this.applyFramed!(copy, { beat: 0, index: 0, count: 1 }).map((f) => f.visualCopy) },
    applyFramed(copy) {
      return [0, -1].map((scale, slot) => ({
        visualCopy: {
          transform: copy.transform.clone().multiply(new Matrix4().makeTranslation(slot * 4 - 2, 1, 0))
            .multiply(new Matrix4().makeScale(scale, 1, 1)),
          opacity: copy.opacity * (slot + 1) / 2,
          colorShift: { ...copy.colorShift, hue: slot / 3 },
        },
        beatOffset: slot + 1,
        birthBeat: 8 + slot,
      }))
    },
  }
  const wrapper = splitterWithChildChain(parent, [gridRow(3), rotateZ(37), shiftX(0.4, true)])
  const input = identityVisualCopy()
  input.transform.makeRotationY(0.3).premultiply(new Matrix4().makeTranslation(3, 2, 1))
  const context = { beat: 10, index: 0, count: 1 }
  const folded = wrapper.apply(input, context)
  const framed = wrapper.applyFramed!(input, context)
  assert.equal(framed.length, 6)
  for (let i = 0; i < framed.length; i++) {
    const result = framed[i]
    assert.equal(result.beatOffset, Math.floor(i / 3) + 1)
    assert.equal(result.birthBeat, 8 + Math.floor(i / 3))
    const transform = result.visualCopy.transform.clone()
    if (result.internalTransform) transform.multiply(result.internalTransform)
    transform.elements.forEach((value, j) => assert.ok(Math.abs(value - folded[i].transform.elements[j]) < 1e-10))
    assert.equal(result.visualCopy.opacity, folded[i].opacity)
    assert.deepEqual(result.visualCopy.colorShift, folded[i].colorShift)
    assert.equal(!!result.internalTransform, i >= 3, 'only mirrored, invertible slots carry separate internal motion')
  }
  const untouched = framed[1].visualCopy.transform.clone()
  framed[0].visualCopy.transform.makeScale(9, 9, 9)
  assert.deepEqual(framed[1].visualCopy.transform.elements, untouched.elements, 'descendants own their frames')
  assert.equal(wrapper.cachePolicy, undefined, 'clock emitters are never declared static')
})

function uniformMover(motion: number, mode = 1): MoverOrSplitter {
  return moverDefinition.resolve({
    settings: mergeDefinitionSettings(moverDefinition, { motion, mode,
      angleX: 27, angleY: 41, angleZ: 63, pivotX: 1.2, pivotY: -.8, pivotZ: .3,
      distanceX: 2, distanceY: .3, distanceZ: .7 }) as unknown as MoverSettings,
    notes: [{ beat: .2, durationBeats: 2, blockStartBeat: 0, blockEndBeat: 8, pitch: 60, velocity: .7 },
      { beat: 1, durationBeats: 2, blockStartBeat: 0, blockEndBeat: 8, pitch: 63, velocity: 100 }],
  })
}

function assertMatrixNear(actual: Matrix4, expected: Matrix4) {
  actual.elements.forEach((value, i) => assert.ok(Math.abs(value - expected.elements[i]) < 1e-8,
    `matrix element ${i}: ${value} != ${expected.elements[i]}`))
}

test('compact child metadata reproduces Rotate, Translate and Orbit frames and internals across seeks', () => {
  const parent = radialSplitter.resolve({ settings: mergeDefinitionSettings(radialSplitter,
    { copies: 5, radius: 2, tilt: 31, size: .7 }) as never, notes: [] })
  const poses = [new Matrix4(), new Matrix4().makeRotationY(.3).setPosition(3, -4, 7)
    .scale(new Vector3(.7, 1.3, -2.1)), new Matrix4().makeScale(0, 1, 1).setPosition(2, 3, 4),
  new Matrix4().makeScale(1e-5, 1e-5, 1e-5).setPosition(3, 2, 1)]
  for (const motion of [0, 1, 2]) for (const mode of [0, 1, 2]) {
    const wrapper = splitterWithChildChain(parent, [uniformMover(motion, mode), uniformMover(1, 2)])
    const seen = new Map<number, number[][]>()
    for (const beat of [0, .7, 2.4, -1, .7, 0]) {
      const compact = wrapper.framedLocalTransformsAtBeat!(beat)
      assert.equal(compact.frames.length, 5)
      assert.equal(compact.internals.length, 5)
      assert.equal(compact.bareFrames.length, 5)
      const saved = [...compact.frames, ...compact.internals.filter((m): m is Matrix4 => m !== null),
        ...compact.bareFrames].map(matrix => matrix.elements.slice())
      if (seen.has(beat)) assert.deepEqual(saved, seen.get(beat))
      seen.set(beat, saved)
      for (const pose of poses) {
        const input = identityVisualCopy()
        input.transform.copy(pose)
        input.opacity = .31
        input.colorShift.hue = .27
        const reference = wrapper.applyFramed!(input, { beat, index: 5, count: 10,
          placementTransform: new Matrix4().makeScale(0, 1, 1) })
        const determinant = pose.determinant()
        const degenerate = !Number.isFinite(determinant) || Math.abs(determinant) < 1e-12
        reference.forEach((copy, index) => {
          const frame = pose.clone().multiply((degenerate ? compact.bareFrames : compact.frames)[index])
          assertMatrixNear(frame, copy.visualCopy.transform)
          const internal = degenerate ? null : compact.internals[index]
          assert.equal(!!internal, !!copy.internalTransform)
          if (internal) assertMatrixNear(internal, copy.internalTransform!)
          assert.equal(copy.visualCopy.opacity, input.opacity)
          assert.deepEqual(copy.visualCopy.colorShift, input.colorShift)
          // A downstream splitter composes before the retained internal; this
          // must not collapse to simply using an animated local frame.
          const downstream = new Matrix4().makeRotationX(.6).setPosition(.4, -.5, .2)
          const expected = copy.visualCopy.transform.clone().multiply(downstream)
          if (copy.internalTransform) expected.multiply(copy.internalTransform)
          frame.multiply(downstream)
          if (internal) frame.multiply(internal)
          assertMatrixNear(frame, expected)
        })
      }
      assert.equal(wrapper.framedLocalTransformsAtBeat!(beat), compact)
      assert.deepEqual([...compact.frames, ...compact.internals.filter((m): m is Matrix4 => m !== null),
        ...compact.bareFrames].map(matrix => matrix.elements), saved)
    }
  }
})

test('compact own-slot singular fallback retains bare slots for a degenerate incoming frame', () => {
  const local = [new Matrix4().makeScale(0, 1, 1).setPosition(2, 3, 1),
    new Matrix4().makeScale(-.8, 1.2, .7).setPosition(-2, 1, 3)]
  const parent: MoverOrSplitter = { localTransforms: local, apply(copy) {
    return local.map(matrix => ({ ...copy, transform: copy.transform.clone().multiply(matrix) }))
  } }
  const wrapper = splitterWithChildChain(parent, [uniformMover(2)])
  const compact = wrapper.framedLocalTransformsAtBeat!(1.7)
  assert.equal(compact.internals[0], null)
  assert.ok(compact.internals[1])
  assert.notDeepEqual(compact.frames[0].elements, compact.bareFrames[0].elements)
  for (const pose of [new Matrix4().makeRotationX(.3).setPosition(2, -3, 4),
    new Matrix4().makeScale(0, 1, 1).setPosition(5, 6, 7)]) {
    const input = identityVisualCopy(); input.transform.copy(pose)
    const degenerate = Math.abs(pose.determinant()) < 1e-12
    const reference = wrapper.applyFramed!(input, { ...ctx, beat: 1.7 })
    reference.forEach((copy, index) => {
      assertMatrixNear(pose.clone().multiply((degenerate ? compact.bareFrames : compact.frames)[index]), copy.visualCopy.transform)
      assert.equal(!!copy.internalTransform, !degenerate && !!compact.internals[index])
    })
  }
})

test('framed metadata requires count-one proof and declines context-dependent or clocked children', () => {
  const parent = gridRow(4)
  const proven = uniformMover(1)
  assert.ok(splitterWithChildChain(parent, [proven]).framedLocalTransformsAtBeat)
  const unknownCardinality = { ...proven, localTransformCount: undefined }
  assert.equal(splitterWithChildChain(parent, [unknownCardinality]).framedLocalTransformsAtBeat, undefined)
  assert.equal(splitterWithChildChain(parent, [gridRow(2)]).framedLocalTransformsAtBeat, undefined)
  assert.equal(splitterWithChildChain(parent, [shiftX(1, true)]).framedLocalTransformsAtBeat, undefined)
  assert.equal(splitterWithChildChain(parent, [{ ...proven, emitsCopyClocks: true }]).framedLocalTransformsAtBeat, undefined)
  assert.equal(splitterWithChildChain(parent, [{ ...proven, structuralVariants: [gridRow(2)] }]).framedLocalTransformsAtBeat, undefined)
  assert.equal(splitterWithChildChain(parent, [gatedMoverOrSplitter(proven,
    { rule: 'every', slices: 2, on: [0] })]).framedLocalTransformsAtBeat, undefined)
})

test('declared tiny local slots keep their singularity classification as upstream frames rotate', () => {
  const scales = [0, 1e-5, 1e-4 * (1 - 1e-6), 1e-4, 1e-4 * (1 + 1e-6), -.7]
  const locals = scales.map(scale => new Matrix4().makeScale(scale, scale, scale).setPosition(2, 3, 1))
  const parent: MoverOrSplitter = { localTransforms: locals, apply(copy) {
    return locals.map(local => ({ ...copy, transform: copy.transform.clone().multiply(local) }))
  } }
  const wrapper = splitterWithChildChain(parent, [uniformMover(1)])
  const compact = wrapper.framedLocalTransformsAtBeat!(1.7)
  for (let step = 0; step < 40; step++) {
    const input = identityVisualCopy()
    input.transform.makeRotationX(step * .37).multiply(new Matrix4().makeRotationY(step * .11))
      .scale(new Vector3(.7, 1.3, 2.1)).setPosition(3, -4, 7)
    const reference = wrapper.applyFramed!(input, { ...ctx, beat: 1.7 })
    reference.forEach((copy, index) => {
      assert.equal(!!copy.internalTransform, Math.abs(locals[index].determinant()) >= 1e-12,
        `slot ${index} must classify its declared scale without inverse cancellation`)
      assertMatrixNear(input.transform.clone().multiply(compact.frames[index]), copy.visualCopy.transform)
      if (copy.internalTransform) assertMatrixNear(compact.internals[index]!, copy.internalTransform)
    })
  }
})
