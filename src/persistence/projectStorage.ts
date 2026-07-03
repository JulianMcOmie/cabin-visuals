import { getSupabase } from './supabase'
import type { ProjectDocument } from './types'
import { emptyDocument } from './types'
import { CURRENT_VERSION, upgradeDocument } from './upgrade'

// The one door for project CRUD — the only file that names the `projects`
// table for the document. Every function runs under RLS as the signed-in user,
// so a row can only ever be the caller's own.

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: string
}

/** Spine columns only — never pulls a blob. Newest-edited first. */
export async function list(): Promise<ProjectSummary[]> {
  const { data, error } = await getSupabase()
    .from('projects')
    .select('id, name, updated_at')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updated_at }))
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
  // RLS filters a non-owned/missing row to zero rows with no error — surface
  // that as a failure instead of silently dropping the save.
  if (!data.length) throw new Error(`Project ${id} not found (or not yours)`)
}

/** Create a project with a fresh empty document; returns its summary. */
export async function create(name: string): Promise<ProjectSummary> {
  const supabase = getSupabase()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError) throw authError
  if (!auth.user) throw new Error('Not signed in')
  const { data, error } = await supabase
    .from('projects')
    .insert({
      name,
      user_id: auth.user.id,
      data: emptyDocument(),
      schema_version: CURRENT_VERSION,
    })
    .select('id, name, updated_at')
    .single()
  if (error) throw error
  return { id: data.id, name: data.name, updatedAt: data.updated_at }
}

/** Delete a project row (the document goes with it). */
export async function remove(id: string): Promise<void> {
  const { error } = await getSupabase().from('projects').delete().eq('id', id)
  if (error) throw error
}
