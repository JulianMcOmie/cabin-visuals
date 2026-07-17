import { NextRequest, NextResponse } from 'next/server'

// Forced alignment for lyrics: the client sends the uploaded song's SIGNED
// URL plus the lyric text; this route fetches the audio itself and forwards
// both to ElevenLabs' Forced Alignment API, which returns word-level
// timestamps for exactly the supplied words. Unlike transcription, the text
// is known - all the model does is time it, which is what makes the onsets
// tight enough for beat-synced lyric videos.
//
// Needs ELEVENLABS_API_KEY in the server env. Without it the route answers
// 503 with a human-readable message the dialog shows verbatim.

const apiKey = process.env.ELEVENLABS_API_KEY

// Generous runaway guard; ElevenLabs accepts far larger files than songs.
const MAX_AUDIO_BYTES = 100 * 1024 * 1024

// Aligning a full song takes tens of seconds.
export const maxDuration = 60

export async function POST(request: NextRequest) {
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Lyric alignment is not configured yet (missing ELEVENLABS_API_KEY).' },
      { status: 503 },
    )
  }

  try {
    const body = (await request.json()) as { url?: unknown; text?: unknown; fileName?: unknown }
    if (typeof body.url !== 'string') {
      return NextResponse.json({ error: 'Missing audio url' }, { status: 400 })
    }
    if (typeof body.text !== 'string' || body.text.trim().length === 0) {
      return NextResponse.json({ error: 'Missing lyric text' }, { status: 400 })
    }
    const fileName = typeof body.fileName === 'string' && body.fileName ? body.fileName : 'audio.mp3'

    // Only fetch from our own Supabase storage - this route must not be a
    // generic fetch-anything proxy.
    const supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host
    let target: URL
    try {
      target = new URL(body.url)
    } catch {
      return NextResponse.json({ error: 'Invalid audio url' }, { status: 400 })
    }
    if (target.host !== supabaseHost) {
      return NextResponse.json({ error: 'Audio url not allowed' }, { status: 400 })
    }

    const audio = await fetch(target)
    if (!audio.ok) {
      return NextResponse.json({ error: `Could not fetch the audio (${audio.status})` }, { status: 502 })
    }
    const blob = await audio.blob()
    if (blob.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: 'The song is too large to align.' }, { status: 413 })
    }

    const form = new FormData()
    form.append('file', blob, fileName)
    form.append('text', body.text)

    const res = await fetch('https://api.elevenlabs.io/v1/forced-alignment', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error('Forced alignment failed:', res.status, detail)
      return NextResponse.json({ error: `Alignment failed (${res.status})` }, { status: 502 })
    }

    const data = (await res.json()) as {
      words?: Array<{ text?: string; word?: string; start?: number; end?: number }>
    }
    const words = (data.words ?? [])
      .filter((w) => typeof w.start === 'number' && typeof w.end === 'number')
      .map((w) => ({ word: (w.text ?? w.word ?? '').trim(), start: w.start!, end: w.end! }))
      .filter((w) => w.word.length > 0)

    if (words.length === 0) {
      return NextResponse.json({ error: 'The aligner returned no timed words.' }, { status: 502 })
    }
    return NextResponse.json({ words })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    console.error('Alignment route error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
