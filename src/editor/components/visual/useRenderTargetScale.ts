import { useSyncExternalStore } from 'react'
import { useTimeStore } from '../../store/TimeStore'
import { previewLighting, previewQualityScale, useUIStore } from '../../store/UIStore'
import type { LightingBudget } from '../../core/visual/sceneLights'
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

/**
 * The lighting budget every render pass runs under right now - the pass
 * pools in VisualScene, its legacy JSX rig and ShaderWrapper's offscreen rig
 * all read this one value so a Fast frame is trimmed (or flat) everywhere at
 * once. Same pin rule as the scale: an export or preview capture always
 * lights in full, whatever the toolbar says.
 */
export function usePreviewLighting(): LightingBudget {
  const previewQuality = useUIStore((s) => s.previewQuality)
  const exportPinned = useSyncExternalStore(subscribeExportPinned, isExportPinned, () => false)
  return exportPinned ? 'full' : previewLighting(previewQuality)
}
