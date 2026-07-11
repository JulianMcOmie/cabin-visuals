// The one module that knows where audio bytes live.
//
// Bytes live in the project-audio Storage bucket (persistence/audioStorage),
// addressed by the opaque `ref` in the AudioStore descriptor - for uploaded
// clips the ref IS the bucket path. A session-local object-URL cache fronts
// the bucket so a just-loaded file plays without a round trip. Nothing
// upstream (the store descriptor, the playback engine, the UI) changes - they
// only ever deal in refs resolved through getPlayableUrl().

import { mintAudioPath, uploadAudioTo, getAudioUrl, deleteAudio } from '../../../persistence/audioStorage'

const mem = new Map<string, string>() // ref -> object URL (this session's cache)
// Local bytes behind refs whose upload hasn't succeeded yet - retry fuel.
const localFiles = new Map<string, File>()

/**
 * Begin persisting an audio file's bytes. The returned ref is usable
 * IMMEDIATELY (the local bytes back it via the session cache); `completion`
 * settles when the background upload does - durability, not a gate.
 */
export async function beginSaveAudio(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<{ ref: string; completion: Promise<void> }> {
  const projectId = new URLSearchParams(window.location.search).get('project')
  // No project row to hang the bytes on - session-only, the pre-bucket behavior.
  if (!projectId) {
    const ref = crypto.randomUUID()
    mem.set(ref, URL.createObjectURL(file))
    return { ref, completion: Promise.resolve() }
  }
  const ref = await mintAudioPath(projectId)
  mem.set(ref, URL.createObjectURL(file)) // play immediately, no re-download
  localFiles.set(ref, file)
  const completion = uploadAudioTo(ref, file, onProgress).then(() => {
    localFiles.delete(ref)
  })
  return { ref, completion }
}

/** Re-run a failed upload from the locally-held bytes. */
export async function retryAudioUpload(
  ref: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const file = localFiles.get(ref)
  if (!file) throw new Error('The original file is no longer available - load it again')
  await uploadAudioTo(ref, file, onProgress)
  localFiles.delete(ref)
}

/** Resolve a ref to a URL a Tone.Player can load. */
export async function getPlayableUrl(ref: string): Promise<string> {
  const cached = mem.get(ref)
  if (cached) return cached
  // Not in this session's cache - a hydrated project's clip. Signed URLs
  // expire, so they're resolved fresh per load rather than cached.
  return getAudioUrl(ref)
}

/** Drop the bytes for a ref, locally and (for uploaded clips) in the bucket. */
export function removeAudio(ref: string): void {
  const url = mem.get(ref)
  if (url) {
    URL.revokeObjectURL(url)
    mem.delete(ref)
  }
  localFiles.delete(ref)
  // A path-shaped ref means bytes in the bucket too. Fire-and-forget: the doc
  // drops the descriptor either way; a stray orphan object is harmless.
  if (ref.includes('/')) {
    void deleteAudio(ref).catch((err) => console.error('Failed to delete audio bytes', err))
  }
}
