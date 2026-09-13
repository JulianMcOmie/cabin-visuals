import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { mergeDefinitionSettings } from './definitions'
import { identityVisualCopy } from './identityVisualCopy'
import { impactScatterMover, SCATTER_IMPACT_PITCH, type ImpactScatterSettings } from './impactScatter'
import { MOTION_BLOCKS, motionMover } from './motion'
import { framedMoverOrSplitter } from './moverFrame'
import { resolveVisualCopies } from './resolveVisualCopies'
import type { MoverOrSplitter, VisualCopy } from './types'
import { splitterWithChildChain } from './splitterChildChain'
import { sharedLocalLayout } from './sharedLocalLayout'
import { compileParticlePlan, particlePlanCopy } from './particlePlan'
import { sharedGpuOperation } from './sharedGpuOperation'
import { paletteAppearance } from './gpuAppearance'

/** A frame that slides the parent's field a fixed distance along +X. */
function shift(distance: number): MoverOrSplitter {
  return {
    apply(visualCopy) {
      return [{
        transform: visualCopy.transform.clone().multiply(new Matrix4().makeTranslation(distance, 0, 0)),
        opacity: visualCopy.opacity,
        colorShift: { ...visualCopy.colorShift },
      }]
    },
  }
}

function copyAt(x: number, y: number, z: number): VisualCopy {
  const copy = identityVisualCopy()
  copy.transform.makeTranslation(x, y, z)
  return copy
}

function note(beat: number, pitch: number, durationBeats = 0.25): ResolvedNote {
  return { beat, pitch, durationBeats, velocity: 1, blockStartBeat: 0, blockEndBeat: 1024 }
}

function scatter(overrides: Partial<ImpactScatterSettings> = {}, hitBeat = 0): MoverOrSplitter {
  return impactScatterMover.resolve({
    settings: { ...mergeDefinitionSettings(impactScatterMover, undefined), ...overrides } as ImpactScatterSettings,
    notes: [note(hitBeat, SCATTER_IMPACT_PITCH)],
  })
}

/** Where a copy placed at `home` ends up, as a world position. */
function endsUp(mover: MoverOrSplitter, home: [number, number, number], beat: number): Vector3 {
  const [out] = mover.apply(copyAt(...home), { beat, index: 0, count: 1 })
  return new Vector3().setFromMatrixPosition(out.transform)
}

/** The furthest the copy gets from home over a window, and in which direction. */
function peak(mover: MoverOrSplitter, home: [number, number, number]): { distance: number; x: number } {
  let best = { distance: 0, x: 0 }
  for (let beat = 0; beat <= 8; beat += 1 / 32) {
    const offset = endsUp(mover, home, beat).sub(new Vector3(...home))
    if (offset.length() > best.distance) best = { distance: offset.length(), x: offset.x }
  }
  return best
}

test('an empty frame returns the mover untouched', () => {
  const inner = scatter()
  assert.equal(framedMoverOrSplitter(inner, []), inner)
})

test('a frame moves the blast center, so the throw reverses direction', () => {
  const home: [number, number, number] = [3, 0, 0]
  // Center at the origin: the copy at +3 is thrown outward, away from it.
  const unframed = peak(scatter(), home)
  assert.ok(unframed.x > 0, `thrown +X away from the origin (x=${unframed.x.toFixed(2)})`)

  // The same mover with its field slid to +9: the copy at +3 is now INSIDE the
  // blast, so outward is -X. Nothing about the mover's own settings changed.
  const framed = peak(framedMoverOrSplitter(scatter(), [shift(9)]), home)
  assert.ok(framed.x < 0, `thrown -X away from the moved center (x=${framed.x.toFixed(2)})`)
})

test('a frame moves the falloff with the geometry, not just the direction', () => {
  // Far outside `reach` the hit barely registers; sliding the field onto the copy
  // has to make it land hard, which only happens if gain reads the moved center.
  const home: [number, number, number] = [40, 0, 0]
  const faint = peak(scatter(), home).distance
  const direct = peak(framedMoverOrSplitter(scatter(), [shift(40)]), home).distance
  assert.ok(direct > faint * 4, `moved center hits far harder (${direct.toFixed(2)} vs ${faint.toFixed(2)})`)
})

test('a frame leaves the field at rest when the mover is at rest', () => {
  // Before the hit there is nothing to move: the frame must not displace the
  // copy itself. Only the parent's FIELD moves, never the object.
  const framed = framedMoverOrSplitter(scatter({}, 4), [shift(9)])
  const at = endsUp(framed, [3, 0, 0], 0)
  assert.ok(at.distanceTo(new Vector3(3, 0, 0)) < 1e-9, `copy still at home (${at.toArray()})`)
})

