// The one module that knows where audio bytes live.
//
// Bytes live in the project-audio Storage bucket (persistence/audioStorage),
// addressed by the opaque `ref` in the AudioStore descriptor - for uploaded
// clips the ref IS the bucket path. A session-local object-URL cache fronts
// the bucket so a just-loaded file plays without a round trip. Nothing
// upstream (the store descriptor, the playback engine, the UI) changes - they
// only ever deal in refs resolved through getPlayableUrl().

import { mintAudioPath, uploadAudioTo, getAudioUrl } from '../../../persistence/audioStorage'

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

/**
 * Whether a ref addresses bytes in the bucket - i.e. whether anything OUTSIDE
 * this tab (a signed URL, the transcription routes) can reach them. Uploaded
 * refs are the `{userId}/{projectId}/{clipId}` paths mintAudioPath produces;
 * a session-only clip (no project row, see beginSaveAudio) is a bare id whose
 * bytes never left the browser, and a template-shipped ref is a public app
 * asset served from '/'.
 */
export function isUploadedRef(ref: string): boolean {
  return !ref.startsWith('/') && ref.includes('/')
}

/** Resolve a ref to a URL a Tone.Player can load. */
export async function getPlayableUrl(ref: string): Promise<string> {
  const cached = mem.get(ref)
  if (cached) return cached
  // Public app asset (template-shipped audio like the promo voiceover, refs
  // starting with '/'): served as-is, no bucket, no signing.
  if (ref.startsWith('/')) return ref
  // Not in this session's cache - a hydrated project's clip. Signed URLs
  // expire, so they're resolved fresh per load rather than cached.
  return getAudioUrl(ref)
}

// Cross-session byte cache for UPLOADED clips (Cache API, keyed by ref). The
// bucket bytes behind a ref are immutable - paths are minted once and never
// rewritten - so there is nothing to invalidate. Without this every project
// open re-downloaded the whole song: each open mints a fresh signed URL with
// a new ?token=, so the browser's HTTP cache never hit either. Session-only
// and public-asset refs skip it (object URLs / ordinary cacheable requests).
const AUDIO_CACHE = 'cabin-audio-v1'
const cacheKeyFor = (ref: string) => `/__cabin-audio/${encodeURIComponent(ref)}`

/** The clip's bytes: this session's local file, the persistent cache, or a
 *  fresh signed-URL download (which is then cached for next time). */
export async function fetchAudioBytes(ref: string): Promise<ArrayBuffer> {
  const local = mem.get(ref)
  if (local || !isUploadedRef(ref)) {
    const res = await fetch(local ?? ref)
    return res.arrayBuffer()
  }
  let cache: Cache | null = null
  try {
    if (typeof caches !== 'undefined') cache = await caches.open(AUDIO_CACHE)
  } catch {
    cache = null // private mode / storage denied - straight to the network
  }
  const key = cacheKeyFor(ref)
  if (cache) {
    const hit = await cache.match(key).catch(() => undefined)
    if (hit) return hit.arrayBuffer()
  }
  const res = await fetch(await getAudioUrl(ref))
  if (!res.ok) throw new Error(`Audio download failed (${res.status})`)
  const bytes = await res.arrayBuffer()
  if (cache) {
    // Store a copy under the stable key; the signed URL is not part of it.
    void cache.put(key, new Response(bytes.slice(0), { headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream' } })).catch(() => {})
  }
  return bytes
}

/** Drop this session's local hold on a ref. Bucket bytes are deliberately left
 *  alone - see the note below. */
export function removeAudio(ref: string): void {
  const url = mem.get(ref)
  if (url) {
    URL.revokeObjectURL(url)
    mem.delete(ref)
  }
  localFiles.delete(ref)
  // Bucket bytes are NOT deleted here, on purpose. Copying a project shares
  // clip paths between the copy and the original, so a path is no longer owned
  // by exactly one project - deleting the bytes when one project drops the
  // descriptor would silently strip the audio out of the other. Orphaned
  // objects are reclaimed by a sweep that derives live refs from every project
  // AND every revision snapshot; they are never reclaimed inline.
  // (projectStorage.remove already leaks a whole project's media the same way.)
}
