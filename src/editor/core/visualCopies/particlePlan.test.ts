import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import { radialSplitter, gridSplitter, lineSplitter } from './library'
import { mergeDefinitionSettings } from './definitions'
import { compileParticlePlan, matrixScaleBound, particlePlanMatrix } from './particlePlan'
import { resolveVisualCopies, structuralCopyCount } from './resolveVisualCopies'
import { gatedMoverOrSplitter } from './copyTargets'
import { moverDefinition, type MoverSettings } from './mover'
import { splitterWithChildChain } from './splitterChildChain'

function motion(motion: number, mode: number, drive = 0) {
  return moverDefinition.resolve({ settings: mergeDefinitionSettings(moverDefinition, {
    motion, mode, drive, angleX: 31, angleY: 47, angleZ: 67,
    pivotX: 1.2, pivotY: -.8, pivotZ: .4, distanceX: 2, distanceY: .3,
    basisXX: 1, basisXY: .2, basisXZ: .1,
  }) as unknown as MoverSettings, notes: [
    { beat: .5, durationBeats: 2, blockStartBeat: 0, blockEndBeat: 8, pitch: 60, velocity: .7 },
    { beat: 1, durationBeats: 1, blockStartBeat: 0, blockEndBeat: 8, pitch: 63, velocity: 100 },
    { beat: 3, durationBeats: 2, blockStartBeat: 0, blockEndBeat: 8, pitch: 66, velocity: 1 },
  ] })
}

function layout(def: typeof radialSplitter | typeof gridSplitter | typeof lineSplitter, settings: Record<string, number>) {
  return def.resolve({ settings: mergeDefinitionSettings(def, settings, undefined) as never, notes: [] })
}
test('factored layouts preserve input-major order and local composition', () => {
  const chain = [layout(radialSplitter, { copies: 5, radius: 2, tilt: 27, size: .7 }),
    layout(gridSplitter, { rows: 3, columns: 2, depth: 2, columnsMode: 1, spacing: .3 }),
    layout(lineSplitter, { copies: 3, spacing: .2 })]
  const plan = compileParticlePlan(chain)!
  const copies = resolveVisualCopies(chain, 0)
  assert.equal(plan.count, copies.length)
  const actual = new Matrix4()
  copies.forEach((copy, i) => {
    particlePlanMatrix(plan, i, actual)
    actual.elements.forEach((v, k) => assert.ok(Math.abs(v - copy.transform.elements[k]) < 1e-10))
  })
})
test('million-copy plans and structural counts never execute a per-copy apply', () => {
  const chain = Array.from({ length: 4 }, () => layout(lineSplitter, { copies: 32, spacing: .05 }))
  for (const entry of chain) entry.apply = () => { throw new Error('expanded') }
  const plan = compileParticlePlan(chain)!
  assert.equal(plan.count, 1048576)
  assert.equal(plan.matrices.length, 4 * 32 * 16)
  assert.equal(structuralCopyCount(chain), plan.count)
})
test('unproven context-dependent, targeted, nested and clocked entries stay on the reference path', () => {
  const ordinary = layout(radialSplitter, { copies: 4 })
  assert.equal(compileParticlePlan([{ ...ordinary, localTransforms: undefined }]), undefined)
  assert.equal(compileParticlePlan([{ ...ordinary, emitsCopyClocks: true }]), undefined)
  assert.equal(compileParticlePlan([{ ...ordinary, applyFramed: () => [] }]), undefined)
  assert.equal(compileParticlePlan([gatedMoverOrSplitter(ordinary, { rule: 'every', slices: 2, on: [0] })]), undefined)
})

