import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { MAX_SONG_BYTES, ownsAudioRef, readLimited, separateDrums } from '@/server/drumStem'

export const runtime = 'nodejs'
export const maxDuration = 300
// Coalesce simultaneous clicks on this server instance. The private storage
// cache survives server restarts; only successful stems are written there.
const pending = new Map<string, Promise<void>>()

export async function POST(request: NextRequest) {
  try {
    const client = await createClient()
    const { data: { user } } = await client.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Sign in and save the song before extracting drums.' }, { status: 401 })
    const { clipRef } = await request.json()
    if (!ownsAudioRef(clipRef, user.id)) return NextResponse.json({ error: 'Invalid song reference.' }, { status: 400 })
    const bucket = client.storage.from('project-audio')
    const cacheRef = `${clipRef}-drums-six-v1.mp3`
    const cached = await bucket.createSignedUrl(cacheRef, 3600)
    if (cached.data?.signedUrl) return NextResponse.json({ url: cached.data.signedUrl }, { headers: { 'Cache-Control': 'no-store' } })
    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'Drum separation is not configured yet (missing ELEVENLABS_API_KEY).' }, { status: 503 })
    let job = pending.get(clipRef)
    if (!job) {
      if (pending.size >= 2) return NextResponse.json({ error: 'Drum separation is busy. Try again shortly.' }, { status: 429 })
      job = (async () => {
        const source = await bucket.createSignedUrl(clipRef, 300)
        if (!source.data?.signedUrl) throw new Error('The song upload is not available. Save the project and try again.')
        const signal = AbortSignal.timeout(270_000)
        const response = await fetch(source.data.signedUrl, { signal, redirect: 'error' })
        if (!response.ok) throw new Error('The uploaded song could not be read.')
        const bytes = await readLimited(response, MAX_SONG_BYTES)
        const stem = await separateDrums(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: response.headers.get('content-type') ?? 'application/octet-stream' }), apiKey, signal)
        const saved = await bucket.upload(cacheRef, stem, { contentType: 'audio/mpeg', upsert: true })
        if (saved.error) throw new Error('The drum stem could not be saved. Please try again.')
      })()
      pending.set(clipRef, job)
    }
    try { await job } finally { if (pending.get(clipRef) === job) pending.delete(clipRef) }
    const result = await bucket.createSignedUrl(cacheRef, 3600)
    if (!result.data?.signedUrl) throw new Error('The drum stem could not be opened.')
    return NextResponse.json({ url: result.data.signedUrl }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : 502
    const message = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      ? 'Drum separation timed out. Please try again later.'
      : error instanceof SyntaxError ? 'Invalid request body.' : error instanceof Error ? error.message : 'Drum separation failed.'
    return NextResponse.json({ error: message }, { status })
  }
}
