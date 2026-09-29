import assert from 'node:assert/strict'
import test from 'node:test'
import { memoizeEvaluation, withCopyEvaluation } from './evaluationMemo'

test('interleaved copy clocks share a calculation only within one evaluation', () => {
  let calls = 0
  const sample = memoizeEvaluation((beat: number) => ({ beat, call: ++calls }))
  withCopyEvaluation(() => {
    const first = sample(2)
    sample(7)
    assert.equal(withCopyEvaluation(() => sample(2)), first)
    assert.equal(calls, 2)
  })
  withCopyEvaluation(() => { sample(2); assert.equal(calls, 3) })
  sample(2); sample(2)
  assert.equal(calls, 5, 'direct callers do not retain a hidden playback cache')
})

test('memo owners do not collide and exceptions release evaluation scratch', () => {
  let calls = 0
  const first = memoizeEvaluation((beat: number) => { calls++; return beat + 1 })
  const second = memoizeEvaluation((beat: number) => beat + 2)
  assert.throws(() => withCopyEvaluation(() => {
    assert.equal(first(0), 1)
    assert.equal(second(0), 2)
    throw new Error('abort frame')
  }), /abort frame/)
  withCopyEvaluation(() => assert.equal(first(0), 1))
  assert.equal(calls, 2)
})
