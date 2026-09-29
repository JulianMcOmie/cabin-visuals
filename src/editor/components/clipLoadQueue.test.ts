import test from 'node:test'
import assert from 'node:assert/strict'
import { createClipLoadQueue } from './clipLoadQueue'

test('only three decoders start at once, and finishing a slot is idempotent', () => {
  const acquire = createClipLoadQueue()
  const started: number[] = []
  const finish: Array<() => void> = []
  const cancel = Array.from({ length: 5 }, (_, id) => acquire(done => { started.push(id); finish[id] = done }))
  assert.deepEqual(started, [0, 1, 2])
  finish[0](); finish[0]()
  assert.deepEqual(started, [0, 1, 2, 3])
  finish[1]()
  assert.deepEqual(started, [0, 1, 2, 3, 4])
  cancel.forEach(done => done())
})

test('leaving a folder cancels queued starts and frees active slots', () => {
  const acquire = createClipLoadQueue(1)
  const started: number[] = []
  const cancel = Array.from({ length: 3 }, (_, id) => acquire(() => { started.push(id) }))
  cancel[1]()
  cancel[0]()
  assert.deepEqual(started, [0, 2])
  cancel[2]()
})

test('a stalled download cannot block subsequent previews indefinitely', async () => {
  const acquire = createClipLoadQueue(1, 10)
  const cancel = acquire(() => {})
  await new Promise<void>(resolve => acquire(done => { done(); resolve() }))
  cancel()
})
