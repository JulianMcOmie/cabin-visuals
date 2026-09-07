import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import { fractalSplitter, fractalTransforms, FRACTAL_MAX_COPIES, type FractalSettings } from './fractal'
import { mergeDefinitionSettings } from './definitions'
import { resolveVisualCopies } from './resolveVisualCopies'
const settings = (v: Partial<FractalSettings> = {}) => ({ ...mergeDefinitionSettings(fractalSplitter, {}), ...v }) as FractalSettings

test('recursive generations inherit translation, rotation and shrinking', () => {
  const t = fractalTransforms(settings({ branches: 1, depth: 3, angle: 0, spread: 2, shrink: .5 }))
  assert.equal(t.length, 4)
  assert.deepEqual(t.map(m => m.elements[13]), [0, 2, 3, 3.5])
  assert.deepEqual(t.map(m => m.elements[0]), [1, .5, .25, .125])
  const turn = fractalTransforms(settings({ branches: 1, depth: 2, angle: 90, spread: 2, shrink: .5 }))
  assert.ok(Math.abs(turn[2].elements[12] + 1) < 1e-10)
  assert.ok(Math.abs(turn[2].elements[13] - 2) < 1e-10)
})
test('complete generations are bounded even with out-of-range settings', () => {
  assert.equal(fractalTransforms(settings({ depth: 999, branches: 999 })).length, FRACTAL_MAX_COPIES)
  assert.equal(fractalTransforms(settings({ depth: 0 })).length, 1)
  for (const m of fractalTransforms(settings({ depth: NaN, branches: NaN, spread: NaN, shrink: NaN, angle: NaN }))) assert.ok(m.elements.every(Number.isFinite))
})
test('size does not move centers, plane mapping and local composition hold', () => {
  const base = fractalTransforms(settings()), sized = fractalTransforms(settings({ size: 2 }))
  assert.deepEqual(base.map(m => m.elements.slice(12, 15)), sized.map(m => m.elements.slice(12, 15)))
  assert.ok(fractalTransforms(settings({ plane: 1 })).every(m => Math.abs(m.elements[13]) < 1e-10))
  const incoming = new Matrix4().makeRotationZ(Math.PI / 2)
  const actual = fractalSplitter.resolve({ settings: settings(), notes: [] }).apply({ transform: incoming, opacity: .4, colorShift: { hue: 0, saturation: 0, lightness: 0, tint: null, tintAmount: 0 } }, { beat: 0, index: 0, count: 1 })
  assert.deepEqual(actual[1].transform.elements, incoming.clone().multiply(base[1]).elements)
  assert.equal(actual[1].opacity, .4)
})
test('depth MIDI lane changes complete generations with structural variants', () => {
  const resolved = fractalSplitter.resolve({ settings: settings(), notes: [{ beat: 1, blockStartBeat: 0, blockEndBeat: 8, pitch: 37, durationBeats: 1, velocity: 1 }] })
  assert.ok(resolved.structuralVariants)
  assert.equal(resolveVisualCopies([resolved], 0).length, 40)
  assert.equal(resolveVisualCopies([resolved], 2).length, 4)
})
