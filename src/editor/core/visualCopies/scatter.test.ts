import assert from 'node:assert/strict'
import test from 'node:test'
import { scatterPositions, scatterSplitter, SCATTER_MAX_COPIES, type ScatterSettings } from './scatter'
import { mergeDefinitionSettings } from './definitions'
import { resolveVisualCopies } from './resolveVisualCopies'
const s = (v: Partial<ScatterSettings> = {}) => ({ ...mergeDefinitionSettings(scatterSplitter, {}), ...v }) as ScatterSettings

test('each distribution is seed-stable and increasing count preserves existing slots', () => {
  for (const distribution of [0, 1, 2]) {
    const small = scatterPositions(s({ distribution, copies: 20 }))
    assert.deepEqual(small, scatterPositions(s({ distribution, copies: 20 })))
    assert.deepEqual(small, scatterPositions(s({ distribution, copies: 40 })).slice(0, 20))
    assert.notDeepEqual(small, scatterPositions(s({ distribution, copies: 20, seed: 2 })))
  }
})
test('spread is a radius bound in every plane and zero spread collapses the cloud', () => {
  for (const distribution of [0, 1, 2]) for (const plane of [0, 1, 2]) {
    const points = scatterPositions(s({ distribution, plane, spread: 2 }))
    assert.ok(points.every(p => p.length() <= 2 + 1e-10))
    const axis = plane === 1 ? 'y' : plane === 2 ? 'x' : 'z'
    assert.ok(points.every(p => p[axis] === 0))
    assert.ok(scatterPositions(s({ distribution, plane, spread: 0 })).every(p => p.length() === 0))
  }
})
test('even spacing improves separation; clustered points form tighter neighborhoods', () => {
  const nearest = (distribution: number) => {
    const points = scatterPositions(s({ distribution, copies: 64, spread: 1, seed: 42 }))
    return points.map((p, i) => Math.min(...points.filter((_, j) => i !== j).map(q => p.distanceTo(q))))
  }
  const uniform = nearest(0), clustered = nearest(1), even = nearest(2)
  assert.ok(Math.min(...even) > Math.min(...uniform) * 3)
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length
  assert.ok(mean(clustered) < mean(uniform))
})
test('static scatter is scrub deterministic, bounded and preserves copy appearance', () => {
  assert.equal(scatterPositions(s({ copies: 99999 })).length, SCATTER_MAX_COPIES)
  const entry = scatterSplitter.resolve({ settings: s(), notes: [] })
  const at = (beat: number) => resolveVisualCopies([entry], beat).map(c => c.transform.elements)
  assert.deepEqual(at(40), at(0)); assert.deepEqual(at(0), at(10))
  assert.ok(scatterPositions(s({ copies: NaN, spread: NaN, seed: NaN })).every(p => p.toArray().every(Number.isFinite)))
})
