import { NextRequest, NextResponse } from 'next/server'

// Lyric transcription proxy. The client sends the SIGNED URL of an uploaded
// song (never the bytes - request bodies on Vercel cap out well under song
// size); this route fetches the audio itself and forwards it to ElevenLabs'
// Scribe speech-to-text with word-level timestamps.
//
// EXPERIMENT (uncommitted): this used to call OpenAI Whisper - `git checkout
// -- app/api/transcribe/route.ts` restores that. Scribe is being trialed for
// better word timing on sung vocals.
//
// Needs ELEVENLABS_API_KEY in the server env. Without it the route answers
// 503 with a human-readable message the dialog shows verbatim.

const apiKey = process.env.ELEVENLABS_API_KEY

// Generous runaway guard; Scribe accepts far larger files than songs.
const MAX_AUDIO_BYTES = 100 * 1024 * 1024

// Transcribing a full song takes tens of seconds; don't let the platform's
// default function timeout kill it mid-request.
export const maxDuration = 60

export async function POST(request: NextRequest) {
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Transcription is not configured yet (missing ELEVENLABS_API_KEY).' },
      { status: 503 },
    )
  }

  try {
    const body = (await request.json()) as { url?: unknown; fileName?: unknown }
    if (typeof body.url !== 'string') {
      return NextResponse.json({ error: 'Missing audio url' }, { status: 400 })
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
      return NextResponse.json({ error: 'The song is too large to transcribe.' }, { status: 413 })
    }

    const form = new FormData()
    form.append('file', blob, fileName)
    form.append('model_id', 'scribe_v2')
    form.append('timestamps_granularity', 'word')

    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error('Scribe transcription failed:', res.status, detail)
      return NextResponse.json({ error: `Transcription failed (${res.status})` }, { status: 502 })
    }

    const data = (await res.json()) as {
      text?: string
      words?: Array<{ text?: string; start?: number; end?: number; type?: string }>
    }
    // Scribe's word list interleaves 'spacing' and 'audio_event' entries -
    // only actual words become notes.
    const words = (data.words ?? [])
      .filter((w) => (w.type ?? 'word') === 'word')
      .filter((w) => typeof w.text === 'string' && typeof w.start === 'number' && typeof w.end === 'number')
      .map((w) => ({ word: w.text!.trim(), start: w.start!, end: w.end! }))
      .filter((w) => w.word.length > 0)

    return NextResponse.json({ text: data.text ?? '', words })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    console.error('Transcription route error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