test('count lanes preserve exact matrices and order across backward seeks', () => {
  const settings = mergeDefinitionSettings(lineSplitter, { copies: 8, spacing: .3 }, undefined)
  const varying = lineSplitter.resolve({ settings: settings as never, notes: [
    { beat: 1, durationBeats: .25, blockStartBeat: 0, blockEndBeat: 8, pitch: 37, velocity: 1 },
    { beat: 3, durationBeats: .25, blockStartBeat: 0, blockEndBeat: 8, pitch: 43, velocity: 1 },
  ] })
  const chain = [layout(radialSplitter, { copies: 5, tilt: 23 }), varying]
  for (const beat of [0, 2, 4, -1, 2, 0]) {
    const plan = compileParticlePlan(chain, 0, beat)!
    const reference = resolveVisualCopies(chain, beat)
    assert.equal(plan.count, reference.length)
    reference.forEach((copy, index) => {
      const actual = particlePlanMatrix(plan, index, new Matrix4())
      actual.elements.forEach((value, i) => assert.ok(Math.abs(value - copy.transform.elements[i]) < 1e-10))
    })
  }
  varying.apply = () => { throw new Error('expanded during structural query') }
  varying.structuralVariants!.forEach(entry => { entry.apply = varying.apply })
  assert.equal(structuralCopyCount(chain), 40)
})

test('all Mover cells factor exactly across placements, chain positions and backward seeks', () => {
  const placement = new Matrix4().makeRotationY(.37).setPosition(4, -3, 2)
  for (const kind of [0, 1, 2]) for (const mode of [0, 1, 2]) for (const drive of [0, 1]) {
    const moving = motion(kind, mode, drive)
    const first = layout(radialSplitter, { copies: 5, radius: 2, tilt: 27, size: .7 })
    const second = layout(lineSplitter, { copies: 3, spacing: .2, angle: 32 })
    for (const chain of [[moving, first, second], [first, moving, second], [first, second, moving]]) {
      for (const beat of [0, .8, 2.5, 4, -.5, .8, 0]) {
        const plan = compileParticlePlan(chain, 0, beat)!
        const copies = resolveVisualCopies(chain, beat, placement)
        assert.equal(plan.count, copies.length)
        copies.forEach((copy, index) => {
          const actual = particlePlanMatrix(plan, index, new Matrix4())
          actual.elements.forEach((value, i) => assert.ok(Math.abs(value - copy.transform.elements[i]) < 1e-9,
            `motion ${kind}, mode ${mode}, drive ${drive}, beat ${beat}, copy ${index}, element ${i}`))
        })
      }
    }
  }
})

test('interleaved root motions retain noncommuting order without expanding the local product', () => {
  const root1 = motion(2, 1), root2 = motion(2, 2)
  const chain = [layout(radialSplitter, { copies: 5, radius: 2, tilt: 27 }), root1,
    layout(lineSplitter, { copies: 3, spacing: .2 }), motion(1, 1), root2]
  const plan = compileParticlePlan(chain, 0, 1.3)!
  assert.deepEqual(plan.counts, [1, 5, 3, 1])
  const reference = resolveVisualCopies(chain, 1.3)
  reference.forEach((copy, index) => {
    const actual = particlePlanMatrix(plan, index, new Matrix4())
    actual.elements.forEach((value, i) => assert.ok(Math.abs(value - copy.transform.elements[i]) < 1e-9))
  })
  const large = [...Array.from({ length: 4 }, () => layout(radialSplitter, { copies: 32 })), root1, root2]
  large.forEach(entry => { entry.apply = () => { throw new Error('expanded') } })
  assert.equal(compileParticlePlan(large, 0, 1.3)!.matrices.length, (4 * 32 + 1) * 16)
  assert.equal(structuralCopyCount(large), 1048576)
})

