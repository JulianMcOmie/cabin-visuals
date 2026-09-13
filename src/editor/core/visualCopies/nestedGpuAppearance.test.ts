import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import { bypassGated } from './bypass'
import { gatedMoverOrSplitter } from './copyTargets'
import { mergeDefinitionSettings } from './definitions'
import { getMoverOrSplitterDefinition } from './registry'
import { compileParticlePlan, particlePlanCopy, particlePlanNeedsUpdate } from './particlePlan'
import { resolveVisualCopies } from './resolveVisualCopies'
import { sharedLocalLayout } from './sharedLocalLayout'
import { splitterWithChildChain } from './splitterChildChain'
import { SWITCHER_SOLO, switchGated, switcherVariantsFor } from './switcher'
import type { MoverOrSplitter, VisualCopy } from './types'

function color(id: string, params: Record<string, number> = {}): MoverOrSplitter {
  const definition = getMoverOrSplitterDefinition(id)!
  return definition.resolve({ settings: mergeDefinitionSettings(definition, params), notes: [
    { beat: 0, pitch: 60, velocity: .7, durationBeats: 2, blockStartBeat: 0, blockEndBeat: 8 },
    { beat: .3, pitch: 61, velocity: .8, durationBeats: 2, blockStartBeat: 0, blockEndBeat: 8 },
    { beat: .5, pitch: 62, velocity: .4, durationBeats: 1, blockStartBeat: 0, blockEndBeat: 8 },
  ] })
}

const colors = ['calmHueRotate', 'gradient', 'cosinePalette', 'riso', 'hueRotate']
const motion = sharedLocalLayout({ transforms: [new Matrix4().makeRotationZ(.37).setPosition(.2, -.3, .1)] })
const rootMotion: MoverOrSplitter = {
  composition: 'chainRoot', rootTransform: new Matrix4().makeRotationY(.2).setPosition(-.1, .4, .2),
  apply(copy) { return [{ ...copy, transform: this.rootTransform!.clone().multiply(copy.transform) }] },
}
const parent = sharedLocalLayout({ transforms: [
  new Matrix4().makeRotationZ(.6).setPosition(-.8, .3, -.2),
  new Matrix4().makeRotationY(-.4).setPosition(.7, -.1, .5),
  new Matrix4().makeScale(0, 1, 1).setPosition(.1, .2, .3),
  new Matrix4().makeScale(-.8, 1.1, .9).setPosition(.4, .7, -.3),
], opacities: [.6, .8, .4, .7], hueShifts: [.1, -.2, .3, -.1] })
const seed = sharedLocalLayout({ transforms: [
  new Matrix4().makeRotationX(.2).setPosition(.3, -.7, .4),
  new Matrix4().makeRotationZ(-.5).setPosition(-.6, .2, -.8),
  new Matrix4().makeScale(0, 1, 1),
  new Matrix4().makeScale(1e-13, 1, 1),
] })
const suffix = sharedLocalLayout({ transforms: [new Matrix4(), new Matrix4().makeTranslation(.27, -.18, .31)],
  opacities: [.3, .7], hueShifts: [.11, -.17] })

function nearCopies(actual: VisualCopy, expected: VisualCopy) {
  actual.transform.elements.forEach((value, index) => assert.ok(Math.abs(value - expected.transform.elements[index]) < 1e-8,
    `matrix ${index}: ${value} != ${expected.transform.elements[index]}`))
  assert.ok(Math.abs(actual.opacity - expected.opacity) < 1e-10)
  for (const channel of ['hue', 'saturation', 'lightness', 'tintAmount'] as const) {
    assert.ok(Math.abs(actual.colorShift[channel] - expected.colorShift[channel]) < 1e-9, `${channel}: ${actual.colorShift[channel]} != ${expected.colorShift[channel]}`)
  }
  assert.equal(actual.colorShift.tint, expected.colorShift.tint)
  assert.equal(actual.colorShift.tintPerceptual ?? false, expected.colorShift.tintPerceptual ?? false)
  assert.equal(actual.colorShift.huePerceptual ?? false, expected.colorShift.huePerceptual ?? false)
}

