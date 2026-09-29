import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import { compileParticlePlan, particlePlanCopy, particlePlanNeedsUpdate, type ParticlePlan } from './particlePlan'
import { resolveVisualCopies } from './resolveVisualCopies'
import { sharedLocalLayout } from './sharedLocalLayout'
import { splitterWithChildChain } from './splitterChildChain'
import { symmetricMotionMover } from './symmetricMotion'
import { symmetricRotationMover } from './symmetricRotation'
import { mergeDefinitionSettings } from './definitions'
import type { MoverOrSplitter, VisualCopy } from './types'

function local(count: number, angle = .17): MoverOrSplitter {
  return sharedLocalLayout({ transforms: Array.from({ length: count }, (_, i) =>
    new Matrix4().makeRotationY(i * angle).setPosition(i * .13 - .7, i % 3 * .2, i % 5 * .1)) })
}

function moving(count: number): MoverOrSplitter {
  return splitterWithChildChain(local(count), [sharedLocalLayout({
    transforms: [new Matrix4().makeRotationZ(.53).setPosition(.2, -.1, .3)],
  })])
}

function radialMotion(): MoverOrSplitter {
  return symmetricMotionMover.resolve({ settings: mergeDefinitionSettings(symmetricMotionMover,
    { symmetry: 0, motion: 1, plane: 3, distance: .7, angle: 37 }) as never,
  notes: [{ beat: 0, pitch: 60, velocity: .7, durationBeats: 4, blockStartBeat: 0, blockEndBeat: 8 },
    { beat: .2, pitch: 62, velocity: 1, durationBeats: 3, blockStartBeat: 0, blockEndBeat: 8 }] })
}

function axialMotion(): MoverOrSplitter {
  return symmetricRotationMover.resolve({ settings: mergeDefinitionSettings(symmetricRotationMover,
    { mode: 2, falloff: 2, twist: 23, fold: -31, roll: 47, axisYaw: 17, axisPitch: 29,
      centerX: .2, centerY: -.3, centerZ: .1 }) as never, notes: [] })
}

function near(actual: number, expected: number, label: string) {
  assert.ok(Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(expected)), `${label}: ${actual} != ${expected}`)
}

function copyNear(actual: VisualCopy, expected: VisualCopy) {
  actual.transform.elements.forEach((value, i) => near(value, expected.transform.elements[i], `matrix ${i}`))
  near(actual.opacity, expected.opacity, 'opacity')
  assert.deepEqual(Object.keys(actual.colorShift).sort(), Object.keys(expected.colorShift).sort())
  for (const key of Object.keys(expected.colorShift) as (keyof VisualCopy['colorShift'])[]) {
    const value = expected.colorShift[key]
    if (typeof value === 'number') near(actual.colorShift[key] as number, value, key)
    else assert.equal(actual.colorShift[key], value, key)
  }
}

function parity(chain: MoverOrSplitter[], beat: number, placement = new Matrix4()): ParticlePlan {
  const plan = compileParticlePlan(chain, 9, beat, placement)
  assert.ok(plan)
  const expected = resolveVisualCopies(chain, beat, placement)
  assert.equal(plan.count, expected.length)
  expected.forEach((copy, index) => copyNear(particlePlanCopy(plan, index)!, copy))
  assert.equal(particlePlanCopy(plan, -1), undefined)
  assert.equal(particlePlanCopy(plan, plan.count), undefined)
  return plan
}

/** Deliberately not representable by a GPU opcode: reads position, placement,
 * previous-stage index/count and the entire formation, and sets every generic
 * appearance channel. Its count proof is enough for a bounded CPU island. */
function arbitraryField(onApply?: (count: number, index: number) => void): MoverOrSplitter {
  return { maxOutputCount: 1, cachePolicy: 'beat', apply(copy, { beat, index, count, formation, placementTransform }) {
    onApply?.(count, index)
    const x = copy.transform.elements[12]
    const firstX = formation?.[0].transform.elements[12] ?? x
    const shift = Math.sin(x + beat) + firstX * .2 + index / count + (placementTransform?.elements[12] ?? 0)
    return [{ transform: new Matrix4().makeTranslation(shift, -.3 * shift, .1)
      .multiply(copy.transform), opacity: copy.opacity * (.3 + .7 * (index + 1) / count),
    colorShift: { ...copy.colorShift, hue: copy.colorShift.hue + .13 + index * .03,
      saturation: -.2, lightness: .17, tint: index % 2 ? '#123456' : '#fedcba', tintAmount: .6,
      tintPerceptual: true, huePerceptual: true } }]
  } }
}