test('frames nest: a frame can itself be framed', () => {
  const home: [number, number, number] = [12, 0, 0]
  const once = peak(framedMoverOrSplitter(scatter(), [shift(6)]), home)
  const twice = peak(framedMoverOrSplitter(framedMoverOrSplitter(scatter(), [shift(6)]), [shift(6)]), home)
  // 6 puts the center below the copy (thrown +X); 6+6 puts it exactly on it.
  assert.ok(once.x > 0, `center at +6 throws +X (x=${once.x.toFixed(2)})`)
  assert.ok(twice.distance > once.distance, `center at +12 hits harder (${twice.distance.toFixed(2)})`)
})

test('a real Motion mover works as a frame: the center drifts with it', () => {
  // Drift +X, unwrapped, so the frame is a growing translation.
  const drift = motionMover.resolve({
    settings: mergeDefinitionSettings(motionMover, { boundX: 0, boundY: 0, boundZ: 0 }) as never,
    notes: [note(0, MOTION_BLOCKS.drift, 16)],
  })
  const home: [number, number, number] = [8, 0, 0]
  // Hit at beat 4, by which point the drifting center has reached +8 - i.e. the
  // copy. An unmoved center at the origin is 8 away and hits far softer.
  const framed = peak(framedMoverOrSplitter(scatter({}, 4), [drift]), home).distance
  const plain = peak(scatter({}, 4), home).distance
  assert.ok(framed > plain, `drifted center hits harder (${framed.toFixed(2)} vs ${plain.toFixed(2)})`)
})

test('the frame does not become an extra chain entry', () => {
  // One mover in, one copy out - a frame changes how its parent behaves, never
  // how many copies the chain produces.
  const framed = framedMoverOrSplitter(scatter(), [shift(9)])
  assert.equal(resolveVisualCopies([framed], 0.25).length, 1)
})

/** The pre-optimization wrapper, intentionally without proof or composition
 * forwarding. This is an independent reference for nested anchoring parity. */
function genericFrame(inner: MoverOrSplitter, frame: MoverOrSplitter[]): MoverOrSplitter {
  return {
    apply(copy, context) {
      const [sample] = resolveVisualCopies(frame, context.beat, context.placementTransform)
      if (!sample) return inner.apply(copy, context)
      const placementTransform = sample.transform.clone().invert()
      if (context.placementTransform) placementTransform.multiply(context.placementTransform)
      return inner.apply(copy, { ...context, placementTransform })
    },
  }
}

test('irrelevant frames preserve compact metadata without evaluating their layout', () => {
  const delta = new Matrix4().makeRotationY(.4)
  const inner = sharedLocalLayout({ transforms: [delta], opacities: [.7], hueShifts: [.2] })
  const frame = [shift(7)]
  const expected = genericFrame(inner, frame)
  const fast = framedMoverOrSplitter(inner, frame)
  assert.equal(fast.localLayout, inner.localLayout)
  assert.equal(fast.cachePolicy, 'static')
  const placement = new Matrix4().makeRotationX(.7).setPosition(2, 3, 4)
  const copy = copyAt(1, -.3, 2); copy.opacity = .6; copy.colorShift.hue = .13
  for (const beat of [-1, 0, 2, 0]) {
    const context = { beat, index: 3, count: 7, placementTransform: placement }
    assert.deepEqual(fast.apply(copy, context), expected.apply(copy, context))
  }
  frame[0].apply = () => { throw new Error('irrelevant frame expanded') }
  fast.apply(copy, { beat: 4, index: 0, count: 1 })
  assert.ok(compileParticlePlan([fast], 0, 4))
})

test('a fast framed chain-root mover retains the generic wrapper local reanchoring', () => {
  const delta = new Matrix4().makeRotationZ(.63).setPosition(.3, -.2, .4)
  const inner: MoverOrSplitter = {
    composition: 'chainRoot', localSlotMotion: true, rootTransform: delta,
    apply(copy) { return [{ ...copy, transform: delta.clone().multiply(copy.transform) }] },
  }
  const parent = sharedLocalLayout({ transforms: [
    new Matrix4().makeRotationY(.4).setPosition(2, 1, -.3),
    new Matrix4().makeRotationX(.3).setPosition(-1, .5, .2),
  ] })
  const frame = [shift(9)]
  const fast = framedMoverOrSplitter(inner, frame)
  assert.equal(fast.composition, undefined)
  assert.equal(fast.rootTransform, delta)
  const baseline = splitterWithChildChain(parent, [genericFrame(inner, frame)])
  const optimized = splitterWithChildChain(parent, [fast])
  const naive = splitterWithChildChain(parent, [inner])
  const suffix = sharedLocalLayout({ transforms: [new Matrix4().makeTranslation(.2, .4, .8)] })
  for (const beat of [0, 1, -1]) {
    assert.deepEqual(resolveVisualCopies([optimized, suffix], beat), resolveVisualCopies([baseline, suffix], beat))
    assert.notDeepEqual(resolveVisualCopies([naive, suffix], beat), resolveVisualCopies([baseline, suffix], beat),
      'returning the raw inner mover would change established nested composition')
  }
})