function check(chain: MoverOrSplitter[], beat: number, placement = new Matrix4().makeRotationZ(.21).setPosition(.3, -.4, .2)) {
  const plan = compileParticlePlan(chain, 0, beat, placement)
  assert.ok(plan)
  assert.equal(plan.cpuPrefix, undefined)
  const expected = resolveVisualCopies(chain, beat, placement)
  assert.equal(plan.count, expected.length)
  expected.forEach((copy, index) => nearCopies(particlePlanCopy(plan, index)!, copy))
  return plan
}

test('nested colorizers sample world positions between local motions and preserve ordered appearance', () => {
  const richMotion = sharedLocalLayout({ transforms: [new Matrix4().makeRotationX(.23)], opacities: [.7], hueShifts: [.19] })
  for (const id of colors) for (const map of [0, 1, 5]) {
    const nested = splitterWithChildChain(parent, [motion, color(id, { mode: map }), rootMotion,
      color('hueRotate', { mode: 5, rotate: .13, spread: .7, saturation: .1, lightness: -.07 }), richMotion])
    assert.ok(nested.framedLocalTransformsAtBeat)
    const layout = nested.framedLocalTransformsAtBeat(.7)
    assert.equal(layout.appearanceStages?.length, 2)
    assert.equal(layout.appearanceStages![0].sampleFrames.length, 4)
    for (const beat of [-.5, .2, .7, 3, .7]) check([seed, nested, suffix], beat)
    check([splitterWithChildChain(seed, [motion]), nested, suffix], .7)
  }
})

test('nested colorizers keep target predicates and uniform gates in their parent-slot index domain', () => {
  const base = color('cosinePalette', { mode: 5, cycles: 1.5 })
  const targeted = gatedMoverOrSplitter(base, { rule: 'every', slices: 3, on: [0, 2] })
  const switched = switchGated(targeted, beat => beat < 1, switcherVariantsFor(targeted, SWITCHER_SOLO, 0, 2))
  const gated = bypassGated(switched, [beat => beat < 0])
  assert.ok(gated.gpuAppearanceOnly)
  const nested = splitterWithChildChain(parent, [motion, gated, rootMotion])
  assert.ok(nested.framedLocalTransformsAtBeat)
  for (const beat of [-.5, .3, 1.7, .3]) check([seed, nested, suffix], beat)
})

test('nested world palettes invalidate held-beat placement changes without baking the old parent world into slots', () => {
  const nested = splitterWithChildChain(parent, [color('cosinePalette', { mode: 0 })])
  const placement = new Matrix4().setPosition(.3, -.2, .1)
  const first = check([seed, nested], .7, placement)
  const before = particlePlanCopy(first, 0)!.colorShift.tint
  placement.elements[12] = 1.9
  assert.ok(particlePlanNeedsUpdate(first, [seed, nested], .7, placement))
  const updated = check([seed, nested], .7, placement)
  assert.notEqual(particlePlanCopy(updated, 0)!.colorShift.tint, before)
})

test('nested GPU appearance samples only the containing splitter slots after a million-copy expansion', () => {
  const level = sharedLocalLayout({ transforms: Array.from({ length: 32 }, (_, index) => new Matrix4().makeTranslation(index / 31, index % 3 / 7, .1)) })
  const palette = color('cosinePalette')
  palette.apply = () => { throw new Error('The nested palette must not run per-copy CPU appearance') }
  let sampledMotion = 0
  const countedMotion = { ...motion, apply(copy: VisualCopy, context: Parameters<MoverOrSplitter['apply']>[1]) {
    sampledMotion++
    return motion.apply(copy, context)
  } }
  const nested = splitterWithChildChain(level, [countedMotion, palette, countedMotion])
  for (const beat of [.2, .7, .2]) {
    const before = sampledMotion
    const plan = compileParticlePlan([level, level, level, nested], 0, beat)
    assert.ok(plan)
    assert.equal(plan.cpuPrefix, undefined)
    assert.equal(plan.count, 32 ** 4)
    assert.equal(sampledMotion - before, 64, 'two motions visit the 32 local slots, not their million occurrences')
    assert.ok(plan.matrices.length < 50000)
  }
})