test('root contracts preserve reference fallback for targeted, unproven framed and ambiguous entries', () => {
  const root = motion(2, 1)
  assert.equal(compileParticlePlan([gatedMoverOrSplitter(root, { rule: 'every', slices: 2, on: [0] })]), undefined)
  const nested = splitterWithChildChain(layout(radialSplitter, { copies: 5 }), [root])
  assert.ok(compileParticlePlan([nested])?.program, 'proven nested root motion has a framed plan')
  assert.equal(compileParticlePlan([{ ...root, applyFramed: () => [] }]), undefined)
  assert.equal(compileParticlePlan([{ ...root, localTransforms: [new Matrix4()] }]), undefined)
  assert.equal(compileParticlePlan([{ ...root, emitsCopyClocks: true }]), undefined)
  const immutable = root.rootTransformAtBeat!(2).elements.slice()
  compileParticlePlan([root, root], 0, 2)
  assert.deepEqual(root.rootTransformAtBeat!(2).elements, immutable, 'compilation never mutates shared deltas')
})

test('particle scale bounds stay tight under rotations and mirrored nonuniform scales', () => {
  for (let i = 0; i < 96; i++) {
    const rotation = new Matrix4().makeRotationX(i * .17)
      .multiply(new Matrix4().makeRotationY(i * .31))
      .multiply(new Matrix4().makeRotationZ(i * .53))
      .setPosition(20, -50, 100)
    const bound = matrixScaleBound(rotation)
    assert.ok(bound >= 1 - 1e-14 && bound < 1 + 1e-13, `rotation ${i}: ${bound}`)
    const scaled = matrixScaleBound(rotation.clone().scale(new Vector3(-3.7, .2, 1.4)))
    assert.ok(scaled >= 3.7 - 1e-13 && scaled < 3.7 + 1e-12, `scaled rotation ${i}: ${scaled}`)
  }
  assert.equal(matrixScaleBound(new Matrix4().makeScale(0, 0, 0)), 0)
  for (const scale of [1e-200, 1e200]) {
    const bound = matrixScaleBound(new Matrix4().makeRotationY(.8).scale(new Vector3(scale, scale, scale)))
    assert.ok(Number.isFinite(bound) && Math.abs(bound / scale - 1) < 1e-13)
  }
})

test('particle scale bounds conservatively cover shears and sampled unit directions', () => {
  const directions = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
  for (let i = 0; i < 256; i++) {
    const z = 1 - 2 * (i + .5) / 256
    const radius = Math.sqrt(1 - z * z), angle = i * Math.PI * (3 - Math.sqrt(5))
    directions.push(new Vector3(radius * Math.cos(angle), radius * Math.sin(angle), z))
  }
  for (let i = 0; i < 24; i++) {
    const shear = new Matrix4().set(
      i % 2 ? -2 : .5, Math.sin(i) * 3, .7, 0,
      -.4, 1.3, Math.cos(i) * 2, 0,
      Math.sin(i * .7), -.6, i % 3 ? .2 : 0, 0,
      0, 0, 0, 1,
    ).premultiply(new Matrix4().makeRotationY(i * .37))
      .multiply(new Matrix4().makeRotationX(i * .21))
    const bound = matrixScaleBound(shear)
    for (const direction of directions) {
      assert.ok(direction.clone().applyMatrix4(shear).length() <= bound,
        `shear ${i} must not underestimate its transformed unit vectors`)
    }
  }
})

test('constant rotation does not inflate a compact radial chain size estimate', () => {
  for (const kind of [1, 2]) {
    const chain = [layout(radialSplitter, { copies: 32, radius: 2, tilt: 27 }),
      layout(radialSplitter, { copies: 32, radius: .5, plane: 1 }),
      layout(radialSplitter, { copies: 32, radius: .1, plane: 2 }), motion(kind, 1)]
    for (const beat of [0, .3, 1.7, 4, -2, .3, 0]) {
      const plan = compileParticlePlan(chain, 0, beat)!
      assert.equal(plan.count, 32768)
      assert.ok(plan.scaleBound >= 1 - 1e-13 && plan.scaleBound < 1 + 1e-12,
        `motion ${kind} beat ${beat}: ${plan.scaleBound}`)
    }
  }
})
