import { getSupabase } from './supabase'
import type { ProjectDocument } from './types'
import { emptyDocument } from './types'
import { upgradeDocument } from './upgrade'

// The one door for project CRUD - the only file that names the `projects`
// table for the document. Every function runs under RLS as the signed-in user,
// so a row can only ever be the caller's own.

/** One block in a project-card thumbnail, as percentages of the project width. */
export interface ProjectPreviewBlock {
  left: number
  width: number
}

/** One track row in the thumbnail: the track's real color + its real blocks. */
export interface ProjectPreviewRow {
  color: string
  blocks: ProjectPreviewBlock[]
}

/** A real mini-timeline of the project (derived from its document, not a hash),
 *  so a card shows the actual arrangement. Empty rows array = nothing drawn yet. */
export interface ProjectPreview {
  /** A real captured frame of the project (small JPEG data URL), when the
   *  editor has saved one - the card shows this over the row sketch. */
  image?: string
  /** Project timeline length in seconds. */
  durationSeconds: number
  rows: ProjectPreviewRow[]
}

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: string
  /** The row's concurrency counter (see `save`). */
  rev: number
  preview?: ProjectPreview
}

/** A save was refused because the row moved on since this tab loaded it -
 *  another tab or device saved in between. Distinct from every other failure
 *  because it must NOT be retried: retrying is exactly the overwrite the rev
 *  check exists to prevent. Callers stop autosaving and ask the user. */
export class ProjectConflictError extends Error {
  constructor(readonly projectId: string) {
    super(`Project ${projectId} was changed somewhere else`)
    this.name = 'ProjectConflictError'
  }
}

const MAX_PREVIEW_ROWS = 6
const MAX_PREVIEW_BLOCKS = 32

/** Collapse a stored document into the card thumbnail: each root track becomes a
 *  row of its real blocks (positions as a percentage of the project length),
 *  drawn in the track's own color. Audio blocks convert their trimmed seconds to
 *  bars the same way the editor sizes them. Tolerant of partial/legacy shapes -
 *  a bad field just yields a thinner preview, never a throw. */
function documentToPreview(doc: unknown): ProjectPreview {
  const d = (doc ?? {}) as {
    tracks?: Record<string, {
      type?: string
      color?: string
      blocks?: { startBar?: number; durationBars?: number }[]
      audioBlocks?: { startBar?: number; trimStart?: number; trimEnd?: number }[]
    }>
    rootTrackIds?: string[]
    scenes?: Record<string, {
      isMain?: boolean
      tracks?: Record<string, {
        type?: string
        color?: string
        blocks?: { startBar?: number; durationBars?: number }[]
        audioBlocks?: { startBar?: number; trimStart?: number; trimEnd?: number }[]
      }>
      rootTrackIds?: string[]
    }>
    sceneOrder?: string[]
    audioTracks?: Record<string, {
      type?: string
      color?: string
      blocks?: { startBar?: number; durationBars?: number }[]
      audioBlocks?: { startBar?: number; trimStart?: number; trimEnd?: number }[]
    }>
    audioRootTrackIds?: string[]
    totalBars?: number
    beatsPerBar?: number
    bpm?: number
  }
  const firstScene = d.sceneOrder?.map((id) => d.scenes?.[id]).find((scene) => scene && !scene.isMain)
  const tracks = firstScene
    ? { ...(d.audioTracks ?? {}), ...(firstScene.tracks ?? {}) }
    : d.tracks ?? {}
  const rootIds = firstScene
    ? [...(d.audioRootTrackIds ?? []), ...(firstScene.rootTrackIds ?? [])]
    : Array.isArray(d.rootTrackIds) ? d.rootTrackIds : []
  const totalBars = Math.max(1, d.totalBars ?? 1)
  const beatsPerBar = d.beatsPerBar ?? 4
  const bpm = d.bpm ?? 120
  const durationSeconds = Math.round((totalBars * beatsPerBar * 60) / Math.max(1, bpm))
  const rows: ProjectPreviewRow[] = []
  for (const id of rootIds) {
    if (rows.length >= MAX_PREVIEW_ROWS) break
    const t = tracks[id]
    if (!t) continue
    const isAudio = t.type === 'audio'
    const raw = isAudio ? t.audioBlocks ?? [] : t.blocks ?? []
    if (raw.length === 0) continue
    const blocks: ProjectPreviewBlock[] = []
    for (const b of raw) {
      if (blocks.length >= MAX_PREVIEW_BLOCKS) break
      const startBar = b.startBar ?? 0
      const durationBars = isAudio
        ? (Math.max(0, ((b as { trimEnd?: number }).trimEnd ?? 0) - ((b as { trimStart?: number }).trimStart ?? 0)) * bpm) / 60 / beatsPerBar
        : (b as { durationBars?: number }).durationBars ?? 1
      const left = Math.max(0, Math.min(100, (startBar / totalBars) * 100))
      const width = Math.max(1.5, Math.min(100 - left, (durationBars / totalBars) * 100))
      blocks.push({ left, width })
    }
    if (blocks.length > 0) rows.push({ color: t.color ?? '#3a7694', blocks })
  }
  return { durationSeconds, rows }
}

