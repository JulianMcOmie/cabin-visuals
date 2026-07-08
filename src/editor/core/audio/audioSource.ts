// The one module that knows where audio bytes live.
//
// Bytes live in the project-audio Storage bucket (persistence/audioStorage),
// addressed by the opaque `ref` in the AudioStore descriptor - for uploaded
// clips the ref IS the bucket path. A session-local object-URL cache fronts
// the bucket so a just-loaded file plays without a round trip. Nothing
// upstream (the store descriptor, the playback engine, the UI) changes - they
// only ever deal in refs resolved through getPlayableUrl().

import { uploadAudio, getAudioUrl, deleteAudio } from '../../../persistence/audioStorage'

const mem = new Map<string, string>() // ref -> object URL (this session's cache)

/** Persist an audio file's bytes and return an opaque handle to store. */
export async function saveAudio(file: File): Promise<string> {
  const projectId = new URLSearchParams(window.location.search).get('project')
  // No project row to hang the bytes on - session-only, the pre-bucket behavior.
  if (!projectId) {
    const ref = crypto.randomUUID()
    mem.set(ref, URL.createObjectURL(file))
    return ref
  }
  const ref = await uploadAudio(projectId, file)
  mem.set(ref, URL.createObjectURL(file)) // play immediately, no re-download
  return ref
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
  // A path-shaped ref means bytes in the bucket too. Fire-and-forget: the doc
  // drops the descriptor either way; a stray orphan object is harmless.
  if (ref.includes('/')) {
    void deleteAudio(ref).catch((err) => console.error('Failed to delete audio bytes', err))
  }
}
