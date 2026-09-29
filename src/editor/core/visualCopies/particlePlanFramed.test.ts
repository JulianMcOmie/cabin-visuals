import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import { mergeDefinitionSettings } from './definitions'
import { radialSplitter } from './library'
import { moverDefinition } from './mover'
import { compileParticlePlan, particlePlanMatrix } from './particlePlan'
import { resolveVisualCopies, structuralCopyCount } from './resolveVisualCopies'
import { splitterWithChildChain } from './splitterChildChain'
import type { MoverOrSplitter } from './types'

function local(...matrices: Matrix4[]): MoverOrSplitter {
  return {
    localTransforms: matrices,
    apply(copy) {
      return matrices.map(matrix => ({ ...copy, transform: copy.transform.clone().multiply(matrix) }))
    },
  }
}

function root(matrix: Matrix4): MoverOrSplitter {
  // Intentionally no composition declaration: nested Orbit currently uses this
  // exact contract and must retain the wrapper's existing reanchoring behavior.
  return {
    rootTransform: matrix,
    apply(copy) { return [{ ...copy, transform: matrix.clone().multiply(copy.transform) }] },
  }
}

function radial(copies: number, tilt = 0, size = 1): MoverOrSplitter {
  return radialSplitter.resolve({
    settings: mergeDefinitionSettings(radialSplitter, { copies, tilt, size, radius: .8 }) as never,
    notes: [],
  })
}

function movingRadial(copies: number, angle: number, tilt = 0): MoverOrSplitter {
  return splitterWithChildChain(radial(copies, tilt), [local(new Matrix4().makeRotationY(angle))])
}

function parity(chain: MoverOrSplitter[], beat = 0) {
  const plan = compileParticlePlan(chain, 7, beat)
  assert.ok(plan?.program)
  const reference = resolveVisualCopies(chain, beat, new Matrix4().makeScale(0, 0, 0))
  assert.equal(plan.count, reference.length)
  const actual = new Matrix4()
  reference.forEach((copy, index) => {
    particlePlanMatrix(plan, index, actual)
    actual.elements.forEach((value, element) => {
      const expected = copy.transform.elements[element]
      assert.ok(Math.abs(value - expected) <= 1e-9 * Math.max(1, Math.abs(expected)),
        `copy ${index}, element ${element}: ${value} versus ${expected}`)
    })
    assert.equal(copy.opacity, 1)
    assert.deepEqual(copy.colorShift, reference[0].colorShift)
  })
  return plan
}

test('framed programs preserve correlated slots and ordered internals across later layouts and roots', () => {
  const first = movingRadial(5, .73, 23)
  const second = splitterWithChildChain(radial(3, 41, .8), [
    root(new Matrix4().makeRotationZ(.31).setPosition(.2, -.4, .3)),
    local(new Matrix4().makeRotationX(-.27)),
  ])
  const third = movingRadial(2, -.43, 12)
  const rootDelta = new Matrix4().makeRotationY(.37).setPosition(2, -3, 1)
  for (const position of [0, 1, 3, 5]) {
    const chain = [first, radial(2, 51), second, local(new Matrix4().makeTranslation(.3, .1, -.2)), third]
    chain.splice(position, 0, root(rootDelta))
    const plan = parity(chain)
    assert.equal(plan.count, 60)
    assert.ok(plan.program!.guardOffsets.every(offset => offset === -1))
  }
})

test('framed programs match incoming mirrored, zero, tiny and exact-threshold frames', () => {
  const scales = [new Matrix4().makeScale(-.7, 1.3, 2.1), new Matrix4().makeScale(0, 0, 0),
    new Matrix4().makeScale(1e-5, 1e-5, 1e-5), new Matrix4().makeScale(1e-4, 1e-4, 1e-4),
    new Matrix4().makeScale(1.00001e-4, 1.00001e-4, 1.00001e-4)]
  for (const scale of scales) {
    const plan = parity([local(scale), movingRadial(3, .8, 27), radial(2, 39)])
    const active = Math.abs(scale.determinant()) >= 1e-12
    assert.equal(plan.program!.guardOffsets[1], active ? -1 : -2)
  }
  assert.equal(scales[3].determinant(), 1e-12, 'exercise inclusive threshold equality')
})

test('nested constant motion resamples correctly across backward seeks', () => {
  const child = moverDefinition.resolve({ settings: mergeDefinitionSettings(moverDefinition,
    { motion: 1, mode: 1, angleX: 31, angleY: 47, angleZ: 67 }) as never, notes: [] })
  const chain = [radial(3, 19), splitterWithChildChain(radial(4, 37), [child]), radial(2, 53)]
  const earlier = parity(chain, .7).matrices.slice()
  const later = parity(chain, 2.3).matrices.slice()
  assert.notDeepEqual(earlier, later)
  parity(chain, -.5)
  assert.deepEqual(parity(chain, .7).matrices, earlier)
})

