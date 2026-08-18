'use client'

import { useEffect, useState } from 'react'
import { createManifestLoader } from './clipManifest'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
export const INSTRUMENT_CLIP_BASE = `${SUPABASE_URL}/storage/v1/object/public/instrument-previews`

// Same scheme as templateClipUrl: stable per-id paths (`<id>.mp4`) in a public
// bucket, with a manifest (id -> capture version) appended to each URL so
// regenerated clips bust caches while unchanged ones stay cached (loading +
// localStorage strategy in clipManifest.ts). One difference: here the manifest
// is also the EXISTENCE record - not every library item has a clip (new
// instruments land before their capture runs), and an id absent from the
// manifest means "keep the live preview", not "404".
const manifest = createManifestLoader(`${INSTRUMENT_CLIP_BASE}/manifest.json`, 'cabin.instrumentClipManifest')
// Fetch starts as soon as the editor bundle evaluates, not at first card mount.
if (SUPABASE_URL) manifest.warm()

/**
 * The instrument's preview clip URL. Three states on purpose:
 * `undefined` = manifest still resolving - render nothing yet, so a card never
 * pays for a live WebGL preview that a clip is about to replace;
 * `null` = no clip exists for this id - fall back to the live preview;
 * string = the versioned clip URL.
 */
export function useInstrumentClipUrl(id: string): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(SUPABASE_URL ? undefined : null)
  useEffect(() => {
    if (!SUPABASE_URL) return
    let live = true
    void manifest.load().then((versions) => {
      if (!live) return
      const version = versions[id]
      setUrl(version ? `${INSTRUMENT_CLIP_BASE}/${id}.mp4?v=${version}` : null)
    })
    return () => { live = false }
  }, [id])
  return url
}
