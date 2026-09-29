import { promises as fs } from 'fs'
import { NextResponse, type NextRequest } from 'next/server'
import { DEV_FILES_ENABLED, fileVersion, projectFile, writeAtomic } from '@/devtools/projectFiles'

// Dev-only: one on-disk project document.
//   GET  ?versionOnly=1 → { version }            (the editor polls this)
//   GET                 → { version, document }
//   PUT  { document, baseVersion } → { version } | 409 { version } when the file
//        moved since baseVersion (someone else - the CLI - wrote it; the editor
//        then reloads instead of clobbering).

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ name: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  if (!DEV_FILES_ENABLED) return new NextResponse(null, { status: 404 })
  const { name } = await params
  const file = projectFile(name)
  if (!file) return NextResponse.json({ error: 'bad project name' }, { status: 400 })
  const version = await fileVersion(file)
  if (!version) return NextResponse.json({ error: `no project "${name}" (expected ${file})` }, { status: 404 })
  if (request.nextUrl.searchParams.get('versionOnly')) return NextResponse.json({ version })
  const text = await fs.readFile(file, 'utf8')
  try {
    return NextResponse.json({ version, document: JSON.parse(text) })
  } catch (e) {
    return NextResponse.json({ error: `project.json is not valid JSON: ${(e as Error).message}` }, { status: 422 })
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  if (!DEV_FILES_ENABLED) return new NextResponse(null, { status: 404 })
  const { name } = await params
  const file = projectFile(name)
  if (!file) return NextResponse.json({ error: 'bad project name' }, { status: 400 })
  const body = (await request.json()) as { document?: unknown; baseVersion?: string | null }
  if (!body.document || typeof body.document !== 'object') return NextResponse.json({ error: 'missing document' }, { status: 400 })
  const current = await fileVersion(file)
  if (current && body.baseVersion && current !== body.baseVersion) {
    return NextResponse.json({ version: current, conflict: true }, { status: 409 })
  }
  await writeAtomic(file, JSON.stringify(body.document, null, 1) + '\n')
  return NextResponse.json({ version: await fileVersion(file) })
}
