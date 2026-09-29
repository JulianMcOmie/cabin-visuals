import { create } from 'zustand'
import type { CommentDoc, CommentNote, CommentStatus, NewComment, ReviewComment } from '../../devtools/commentsCore'

// Review comments in the editor (dev, `?file=` sessions): the client for
// app/api/dev/projects/[name]/comments. The `cabin` CLI reads the same file,
// answers, and hands comments back (src/devtools/commentsCore.ts has the model).
//
// Pinning a comment: C drops one at the playhead (on the selected track, if
// any); comment MODE (the chip in the scene tabs) turns clicks on a track lane
// or on the canvas into pins at that beat / on that object.

export type { ReviewComment, CommentStatus }

export interface ComposerTarget {
  beat: number
  endBeat?: number
  trackId?: string
  sceneId?: string
  /** 0..1 canvas coords for a canvas pin. */
  screen?: { x: number; y: number }
  /** Where to float the composer (client px). */
  x: number
  y: number
}

interface CommentsState {
  /** The project file this session is bound to (null = comments off). */
  file: string | null
  doc: CommentDoc | null
  version: string | null
  panelOpen: boolean
  /** Comment mode: clicks on lanes / the canvas pin comments. */
  mode: boolean
  focusId: string | null
  composer: ComposerTarget | null
  setFile(file: string | null): void
  setPanelOpen(open: boolean): void
  setMode(on: boolean): void
  focus(id: string | null): void
  openComposer(t: ComposerTarget): void
  closeComposer(): void
  refresh(): Promise<void>
  add(c: NewComment, still?: string): Promise<ReviewComment | null>
  reply(id: string, text: string, status?: CommentStatus): Promise<void>
  setStatus(id: string, status: CommentStatus): Promise<void>
  remove(id: string): Promise<void>
}

const base = (file: string) => `/api/dev/projects/${encodeURIComponent(file)}/comments`

async function post(file: string, body: unknown): Promise<{ version: string; result: unknown }> {
  const r = await fetch(base(file), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error ?? `comments: HTTP ${r.status}`)
  return j
}

export const useCommentsStore = create<CommentsState>((set, get) => ({
  file: null,
  doc: null,
  version: null,
  panelOpen: false,
  mode: false,
  focusId: null,
  composer: null,

  setFile: (file) => set({ file, doc: null, version: null }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setMode: (mode) => set({ mode, composer: mode ? get().composer : null }),
  focus: (focusId) => set({ focusId, panelOpen: focusId ? true : get().panelOpen }),
  openComposer: (composer) => set({ composer }),
  closeComposer: () => set({ composer: null }),

  refresh: async () => {
    const file = get().file
    if (!file) return
    const r = await fetch(`${base(file)}`, { cache: 'no-store' })
    if (!r.ok) return
    const { version, doc } = (await r.json()) as { version: string; doc: CommentDoc }
    set({ version, doc })
  },

  add: async (c, still) => {
    const file = get().file
    if (!file) return null
    const { result } = await post(file, { op: 'add', comment: c, still })
    await get().refresh()
    return result as ReviewComment
  },
  reply: async (id, text, status) => {
    const file = get().file
    if (!file) return
    await post(file, { op: 'reply', id, author: 'you', text, status })
    await get().refresh()
  },
  setStatus: async (id, status) => {
    const file = get().file
    if (!file) return
    await post(file, { op: 'status', id, status })
    await get().refresh()
  },
  remove: async (id) => {
    const file = get().file
    if (!file) return
    await post(file, { op: 'delete', id })
    await get().refresh()
  },
}))

/** Comments that still want attention from someone (not resolved/wontfix). */
export function isLive(c: ReviewComment) {
  return c.status !== 'resolved' && c.status !== 'wontfix'
}

export const STATUS_COLOR: Record<CommentStatus, string> = {
  open: '#f59e0b',
  working: '#38bdf8',
  review: '#a78bfa',
  resolved: '#34d399',
  wontfix: '#64748b',
}

export type { CommentNote }
