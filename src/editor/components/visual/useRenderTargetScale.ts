import { useSyncExternalStore } from 'react'
import { useTimeStore } from '../../store/TimeStore'
import { previewQualityScale, useUIStore } from '../../store/UIStore'
import { isExportPinned, subscribeExportPinned } from '../../core/export/frameDriver'

/**
 * The factor every offscreen render target shrinks by right now - the one
 * number VisualScene's scene/filter targets and ShaderWrapper's per-object rig
 * must agree on, so Fast Preview shrinks the whole frame's fragment work, not
 * just the compositor's. Pinned renders (export, preview capture) stand the
 * scale down to 1 for the pin's duration: a fractional preview resolution must
 * never leak into a pinned frame. AUTO reads the transport (full res paused,
 * half while playing), so the transport is only subscribed in that mode.
 */
export function useRenderTargetScale(): number {
  const previewQuality = useUIStore((s) => s.previewQuality)
  const isPlaying = useTimeStore((s) => previewQuality === 'auto' && s.isPlaying)
  const exportPinned = useSyncExternalStore(subscribeExportPinned, isExportPinned, () => false)
  return exportPinned ? 1 : previewQualityScale(previewQuality, isPlaying)
}