test('frame fast paths require placement-independent variants and retain time remaps', () => {
  let evaluated = 0
  const frame = [{ apply: (copy: VisualCopy) => { evaluated++; return [copy] } }]
  const independent = sharedLocalLayout({ transforms: [new Matrix4()] })
  independent.warpBeat = beat => beat - 2
  independent.structuralVariants = [sharedLocalLayout({ transforms: [new Matrix4().makeTranslation(1, 0, 0)] })]
  const fast = framedMoverOrSplitter(independent, frame)
  assert.equal(fast.warpBeat!(3), 1)
  assert.ok(fast.structuralVariants?.[0].localTransforms)
  fast.apply(identityVisualCopy(), { beat: 1, index: 0, count: 1 })
  assert.equal(evaluated, 0)
  const dependent = sharedLocalLayout((_beat, placement) => ({ transforms: [placement?.clone() ?? new Matrix4()] }),
    { count: 1, usesPlacement: true })
  const guarded = framedMoverOrSplitter({ ...independent, structuralVariants: [dependent] }, frame)
  assert.equal(guarded.localTransforms, undefined)
  guarded.apply(identityVisualCopy(), { beat: 1, index: 0, count: 1 })
  assert.equal(evaluated, 1)
})

test('GPU frame fast path binds its sampler and rejects placement-sensitive operations', () => {
  let calls = 0
  const frame: MoverOrSplitter[] = [{ apply(copy) { calls++; return [copy] } }]
  const operation = { kind: 1, parameters: [1, 2, 3], scaleBound: 1, translationBound: 4 }
  const inner: MoverOrSplitter = {
    maxOutputCount: 1,
    gpuOperationAtBeat() { assert.equal(this, inner); return operation },
    apply(copy) { return [copy] },
  }
  const fast = framedMoverOrSplitter(inner, frame)
  assert.equal(fast.gpuOperationAtBeat!(2), operation)
  fast.apply(identityVisualCopy(), { beat: 2, index: 0, count: 1 })
  assert.equal(calls, 0)
  const dependent = { ...inner, gpuOperationUsesPlacement: true }
  const generic = framedMoverOrSplitter(dependent, frame)
  assert.equal(generic.gpuOperationAtBeat, undefined)
  generic.apply(identityVisualCopy(), { beat: 2, index: 0, count: 1 })
  assert.equal(calls, 1)
  const mixed = framedMoverOrSplitter({ ...inner, structuralVariants: [dependent] }, frame)
  assert.equal(mixed.gpuOperationAtBeat, undefined)
})

test('an empty compact frame preserves incoming placement through CPU and GPU appearance evaluation', () => {
  const frame: MoverOrSplitter[] = [{ maxOutputCount: 1,
    apply(copy, context) { return context.beat < 1 ? [] : [copy] },
  }, sharedLocalLayout({ transforms: [new Matrix4().makeTranslation(3, 0, 0)] })]
  const inner = sharedGpuOperation(() => paletteAppearance({ mode: 0, span: 8 },
    ['#ff0000', '#00ff00', '#0000ff', '#ffffff'], 1, { rounded: true }),
  { usesPlacement: true, appearanceOnly: true })
  const fast = framedMoverOrSplitter(inner, frame), reference = genericFrame(inner, frame)
  assert.equal(fast.gpuOperationPreservesDeterminant, true)
  const seed = sharedLocalLayout({ transforms: [new Matrix4().makeTranslation(.2, 0, 0),
    new Matrix4().makeTranslation(4.7, 0, 0)] })
  for (const placement of [undefined, new Matrix4().makeTranslation(1, 0, 0)]) {
    for (const beat of [0, 2, 0]) {
      const framePlan = compileParticlePlan(frame, 0, beat, placement)
      assert.ok(framePlan)
      assert.equal(framePlan.count, beat < 1 ? 0 : 1)
      const context = { beat, index: 0, count: 1, placementTransform: placement }
      assert.deepEqual(fast.apply(copyAt(.2, 0, 0), context), reference.apply(copyAt(.2, 0, 0), context))
      const plan = compileParticlePlan([seed, fast], 0, beat, placement)
      assert.ok(plan)
      const expected = resolveVisualCopies([seed, reference], beat, placement)
      assert.equal(plan.count, expected.length)
      expected.forEach((copy, index) => assert.deepEqual(particlePlanCopy(plan, index), copy))
    }
  }
})