test('recursive splitter children retain earlier and inner colorizer index domains', () => {
  const five = sharedLocalLayout({ transforms: Array.from({ length: 5 }, (_, index) =>
    new Matrix4().makeRotationZ(index * .37).setPosition(index / 3 - .8, index % 3 * .2, .1)) })
  const three = sharedLocalLayout({ transforms: Array.from({ length: 3 }, (_, index) =>
    new Matrix4().makeTranslation(index * .31, -.2, index * -.19)) })
  const seven = sharedLocalLayout({ transforms: Array.from({ length: 7 }, (_, index) =>
    new Matrix4().makeRotationY(index * .17).setPosition(index / 5, index % 3 * .3, -.2)) })
  const inner = splitterWithChildChain(three, [color('riso', { mode: 5, dither: 1 }),
    color('hueRotate', { mode: 5, spread: .6 }), motion])
  const nested = splitterWithChildChain(five, [color('cosinePalette', { mode: 5 }), motion, inner,
    color('gradient', { mode: 1, amount: .3 }), rootMotion])
  const layout = nested.framedLocalTransformsAtBeat!(.7)
  assert.equal(layout.requiresInvertibleInput, true)
  assert.equal(layout.frames.length, 15)
  assert.equal(layout.bareFrames.length, 5)
  assert.deepEqual(layout.appearanceStages?.map(stage => stage.inputCount), [5, 3, 3, 15])
  assert.deepEqual(layout.appearanceStages![0].inputIndices, [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4])
  assert.deepEqual(layout.appearanceStages![1].inputIndices, [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2])
  for (const beat of [-.5, .2, .7, 3, .7]) check([seven, nested, suffix], beat)
})

test('recursive nested appearance preserves child guards while rejecting unproven outer fanout cardinality', () => {
  const nested = splitterWithChildChain(parent, [splitterWithChildChain(parent, [color('cosinePalette', { mode: 0 }),
    color('hueRotate', { mode: 5 })])])
  const placement = new Matrix4().setPosition(.3, -.4, .2)
  check([nested, suffix], .7, placement)
  const layout = nested.framedLocalTransformsAtBeat!(.7)
  assert.ok(layout.appearanceStages?.some(stage => stage.active?.includes(0)), 'a singular local parent suppresses only its nested colors')
  const singular = sharedLocalLayout({ transforms: [new Matrix4().makeScale(0, 1, 1)] })
  assert.equal(compileParticlePlan([singular, nested], 0, .7, placement), undefined)
  assert.equal(resolveVisualCopies([singular, nested], .7, placement).length, 4,
    'a degenerate outer input emits only the four bare parent slots, not sixteen hidden descendants')
})

test('recursive nested palettes compile after a large population without calling child appearance', () => {
  const level = sharedLocalLayout({ transforms: Array.from({ length: 32 }, (_, index) => new Matrix4().makeTranslation(index / 31, .2, .1)) })
  const palette = color('riso')
  palette.apply = () => { throw new Error('Recursive color must remain in the GPU program') }
  const nested = splitterWithChildChain(level, [splitterWithChildChain(level, [palette, color('hueRotate')])])
  const plan = compileParticlePlan([level, level, nested], 0, .7)
  assert.ok(plan)
  assert.equal(plan.count, 32 ** 4)
  assert.equal(plan.cpuPrefix, undefined)
  assert.ok(plan.matrices.length < 100000, 'recursive tables are bounded by the local subtree, not its million occurrences')
})

