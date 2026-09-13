import assert from 'node:assert/strict'
import test from 'node:test'
import { Color, Matrix4 } from 'three'
import { compileParticlePlan, particlePlanCopy, particlePlanMatrix, particlePlanNeedsUpdate } from './particlePlan'
import { resolveVisualCopies, structuralCopyCount } from './resolveVisualCopies'
import { applyColorShiftToColor } from '../visual/colorShift'
import { COLOR_IDS, colorEntry, colorFrameCases, colorNote, radialPopulation } from '../../../../scripts/perf/particle-color-program-fixtures'
import type { VisualCopy } from './types'

function near(actual: number, expected: number, label: string, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${label}: ${actual} != ${expected}`)
}
function assertAppearance(actual: VisualCopy, expected: VisualCopy, source: string) {
  actual.transform.elements.forEach((value, i) => near(value, expected.transform.elements[i], `matrix ${i}`))
  near(actual.opacity, expected.opacity, 'opacity')
  for (const key of ['hue', 'saturation', 'lightness', 'tintAmount'] as const) near(actual.colorShift[key], expected.colorShift[key], key)
  assert.equal(actual.colorShift.tint?.toLowerCase() ?? null, expected.colorShift.tint?.toLowerCase() ?? null)
  assert.equal(!!actual.colorShift.tintPerceptual, !!expected.colorShift.tintPerceptual)
  assert.equal(!!actual.colorShift.huePerceptual, !!expected.colorShift.huePerceptual)
  const expectedRgb = applyColorShiftToColor(new Color(source), expected.colorShift, new Color()).toArray()
  const actualRgb = applyColorShiftToColor(new Color(source), actual.colorShift, new Color()).toArray()
  actualRgb.forEach((value, i) => near(value, expectedRgb[i], `linear RGB ${i}`))
}

test('all colorizer maps and composition cases preserve CPU appearance in compact plans', () => {
  for (const frame of colorFrameCases()) {
    const plan = compileParticlePlan(frame.chain, 1, frame.beat, frame.placement)
    assert.ok(plan, `${frame.name} should retain GPU batching`)
    assert.equal(plan.cpuPrefix, undefined, `${frame.name} must not evaluate a hidden CPU seed population`)
    const expected = resolveVisualCopies(frame.chain, frame.beat, frame.placement)
    assert.equal(plan.count, expected.length, frame.name)
    expected.forEach((copy, index) => assertAppearance(particlePlanCopy(plan, index)!, copy, frame.color))
  }
})

test('every colorizer after a million split copies compiles without invoking per-copy apply', () => {
  for (const id of COLOR_IDS) {
    const chain = [...radialPopulation(), colorEntry(id, {}, [colorNote()])]
    for (const entry of chain) {
      entry.apply = () => { throw new Error(`${id} expanded the particle population`) }
      for (const variant of entry.structuralVariants ?? []) variant.apply = entry.apply
    }
    assert.equal(structuralCopyCount(chain), 32 ** 4)
    for (const beat of [.2, .7, 2.3, -.5, .7]) {
      const plan = compileParticlePlan(chain, 0, beat)!
      assert.ok(plan, id)
      assert.equal(plan.count, 32 ** 4)
      assert.equal(plan.cpuPrefix, undefined)
      assert.ok(plan.matrices.length < 65536, `${id} payload must follow device data and splitter factors`)
      for (const index of [0, 31, 65535, 524288, 32 ** 4 - 1]) {
        assert.ok(particlePlanMatrix(plan, index, new Matrix4()).elements.every(Number.isFinite))
        assert.ok(particlePlanCopy(plan, index))
      }
    }
  }
})

test('copy-index colorizers sample their incoming population before a later splitter expands it', () => {
  const chain = [colorEntry('line', { copies: 3, spacing: .3 }),
    colorEntry('cosinePalette', { mode: 5, cycles: .75, scroll: .13 }),
    colorEntry('radial', { copies: 4, radius: .1 })]
  const plan = compileParticlePlan(chain, 0, .7)!
  assert.ok(plan)
  assert.equal(plan.count, 12)
  const colors = Array.from({ length: plan.count }, (_, index) => particlePlanCopy(plan, index)!.colorShift.tint)
  for (let seed = 0; seed < 3; seed++) for (let child = 0; child < 4; child++) assert.equal(colors[seed * 4 + child], colors[seed * 4])
  assert.equal(new Set(colors).size, 3, 'different parents have different colors; descendants inherit the parent sample')
})

test('position colorizers sample the frame at their own stage and do not move their lookup past a later fluid field', () => {
  const grid = () => colorEntry('grid', { rows: 5, columns: 7, spacing: .53 })
  const cosine = () => colorEntry('cosinePalette', { mode: 0, span: 2.7, scroll: .137 })
  const fluid = () => colorEntry('fluidImpact', { strength: 2.2 }, [colorNote()])
  const before = [grid(), cosine(), fluid()], after = [grid(), fluid(), cosine()]
  const a = compileParticlePlan(before, 0, .3)!, b = compileParticlePlan(after, 0, .3)!
  assert.ok(a && b)
  let changed = 0
  const expectedA = resolveVisualCopies(before, .3), expectedB = resolveVisualCopies(after, .3)
  for (let i = 0; i < a.count; i++) {
    assertAppearance(particlePlanCopy(a, i)!, expectedA[i], '#bc734d')
    assertAppearance(particlePlanCopy(b, i)!, expectedB[i], '#bc734d')
    if (particlePlanCopy(a, i)!.colorShift.tint !== particlePlanCopy(b, i)!.colorShift.tint) changed++
  }
  assert.ok(changed > a.count / 2, 'moving the colorizer across the field meaningfully changes its spatial sample')
})

test('held-beat placement edits and backward seeks resample world color mapping without changing older plans', () => {
  const chain = [colorEntry('grid', { rows: 5, columns: 7, depth: 2, spacing: .43 }),
    colorEntry('cosinePalette', { mode: 0, span: 2.7 }, [colorNote()]),
    colorEntry('hueRotate', { mode: 1, continuous: 1, speed: .17 })]
  const placement = new Matrix4().makeTranslation(.17, -.13, .2)
  const first = compileParticlePlan(chain, 0, .7, placement)!
  assert.ok(first)
  const saved = first.matrices.slice(), savedCopy = particlePlanCopy(first, 17)!
  assert.equal(particlePlanNeedsUpdate(first, chain, .7, placement.clone()), false)
  placement.elements[12] += .4
  assert.equal(particlePlanNeedsUpdate(first, chain, .7, placement), true)
  const moved = compileParticlePlan(chain, 0, .7, placement)!
  assert.ok(moved)
  assert.notEqual(particlePlanCopy(moved, 17)!.colorShift.tint, savedCopy.colorShift.tint)
  assert.deepEqual(first.matrices, saved)
  assert.deepEqual(particlePlanCopy(first, 17), savedCopy)
  const seen = new Map<number, VisualCopy>()
  for (const beat of [.7, 2, -.5, .7]) {
    const plan = compileParticlePlan(chain, 0, beat, placement)!
    const copy = particlePlanCopy(plan, 17)!
    if (seen.has(beat)) assert.deepEqual(copy, seen.get(beat))
    seen.set(beat, copy)
  }
})


test('Visibility changes opacity without dropping a million-copy structural capacity or evaluating its copies', () => {
  const chain = [...radialPopulation(), colorEntry('cosinePalette', { mode: 5 }),
    colorEntry('visibility', { grouping: 50, attackBeats: 0, decayBeats: 0, sustainLevel: .6 }, [colorNote(0, 127, 1, 4)])]
  for (const entry of chain) entry.apply = () => { throw new Error('Visibility expanded a million particles') }
  const plan = compileParticlePlan(chain, 0, .7)!
  assert.ok(plan)
  assert.equal(plan.count, 32 ** 4)
  assert.equal(structuralCopyCount(chain), 32 ** 4)
  assert.equal(plan.cpuPrefix, undefined)
  for (const index of [0, 524287, 524288, 1048575]) {
    const copy = particlePlanCopy(plan, index)!
    near(copy.opacity, index < 524288 ? .6 : 0, 'group opacity')
  }
})
