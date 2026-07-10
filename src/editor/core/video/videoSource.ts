import { BlobSource, UrlSource, type Source } from 'mediabunny'
import { uploadVideo, getVideoUrl, deleteVideo } from '../../../persistence/videoStorage'

// Ref-based access to video bytes, mirroring core/audio/audioSource.ts: with a
// project row the bytes live in the project-videos bucket and the ref is the
// bucket path; without one (fresh in-memory editor) the ref is session-only.
// Either way the document stores only the ref.
//
// The decode engine (core/video/decodeEngine) reads through getVideoSource():
// a mediabunny Source, which streams via range requests - it never downloads a
// whole file to seek. Session clips read from the in-memory File; hydrated
// clips read from a signed URL.

const memFiles = new Map<string, File>() // ref -> File (this session's uploads)

/** Persist a video file's bytes and return an opaque handle to store. */
export async function saveVideo(file: File, onProgress?: (fraction: number) => void): Promise<string> {
  const projectId = new URLSearchParams(window.location.search).get('project')
  // No project row to hang the bytes on - session-only, same as audio pre-save.
  if (!projectId) {
    const ref = crypto.randomUUID()
    memFiles.set(ref, file)
    onProgress?.(1)
    return ref
  }
  const ref = await uploadVideo(projectId, file, onProgress)
  memFiles.set(ref, file) // decode immediately, no re-download
  return ref
}

/** A mediabunny Source for a ref: the session File if we have it, else the
 *  bucket's signed URL (range-streamed, not fully downloaded). */
export async function getVideoSource(ref: string): Promise<Source> {
  const file = memFiles.get(ref)
  if (file) return new BlobSource(file)
  // Hydrated clip: signed URLs expire, so resolve fresh per open.
  return new UrlSource(await getVideoUrl(ref))
}

/** Drop the bytes for a ref, locally and (for uploaded clips) in the bucket. */
export function removeVideo(ref: string): void {
  memFiles.delete(ref)
  // A path-shaped ref means bytes in the bucket too. Fire-and-forget: the doc
  // drops the descriptor either way; a stray orphan object is harmless.
  if (ref.includes('/')) {
    void deleteVideo(ref).catch((err) => console.error('Failed to delete video bytes', err))
  }
}
