'use client'

import { memo, useEffect, useRef } from 'react'
import { observeTimelineViewport } from './observeTimelineViewport'
import { PREVIEW_HEIGHT, PREVIEW_WIDTH, registerTrackPreview, trackPreviewSurfaces } from './trackPreviewRegistry'

export const TrackLivePreview = memo(function TrackLivePreview({ trackId }: { trackId: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let unregister: (() => void) | undefined
    const stop = observeTimelineViewport(canvas, visible => {
      if (visible && !unregister) unregister = registerTrackPreview(trackPreviewSurfaces, { trackId, canvas })
      if (!visible) { unregister?.(); unregister = undefined }
    })
    return () => { stop(); unregister?.() }
  }, [trackId])
  return (
    <canvas
      ref={ref}
      data-track-live-preview={trackId}
      width={PREVIEW_WIDTH}
      height={PREVIEW_HEIGHT}
      aria-label="Live instrument chain through this row at the playhead"
      title="Instrument chain through this row · follows the playhead"
      className="relative pointer-events-none flex-shrink-0 rounded border border-[color-mix(in_srgb,var(--text)_10%,transparent)] bg-[color-mix(in_srgb,var(--bg-canvas-deep)_40%,transparent)] object-contain"
      style={{ width: 56, height: 'calc(100% - 8px)', maxHeight: 40 }}
    />
  )
})
