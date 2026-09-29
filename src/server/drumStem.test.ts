import assert from 'node:assert/strict'
import test from 'node:test'
import { zipSync } from 'fflate'
import { drumFromZip, ownsAudioRef, readLimited, separateDrums } from './drumStem'

test('audio refs stay in the authenticated user storage prefix', () => {
  assert.ok(ownsAudioRef('u/project/clip', 'u'))
  for (const ref of ['other/project/clip', 'u/../clip', 'u/p/c/more', 'https://evil.test/x', 'u/p/a?token=x', null]) assert.equal(ownsAudioRef(ref, 'u'), false)
})
test('only one named drum MP3 is extracted from the provider ZIP', () => {
  const bytes = new Uint8Array([1, 2, 3])
  assert.deepEqual(drumFromZip(zipSync({ 'stems/drums.mp3': bytes, 'bass.mp3': new Uint8Array(10000) })), bytes)
  assert.throws(() => drumFromZip(zipSync({ 'bass.mp3': bytes })), /usable drum/)
  assert.throws(() => drumFromZip(zipSync({ 'drums.mp3': bytes, 'drum.mp3': bytes })), /usable drum/)
})
test('bounded response reader rejects oversized streamed bodies without trusting headers', async () => {
  await assert.rejects(readLimited(new Response(new Uint8Array(11)), 10), /too large/)
  assert.equal((await readLimited(new Response(new Uint8Array(10)), 10)).length, 10)
})
test('real provider adapter sends six-stem multipart request and propagates quota failures', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.match(String(url), /stem-separation\?output_format=mp3_44100_128/)
    assert.equal((init!.body as FormData).get('stem_variation_id'), 'six_stems_v1')
    assert.ok((init!.body as FormData).get('file') instanceof Blob)
    return new Response('', { status: 429 })
  })
  await assert.rejects(separateDrums(new Blob(['song']), 'test-key', new AbortController().signal), /credits/)
})