/** List the caller's projects, newest-edited first. Pulls each document so the
 *  card thumbnail reflects the real arrangement (see documentToPreview) - a full
 *  blob per project, fine at the current per-account project counts; a projected
 *  preview column is the scale fix if lists ever get large. */
export async function list(): Promise<ProjectSummary[]> {
  const { data, error } = await getSupabase()
    .from('projects')
    .select('id, name, updated_at, rev, data')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data.map((r) => ({
    id: r.id,
    name: r.name,
    updatedAt: r.updated_at,
    rev: r.rev,
    preview: {
      ...documentToPreview(r.data),
      image: typeof (r.data as { thumbnail?: unknown })?.thumbnail === 'string'
        ? (r.data as { thumbnail: string }).thumbnail
        : undefined,
    },
  }))
}

/** Load one project's document, upgraded to the current shape. The `rev` comes
 *  back with it: whoever holds the document must hand it to `save` to prove the
 *  row hasn't moved on underneath them. */
export async function load(id: string): Promise<{ name: string; document: ProjectDocument; rev: number }> {
  const { data, error } = await getSupabase()
    .from('projects')
    .select('name, data, rev')
    .eq('id', id)
    .single()
  if (error) throw error
  return { name: data.name, document: upgradeDocument(data.data), rev: data.rev }
}

/**
 * Mirror the document to its row (blob + projected columns, one write),
 * but ONLY if the row is still at `expectedRev` - the rev this caller loaded.
 * Returns the new rev to carry into the next save.
 *
 * This is the fix for the two-tab data-loss bug. A save used to be an
 * unconditional "make the row look like my copy", so a tab sitting on an hour
 * old document would happily flatten an hour of newer work from another tab.
 * The `.eq('rev', …)` makes the check and the write one atomic statement in
 * Postgres, so a stale tab is refused rather than served last-write-wins.
 */
export async function save(id: string, doc: ProjectDocument, expectedRev: number): Promise<number> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('projects')
    .update({
      data: doc,
      schema_version: doc.schemaVersion,
      rev: expectedRev + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('rev', expectedRev)
    .select('rev')
  if (error) throw error
  if (data.length) return data[0].rev

  // Zero rows means one of two very different things, and the caller must tell
  // them apart: a stale rev (recoverable - ask the user) or a missing/non-owned
  // row that RLS filtered out with no error (a real failure). Re-read to see
  // which; the row either exists for us or it doesn't.
  const { data: current, error: probeError } = await supabase
    .from('projects')
    .select('rev')
    .eq('id', id)
    .maybeSingle()
  if (probeError) throw probeError
  if (!current) throw new Error(`Project ${id} not found (or not yours)`)
  throw new ProjectConflictError(id)
}

/** Create a project - empty by default, or seeded from a document (templates). */
export async function create(name: string, document?: ProjectDocument): Promise<ProjectSummary> {
  const supabase = getSupabase()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError) throw authError
  if (!auth.user) throw new Error('Not signed in')
  const doc = document ?? emptyDocument()
  const { data, error } = await supabase
    .from('projects')
    .insert({
      name,
      user_id: auth.user.id,
      data: doc,
      schema_version: doc.schemaVersion,
    })
    .select('id, name, updated_at, rev')
    .single()
  if (error) throw error
  return { id: data.id, name: data.name, updatedAt: data.updated_at, rev: data.rev }
}

/** Rename a project. The name is a spine column, not part of the document, so
 *  autosave never touches it - this is the one write path for it.
 *
 *  Deliberately does NOT bump `rev`: rev tracks the document, and a rename in
 *  one tab shouldn't strand every other tab on a stale rev over a field they
 *  don't even hold. (The revision trigger skips it for the same reason - the
 *  document is unchanged, so there's nothing to snapshot.) */
export async function rename(id: string, name: string): Promise<void> {
  const { data, error } = await getSupabase()
    .from('projects')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data.length) throw new Error(`Project ${id} not found (or not yours)`)
}

/**
 * Duplicate a project into a new row of the caller's own.
 *
 * A SHALLOW copy: the document is cloned verbatim, so both projects reference
 * the same clip paths in Storage rather than duplicating bytes (a deep copy
 * would re-upload every megabyte for what is usually a throwaway experiment).
 * That sharing is only safe because releasing a clip no longer deletes its
 * bucket bytes - see core/audio/audioSource.ts removeAudio. Don't reintroduce
 * inline byte deletion without making this a deep copy first.
 *
 * The thumbnail is dropped: it's a stale frame of the source project, and the
 * copy will capture its own on first save.
 */
export async function duplicate(id: string): Promise<ProjectSummary> {
  const { name, document } = await load(id)
  const { thumbnail: _thumbnail, ...doc } = document
  void _thumbnail
  return create(`${name} copy`, doc)
}

/** Delete a project row (the document goes with it). */
export async function remove(id: string): Promise<void> {
  const { error } = await getSupabase().from('projects').delete().eq('id', id)
  if (error) throw error
}
