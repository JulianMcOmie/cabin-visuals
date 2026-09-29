import { promises as fs } from 'fs'
import { NextResponse, type NextRequest } from 'next/server'
import { DEV_FILES_ENABLED, mimeFor, projectMediaPath } from '@/devtools/projectFiles'

// Dev-only: media inside an on-disk project folder (audio, video, photos), so a
// document can reference `/api/dev/projects/<name>/files/audio/song.m4a` as an
// ordinary public-path clip ref (core/audio/audioSource.ts fetches '/...' refs
// as URLs). Supports byte ranges for media elements.

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ name: string; path: string[] }> }

export async function GET(request: NextRequest, { params }: Params) {
  if (!DEV_FILES_ENABLED) return new NextResponse(null, { status: 404 })
  const { name, path: parts } = await params
  const file = projectMediaPath(name, parts)
  if (!file) return new NextResponse(null, { status: 400 })
  let size: number
  try {
    size = (await fs.stat(file)).size
  } catch {
    return new NextResponse(null, { status: 404 })
  }
  const type = mimeFor(file)
  const range = request.headers.get('range')
  const m = range && /bytes=(\d*)-(\d*)/.exec(range)
  if (m) {
    const start = m[1] ? Number(m[1]) : 0
    const end = m[2] ? Math.min(size - 1, Number(m[2])) : size - 1
    const handle = await fs.open(file, 'r')
    const buf = Buffer.alloc(end - start + 1)
    await handle.read(buf, 0, buf.length, start)
    await handle.close()
    return new NextResponse(buf, {
      status: 206,
      headers: { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': String(buf.length) },
    })
  }
  const data = await fs.readFile(file)
  return new NextResponse(data, { headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } })
}
