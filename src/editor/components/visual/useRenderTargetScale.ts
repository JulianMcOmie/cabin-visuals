import { useSyncExternalStore } from 'react'
import { useThree } from '@react-three/fiber'
import { previewSamplingScale } from '../../core/visual/framePixels'
import { useTimeStore } from '../../store/TimeStore'
import { previewLighting, previewQualityScale, useUIStore } from '../../store/UIStore'
import type { LightingBudget } from '../../core/visual/sceneLights'
import { isExportPinned, subscribeExportPinned } from '../../core/export/frameDriver'

/** Shared sampling density for scene and per-object targets, including export pins. */
export function useRenderTargetScale(): number {
  const previewQuality = useUIStore((s) => s.previewQuality)
  const isPlaying = useTimeStore((s) => previewQuality === 'auto' && s.isPlaying)
  const exportPinned = useSyncExternalStore(subscribeExportPinned, isExportPinned, () => false)
  const height = useThree((s) => s.size.height)
  const dpr = useThree((s) => s.viewport.dpr)
  return previewSamplingScale(previewQualityScale(previewQuality, isPlaying), height, dpr, exportPinned)
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
