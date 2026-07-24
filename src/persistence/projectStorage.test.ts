import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { emptyDocument } from './types'

// These cover the optimistic-concurrency guard in save() - the fix for the
// two-tab bug where a stale tab silently flattened newer work. The interesting
// behaviour is entirely in how a zero-row UPDATE is interpreted, so the
// Supabase client is faked rather than reached over the network.

interface RecordedCall {
  table: string
  op: 'update' | 'select'
  payload?: Record<string, unknown>
  filters: [string, unknown][]
}

type Responder = (call: RecordedCall) => { data: unknown; error: unknown }

// One mock for the whole file (node:test refuses to re-mock a specifier), so
// the response is swapped per test through this indirection.
let respond: Responder = () => ({ data: null, error: null })
let calls: RecordedCall[] = []

/** A chainable stand-in for the PostgREST builder, covering exactly the shapes
 *  projectStorage uses: .update().eq().eq().select() and .select().eq().maybeSingle(). */
const client = {
  from(table: string) {
    const call: RecordedCall = { table, op: 'select', filters: [] }
    const builder = {
      update(payload: Record<string, unknown>) { call.op = 'update'; call.payload = payload; return builder },
      select() { return builder },
      eq(column: string, value: unknown) { call.filters.push([column, value]); return builder },
      maybeSingle() { return builder },
      single() { return builder },
      then<T>(resolve: (v: { data: unknown; error: unknown }) => T) {
        calls.push(call)
        return Promise.resolve(resolve(respond(call)))
      },
    }
    return builder
  },
}

// `mock.module` is real on Node 22+ (run with --experimental-test-module-mocks)
// but isn't in @types/node's MockTracker yet, hence the cast.
;(mock as unknown as { module(specifier: string, options: { namedExports: unknown }): void })
  .module('./supabase.ts', { namedExports: { getSupabase: () => client } })

// Imported lazily (the build target is CJS, so no top-level await) and only
// once - the mock has to be in place before projectStorage first resolves it.
let pending: Promise<typeof import('./projectStorage')> | undefined
const getStorage = () => (pending ??= import('./projectStorage'))

function given(responder: Responder) {
  respond = responder
  calls = []
}

test('save writes conditionally on the loaded rev and returns the next one', async () => {
  const storage = await getStorage()
  given(() => ({ data: [{ rev: 8 }], error: null }))

  const next = await storage.save('p1', emptyDocument(), 7)

  assert.equal(next, 8, 'the caller must carry the new rev into its next save')
  assert.deepEqual(calls[0].filters, [['id', 'p1'], ['rev', 7]], 'the write must be guarded by the loaded rev')
  assert.equal(calls[0].payload?.rev, 8, 'a successful save advances the row')
})

test('a stale rev on a row that still exists is a conflict, not a failure', async () => {
  // Zero rows from the guarded UPDATE, then the probe finds the row alive at a
  // newer rev: somebody else saved in between.
  const storage = await getStorage()
  given((call) => (call.op === 'update' ? { data: [], error: null } : { data: { rev: 12 }, error: null }))

  await assert.rejects(
    () => storage.save('p1', emptyDocument(), 7),
    (err: Error) => {
      assert.equal(err.name, 'ProjectConflictError')
      assert.equal((err as InstanceType<typeof storage.ProjectConflictError>).projectId, 'p1')
      return true
    },
  )
})

test('zero rows with no row behind it stays an ordinary failure', async () => {
  // Deleted, or filtered out by RLS. This must NOT surface as a conflict: the
  // conflict path parks autosave and shows the user a choice between two
  // versions, and there is no second version here - it's a plain error the
  // autosave loop should keep retrying.
  const storage = await getStorage()
  given((call) => (call.op === 'update' ? { data: [], error: null } : { data: null, error: null }))

  await assert.rejects(
    () => storage.save('p1', emptyDocument(), 7),
    (err: Error) => {
      assert.notEqual(err.name, 'ProjectConflictError')
      assert.match(err.message, /not found/)
      return true
    },
  )
})

test('load hands back the rev alongside the document', async () => {
  const storage = await getStorage()
  given(() => ({ data: { name: 'Song', data: emptyDocument(), rev: 4 }, error: null }))

  const loaded = await storage.load('p1')

  assert.equal(loaded.rev, 4, 'without this the editor has no rev to save against')
  assert.equal(loaded.name, 'Song')
})
