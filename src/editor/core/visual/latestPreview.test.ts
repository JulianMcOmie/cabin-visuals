import assert from 'node:assert/strict'
import test from 'node:test'
import { LatestPreview } from './latestPreview'

const tick = () => new Promise(resolve => setTimeout(resolve, 10))
test('input requests never execute work synchronously; busy jobs keep only the latest state', async () => {
  let value = 0
  const seen: number[] = []
  let complete = () => {}
  const queue = new LatestPreview(() => {
    seen.push(value)
    return new Promise<void>(resolve => { complete = resolve })
  })
  queue.request()
  assert.deepEqual(seen, [])
  await tick()
  assert.deepEqual(seen, [0])
  for (value = 1; value <= 10_000; value++) queue.request()
  await tick()
  assert.deepEqual(seen, [0], 'no second in-flight job')
  value = 10_000
  complete()
  await tick()
  assert.deepEqual(seen, [0, 10_000], 'all obsolete requests were replaced')
  complete()
  await tick()
  assert.equal(seen.length, 2, 'paused state goes idle')
  queue.dispose()
})

test('continuous edits make progress and the final edit is delivered', async () => {
  let latest = 0
  const seen: number[] = []
  const queue = new LatestPreview(async () => { seen.push(latest); await tick() })
  for (latest = 1; latest <= 5; latest++) { queue.request(); await tick() }
  latest = 6; queue.request()
  await tick(); await tick(); await tick()
  assert.ok(seen.length >= 3, 'no trailing debounce starvation')
  assert.equal(seen.at(-1), 6)
  queue.dispose()
})

test('dispose cancels queued work and completion cannot restart it', async () => {
  let runs = 0, complete = () => {}
  const queue = new LatestPreview(() => { runs++; return new Promise<void>(resolve => { complete = resolve }) })
  queue.request(); await tick(); queue.request(); queue.dispose(); complete(); await tick()
  assert.equal(runs, 1)
  queue.request(); await tick(); assert.equal(runs, 1)
})

test('a failed job releases the slot and reports its error', async () => {
  const errors: unknown[] = []
  let runs = 0
  const queue = new LatestPreview(async () => { if (++runs === 1) throw new Error('worker failed') }, () => 0, error => errors.push(error))
  queue.request(); await tick(); queue.request(); await tick()
  assert.equal(runs, 2); assert.equal(errors.length, 1)
  queue.dispose()
})
