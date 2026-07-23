import { BlobSource, UrlSource, type Source } from 'mediabunny'
import { mintVideoPath, uploadVideoTo, getVideoUrl } from '../../../persistence/videoStorage'

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

export interface VideoSave {
  /** Usable IMMEDIATELY: local bytes are registered under it before any
   *  network happens, so clips can arm and play while the upload runs. */
  ref: string
  /** Resolves when the bytes are durable in storage (instantly for session-only
   *  refs). Rejection = the upload failed; the ref still plays this session
   *  from local bytes but will not survive a reload - surface a retry. */
  completion: Promise<void>
}

/** Begin persisting a video file: the ref is minted and locally-backed up
 *  front; the upload is background durability, not a gate on anything. */
export async function beginSaveVideo(file: File, onProgress?: (fraction: number) => void): Promise<VideoSave> {
  const projectId = new URLSearchParams(window.location.search).get('project')
  // No project row to hang the bytes on - session-only, same as audio pre-save.
  if (!projectId) {
    const ref = crypto.randomUUID()
    memFiles.set(ref, file)
    onProgress?.(1)
    return { ref, completion: Promise.resolve() }
  }
  const ref = await mintVideoPath(projectId)
  memFiles.set(ref, file) // decode immediately - playback never waits on the net
  return { ref, completion: uploadVideoTo(ref, file, onProgress) }
}

/** Retry a failed background upload for a ref whose bytes are still local. */
export function retryVideoUpload(ref: string, onProgress?: (fraction: number) => void): Promise<void> {
  const file = memFiles.get(ref)
  if (!file) return Promise.reject(new Error('Original file no longer in this session'))
  if (!ref.includes('/')) return Promise.resolve() // session-only ref: nothing to upload
  return uploadVideoTo(ref, file, onProgress)
}

/** A ref that is a PUBLIC APP ASSET (template placeholder clips under
 *  /templates/...), not a bucket path. These ship with the app: no upload, no
 *  signing, no per-user storage - the document just points at the asset. */
export function isPublicAssetRef(ref: string): boolean {
  return ref.startsWith('/')
}

/** A mediabunny Source for a ref: the session File if we have it, a public
 *  app asset served as-is, else the bucket's signed URL (range-streamed,
 *  not fully downloaded). */
export async function getVideoSource(ref: string): Promise<Source> {
  const file = memFiles.get(ref)
  if (file) return new BlobSource(file)
  if (isPublicAssetRef(ref)) return new UrlSource(new URL(ref, window.location.origin).href)
  // Hydrated clip: signed URLs expire, so resolve fresh per open.
  return new UrlSource(await getVideoUrl(ref))
}

/** Drop this session's local hold on a ref. Bucket bytes are deliberately left
 *  alone - see core/audio/audioSource.ts removeAudio for the reasoning. */
export function removeVideo(ref: string): void {
  memFiles.delete(ref)
}
