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
  rows: ProjectPreviewRow[]
}

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: string
  preview?: ProjectPreview
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
    if (blocks.length > 0) rows.push({ color: t.color ?? '#35a7e6', blocks })
  }
  return { rows }
}

/** List the caller's projects, newest-edited first. Pulls each document so the
 *  card thumbnail reflects the real arrangement (see documentToPreview) - a full
 *  blob per project, fine at the current per-account project counts; a projected
 *  preview column is the scale fix if lists ever get large. */
export async function list(): Promise<ProjectSummary[]> {
  const { data, error } = await getSupabase()
    .from('projects')
    .select('id, name, updated_at, data')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data.map((r) => ({
    id: r.id,
    name: r.name,
    updatedAt: r.updated_at,
    preview: documentToPreview(r.data),
  }))
}

/** Load one project's document, upgraded to the current shape. */
export async function load(id: string): Promise<{ name: string; document: ProjectDocument }> {
  const { data, error } = await getSupabase()
    .from('projects')
    .select('name, data')
    .eq('id', id)
    .single()
  if (error) throw error
  return { name: data.name, document: upgradeDocument(data.data) }
}

/** Mirror the document to its row (blob + projected columns, one write). */
export async function save(id: string, doc: ProjectDocument): Promise<void> {
  const { data, error } = await getSupabase()
    .from('projects')
    .update({
      data: doc,
      schema_version: doc.schemaVersion,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('id')
  if (error) throw error
  // RLS filters a non-owned/missing row to zero rows with no error - surface
  // that as a failure instead of silently dropping the save.
  if (!data.length) throw new Error(`Project ${id} not found (or not yours)`)
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
    .select('id, name, updated_at')
    .single()
  if (error) throw error
  return { id: data.id, name: data.name, updatedAt: data.updated_at }
}

/** Rename a project. The name is a spine column, not part of the document, so
 *  autosave never touches it - this is the one write path for it. */
export async function rename(id: string, name: string): Promise<void> {
  const { data, error } = await getSupabase()
    .from('projects')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data.length) throw new Error(`Project ${id} not found (or not yours)`)
}

/** Delete a project row (the document goes with it). */
export async function remove(id: string): Promise<void> {
  const { error } = await getSupabase().from('projects').delete().eq('id', id)
  if (error) throw error
}
