import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import { bypassGated } from './bypass'
import { gatedMoverOrSplitter, type CopyTargetSelection } from './copyTargets'
import { mergeDefinitionSettings } from './definitions'
import { fluidImpactMover } from './fluidImpact'
import { affineGpuOperation, applyGpuOperation } from './gpuOperations'
import { compileParticlePlan, particlePlanCopy, particlePlanNeedsUpdate } from './particlePlan'
import { resolveVisualCopies, structuralCopyCount } from './resolveVisualCopies'
import { sharedLocalLayout } from './sharedLocalLayout'
import { splitterWithChildChain } from './splitterChildChain'
import { SWITCHER_GATE, SWITCHER_SOLO, switchGated, switcherVariantsFor } from './switcher'
import type { MoverOrSplitter, VisualCopy } from './types'

const activeAt = (beat: number) => beat >= 0 && beat < 1
const local = sharedLocalLayout({ transforms: [new Matrix4().makeTranslation(.7, -.2, .3)] })
const two = sharedLocalLayout({ transforms: [new Matrix4().makeTranslation(-.4, .2, .3), new Matrix4().makeRotationY(.3)] })
const animated = sharedLocalLayout(beat => ({ transforms: [new Matrix4().makeRotationZ(beat), new Matrix4().makeTranslation(beat, 0, 0)] }), { count: 2 })
const root: MoverOrSplitter = {
  rootTransformAtBeat: beat => new Matrix4().makeRotationZ(beat * .3).setPosition(.4, -.2, .1),
  apply(copy, { beat }) { return [{ ...copy, transform: this.rootTransformAtBeat!(beat).multiply(copy.transform) }] },
}
const rich = sharedLocalLayout((beat, placement) => ({
  transforms: [new Matrix4().makeTranslation(placement?.elements[12] ?? 0, beat, 0), new Matrix4()],
  opacities: [.3, .7], hueShifts: [.2, -.1],
}), { usesPlacement: true, count: 2 })
const framed = splitterWithChildChain(two, [local])
const fluid = fluidImpactMover.resolve({ settings: mergeDefinitionSettings(fluidImpactMover, {}) as never,
  notes: [{ pitch: 60, beat: 0, velocity: .7, durationBeats: 1, blockStartBeat: 0, blockEndBeat: 8 }] })
const placed: MoverOrSplitter = {
  gpuOperationUsesPlacement: true,
  gpuOperationAtBeat: (beat, placement) => affineGpuOperation(new Matrix4().makeTranslation((placement?.elements[12] ?? 0) + beat, .2, 0), 'chainRoot'),
  apply(copy, context) { return [{ ...copy,
    transform: applyGpuOperation(this.gpuOperationAtBeat!(context.beat, context.placementTransform), copy.transform, new Matrix4()) }] },
}

function nearCopies(actual: VisualCopy, expected: VisualCopy) {
  actual.transform.elements.forEach((value, index) => assert.ok(Math.abs(value - expected.transform.elements[index]) < 1e-8,
    `matrix ${index}: ${value} != ${expected.transform.elements[index]}`))
  assert.ok(Math.abs(actual.opacity - expected.opacity) < 1e-10)
  assert.deepEqual(actual.colorShift, expected.colorShift)
}

function check(chain: MoverOrSplitter[], beat: number, placement = new Matrix4().makeRotationZ(.17).setPosition(.3, -.2, .7)) {
  const plan = compileParticlePlan(chain, 0, beat, placement)
  assert.ok(plan, 'the gate must retain the compact contract')
  assert.equal(plan.cpuPrefix, undefined)
  const copies = resolveVisualCopies(chain, beat, placement)
  assert.equal(plan.count, copies.length)
  copies.forEach((copy, index) => nearCopies(particlePlanCopy(plan, index)!, copy))
  return plan
}

test('uniform bypass and switch gates preserve every compact family, counts and framed appearance', () => {
  const seed = sharedLocalLayout({ transforms: [new Matrix4().makeTranslation(1, .3, 0), new Matrix4().makeScale(0, 1, 1)],
    opacities: [.6, .8], hueShifts: [.1, -.2] })
  for (const entry of [local, two, animated, root, rich, framed, fluid, placed]) {
    const wrappers = [bypassGated(entry, [beat => !activeAt(beat)]),
      switchGated(entry, activeAt, switcherVariantsFor(entry, SWITCHER_GATE, 0, 2)),
      switchGated(entry, activeAt, switcherVariantsFor(entry, SWITCHER_SOLO, 0, 2))]
    for (const wrapped of wrappers) {
      const chain = [seed, wrapped, two]
      const maximum = Math.max(...[-.5, .3, 1.7].map(beat => check(chain, beat).count))
      assert.equal(structuralCopyCount(chain), maximum, 'a gate preserves the enabled allocation ceiling')
    }
  }
})

