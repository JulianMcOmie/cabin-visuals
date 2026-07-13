'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useProjectStore } from '../store/ProjectStore'
import { useTimeStore } from '../store/TimeStore'
import { runExport } from '../core/export/exportEngine'
import { downloadBlob } from '../core/export/mux'
import { resolveExportRange, defaultBitrate, type ExportSettings } from '../core/export/types'

// DEV-ONLY. Downloads a short, looping clip of the CURRENT project's real render,
// for use as a template gallery preview (uploaded to the public template-previews
// bucket, keyed by template id). Reuses the export pipeline verbatim - just with
// preset preview settings - so a clip is pixel-identical to what a user gets.
// Open /editor?template=<id>, click, upload the downloaded <id>.mp4.
//
// The clip is the first PREVIEW_BARS bars, which loops cleanly at the templates'
// shared 120 bpm (2 bars = 8 beats = 4s). Small, no audio, no watermark.
const PREVIEW_BARS = 2
const PREVIEW_WIDTH = 640
const PREVIEW_HEIGHT = 360

export function PreviewCaptureButton() {
  const [busy, setBusy] = useState(false)
  const templateId = useSearchParams().get('template')

  const capture = async () => {
    if (busy) return
    setBusy(true)
    try {
      const { bpm, beatsPerBar, totalBars } = useProjectStore.getState()
      const settings: ExportSettings = {
        width: PREVIEW_WIDTH,
        height: PREVIEW_HEIGHT,
        fps: 30,
        includeAudio: false,
        videoBitrate: defaultBitrate(PREVIEW_WIDTH, 30),
        fileName: templateId ?? 'preview',
        watermark: false,
        rangeMode: 'custom',
        rangeFromBar: 1,
        rangeToBar: PREVIEW_BARS,
      }
      const range = resolveExportRange(settings, beatsPerBar, totalBars, useTimeStore.getState().loopRegion)
      const { blob } = await runExport(settings, { bpm, beatsPerBar, totalBars, range })
      if (blob) downloadBlob(blob, `${settings.fileName}.mp4`)
    } catch (err) {
      console.error('Preview capture failed', err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={capture}
      disabled={busy}
      title="Dev: download a looping preview clip of this template"
      className="h-7 px-2.5 rounded border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-3)] text-[11px] font-semibold hover:border-[var(--border-strong)] transition-colors cursor-pointer disabled:opacity-50"
    >
      {busy ? 'Capturing…' : 'Preview clip'}
    </button>
  )
}
