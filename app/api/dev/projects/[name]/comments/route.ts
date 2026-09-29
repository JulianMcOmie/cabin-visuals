import { NextResponse, type NextRequest } from 'next/server'
import { DEV_FILES_ENABLED, projectDir } from '@/devtools/projectFiles'
import {
  addComment, commentsVersion, deleteCommentImages, readComments, removeComment, replyTo, saveCommentImage, setStatus, updateComments,
  type CommentStatus, type NewComment,
} from '@/devtools/commentsCore'

// Dev-only: review comments for one on-disk project (src/devtools/commentsCore.ts).
//   GET  ?versionOnly=1 → { version }          (the editor polls this)
//   GET                 → { version, doc }
//   POST { op: 'add', comment, still? }        still = PNG data URL of the frame
//   POST { op: 'reply', id, author, text, status? }
//   POST { op: 'status', id, status }
//   POST { op: 'delete', id }

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ name: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  if (!DEV_FILES_ENABLED) return new NextResponse(null, { status: 404 })
  const dir = projectDir((await params).name)
  if (!dir) return NextResponse.json({ error: 'bad project name' }, { status: 400 })
  const version = await commentsVersion(dir)
  if (request.nextUrl.searchParams.get('versionOnly')) return NextResponse.json({ version })
  return NextResponse.json({ version, doc: await readComments(dir) })
}

type Body =
  | { op: 'add'; comment: NewComment; still?: string }
  | { op: 'reply'; id: string; author?: string; text: string; status?: CommentStatus }
  | { op: 'status'; id: string; status: CommentStatus }
  | { op: 'delete'; id: string }

export async function POST(request: NextRequest, { params }: Params) {
  if (!DEV_FILES_ENABLED) return new NextResponse(null, { status: 404 })
  const dir = projectDir((await params).name)
  if (!dir) return NextResponse.json({ error: 'bad project name' }, { status: 400 })
  const body = (await request.json()) as Body
  try {
    const result = await updateComments(dir, async (doc) => {
      switch (body.op) {
        case 'add': {
          const c = addComment(doc, { ...body.comment, author: body.comment.author ?? 'you' })
          if (body.still) c.still = await saveCommentImage(dir, `${c.id}-still.png`, body.still)
          return c
        }
        case 'reply': return replyTo(doc, body.id, { author: body.author ?? 'you', text: body.text }, body.status)
        case 'status': return setStatus(doc, body.id, body.status)
        case 'delete': await deleteCommentImages(dir, removeComment(doc, body.id)); return { ok: true }
        default: throw new Error(`unknown op ${(body as { op?: string }).op}`)
      }
    })
    return NextResponse.json({ version: await commentsVersion(dir), result })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
