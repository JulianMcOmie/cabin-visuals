import { afterEach, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'

type Session = { user: { id: string }; access_token: string }
let auth: { data: { session: Session | null }; error: Error | null }
const client = { auth: { getSession: async () => auth } }

;(mock as unknown as { module(specifier: string, options: { namedExports: unknown }): void })
  .module('./supabase.ts', { namedExports: { getSupabase: () => client } })

let pending: Promise<[
  typeof import('./audioStorage'),
  typeof import('./videoStorage'),
  typeof import('./photoStorage'),
]> | undefined
const getStorage = () => (pending ??= Promise.all([
  import('./audioStorage'), import('./videoStorage'), import('./photoStorage'),
]))

// The network boundary is faked; tests exercise the public media APIs without
// contacting Supabase or sending files anywhere.
class UploadRequest {
  static sent: UploadRequest[] = []
  method = ''
  url = ''
  headers: Record<string, string> = {}
  body: File | null = null
  status = 0
  responseText = ''
  upload = { onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  open(method: string, url: string) { this.method = method; this.url = url }
  setRequestHeader(name: string, value: string) { this.headers[name] = value }
  send(file: File) {
    this.body = file
    UploadRequest.sent.push(this)
    queueMicrotask(() => respond(this))
  }
  finish(status: number, body = '') {
    this.status = status
    this.responseText = body
    this.onload?.()
  }
}

let respond: (request: UploadRequest) => void
let restore: () => void
beforeEach(() => {
  auth = { data: { session: { user: { id: 'user-1' }, access_token: 'session-token' } }, error: null }
  respond = (request) => request.finish(200)
  UploadRequest.sent = []
  const previousXHR = globalThis.XMLHttpRequest
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  globalThis.XMLHttpRequest = UploadRequest as unknown as typeof XMLHttpRequest
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://storage.example'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-key'
  restore = () => {
    if (previousXHR === undefined) Reflect.deleteProperty(globalThis, 'XMLHttpRequest')
    else globalThis.XMLHttpRequest = previousXHR
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey
  }
})
afterEach(() => restore())

for (const [index, kind, bucket] of [
  [0, 'Audio', 'project-audio'],
  [1, 'Video', 'project-videos'],
  [2, 'Photo', 'project-photos'],
] as const) {
  test(`${kind} keeps its user/project ref and uploads to its own bucket`, async () => {
    const stores = await getStorage()
    const storage = stores[index] as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
    const path = await storage[`mint${kind}Path`]('project-1') as string
    assert.match(path, /^user-1\/project-1\/[0-9a-f-]{36}$/)
    assert.equal(UploadRequest.sent.length, 0, 'minting the ref must not start an upload')

    const file = new File(['media'], 'source.mp4', { type: 'video/mp4' })
    await storage[`upload${kind}To`](path, file)

    assert.equal(UploadRequest.sent.length, 1)
    const request = UploadRequest.sent[0]
    assert.equal(request.method, 'POST')
    assert.equal(request.url, `https://storage.example/storage/v1/object/${bucket}/${path}`)
    assert.deepEqual(request.headers, {
      Authorization: 'Bearer session-token',
      apikey: 'public-key',
      'Content-Type': 'video/mp4',
    })
    assert.equal(request.body, file)
  })
}

test('unauthenticated mint and upload fail before any bytes are sent', async () => {
  const [storage] = await getStorage()
  auth.data.session = null
  await assert.rejects(storage.mintAudioPath('project-1'), { message: 'Not signed in' })
  await assert.rejects(storage.uploadAudioTo('path', new File([], 'source')), { message: 'Not signed in' })
  assert.equal(UploadRequest.sent.length, 0)
})

test('minting preserves the original auth failure', async () => {
  const [storage] = await getStorage()
  const error = new Error('Could not refresh session')
  auth.error = error
  await assert.rejects(storage.mintAudioPath('project-1'), (actual) => actual === error)
  assert.equal(UploadRequest.sent.length, 0)
})

test('upload reports only computable progress and defaults an unknown content type', async () => {
  const [storage] = await getStorage()
  const progress: number[] = []
  respond = (request) => {
    request.upload.onprogress?.({ lengthComputable: false, loaded: 10, total: 0 })
    request.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 20 })
    request.upload.onprogress?.({ lengthComputable: true, loaded: 20, total: 20 })
    request.finish(201)
  }
  await storage.uploadAudioTo('path', new File(['media'], 'source'), (fraction) => progress.push(fraction))
  assert.deepEqual(progress, [0.25, 1])
  assert.equal(UploadRequest.sent[0].headers['Content-Type'], 'application/octet-stream')
})

for (const [status, body, message] of [
  [400, '{"message":"Bucket rejected this file"}', 'Bucket rejected this file'],
  [500, '{}', 'Upload failed (500)'],
  [503, '<html>Unavailable</html>', 'Upload failed (503)'],
] as const) {
  test(`upload preserves the error response for HTTP ${status}`, async () => {
    const [storage] = await getStorage()
    respond = (request) => request.finish(status, body)
    await assert.rejects(storage.uploadAudioTo('path', new File([], 'source')), { message })
  })
}

test('upload reports a network failure', async () => {
  const [storage] = await getStorage()
  respond = (request) => request.onerror?.()
  await assert.rejects(storage.uploadAudioTo('path', new File([], 'source')), {
    message: 'Upload failed - network error',
  })
})
