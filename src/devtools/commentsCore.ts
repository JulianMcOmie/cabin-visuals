import { promises as fs } from 'fs'
import path from 'path'

// Review comments pinned to a time (and optionally an instrument) in a project:
// `projects/<name>/comments.json` + stills in `projects/<name>/comments/`.
// The editor writes them through app/api/dev/projects/[name]/comments; the
// `cabin` CLI reads, answers and resolves them directly. Both go through THIS
// module (plain node - no Next imports) and a lock file, so neither clobbers
// the other.
//
// Lifecycle: open (you asked) → working (Claude is on it) → review (Claude
// replied with a change - look) → resolved, or back to open if it isn't right.

export type CommentStatus = 'open' | 'working' | 'review' | 'resolved' | 'wontfix'
export const STATUSES: CommentStatus[] = ['open', 'working', 'review', 'resolved', 'wontfix']

export interface CommentNote { beat: number; pitch: number; dur: number; vel: number }

export interface ThreadEntry {
  author: string
  text: string
  at: string
  /** Project-relative image paths (comments/<id>-...png). */
  images?: string[]
}

export interface ReviewComment {
  /** 'c1', 'c2' … - short so it's easy to type. */
  id: string
  createdAt: string
  updatedAt: string
  author: string
  /** Absolute beat the comment is pinned to; `endBeat` makes it a range. */
  beat: number
  endBeat?: number
  sceneId?: string
  sceneName?: string
  trackId?: string
  trackName?: string
  instrumentId?: string
  /** Where on the canvas it was pinned (0..1, origin top-left), for canvas comments. */
  screen?: { x: number; y: number }
  text: string
  status: CommentStatus
  thread: ThreadEntry[]
  /** The frame as it looked when the comment was made. */
  still?: string
  /** What was around the pin when it was made (notes on the target track near the beat). */
  notes?: CommentNote[]
}

export interface CommentDoc {
  version: 1
  nextId: number
  comments: ReviewComment[]
}

export const emptyComments = (): CommentDoc => ({ version: 1, nextId: 1, comments: [] })

export function commentsFile(projectDir: string) { return path.join(projectDir, 'comments.json') }
export function commentsDir(projectDir: string) { return path.join(projectDir, 'comments') }

export async function readComments(projectDir: string): Promise<CommentDoc> {
  try {
    const doc = JSON.parse(await fs.readFile(commentsFile(projectDir), 'utf8')) as CommentDoc
    if (!Array.isArray(doc.comments)) return emptyComments()
    return doc
  } catch {
    return emptyComments()
  }
}

export async function commentsVersion(projectDir: string): Promise<string> {
  try {
    const st = await fs.stat(commentsFile(projectDir))
    return `${Math.round(st.mtimeMs)}-${st.size}`
  } catch {
    return 'none'
  }
}

/** Run a read-modify-write under a lock file (cross-process: editor route + CLI). */
export async function updateComments<T>(projectDir: string, fn: (doc: CommentDoc) => T | Promise<T>): Promise<T> {
  const file = commentsFile(projectDir)
  const lock = `${file}.lock`
  await fs.mkdir(projectDir, { recursive: true })
  const deadline = Date.now() + 5000
  for (;;) {
    try {
      const h = await fs.open(lock, 'wx')
      await h.close()
      break
    } catch {
      // a crashed writer's lock goes stale after 3 s
      try {
        const st = await fs.stat(lock)
        if (Date.now() - st.mtimeMs > 3000) { await fs.rm(lock, { force: true }); continue }
      } catch { continue }
      if (Date.now() > deadline) throw new Error(`comments are locked (${lock})`)
      await new Promise((r) => setTimeout(r, 25))
    }
  }
  try {
    const doc = await readComments(projectDir)
    const result = await fn(doc)
    const tmp = `${file}.${process.pid}.tmp`
    await fs.writeFile(tmp, JSON.stringify(doc, null, 1))
    await fs.rename(tmp, file)
    return result
  } finally {
    await fs.rm(lock, { force: true })
  }
}

