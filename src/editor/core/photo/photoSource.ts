import { mintPhotoPath, uploadPhotoTo, getPhotoUrl, deletePhoto } from '../../../persistence/photoStorage'

// Ref-based access to photo bytes, mirroring core/video/videoSource.ts: with a
// project row the bytes live in the project-photos bucket and the ref is the
// bucket path; without one (fresh in-memory editor) the ref is session-only.
// Either way the document stores only the ref.
//
// The Photo instrument reads through getPhotoPlayableUrl(): a URL a THREE
// TextureLoader can load. Session photos read from an object URL over the
// in-memory File; hydrated photos read from a fresh signed URL. No mediabunny
// and no decode engine - a still image is just a texture.

const memFiles = new Map<string, File>() // ref -> File (this session's uploads)
const objectUrls = new Map<string, string>() // ref -> object URL over its File

export interface PhotoSave {
  /** Usable IMMEDIATELY: local bytes are registered under it before any
   *  network happens, so pads can arm and show while the upload runs. */
  ref: string
  /** Resolves when the bytes are durable in storage (instantly for session-only
   *  refs). Rejection = the upload failed; the ref still shows this session
   *  from local bytes but will not survive a reload - surface a retry. */
  completion: Promise<void>
}

/** Begin persisting a photo file: the ref is minted and locally-backed up
 *  front; the upload is background durability, not a gate on anything. */
export async function beginSavePhoto(file: File, onProgress?: (fraction: number) => void): Promise<PhotoSave> {
  const projectId = new URLSearchParams(window.location.search).get('project')
  // No project row to hang the bytes on - session-only, same as video pre-save.
  if (!projectId) {
    const ref = crypto.randomUUID()
    memFiles.set(ref, file)
    onProgress?.(1)
    return { ref, completion: Promise.resolve() }
  }
  const ref = await mintPhotoPath(projectId)
  memFiles.set(ref, file) // show immediately - rendering never waits on the net
  return { ref, completion: uploadPhotoTo(ref, file, onProgress) }
}

/** Retry a failed background upload for a ref whose bytes are still local. */
export function retryPhotoUpload(ref: string, onProgress?: (fraction: number) => void): Promise<void> {
  const file = memFiles.get(ref)
  if (!file) return Promise.reject(new Error('Original file no longer in this session'))
  if (!ref.includes('/')) return Promise.resolve() // session-only ref: nothing to upload
  return uploadPhotoTo(ref, file, onProgress)
}

/** A URL a TextureLoader can load for a ref: an object URL over the session
 *  File if we have it, else the bucket's signed URL. Signed URLs expire, so
 *  hydrated photos resolve fresh per call. */
export async function getPhotoPlayableUrl(ref: string): Promise<string> {
  const file = memFiles.get(ref)
  if (file) {
    let url = objectUrls.get(ref)
    if (!url) {
      url = URL.createObjectURL(file)
      objectUrls.set(ref, url)
    }
    return url
  }
  return getPhotoUrl(ref)
}

/** Drop the bytes for a ref, locally and (for uploaded photos) in the bucket. */
export function removePhoto(ref: string): void {
  memFiles.delete(ref)
  const url = objectUrls.get(ref)
  if (url) {
    URL.revokeObjectURL(url)
    objectUrls.delete(ref)
  }
  // A path-shaped ref means bytes in the bucket too. Fire-and-forget: the doc
  // drops the descriptor either way; a stray orphan object is harmless.
  if (ref.includes('/')) {
    void deletePhoto(ref).catch((err) => console.error('Failed to delete photo bytes', err))
  }
}
