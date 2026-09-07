'use client'

import { useEffect, useState } from 'react'
import { createManifestLoader } from './clipManifest'
import posters from './instrumentPreviewPosters.json'

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
const bundled: Record<string, { version: string }> = posters
const clipFor = (id: string, version?: string) => version
  ? `${INSTRUMENT_CLIP_BASE}/${id}.mp4?v=${encodeURIComponent(version)}` : null
const initialUrl = (id: string) => SUPABASE_URL
  ? clipFor(id, bundled[id]?.version) ?? undefined : null
// Fetch starts as soon as the editor bundle evaluates, not at first card mount.
if (SUPABASE_URL) manifest.warm()

/**
 * The instrument's preview clip URL. Three states on purpose:
 * Bundled posters also record their clip versions, eliminating the manifest
 * round trip on a first visit. The remote manifest can still update a clip.
 * `undefined` = unknown id, manifest still resolving;
 * `null` = no clip exists for this id - keep the still/icon;
 * string = the versioned clip URL.
 */
export function useInstrumentClipUrl(id: string): string | null | undefined {
  const [result, setResult] = useState(() => ({ id, url: initialUrl(id) }))
  useEffect(() => {
    if (!SUPABASE_URL) return
    let live = true
    void manifest.load().then((versions) => {
      if (!live) return
      const version = versions[id] ?? bundled[id]?.version
      setResult({ id, url: clipFor(id, version) })
    })
    return () => { live = false }
  }, [id])
  return result.id === id ? result.url : initialUrl(id)
}
