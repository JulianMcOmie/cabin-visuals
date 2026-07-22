'use client'

import { useEffect } from 'react'
import { capturePreviewClip, PREVIEW_CAPTURE_VERSION } from '../core/export/previewCapture'
import { TEMPLATES } from '../../templates'

// A content hash of a template's document, id-independent: the `tpl-…` tokens are
// generated off a global counter (editing one template shifts another's ids), so
// they're stripped before hashing - only real content (notes, params, colors,
// bpm) changes the hash. The capture-settings version is folded in. FNV-1a.
function templateHash(document: unknown): string {
  const normalized = `${PREVIEW_CAPTURE_VERSION}:` + JSON.stringify(document).replace(/tpl-[a-z0-9]+/g, '')
  let h = 0x811c9dc5
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

// DEV-ONLY. Renders nothing: it exists to install the window hooks
// (__capturePreview / __templateIds) that the headless `npm run previews`
// script drives to regenerate + upload every template clip at once. The
// visible "Preview clip" header button it once carried was removed on
// 2026-07-22; the hooks must stay mounted or the previews pipeline dies.
// Only mounted in development (see App.tsx), so it never ships.

declare global {
  interface Window {
    __capturePreview?: () => Promise<string | null>
    __templateIds?: string[]
    /** id -> content hash, so the automation script skips unchanged templates. */
    __templateHashes?: Record<string, string>
  }
}

export function PreviewCaptureButton() {
  // Expose the capture entry point + the template id list for the automation
  // script. Returns base64 so it crosses the Playwright bridge as a plain string.
  useEffect(() => {
    // Only templates that actually get a captured video clip - 'animatedSlideshow'
    // ones (Slideshow) render blank and use a bespoke card animation instead.
    // Lyric templates are included: their cards are video-first with the canvas
    // word-pop as the not-yet-captured fallback.
    const videoTemplates = TEMPLATES.filter((t) => t.cardPreview !== 'animatedSlideshow')
    window.__templateIds = videoTemplates.map((t) => t.id)
    window.__templateHashes = Object.fromEntries(videoTemplates.map((t) => [t.id, templateHash(t.document)]))
    window.__capturePreview = async () => {
      const blob = await capturePreviewClip()
      if (!blob) return null
      const buf = await blob.arrayBuffer()
      let binary = ''
      const bytes = new Uint8Array(buf)
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      return btoa(binary)
    }
    return () => {
      delete window.__capturePreview
      delete window.__templateIds
      delete window.__templateHashes
    }
  }, [])

  return null
}
