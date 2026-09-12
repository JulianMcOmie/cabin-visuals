import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

let user: { id: string; is_anonymous?: boolean; user_metadata: Record<string, unknown> } | null = null
let written: unknown[] = []
let failSave = false
// Node 22+ exposes module mocks before the project's @types/node version.
const mockModule = (mock as unknown as { module: (id: string, options: { namedExports: Record<string, unknown> }) => unknown }).module.bind(mock)
mockModule('../utils/supabase/server.ts', { namedExports: { createClient: async () => ({ auth: {
  getUser: async () => ({ data: { user }, error: null }),
  updateUser: async (value: unknown) => { written.push(value); return { error: failSave ? new Error('Offline') : null } },
} }) } })
function request(body: unknown, origin = 'https://cabin.test') {
  return new NextRequest('https://cabin.test/api/settings', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
}
test('settings endpoint authenticates the exact account and validates input before writing', async () => {
  const { POST } = await import('../../app/api/settings/route')
  written = []
  assert.equal((await POST(request({ userId: 'a', theme: 'forest' }, 'https://other.test'))).status, 403)
  assert.equal((await POST(request({ userId: 'a', theme: 'invalid' }))).status, 400)
  assert.equal((await POST(request({ userId: 'a', theme: 'forest' }))).status, 401)
  user = { id: 'a', is_anonymous: true, user_metadata: {} }
  assert.equal((await POST(request({ userId: 'a', theme: 'forest' }))).status, 401)
  user = { id: 'b', user_metadata: {} }
  assert.equal((await POST(request({ userId: 'a', theme: 'forest' }))).status, 409)
  assert.deepEqual(written, [])
  user = { id: 'a', user_metadata: { cabin_settings: { futureSetting: true }, full_name: 'Kept' } }
  assert.equal((await POST(request({ userId: 'a', theme: 'forest' }))).status, 200)
  assert.deepEqual(written, [{ data: { cabin_settings: { futureSetting: true, theme: 'forest' } } }])
  failSave = true
  assert.equal((await POST(request({ userId: 'a', theme: 'ember' }))).status, 503)
})
