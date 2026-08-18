'use client'

/**
 * Shared loader for the preview-clip manifests (instrument + template buckets).
 *
 * The manifest maps clip id -> capture version and is appended to each clip
 * URL, so a regenerated clip busts caches while unchanged ones stay cached.
 * It is served uncached, which used to mean EVERY editor load paid a full
 * Supabase round trip before a single library card could show anything.
 *
 * Now: the last manifest is kept in localStorage and used immediately (cards
 * render on the first paint), while a background refetch refreshes the stored
 * copy for the NEXT session. A regenerated clip therefore reaches a returning
 * user one load later than before - the trade for a library that appears
 * instantly. First-ever loads still wait for the network. `warm()` lets the
 * editor kick the fetch off at module load instead of at first card mount.
 */
export function createManifestLoader(url: string, storageKey: string) {
  let inflight: Promise<Record<string, string>> | null = null

  const readStored = (): Record<string, string> | null => {
    try {
      const raw = localStorage.getItem(storageKey)
      return raw ? (JSON.parse(raw) as Record<string, string>) : null
    } catch {
      return null
    }
  }

  const fetchFresh = (): Promise<Record<string, string>> =>
    fetch(url, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((json: Record<string, string> | null) => {
        if (json) {
          try { localStorage.setItem(storageKey, JSON.stringify(json)) } catch { /* private mode - fine */ }
        }
        return json ?? {}
      })
      .catch(() => ({}))

  const load = (): Promise<Record<string, string>> => {
    if (!inflight) {
      const stored = typeof window !== 'undefined' ? readStored() : null
      if (stored) {
        inflight = Promise.resolve(stored)
        void fetchFresh() // refresh for next session
      } else {
        inflight = fetchFresh()
      }
    }
    return inflight
  }

  return {
    load,
    /** Start the fetch now (idempotent) so it overlaps the rest of app boot. */
    warm(): void {
      if (typeof window !== 'undefined') void load()
    },
  }
}
