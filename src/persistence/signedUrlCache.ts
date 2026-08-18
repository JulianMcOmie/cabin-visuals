import { getSupabase } from './supabase'

/**
 * Memoized signed URLs for the private media buckets. A photo bank of 30
 * images used to sign each ref every time a thumbnail row or texture mounted
 * (one round trip per call); a signed URL is good for an hour, so hand the
 * same one back until it is close to expiring. Failures are not cached.
 */
const TTL_SEC = 60 * 60
// Refresh well before expiry so a URL handed out near the end of its life
// still has time to be fetched.
const REUSE_MS = (TTL_SEC - 10 * 60) * 1000

const cache = new Map<string, { url: string; at: number }>()
const inflight = new Map<string, Promise<string>>()

export function signedUrlFor(bucket: string, path: string): Promise<string> {
  const key = `${bucket}/${path}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < REUSE_MS) return Promise.resolve(hit.url)
  let pending = inflight.get(key)
  if (!pending) {
    pending = (async () => {
      const { data, error } = await getSupabase().storage.from(bucket).createSignedUrl(path, TTL_SEC)
      if (error) throw error
      cache.set(key, { url: data.signedUrl, at: Date.now() })
      return data.signedUrl
    })().finally(() => inflight.delete(key))
    inflight.set(key, pending)
  }
  return pending
}
