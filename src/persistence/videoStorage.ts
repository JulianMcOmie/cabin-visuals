import { getSupabase } from './supabase'

// Upload/download for the project-videos Storage bucket. Paths are
// `{userId}/{projectId}/{clipId}` - the bucket's RLS policies key on the first
// folder equalling auth.uid(), so a user can only ever touch their own bytes.
// The path doubles as the `ref` in the document's videoClips descriptor.
// (Byte-for-byte the project-audio scheme; see audioStorage.ts.)

const BUCKET = 'project-videos'

/** Upload a clip's bytes; returns the bucket path to store as the clip ref.
 *  Uploads via XHR rather than supabase-js because fetch (which supabase-js
 *  wraps) exposes no upload progress; this POSTs to the same Storage endpoint
 *  with the same auth, plus an onprogress feed for the UI. */
export async function uploadVideo(
  projectId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const supabase = getSupabase()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError) throw authError
  if (!auth.user) throw new Error('Not signed in')
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Not signed in')

  const path = `${auth.user.id}/${projectId}/${crypto.randomUUID()}`
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('apikey', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve()
      // Storage errors arrive as JSON: {statusCode, error, message}.
      let message = `Upload failed (${xhr.status})`
      try {
        message = (JSON.parse(xhr.responseText) as { message?: string }).message ?? message
      } catch { /* non-JSON body - keep the status fallback */ }
      reject(new Error(message))
    }
    xhr.onerror = () => reject(new Error('Upload failed - network error'))
    xhr.send(file)
  })
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
