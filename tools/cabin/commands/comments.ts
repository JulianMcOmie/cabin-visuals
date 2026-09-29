import path from 'path'
import type { Cabin } from '../lib/api'
import type { CommandGroup } from '../lib/command'
import { open, resolveTrack, timeCtx } from '../lib/common'
import { barBeat, parsePosition } from '../lib/time'
import { projectDir } from '../lib/project'
import { UsageError } from '../lib/args'
import {
  addComment, commentsVersion, deleteCommentImages, findComment, needsAttention, readComments, removeComment, replyTo,
  saveCommentImage, STATUSES, updateComments, type CommentStatus, type ReviewComment,
} from '../../../src/devtools/commentsCore'

// The review loop with the user: they pin comments in the editor (C at the
// playhead, or comment mode + click a track or the canvas); these commands read
// them with their context, answer, attach an after-still, and hand them back.

function where(p: Cabin, c: ReviewComment): string {
  const bpb = p.beatsPerBar
  const bar = Math.floor(c.beat / bpb)
  const section = p.sections.find((s) => bar >= s.from && bar < s.to)?.name
  const at = `${barBeat(c.beat, bpb)}${c.endBeat !== undefined ? `–${barBeat(c.endBeat, bpb)}` : ''} (b${+c.beat.toFixed(3)}, ${p.toSec(c.beat).toFixed(2)}s)`
  const target = c.trackName ? `${c.sceneName ?? '?'}/${c.trackName}${c.instrumentId ? ` [${c.instrumentId}]` : ''}` : c.sceneName ? `scene ${c.sceneName}` : c.screen ? `canvas @${c.screen.x.toFixed(2)},${c.screen.y.toFixed(2)}` : 'the whole frame'
  return `${at}${section ? ` · @${section}` : ''} · ${target}`
}

function nearbyNotes(p: Cabin, c: ReviewComment): string {
  if (!c.trackId) return ''
  for (const s of [...p.scenes(), p.main()]) {
    const t = s.find(c.trackId)
    if (!t) continue
    const lo = c.beat - 1, hi = (c.endBeat ?? c.beat) + 1
    const ns = t.notes(lo, hi)
    if (!ns.length) return `      notes nearby: none in b${lo.toFixed(1)}–${hi.toFixed(1)}`
    return `      notes nearby: ${ns.slice(0, 12).map((n) => `b${+n.beat.toFixed(2)} p${n.pitch} v${n.vel}${n.dur !== 0.25 ? ` ${+n.dur.toFixed(2)}b` : ''}`).join(' · ')}${ns.length > 12 ? ` … +${ns.length - 12}` : ''}`
  }
  return ''
}

function show(p: Cabin, c: ReviewComment, full: boolean): string {
  const lines = [`${c.id}  [${c.status}]  ${where(p, c)}`, `      ${c.author}: ${c.text}`]
  const thread = full ? c.thread : c.thread.slice(-3)
  if (!full && c.thread.length > 3) lines.push(`      … ${c.thread.length - 3} earlier replies`)
  for (const t of thread) lines.push(`      ${t.author}: ${t.text}${t.images?.length ? `  [${t.images.join(', ')}]` : ''}`)
  const notes = nearbyNotes(p, c)
  if (notes) lines.push(notes)
  if (c.still) lines.push(`      still: ${path.join(p.dir, c.still)}`)
  return lines.join('\n')
}

async function waitForAttention(p: Cabin, timeoutSec: number): Promise<ReviewComment[]> {
  const dir = projectDir(p.name)
  let version = await commentsVersion(dir)
  const seen = new Map((await readComments(dir)).comments.map((c) => [c.id, c.updatedAt]))
  const deadline = Date.now() + timeoutSec * 1000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000))
    const v = await commentsVersion(dir)
    if (v === version) continue
    version = v
    const fresh = (await readComments(dir)).comments.filter((c) => seen.get(c.id) !== c.updatedAt && needsAttention(c))
    for (const c of (await readComments(dir)).comments) seen.set(c.id, c.updatedAt)
    if (fresh.length) return fresh
  }
  return []
}

