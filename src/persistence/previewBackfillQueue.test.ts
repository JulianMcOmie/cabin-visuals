import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PreviewBackfillQueue } from './previewBackfillQueue'

test('starts only after 15 quiet seconds with idle budget and permission', async () => {
  const calls: number[] = []
  const q = new PreviewBackfillQueue([1], 0, async x => { calls.push(x) }, () => 15000)
  await q.tick(14999, true, 50)
  await q.tick(15000, false, 50)
  await q.tick(15000, true, 9)
  assert.deepEqual(calls, [])
  await q.tick(15000, true, 10)
  assert.deepEqual(calls, [1])
})
test('serializes jobs and imposes cooldown after completion', async () => {
  let finish!: () => void
  const calls: number[] = []
  const q = new PreviewBackfillQueue([1, 2], 0, async x => {
    calls.push(x)
    if (x === 1) await new Promise<void>(resolve => { finish = resolve })
  }, () => 20000)
  const first = q.tick(15000, true, 50)
  await q.tick(100000, true, 50)
  assert.deepEqual(calls, [1])
  finish(); await first
  await q.tick(49999, true, 50)
  assert.deepEqual(calls, [1])
  await q.tick(50000, true, 50)
  assert.deepEqual(calls, [1, 2])
})
test('activity aborts immediately, then moves interrupted work behind other projects', async () => {
  const calls: number[] = []
  let aborted = false
  const q = new PreviewBackfillQueue([1, 2], 0, async (x, signal) => {
    calls.push(x)
    if (calls.length === 1) await new Promise<void>(resolve => signal.addEventListener('abort', () => {
      aborted = true; resolve()
    }))
  }, () => 16000)
  const first = q.tick(15000, true, 50)
  q.interrupt(16000)
  assert.equal(aborted, true)
  await first
  await q.tick(46000, true, 50)
  await q.tick(76000, true, 50)
  assert.deepEqual(calls, [1, 2, 1])
})
test('failed projects do not spin and stopping prevents new work', async () => {
  const calls: number[] = []
  const q = new PreviewBackfillQueue([1, 2], 0, async x => { calls.push(x); throw Error('failed') }, () => 15000)
  await q.tick(15000, true, 50)
  await q.tick(45000, true, 50)
  await q.tick(75000, true, 50)
  q.enqueue(3); q.stop()
  await q.tick(100000, true, 50)
  assert.deepEqual(calls, [1, 2])
})
test('stop cancels an in-flight job and does not requeue it', async () => {
  let signal!: AbortSignal
  const q = new PreviewBackfillQueue([1], 0, async (_, value) => {
    signal = value
    await new Promise<void>(resolve => value.addEventListener('abort', () => resolve()))
  })
  const task = q.tick(15000, true, 50)
  q.stop()
  assert.equal(signal.aborted, true)
  await task
})
test('expensive work buys a proportionately longer cooldown', async () => {
  let now = 15000
  const calls: number[] = []
  const q = new PreviewBackfillQueue([1, 2], 0, async x => { calls.push(x); now += 8000 }, () => now)
  await q.tick(now, true, 50)
  now = 182999
  await q.tick(now, true, 50)
  assert.deepEqual(calls, [1])
  now = 183000
  await q.tick(now, true, 50)
  assert.deepEqual(calls, [1, 2])
})