test('sibling GPU operations preserve chain order and compile a million-copy product without expanded apply', () => {
  parity([local(3), radialMotion(), local(4, -.21), axialMotion(), local(2)], .7)
  const chain = [local(32), radialMotion(), local(32), axialMotion(), local(32), local(32)]
  for (const entry of chain) entry.apply = () => { throw new Error('GPU plan expanded a copy') }
  const plan = compileParticlePlan(chain, 0, .7)!
  assert.ok(plan)
  assert.equal(plan.count, 32 ** 4)
  assert.equal(plan.cpuPrefix, undefined)
  assert.deepEqual(plan.program!.kinds, [0, 3, 0, 3, 0, 0])
  assert.ok(plan.matrices.length < 10000, 'storage follows local tables and operation scalars')
  assert.ok(particlePlanCopy(plan, 32 ** 4 - 1)!.transform.elements.every(Number.isFinite))
})

test('GPU operations read reference frames while inherited internals and singular guards remain deferred', () => {
  const scales = sharedLocalLayout({ transforms: [new Matrix4(), new Matrix4().makeScale(0, 1, 1),
    new Matrix4().makeScale(1e-13, 1, 1), new Matrix4().makeScale(-.7, 1.2, .8)] })
  const chain = [moving(2), scales, radialMotion(), moving(3), axialMotion(), local(2)]
  for (const beat of [0, .7, 2, -.5, .7]) {
    const plan = parity(chain, beat, new Matrix4().makeScale(0, 0, 0))
    assert.deepEqual(plan.program!.kinds, [2, 0, 3, 2, 3, 0])
    const guard = plan.program!.guardOffsets[3]
    assert.ok(guard >= 0, 'mixed incoming frames need explicit guards even after a GPU operation')
    assert.deepEqual(Array.from(plan.matrices.slice(guard, guard + 8)), [1, 0, 0, 1, 1, 0, 0, 1])
  }
})

test('bounded CPU seeds preserve full appearance and uncollapsed internal motion through GPU suffixes', () => {
  const suffix = sharedLocalLayout({ transforms: [new Matrix4().makeRotationX(.31), new Matrix4().makeTranslation(.2, .3, .4)],
    opacities: [.8, .5], hueShifts: [.17, -.23] })
  const chain = [moving(3), arbitraryField(), suffix, radialMotion(), moving(2)]
  const placement = new Matrix4().makeRotationZ(.7).setPosition(2, -3, .4)
  const plan = parity(chain, .7, placement)
  assert.equal(plan.cpuPrefix!.length, 2)
  assert.equal(plan.cpuPrefix!.count, 3)
  assert.equal(plan.cpuPrefix!.colors.length, 3)
  assert.ok(plan.cpuPrefix!.colorOffset >= 0)
  assert.equal(plan.structuralCount, 12)
  assert.ok(plan.program!.kinds.includes(3))
  const first = particlePlanCopy(plan, 0)!
  const saved = structuredClone(first.colorShift)
  first.colorShift.tint = '#000000'; first.transform.identity()
  assert.deepEqual(particlePlanCopy(plan, 0)!.colorShift, saved, 'random access never lends mutable seed colors')
  assert.ok(saved.hue !== 0 && saved.tintPerceptual && saved.huePerceptual)
})

test('CPU seed internals survive mixed singular frames and a later skipped framed stage', () => {
  const scales = sharedLocalLayout({ transforms: [new Matrix4(), new Matrix4().makeScale(0, 1, 1),
    new Matrix4().makeScale(-.7, 1.2, .8)], opacities: [.8, .3, .7], hueShifts: [.13, -.2, .27] })
  const chain = [moving(2), scales, arbitraryField(), moving(3), axialMotion(), local(2)]
  const plan = parity(chain, .7, new Matrix4().makeScale(0, 0, 0))
  assert.equal(plan.cpuPrefix!.length, 3)
  assert.equal(plan.cpuPrefix!.count, 6)
  // The prefix is one correlated frame/internal seed stage; a zero determinant
  // in that seed disables new child motion but never its inherited internal.
  assert.deepEqual(plan.program!.kinds, [2, 2, 3, 0])
  const offset = plan.program!.guardOffsets[1]
  assert.ok(offset >= 0)
  assert.deepEqual(Array.from(plan.matrices.slice(offset, offset + 6)), [1, 0, 1, 1, 0, 1])
})

