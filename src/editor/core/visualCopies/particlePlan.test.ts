import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import { radialSplitter, gridSplitter, lineSplitter } from './library'
import { mergeDefinitionSettings } from './definitions'
import { compileParticlePlan, particlePlanMatrix } from './particlePlan'
import { resolveVisualCopies, structuralCopyCount } from './resolveVisualCopies'
import { gatedMoverOrSplitter } from './copyTargets'

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
