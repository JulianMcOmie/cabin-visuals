import { getSupabase } from './supabase'

// Upload/download for the project-videos Storage bucket. Paths are
// `{userId}/{projectId}/{clipId}` - the bucket's RLS policies key on the first
// folder equalling auth.uid(), so a user can only ever touch their own bytes.
// The path doubles as the `ref` in the document's videoClips descriptor.
// (Byte-for-byte the project-audio scheme; see audioStorage.ts.)

const BUCKET = 'project-videos'

/** Upload a clip's bytes; returns the bucket path to store as the clip ref. */
export async function uploadVideo(projectId: string, file: File): Promise<string> {
  const supabase = getSupabase()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError) throw authError
  if (!auth.user) throw new Error('Not signed in')
  const path = `${auth.user.id}/${projectId}/${crypto.randomUUID()}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
  })
  if (error) throw error
  return path
}

/** A URL a <video> element can load (signed; the bucket is private). */
export async function getVideoUrl(path: string): Promise<string> {
  const { data, error } = await getSupabase().storage.from(BUCKET).createSignedUrl(path, 60 * 60)
  if (error) throw error
  return data.signedUrl
}

/** Drop a clip's bytes. */
export async function deleteVideo(path: string): Promise<void> {
  const { error } = await getSupabase().storage.from(BUCKET).remove([path])
  if (error) throw error
}