test('CPU prefix budget accepts 4096 seeds and never evaluates a larger or unproven prefix', () => {
  let calls = 0
  const accepted = [local(64), local(64), arbitraryField((count, index) => {
    assert.equal(count, 4096); assert.equal(index, calls++);
  }), local(32)]
  const plan = compileParticlePlan(accepted, 0, .7)!
  assert.ok(plan)
  assert.equal(calls, 4096)
  assert.equal(plan.cpuPrefix!.count, 4096)
  assert.equal(plan.count, 4096 * 32)
  const neverApply = () => { throw new Error('rejected plan must not evaluate copies') }
  const bounded: MoverOrSplitter = { maxOutputCount: 1, apply: neverApply }
  const large = [local(64), local(65), bounded, local(32)]
  const huge = [local(32), local(32), local(32), local(32), bounded, local(2)]
  const shrinksLate = [local(4097), { maxOutputCount: 0, apply: neverApply }, bounded, local(2)]
  const unproven = [{ apply: neverApply }, local(32)]
  const clocked = [{ ...bounded, emitsCopyClocks: true }, local(32)]
  const noSuffix = [local(2), bounded]
  for (const chain of [large, huge, shrinksLate, unproven, clocked, noSuffix]) {
    assert.equal(compileParticlePlan(chain, 0, .7), undefined)
  }
})

test('hybrid dynamic counts retain structural capacity and deterministic empty/backward seeks', () => {
  const emit = (count: number, copy: VisualCopy) => Array.from({ length: count }, (_, i) => ({ ...copy,
    transform: copy.transform.clone().multiply(new Matrix4().makeTranslation(i, i * .2, -.3)),
    colorShift: { ...copy.colorShift, tint: '#45cdef', tintAmount: .7, hue: i * .13 } }))
  const prefix: MoverOrSplitter = { maxOutputCount: 3, cachePolicy: 'beat',
    apply: (copy, { beat }) => emit(beat < 0 ? 0 : beat < 1 ? 1 : 3, copy),
    structuralVariants: [{ maxOutputCount: 3, apply: copy => emit(3, copy) }] }
  const suffix = sharedLocalLayout(beat => ({ transforms: Array.from({ length: beat < 2 ? 2 : 4 },
    (_, i) => new Matrix4().makeRotationX(i * .2).setPosition(.2, i * .1, 0)) }))
  suffix.maxOutputCount = 4
  suffix.structuralVariants = [local(4)]
  const chain = [prefix, suffix, axialMotion()]
  const seen = new Map<number, { matrices: Float64Array; colors: VisualCopy['colorShift'][] }>()
  for (const beat of [0, .7, 2, -1, .7, 0, -1]) {
    const plan = parity(chain, beat)
    assert.equal(plan.count, beat < 0 ? 0 : beat < 1 ? 2 : 12)
    assert.equal(plan.structuralCount, 12)
    assert.equal(plan.cpuPrefix!.count, beat < 0 ? 0 : beat < 1 ? 1 : 3)
    assert.ok(plan.matrices.every(Number.isFinite))
    if (seen.has(beat)) {
      assert.deepEqual(plan.matrices, seen.get(beat)!.matrices)
      assert.deepEqual(plan.cpuPrefix!.colors, seen.get(beat)!.colors)
    }
    seen.set(beat, { matrices: plan.matrices.slice(), colors: structuredClone(plan.cpuPrefix!.colors) })
  }
})

test('CPU islands refresh placement at a paused beat without mutating earlier plans', () => {
  const chain = [local(3), arbitraryField(), local(4), axialMotion()]
  const placement = new Matrix4().makeScale(2, 3, 4).setPosition(1, -2, .7)
  const first = parity(chain, .7, placement)
  const saved = first.matrices.slice()
  assert.equal(particlePlanNeedsUpdate(first, chain, .7, placement.clone()), false)
  placement.elements[12] = -4
  assert.equal(particlePlanNeedsUpdate(first, chain, .7, placement), true)
  const changed = parity(chain, .7, placement)
  assert.notDeepEqual(changed.matrices, saved)
  assert.deepEqual(first.matrices, saved)
  assert.equal(particlePlanNeedsUpdate(changed, chain, 2, placement), true)
})
