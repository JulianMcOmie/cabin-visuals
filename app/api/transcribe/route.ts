import { NextRequest, NextResponse } from 'next/server'

// Lyric transcription proxy. The client sends the SIGNED URL of an uploaded
// song (never the bytes - request bodies on Vercel cap out well under song
// size); this route fetches the audio itself and forwards it to OpenAI's
// Whisper API with word-level timestamps.
//
// Needs OPENAI_API_KEY in the server env. Without it the route answers 503
// with a human-readable message the dialog shows verbatim.

const apiKey = process.env.OPENAI_API_KEY

// Whisper caps uploads at 25 MB.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

// Transcribing a full song takes tens of seconds; don't let the platform's
// default function timeout kill it mid-request.
export const maxDuration = 60

export async function POST(request: NextRequest) {
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Transcription is not configured yet (missing OPENAI_API_KEY).' },
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
      return NextResponse.json(
        { error: 'The song is larger than the 25 MB transcription limit.' },
        { status: 413 },
      )
    }

    const form = new FormData()
    // Whisper sniffs the container from the file NAME - keep the original.
    form.append('file', blob, fileName)
    form.append('model', 'whisper-1')
    form.append('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'word')

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error('Whisper transcription failed:', res.status, detail)
      return NextResponse.json({ error: `Transcription failed (${res.status})` }, { status: 502 })
    }

    const data = (await res.json()) as {
      text?: string
      words?: Array<{ word?: string; start?: number; end?: number }>
    }
    const words = (data.words ?? [])
      .filter((w) => typeof w.word === 'string' && typeof w.start === 'number' && typeof w.end === 'number')
      .map((w) => ({ word: w.word!.trim(), start: w.start!, end: w.end! }))
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
