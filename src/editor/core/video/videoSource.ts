import { uploadVideo, getVideoUrl, deleteVideo } from '../../../persistence/videoStorage'

// Ref-based access to video bytes, mirroring core/audio/audioSource.ts: with a
// project row the bytes live in the project-videos bucket and the ref is the
// bucket path; without one (fresh in-memory editor) the ref is a session-only
// object URL. Either way the document stores only the ref.

const mem = new Map<string, string>() // ref -> object URL (this session's cache)

/** Persist a video file's bytes and return an opaque handle to store. */
export async function saveVideo(file: File): Promise<string> {
  const projectId = new URLSearchParams(window.location.search).get('project')
  // No project row to hang the bytes on - session-only, same as audio pre-save.
  if (!projectId) {
    const ref = crypto.randomUUID()
    mem.set(ref, URL.createObjectURL(file))
    return ref
  }
  const ref = await uploadVideo(projectId, file)
  mem.set(ref, URL.createObjectURL(file)) // play immediately, no re-download
  return ref
}

/** Resolve a ref to a URL a <video> element can load. */
export async function getPlayableVideoUrl(ref: string): Promise<string> {
  const cached = mem.get(ref)
  if (cached) return cached
  // Not in this session's cache - a hydrated project's clip. Signed URLs
  // expire, so they're resolved fresh per load rather than cached.
  return getVideoUrl(ref)
}

/** Drop the bytes for a ref, locally and (for uploaded clips) in the bucket. */
export function removeVideo(ref: string): void {
  const url = mem.get(ref)
  if (url) {
    URL.revokeObjectURL(url)
    mem.delete(ref)
  }
  // A path-shaped ref means bytes in the bucket too. Fire-and-forget: the doc
  // drops the descriptor either way; a stray orphan object is harmless.
  if (ref.includes('/')) {
    void deleteVideo(ref).catch((err) => console.error('Failed to delete video bytes', err))
  }
}
