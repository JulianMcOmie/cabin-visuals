import { getSupabase } from './supabase'

/** Mint the ref before uploading so local playback can start immediately.
 *  Storage RLS checks the leading user id in `{userId}/{projectId}/{clipId}`. */
export async function mintMediaPath(projectId: string): Promise<string> {
  // getSession avoids getUser's auth-lock-held network round trip; Storage
  // validates the token again when the upload reaches the bucket.
  const { data: auth, error: authError } = await getSupabase().auth.getSession()
  if (authError) throw authError
  const user = auth.session?.user
  if (!user) throw new Error('Not signed in')
  return `${user.id}/${projectId}/${crypto.randomUUID()}`
}

/** XHR exposes upload progress, unlike the fetch transport in supabase-js. */
export async function uploadMediaTo(
  bucket: string,
  path: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const { data: sessionData } = await getSupabase().auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Not signed in')

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${bucket}/${path}`

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
      let message = `Upload failed (${xhr.status})`
      try {
        message = (JSON.parse(xhr.responseText) as { message?: string }).message ?? message
      } catch { /* non-JSON body - keep the status fallback */ }
      reject(new Error(message))
    }
    xhr.onerror = () => reject(new Error('Upload failed - network error'))
    xhr.send(file)
  })
}
