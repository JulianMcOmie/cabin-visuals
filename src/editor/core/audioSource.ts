// The one module that knows where audio bytes live.
//
// Today: in-memory object URLs (session-only — gone on reload).
// Later: swap these two functions to hit IndexedDB, then Supabase. Nothing
// upstream (the store descriptor, the playback engine, the UI) changes — they
// only ever deal in opaque `ref` strings resolved through getPlayableUrl().

const mem = new Map<string, string>() // ref -> object URL

/** Persist an audio file's bytes and return an opaque handle to store. */
export async function saveAudio(file: File): Promise<string> {
  const ref = crypto.randomUUID()
  mem.set(ref, URL.createObjectURL(file))
  return ref
}

/** Resolve a ref to a URL a Tone.Player can load. */
export async function getPlayableUrl(ref: string): Promise<string> {
  const url = mem.get(ref)
  if (!url) throw new Error(`audio ref not found: ${ref}`)
  return url
}

/** Drop the bytes for a ref and free its object URL. */
export function removeAudio(ref: string): void {
  const url = mem.get(ref)
  if (url) {
    URL.revokeObjectURL(url)
    mem.delete(ref)
  }
}
