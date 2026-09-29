import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { ProjectSummary } from './projectStorage'
import { withCachedThumbnail } from './projectThumbnailCache'

let row: { data: { thumbnail?: string }; rev: number }
let fetchSignal: AbortSignal | undefined
const builder = {
  select: () => builder,
  eq: () => builder,
  abortSignal: (signal: AbortSignal) => { fetchSignal = signal; return builder },
  maybeSingle: async () => ({ data: row, error: null }),
}
;(mock as unknown as { module(specifier: string, options: { namedExports: unknown }): void })
  .module('./supabase.ts', { namedExports: { getSupabase: () => ({ from: () => builder }) } })
class FakeWorker {
  static current: FakeWorker
  onerror?: (event: unknown) => void
  onmessage?: (event: { data: unknown }) => void
  terminated = false
  constructor() { FakeWorker.current = this }
  terminate() { this.terminated = true }
  postMessage() { /* Tests control completion/interruption. */ }
}
const summary = (id: string): ProjectSummary => ({ id, rev: 1, updatedAt: '', name: id })

test('interrupting a render terminates its worker and does not cache a partial result', async () => {
  const original = globalThis.Worker
  globalThis.Worker = FakeWorker as unknown as typeof Worker
  try {
    const { populateProjectThumbnail } = await import('./renderProjectThumbnail')
    row = { data: {}, rev: 1 }
    const controller = new AbortController(), project = summary('cancel')
    const pending = populateProjectThumbnail('owner', project, controller.signal)
    await new Promise(resolve => setImmediate(resolve))
    controller.abort()
    await assert.rejects(pending, { name: 'AbortError' })
    assert.equal(FakeWorker.current.terminated, true)
    assert.equal(fetchSignal?.aborted, true)
    assert.equal(withCachedThumbnail('owner', project).preview?.image, undefined)
  } finally { globalThis.Worker = original }
})
test('a newer saved image wins without starting a worker or writing a document', async () => {
  const { populateProjectThumbnail } = await import('./renderProjectThumbnail')
  row = { data: { thumbnail: 'saved-image' }, rev: 2 }
  const project = summary('newer')
  await populateProjectThumbnail('owner', project, new AbortController().signal)
  assert.equal(withCachedThumbnail('owner', project).preview?.image, undefined)
  assert.equal(withCachedThumbnail('owner', { ...project, rev: 2 }).preview?.image, 'saved-image')
})
test('a media request stops the job instead of downloading assets or saving an incomplete image', async () => {
  const original = globalThis.Worker
  globalThis.Worker = FakeWorker as unknown as typeof Worker
  try {
    const { populateProjectThumbnail } = await import('./renderProjectThumbnail')
    row = { data: {}, rev: 1 }
    const project = summary('media')
    const pending = populateProjectThumbnail('owner', project, new AbortController().signal)
    await new Promise(resolve => setImmediate(resolve))
    FakeWorker.current.onmessage!({ data: { kind: 'media', requestId: 1, mediaKind: 'video', ref: 'asset' } })
    await assert.rejects(pending, /Media-backed/)
    assert.equal(FakeWorker.current.terminated, true)
    assert.equal(withCachedThumbnail('owner', project).preview?.image, undefined)
  } finally { globalThis.Worker = original }
})
