'use client'

import { useEffect, useState } from 'react'
import { createManifestLoader } from './clipManifest'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
export const TEMPLATE_CLIP_BASE = `${SUPABASE_URL}/storage/v1/object/public/template-previews`

// Preview clips live at a STABLE path per template (`<id>.mp4`), which is what
// makes a regenerated clip invisible: a browser holding yesterday's copy has no
// reason to ask for it again, so `npm run previews` silently changes nothing
// for anyone who has already seen the gallery.
//
// The capture script already uploads a manifest of id -> content hash next to
// the clips. Appending that hash to the URL turns each regeneration into a new
// URL, so updated clips actually reach people while unchanged ones stay
// cached. Loading + localStorage strategy: clipManifest.ts.
const manifest = createManifestLoader(`${TEMPLATE_CLIP_BASE}/manifest.json`, 'cabin.templateClipManifest')
if (SUPABASE_URL) manifest.warm()

/**
 * The versioned clip URL for a template, or null while it is still unknown
 * (or when there is no storage configured at all). Null on purpose: cards keep
 * showing their fallback rather than fetching a URL that is about to be
 * replaced, which would cost a wasted download of a multi-megabyte clip.
 */
export function useTemplateClipUrl(id: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!SUPABASE_URL) return
    let live = true
    void manifest.load().then((versions) => {
      if (!live) return
      const version = versions[id]
      setUrl(`${TEMPLATE_CLIP_BASE}/${id}.mp4${version ? `?v=${version}` : ''}`)
    })
    return () => { live = false }
  }, [id])
  return url
}