test('gated placement-dependent operations invalidate held-beat edits and keep their world input', () => {
  for (const source of [rich, placed]) {
    const entry = bypassGated(source, [beat => !activeAt(beat)])
    const placement = new Matrix4().setPosition(.3, -.2, .1)
    const plan = check([two, entry], .3, placement)
    placement.elements[12] = 1.7
    assert.ok(particlePlanNeedsUpdate(plan, [two, entry], .3, placement))
    const updated = check([two, entry], .3, placement)
    assert.notDeepEqual(updated.matrices, plan.matrices)
  }
})

test('copy-target guards keep GPU, local and root count-one operations compact at their incoming stage indices', () => {
  const seed = sharedLocalLayout({ transforms: Array.from({ length: 7 }, (_, index) =>
    new Matrix4().makeRotationZ(index * .19).setPosition(index / 3 - .8, index % 3 * .4, .1)) })
  const selections: CopyTargetSelection[] = [{ rule: 'every', slices: 3, on: [0, 2] }, { rule: 'runs', slices: 4, on: [1, 3] }]
  for (const entry of [fluid, placed, local, root]) {
    for (const selection of selections) {
      const targeted = gatedMoverOrSplitter(entry, selection)
      const cases = [targeted,
        bypassGated(targeted, [beat => !activeAt(beat)]),
        gatedMoverOrSplitter(bypassGated(entry, [beat => !activeAt(beat)]), selection),
        gatedMoverOrSplitter(targeted, selections[1])]
      for (const wrapped of cases) for (const beat of [-.5, .3, 1.7]) check([seed, wrapped, two], beat)
    }
  }
})

test('gates after a million-copy prefix compile without per-copy reference calls', () => {
  const level = sharedLocalLayout({ transforms: Array.from({ length: 32 }, (_, index) => new Matrix4().makeTranslation(index / 32, 0, 0)) })
  for (const entry of [fluid, placed, local, root]) {
    const targeted = gatedMoverOrSplitter(entry, { rule: 'every', slices: 3, on: [0, 2] })
    const wrapped = switchGated(bypassGated(targeted, [beat => beat < 0]), beat => beat < 1,
      switcherVariantsFor(targeted, SWITCHER_SOLO, 0, 2))
    wrapped.apply = () => { throw new Error('A compact gate expanded the million-copy population') }
    for (const beat of [-.5, .3, 1.7]) {
      const plan = compileParticlePlan([level, level, level, level, wrapped], 0, beat)
      assert.ok(plan)
      assert.equal(plan.cpuPrefix, undefined)
      assert.equal(plan.count, 32 ** 4)
      assert.ok(plan.matrices.length < 10000)
    }
  }
})

test('targeted singular affine transforms preserve the active and bare branches of a later framed splitter', () => {
  const seed = sharedLocalLayout({ transforms: Array.from({ length: 7 }, (_, index) => new Matrix4().makeTranslation(index / 3, .2, 0)) })
  const nested = splitterWithChildChain(two, [sharedLocalLayout({ transforms: [new Matrix4().makeRotationZ(.7)],
    opacities: [.3], hueShifts: [.2] })])
  for (const scale of [0, 1e-13, -.7]) {
    const entry = sharedLocalLayout({ transforms: [new Matrix4().makeScale(scale, 1, 1)] })
    const targeted = gatedMoverOrSplitter(entry, { rule: 'every', slices: 3, on: [0, 2] })
    check([seed, targeted, nested], .3)
  }
})

test('targeted splitters keep their variable fanout fallback instead of claiming a count-one predicate', () => {
  const targeted = gatedMoverOrSplitter(two, { rule: 'every', slices: 2, on: [0] })
  assert.equal(targeted.gpuOperationAtBeat, undefined)
  const level = sharedLocalLayout({ transforms: Array.from({ length: 32 }, () => new Matrix4()) })
  assert.equal(compileParticlePlan([level, level, level, level, targeted]), undefined)
})
