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
  /** Empty from `list()` today: the sketch can only be derived from the whole
   *  document, and pulling that per card is what made this page slow (see
   *  `list`). The card falls back to its empty state. Kept in the shape - and
   *  still rendered when non-empty - so restoring it is a write-side change
   *  only, once the sketch has a projected column of its own. */
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

/** Project length in seconds from the document's top-level tempo scalars.
 *  Tolerant of absent/legacy fields - a missing one falls back to the value a
 *  fresh project starts at, so an old blob yields a plausible number, never NaN. */
function durationSecondsOf(totalBars: unknown, beatsPerBar: unknown, bpm: unknown): number {
  // Accepts a numeric string as well as a number: `data->key` hands back a JSON
  // number, `data->>key` the same value as text, and the difference between
  // those two arrows is one character in a select string. Coercing here means
  // getting it wrong shows a wrong-typed value rather than silently falling
  // back to a fresh project's tempo and mislabelling every card.
  const num = (v: unknown, fallback: number) => {
    const n = typeof v === 'string' ? Number(v) : v
    return typeof n === 'number' && Number.isFinite(n) ? n : fallback
  }
  return Math.round((Math.max(1, num(totalBars, 1)) * num(beatsPerBar, 4) * 60) / Math.max(1, num(bpm, 120)))
}

/**
 * List the caller's projects, newest-edited first.
 *
 * Selects PROJECTED fields only - never `data`. A card needs a thumbnail and a
 * duration; `data` is the entire project (every scene, track, note, effect and
 * automation curve, plus the base64 thumbnail), which runs from tens of KB to
 * megabytes a row. Pulling one per card made this query the whole load time of
 * /projects: the page gates its first paint on it, so every byte of every
 * document was in front of the grid appearing.
 *
 * `data->>key` extracts inside Postgres, so only the extracted values cross the
 * wire and the client parses kilobytes instead of megabytes. The thumbnail comes
 * back through `->>` as text; the tempo scalars through `->`, which
 * durationSecondsOf reads without depending on which of the two it got.
 *
 * What this gives up: `preview.rows` (the mini-timeline sketch) can't be derived
 * without the whole document, so it comes back empty and a project with no
 * captured frame shows the card's empty state instead of a sketch of its blocks.
 * That only affects projects never edited in the editor - the thumbnail is
 * written by autosave's first flush. Restoring the sketch means storing it in a
 * projected column written at save time, which is also what lets this query stop
 * touching `data` at all.
 */
export async function list(): Promise<ProjectSummary[]> {
  const { data, error } = await getSupabase()
    .from('projects')
    // One string literal on purpose: supabase-js infers the row type by parsing
    // this at the type level, and a concatenated string widens to `string`,
    // which collapses the whole result to GenericStringError.
    .select('id, name, updated_at, rev, thumbnail:data->>thumbnail, totalBars:data->totalBars, beatsPerBar:data->beatsPerBar, bpm:data->bpm')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data.map((r) => ({
    id: r.id,
    name: r.name,
    updatedAt: r.updated_at,
    rev: r.rev,
    preview: {
      image: typeof r.thumbnail === 'string' ? r.thumbnail : undefined,
      durationSeconds: durationSecondsOf(r.totalBars, r.beatsPerBar, r.bpm),
      rows: [],
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
  // getSession, not getUser: no auth round trip in front of the insert - RLS
  // validates the token on the insert itself.
  const { data: auth, error: authError } = await supabase.auth.getSession()
  if (authError) throw authError
  const user = auth.session?.user
  if (!user) throw new Error('Not signed in')
  const doc = document ?? emptyDocument()
  const { data, error } = await supabase
    .from('projects')
    .insert({
      name,
      user_id: user.id,
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
