'use client'

import { useEffect } from 'react'
import { capturePreviewClip, PREVIEW_CAPTURE_VERSION } from '../core/export/previewCapture'
import { getFrameDriver } from '../core/export/frameDriver'
import { useProjectStore } from '../store/ProjectStore'
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
    /** Render a run of exact frames as PNG data URLs (frame-comparison probe). */
    __captureFrames?: (startFrame: number, count: number, opts?: { fps?: number; width?: number; height?: number }) => Promise<string[] | null>
    /** Fill every photoSlot track's pad bank with the given refs (smoke test). */
    __fillPhotoSlots?: (refs: string[]) => number
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
    // Deterministic per-frame capture: render frame i of an `fps` walk at the
    // project bpm and hand back lossless PNGs. Drives the same FrameDriver path
    // as export, so what it returns is exactly what an export would encode.
    // Used by the crazyedit template's frame-by-frame comparison script.
    window.__captureFrames = async (startFrame, count, opts = {}) => {
      const fps = opts.fps ?? 30
      const width = opts.width ?? 422
      const height = opts.height ?? 750
      const deadline = Date.now() + 20_000
      let driver = getFrameDriver()
      while (Date.now() < deadline) {
        driver = getFrameDriver()
        const scenes = useProjectStore.getState().scenes
        const ready = driver != null && Object.values(scenes).some((s) => !s.isMain && Object.keys(s.tracks).length > 0)
        if (ready) break
        await new Promise((r) => setTimeout(r, 100))
      }
      if (!driver) return null
      const { bpm } = useProjectStore.getState()
      driver.pin(width, height)
      try {
        const out: string[] = []
        for (let i = 0; i < count; i++) {
          const frameIdx = startFrame + i
          const beat = (frameIdx * bpm) / (60 * fps)
          driver.renderFrame(beat, (frameIdx * 1000) / fps)
          // Full-frame canvas instruments may return false on the first pass
          // (font/image assets still loading); render again so the retry lands
          // before the pixels are read.
          driver.renderFrame(beat, (frameIdx * 1000) / fps)
          out.push(driver.getCanvas().toDataURL('image/png'))
        }
        return out
      } finally {
        driver.unpin()
      }
    }
    // Photo-slot smoke test: give every photoSlot track a pad bank so a
    // capture shows photos where the placeholders were.
    window.__fillPhotoSlots = (refs) => {
      const s = useProjectStore.getState()
      let filled = 0
      for (const [id, t] of Object.entries(s.tracks)) {
        if (t.instrumentId !== 'photoSlot') continue
        s.setTrackPhotoPads(id, refs.map((ref) => ({ ref })))
        filled++
      }
      return filled
    }
    return () => {
      delete window.__capturePreview
      delete window.__templateIds
      delete window.__templateHashes
      delete window.__captureFrames
      delete window.__fillPhotoSlots
    }
  }, [])

  return null
}