test('recursive fanout declines an animated outer scale before it can become singular', () => {
  const changingScale = sharedLocalLayout(beat => ({ transforms: [new Matrix4().makeScale(1 - beat, 1, 1)] }), { count: 1 })
  const two = sharedLocalLayout({ transforms: [new Matrix4(), new Matrix4().makeTranslation(.2, .1, 0)] })
  const nested = splitterWithChildChain(two, [splitterWithChildChain(two, [color('riso')])])
  assert.ok(nested.framedLocalTransformsAtBeat)
  assert.equal(compileParticlePlan([changingScale, nested], 0, 0), undefined,
    'initial admission needs a playback-wide invertibility proof, not the current nonzero scale')
  assert.equal(resolveVisualCopies([changingScale, nested], 0).length, 4)
  assert.equal(resolveVisualCopies([changingScale, nested], 1).length, 2)
})

test('disabled recursive gates retain their lifetime invertibility requirement', () => {
  const changingScale = sharedLocalLayout(beat => ({ transforms: [new Matrix4().makeScale(1 - beat, 1, 1)] }), { count: 1 })
  const two = sharedLocalLayout({ transforms: [new Matrix4(), new Matrix4().makeTranslation(.2, .1, 0)] })
  const nested = splitterWithChildChain(two, [splitterWithChildChain(two, [color('riso')])])
  const switched = switchGated(nested, beat => beat >= 1, switcherVariantsFor(nested, SWITCHER_SOLO, 0, 2))
  const bypassed = bypassGated(nested, [beat => beat < 1])
  const doubleGated = bypassGated(switched, [beat => beat < .5])
  for (const entry of [switched, bypassed, doubleGated]) {
    assert.equal(entry.framedRequiresInvertibleInput, true)
    for (const beat of [0, .75, 1, 2, 0]) {
      assert.equal(compileParticlePlan([changingScale, entry], 0, beat), undefined,
        `a disabled recursive gate must not admit an unsupported later active branch at beat ${beat}`)
      check([two, entry], beat)
    }
  }
})

test('recursive local table bounds are checked before sampling or materializing a nested product', () => {
  let samples = 0
  const level = (count: number) => sharedLocalLayout(() => {
    samples++
    throw new Error('Structural eligibility must not sample a local subtree')
  }, { count })
  const supported = splitterWithChildChain(level(64), [splitterWithChildChain(level(64), [color('riso')])])
  assert.ok(supported.framedLocalTransformsAtBeat, '4,096 local outputs remain eligible')
  const oversized = splitterWithChildChain(level(64), [splitterWithChildChain(level(65), [color('riso')])])
  assert.equal(oversized.framedLocalTransformsAtBeat, undefined)
  const unbounded = splitterWithChildChain(level(2), [sharedLocalLayout(() => {
    samples++
    return { transforms: [new Matrix4()] }
  })])
  assert.equal(unbounded.framedLocalTransformsAtBeat, undefined)
  assert.equal(samples, 0)
})

test('nested copy clocks and placement-dependent transform tables retain their explicit fallback', () => {
  const override = color('cosinePalette')
  delete override.gpuAppearanceOnly
  const clock: MoverOrSplitter = { emitsCopyClocks: true, maxOutputCount: 1,
    apply: copy => [copy], applyFramed: copy => [{ visualCopy: copy, beatOffset: .3 }] }
  const placedLayout = sharedLocalLayout((_beat, placement) => ({ transforms: [new Matrix4().setPosition(placement?.elements[12] ?? 0, 0, 0), new Matrix4()] }),
    { count: 2, usesPlacement: true })
  for (const children of [[color('cosinePalette'), placedLayout], [color('cosinePalette'), clock], [override]]) {
    assert.equal(splitterWithChildChain(parent, children).framedLocalTransformsAtBeat, undefined)
  }
})
