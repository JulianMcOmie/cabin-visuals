import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import { compileParticlePlan, particlePlanCopy, particlePlanNeedsUpdate } from './particlePlan'
import { sharedLocalLayout } from './sharedLocalLayout'
import type { MoverOrSplitter, SharedLocalLayout } from './types'

test('shared plans reject ambiguous, malformed, clocked and projective contracts', () => {
  const layout: SharedLocalLayout = { transforms: [new Matrix4()], opacities: [.5], hueShifts: [.2] }
  const entry = sharedLocalLayout(layout)
  const malformed: MoverOrSplitter[] = [
    { ...entry, localTransforms: layout.transforms },
    { ...entry, rootTransform: new Matrix4() },
    { ...entry, emitsCopyClocks: true },
    { ...entry, applyFramed: () => [] },
    { ...entry, localLayout: { ...layout, opacities: [] } },
    { ...entry, localLayout: { ...layout, hueShifts: [Infinity] } },
    { ...entry, localLayout: { ...layout, transforms: [new Matrix4().makePerspective(-1, 1, 1, -1, .1, 100)] } },
    { ...entry, structuralVariants: [{ apply: copy => [copy] }] },
  ]
  for (const candidate of malformed) assert.equal(compileParticlePlan([candidate]), undefined)
})

test('appearance indexing respects mixed-radix slots and framed bare guards', () => {
  const frames = [new Matrix4(), new Matrix4().makeScale(0, 1, 1)]
  const prefix = sharedLocalLayout({ transforms: frames, opacities: [.4, .8], hueShifts: [-.2, .3] })
  const child: MoverOrSplitter = {
    apply: copy => [copy], applyFramed: copy => [{ visualCopy: copy }],
    framedLocalTransformsAtBeat: () => ({
      frames, bareFrames: frames, internals: [null, null],
      opacities: [.2, .6], hueShifts: [.4, .7],
      bareOpacities: [.3, .5], bareHueShifts: [-.1, -.5],
    }),
  }
  const plan = compileParticlePlan([prefix, child])!
  const expected = [[.4 * .2, -.2 + .4], [.4 * .6, -.2 + .7], [.8 * .3, .3 - .1], [.8 * .5, .3 - .5]]
  for (const [index, [opacity, hue]] of expected.entries()) {
    const copy = particlePlanCopy(plan, index)!
    assert.equal(copy.opacity, opacity)
    assert.equal(copy.colorShift.hue, hue)
  }
  assert.equal(particlePlanCopy(plan, -.1), undefined)
  assert.equal(particlePlanCopy(plan, plan.count), undefined)
})

test('placement invalidation compares a snapshot while static plans stay reusable', () => {
  const placement = new Matrix4().makeScale(2, 3, 4)
  const entry = sharedLocalLayout((_beat, matrix) => ({
    transforms: [new Matrix4().makeTranslation(matrix?.elements[0] ?? 1, 0, 0)],
  }), { usesPlacement: true, count: 1 })
  const plan = compileParticlePlan([entry], 0, 3, placement)!
  assert.equal(particlePlanNeedsUpdate(plan, [entry], 3, placement.clone()), false)
  placement.elements[0] = 5
  assert.equal(particlePlanNeedsUpdate(plan, [entry], 3, placement), true)
  assert.equal(plan.placementElements![0], 2)
  const staticEntry = sharedLocalLayout({ transforms: [new Matrix4()] })
  const staticPlan = compileParticlePlan([staticEntry])!
  assert.equal(particlePlanNeedsUpdate(staticPlan, [staticEntry], 100, placement), false)
})