export const commentCommands: CommandGroup = {
  title: 'REVIEW COMMENTS',
  note: 'pinned by the user in the editor (C = at the playhead; comment mode + click a track or the canvas)',
  commands: [
    {
      name: 'comments', usage: '<name> [--all] [--wait] [--timeout 3600] [--json]',
      summary: 'comments that need me (open, or you replied); --wait blocks until one arrives',
      details: 'Run `cabin comments <name> --wait` in the background: it exits the moment a comment is added or reopened.',
      async run(a) {
        const all = a.flag('all'), wait = a.flag('wait'), json = a.flag('json'), timeout = a.num('timeout', 3600)
        const p = open(a.need('project name'))
        const doc = await readComments(projectDir(p.name))
        let list = all ? doc.comments : doc.comments.filter(needsAttention)
        if (wait && !list.length) {
          list = await waitForAttention(p, timeout)
          if (!list.length) { console.log(`(no comments within ${timeout}s)`); process.exitCode = 2; return }
        }
        if (json) { console.log(JSON.stringify(list, null, 1)); return }
        if (!list.length) { console.log(all ? '(no comments)' : `(nothing waiting - ${doc.comments.length} comment(s) in total; --all to see them)`); return }
        console.log(list.map((c) => show(p, c, false)).join('\n\n'))
      },
    },
    {
      name: 'comment', usage: '<name> <id> [--strip]', summary: 'one comment in full (+ a frame strip around it)',
      async run(a) {
        const strip = a.flag('strip')
        const p = open(a.need('project name'))
        const c = findComment(await readComments(projectDir(p.name)), a.need('comment id'))
        console.log(show(p, c, true))
        if (strip) {
          const { shot } = await import('../lib/render')
          const { Args } = await import('../lib/args')
          const lo = c.beat - p.beatsPerBar / 2, hi = (c.endBeat ?? c.beat) + p.beatsPerBar / 2
          const beats = Array.from({ length: 8 }, (_, i) => lo + ((hi - lo) * i) / 7)
          await shot(p, new Args(['--at', beats.map((b) => `b${b.toFixed(3)}`).join(','), '--sheet', '--w', '640', '--h', '360', '--out', path.join(p.dir, 'renders', 'comments', c.id)]))
        }
      },
    },
    {
      name: 'comment add', usage: '<name> --at <pos> [--to <pos>] [--track Scene/Track] "text"', summary: 'leave the user a note (a question, a heads-up)',
      async run(a) {
        const at = a.opt('at'), to = a.opt('to'), trackSpec = a.opt('track')
        if (!at) throw new UsageError('--at is required')
        const p = open(a.need('project name'))
        const text = a.rest.splice(0).join(' ')
        const ctx = timeCtx(p)
        const t = trackSpec ? resolveTrack(p, trackSpec) : undefined
        const c = await updateComments(projectDir(p.name), (doc) => {
          const made = addComment(doc, {
            author: 'claude', beat: parsePosition(at, ctx), endBeat: to ? parsePosition(to, ctx) : undefined, text,
            ...(t ? { trackId: t.id, trackName: t.name, sceneId: t.scene.id, sceneName: t.scene.name, instrumentId: t.instrument } : {}),
          })
          made.status = 'review'
          return made
        })
        console.log(`added ${c.id}`)
      },
    },
    {
      name: 'reply', usage: '<name> <id> "text" [--status review|working|resolved|wontfix|open] [--shot]',
      summary: 'answer a comment (default status: review); --shot attaches the frame as it looks now',
      async run(a) {
        const status = (a.opt('status') ?? 'review') as CommentStatus
        if (!STATUSES.includes(status)) throw new UsageError(`--status must be one of ${STATUSES.join(', ')}`)
        const withShot = a.flag('shot')
        const p = open(a.need('project name'))
        const id = a.need('comment id')
        const text = a.rest.splice(0).join(' ')
        if (!text) throw new UsageError('reply text is required')
        const dir = projectDir(p.name)
        const c = findComment(await readComments(dir), id)
        const images: string[] = []
        if (withShot) {
          const { call, ensureDaemon } = await import('../lib/client')
          await ensureDaemon()
          const res = await call<{ images: string[] }>('/shot', { project: p.name, beats: [c.beat], view: 'main', width: 960, height: 540 })
          images.push(await saveCommentImage(dir, `${c.id}-after-${c.thread.length + 1}.png`, res.images[0]))
        }
        await updateComments(dir, (doc) => replyTo(doc, c.id, { author: 'claude', text, images }, status))
        console.log(`replied to ${c.id} [${status}]${images.length ? ` with ${images.join(', ')}` : ''}`)
      },
    },
    {
      name: 'comment rm', usage: '<name> <id>', summary: 'delete a comment',
      async run(a) {
        const p = open(a.need('project name'))
        const id = a.need('comment id')
        const dir = projectDir(p.name)
        const images = await updateComments(dir, (doc) => removeComment(doc, id))
        await deleteCommentImages(dir, images)
        console.log(`removed ${id}${images.length ? ` (+ ${images.length} image${images.length > 1 ? 's' : ''})` : ''}`)
      },
    },
  ],
}