/** Save a PNG (data URL or bytes) under comments/ and return its project-relative path. */
export async function saveCommentImage(projectDir: string, name: string, png: string | Buffer): Promise<string> {
  const bytes = typeof png === 'string' ? Buffer.from(png.replace(/^data:image\/\w+;base64,/, ''), 'base64') : png
  const rel = path.join('comments', name)
  await fs.mkdir(commentsDir(projectDir), { recursive: true })
  await fs.writeFile(path.join(projectDir, rel), bytes)
  return rel.split(path.sep).join('/')
}

const now = () => new Date().toISOString()

export interface NewComment {
  author?: string
  beat: number
  endBeat?: number
  sceneId?: string
  sceneName?: string
  trackId?: string
  trackName?: string
  instrumentId?: string
  screen?: { x: number; y: number }
  text: string
  notes?: CommentNote[]
}

export function addComment(doc: CommentDoc, c: NewComment): ReviewComment {
  if (!c.text?.trim()) throw new Error('a comment needs text')
  if (!Number.isFinite(c.beat)) throw new Error('a comment needs a beat')
  const t = now()
  const comment: ReviewComment = {
    id: `c${doc.nextId++}`,
    createdAt: t,
    updatedAt: t,
    author: c.author ?? 'you',
    beat: c.beat,
    ...(c.endBeat !== undefined && c.endBeat > c.beat ? { endBeat: c.endBeat } : {}),
    ...(c.sceneId ? { sceneId: c.sceneId } : {}),
    ...(c.sceneName ? { sceneName: c.sceneName } : {}),
    ...(c.trackId ? { trackId: c.trackId } : {}),
    ...(c.trackName ? { trackName: c.trackName } : {}),
    ...(c.instrumentId ? { instrumentId: c.instrumentId } : {}),
    ...(c.screen ? { screen: c.screen } : {}),
    ...(c.notes?.length ? { notes: c.notes } : {}),
    text: c.text.trim(),
    status: 'open',
    thread: [],
  }
  doc.comments.push(comment)
  return comment
}

export function findComment(doc: CommentDoc, id: string): ReviewComment {
  const c = doc.comments.find((x) => x.id === id || x.id === `c${id}`)
  if (!c) throw new Error(`no comment "${id}" (have: ${doc.comments.map((x) => x.id).join(', ') || 'none'})`)
  return c
}

export function replyTo(doc: CommentDoc, id: string, entry: { author: string; text: string; images?: string[] }, status?: CommentStatus): ReviewComment {
  const c = findComment(doc, id)
  c.thread.push({ author: entry.author, text: entry.text.trim(), at: now(), ...(entry.images?.length ? { images: entry.images } : {}) })
  if (status) c.status = status
  // A reply from you on something Claude handed back re-opens it.
  else if (entry.author !== 'claude' && (c.status === 'review' || c.status === 'resolved')) c.status = 'open'
  c.updatedAt = now()
  return c
}

export function setStatus(doc: CommentDoc, id: string, status: CommentStatus): ReviewComment {
  if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`)
  const c = findComment(doc, id)
  c.status = status
  c.updatedAt = now()
  return c
}

/** Drops the comment; returns its images (still + reply shots) for `deleteCommentImages`. */
export function removeComment(doc: CommentDoc, id: string): string[] {
  const c = findComment(doc, id)
  doc.comments = doc.comments.filter((x) => x !== c)
  return [...(c.still ? [c.still] : []), ...c.thread.flatMap((e) => e.images ?? [])]
}

/** Deletes project-relative image paths - only files inside comments/. */
export async function deleteCommentImages(projectDir: string, rels: string[]) {
  const root = commentsDir(projectDir) + path.sep
  for (const rel of rels) {
    const abs = path.resolve(projectDir, rel)
    if (abs.startsWith(root)) await fs.rm(abs, { force: true })
  }
}

/** Comments that need Claude: open, or with your reply newer than Claude's last word. */
export function needsAttention(c: ReviewComment): boolean {
  if (c.status === 'open' || c.status === 'working') return true
  const last = c.thread[c.thread.length - 1]
  return !!last && last.author !== 'claude' && c.status !== 'resolved' && c.status !== 'wontfix'
}
