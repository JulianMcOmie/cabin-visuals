import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import { sharedLocalLayout } from './sharedLocalLayout'
import { identityVisualCopy } from './identityVisualCopy'
import { withCopyEvaluation } from './evaluationMemo'
import { getMoverOrSplitterDefinition } from './registry'
import { mergeDefinitionSettings } from './definitions'

test('the same slot table drives local transforms, opacity and relative hue without mutating inputs', () => {
  const transforms = [new Matrix4().makeTranslation(1, 2, 3), new Matrix4().makeRotationY(.7)]
  const layout = { transforms, opacities: [.25, 0], hueShifts: [.3, -.2] }
  const entry = sharedLocalLayout(layout)
  assert.equal(entry.localLayout, layout)
  assert.equal(entry.localTransforms, undefined)
  assert.equal(entry.cachePolicy, 'static')
  const copy = identityVisualCopy()
  copy.transform.makeRotationX(.4); copy.opacity = .6
  copy.colorShift.hue = .1; copy.colorShift.tint = '#aa8844'
  const before = structuredClone(copy), matrices = transforms.map(matrix => matrix.elements.slice())
  const out = entry.apply(copy, { beat: 2, index: 3, count: 9 })
  out.forEach((next, i) => {
    assert.deepEqual(next.transform.elements, copy.transform.clone().multiply(transforms[i]).elements)
    assert.equal(next.opacity, copy.opacity * layout.opacities[i])
    assert.deepEqual(next.colorShift, { ...copy.colorShift, hue: copy.colorShift.hue + layout.hueShifts[i] })
    assert.notEqual(next.transform, transforms[i]); assert.notEqual(next.colorShift, copy.colorShift)
  })
  assert.deepEqual(structuredClone(copy), before)
  assert.deepEqual(transforms.map(matrix => matrix.elements), matrices)
  const plain = sharedLocalLayout({ transforms })
  assert.equal(plain.localTransforms, transforms, 'preserve the ordinary transform-only metadata contract')
  assert.equal(plain.localLayout, undefined)
})

test('dynamic layouts share interleaved clocks and placements but invalidate mutated matrix contents', () => {
  let calls = 0
  const entry = sharedLocalLayout((beat, placement) => {
    calls++
    return { transforms: [new Matrix4().makeTranslation(beat, placement?.elements[12] ?? 0, 0)] }
  }, { usesPlacement: true, count: 1 })
  const a = new Matrix4().makeTranslation(3, 0, 0), b = new Matrix4().makeTranslation(7, 0, 0)
  const sample = entry.localLayoutAtBeat!
  withCopyEvaluation(() => {
    const first = sample(2, a)
    sample(4, a); sample(2, b)
    assert.equal(sample(2, a), first)
    assert.equal(calls, 3)
    a.elements[12] = 9
    assert.equal(sample(2, a).transforms[0].elements[13], 9)
    assert.equal(calls, 4)
  })
  assert.equal(sample(2, a).transforms[0].elements[13], 9)
  assert.equal(calls, 4, 'immediate metadata/reference reads share one recent sample')
  sample(-1, a)
  assert.equal(sample(2, a).transforms[0].elements[12], 2, 'backward seeks recompute the same pure result')
  assert.equal(entry.cachePolicy, 'beat')
  assert.equal(entry.localLayoutUsesPlacement, true)
  assert.equal(entry.localLayoutCount, 1)
})

test('placement-independent samplers ignore unrelated placement changes', () => {
  let calls = 0
  const entry = sharedLocalLayout((beat, placement) => {
    assert.equal(placement, undefined); calls++
    return { transforms: [new Matrix4().makeRotationZ(beat)] }
  }, { count: 1 })
  const first = entry.localLayoutAtBeat!(2, new Matrix4())
  assert.equal(entry.localLayoutAtBeat!(2, new Matrix4().makeScale(0, 0, 0)), first)
  assert.equal(calls, 1)
})

test('factory rejects mismatched appearance channels and broken fixed counts', () => {
  assert.throws(() => sharedLocalLayout({ transforms: [new Matrix4()], opacities: [] }), /slot count/)
  assert.throws(() => sharedLocalLayout({ transforms: [], hueShifts: [1] }), /slot count/)
  const entry = sharedLocalLayout(() => ({ transforms: [] }), { count: 1 })
  assert.throws(() => entry.localLayoutAtBeat!(0), /fixed slot count/)
})

test('every spatial splitter exposes a table that exactly matches its reference apply', () => {
  const ids = ['radial', 'grid', 'line', 'fractal', 'wallpaper', 'scatter', 'symmetry',
    'polyhedron', 'parametricPattern', 'tunnel', 'approach', 'duplicateTrail']
  const placement = new Matrix4().makeScale(2, .7, 1.3).setPosition(3, -1, 2)
  for (const id of ids) {
    const def = getMoverOrSplitterDefinition(id)!
    const entry = def.resolve({ settings: mergeDefinitionSettings(def, {
      copies: 4, rows: 2, columns: 3, depth: 2, branches: 3, density: 3, copiesPerRing: 3, rings: 2, rainbow: 1,
    }), notes: [{ pitch: 60, beat: 0, durationBeats: 1, velocity: .7, blockStartBeat: 0, blockEndBeat: 4 }] })
    for (const beat of [0, .5, 2, -.5, .5]) {
      const table = entry.localLayoutAtBeat?.(beat, placement) ?? entry.localLayout
        ?? { transforms: entry.localTransformsAtBeat?.(beat) ?? entry.localTransforms! }
      assert.ok(table.transforms?.length, id)
      const copy = identityVisualCopy(); copy.opacity = .43; copy.colorShift.hue = .17
      copy.transform.makeRotationX(.3).setPosition(.2, -.4, .1)
      const out = entry.apply(copy, { beat, placementTransform: placement, index: 5, count: 13 })
      assert.equal(out.length, table.transforms.length, id)
      out.forEach((next, i) => {
        assert.deepEqual(next.transform.elements, copy.transform.clone().multiply(table.transforms[i]).elements, id)
        assert.equal(next.opacity, copy.opacity * (table.opacities?.[i] ?? 1), id)
        assert.deepEqual(next.colorShift, { ...copy.colorShift, hue: copy.colorShift.hue + (table.hueShifts?.[i] ?? 0) }, id)
      })
    }
  }
})
