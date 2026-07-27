import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import type { EffectInstance } from '../../types'
import { composePostMoverScale, evaluatePostMoverScale } from './postMoverScale'

function scaleEffect(
  id: string,
  settings: Record<string, number>,
  enabled = true,
): EffectInstance {
  return { id, pluginId: 'scale', enabled, settings }
}

function position(matrix: Matrix4): [number, number, number] {
  return new Vector3().setFromMatrixPosition(matrix).toArray()
}

test('Scale samples base scale and its beat-synced pulse after automation merging', () => {
  const effect = scaleEffect('scale-1', { scale: 2, pulseAmount: 0.5, pulseSpeed: 1 })
  assert.equal(evaluatePostMoverScale([effect], undefined, 0), 2)
  assert.equal(evaluatePostMoverScale([effect], undefined, 0.25), 2.5)
  assert.equal(evaluatePostMoverScale(
    [effect],
    { 'scale-1': { scale: 3, pulseAmount: 0 } },
    0.25,
  ), 3)
})

test('disabled Scale effects are identity and multiple enabled instances multiply', () => {
  const effects = [
    scaleEffect('a', { scale: 2, pulseAmount: 0, pulseSpeed: 1 }),
    scaleEffect('b', { scale: 3, pulseAmount: 0, pulseSpeed: 1 }),
    scaleEffect('off', { scale: 10, pulseAmount: 0, pulseSpeed: 1 }, false),
    { id: 'offset', pluginId: 'offset', enabled: true, settings: { x: 99 } },
  ]
  assert.equal(evaluatePostMoverScale(effects, undefined, 0), 6)
  assert.equal(evaluatePostMoverScale(effects, { a: { enabled: 0 } }, 0), 3)
})

test('matrix order is world × Scale × mover, so Scale expands mover translation', () => {
  const world = new Matrix4().makeTranslation(10, 0, 0)
  const mover = new Matrix4().makeTranslation(2, 0, 0)
  const out = composePostMoverScale(world, mover, 3, new Matrix4())

  // world × scale × mover: mover lands at 2, Scale expands it to 6, then world
  // places the result at 16. The old world × mover × scale ordering landed at 12.
  assert.deepEqual(position(out), [16, 0, 0])
})

test('Scale leaves world placement fixed when no mover transform is present', () => {
  const world = new Matrix4().makeTranslation(10, 2, -4)
  const out = composePostMoverScale(world, undefined, 3, new Matrix4())
  assert.deepEqual(position(out), [10, 2, -4])
})