test('mixed prefix guards retain prior internals when a later framed stage is skipped', () => {
  const scaleChoices = local(new Matrix4(), new Matrix4().makeScale(0, 1, 1),
    new Matrix4().makeScale(-.8, 1.1, 1.2))
  const plan = parity([movingRadial(2, .63, 17), scaleChoices,
    movingRadial(3, -.41, 39), radial(2, 28), root(new Matrix4().makeRotationX(.29))])
  const offset = plan.program!.guardOffsets[2]
  assert.ok(offset >= 0, 'mixed prefix needs a CPU guard table')
  assert.deepEqual(Array.from(plan.matrices.slice(offset, offset + 6)), [1, 0, 1, 1, 0, 1])
  assert.equal(plan.program!.guardStrides[2], 6, 'one flag covers every descendant of its prefix')
})

test('singular own slots fold immediately while other slots defer their internal motion', () => {
  const own = local(new Matrix4().makeTranslation(1, 2, 3).scale(new Vector3(0, 1, 1)),
    new Matrix4().makeTranslation(-1, .5, 2).scale(new Vector3(-.7, 1.2, .8)))
  const moving = splitterWithChildChain(own, [local(new Matrix4().makeRotationZ(.8))])
  const plan = parity([radial(2, 13), moving, radial(3, 29)])
  const offset = plan.program!.internalOffsets[1]
  assert.deepEqual(Array.from(plan.matrices.slice(offset * 16, (offset + 1) * 16)), new Matrix4().elements)
})

test('framed compact scale bounds cover both active and skipped paths', () => {
  const moving = splitterWithChildChain(radial(3, 17), [local(new Matrix4().makeScale(.2, .3, .4))])
  const plan = parity([local(new Matrix4(), new Matrix4().makeScale(0, 2, 3)), moving, radial(2, 37)])
  const matrix = new Matrix4()
  for (let index = 0; index < plan.count; index++) {
    particlePlanMatrix(plan, index, matrix)
    for (const direction of [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1), new Vector3(1, 2, 3).normalize()]) {
      matrix.setPosition(0, 0, 0)
      assert.ok(direction.applyMatrix4(matrix).length() <= plan.scaleBound)
    }
  }
})

test('guard certification does not overlook overflow in affine translations', () => {
  const translations = [new Matrix4().makeTranslation(1e308, 0, 0), new Matrix4().makeTranslation(1e308, 0, 0)]
  const prefix = translations[0].clone().multiply(translations[1])
  assert.equal(Number.isFinite(prefix.determinant()), false)
  const plan = compileParticlePlan([...translations.map(matrix => local(matrix)), movingRadial(2, .4)])!
  assert.ok(plan.program)
  assert.equal(plan.program.guardOffsets[2], -2,
    'reference skips children when finite inputs overflow the accumulated frame determinant')
})

test('million-copy framed plans sample only their own slots without applying the expanded chain', () => {
  let childApplications = 0
  const child = local(new Matrix4().makeRotationZ(.41))
  const applyChild = child.apply
  child.apply = (copy, context) => { childApplications++; return applyChild(copy, context) }
  const chain = [radial(32, 17), splitterWithChildChain(radial(32, 29), [child]), radial(32, 41), radial(32, 53)]
  for (const entry of chain) entry.apply = () => { throw new Error('expanded chain apply') }
  const plan = compileParticlePlan(chain, 0, .7)!
  assert.equal(plan.count, 1048576)
  assert.equal(childApplications, 32)
  assert.ok(plan.program!.guardOffsets.every(offset => offset === -1))
  assert.equal(plan.matrices.length, (32 * 6) * 16)
  assert.equal(structuralCopyCount(chain), 1048576)
})

test('framed compiler rejects ambiguous, clocked, malformed and non-affine metadata', () => {
  const framed = movingRadial(3, .4)
  const malformed: MoverOrSplitter[] = [
    { ...framed, localTransforms: [new Matrix4()] },
    { ...framed, emitsCopyClocks: true },
    { ...framed, applyFramed: undefined },
    { ...framed, structuralVariants: [{ apply: copy => [copy] }] },
    { ...framed, framedLocalTransformsAtBeat: () => ({ frames: [new Matrix4()], internals: [], bareFrames: [new Matrix4()] }) },
    { ...framed, framedLocalTransformsAtBeat: () => ({ frames: [new Matrix4()], internals: [null], bareFrames: [] }) },
    local(new Matrix4().makePerspective(-1, 1, 1, -1, .1, 100)),
  ]
  for (const entry of malformed) assert.equal(compileParticlePlan([entry, framed]), undefined)
})
