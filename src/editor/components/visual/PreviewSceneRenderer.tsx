import { useSyncExternalStore } from 'react'
import { VisualScene } from './VisualScene'
import { previewRuntime, subscribePreviewRendering } from '../../core/visual/previewRuntime'
import { isExportPinned, subscribeExportPinned } from '../../core/export/frameDriver'

/** Worker GL also owns the expensive React object tree. Keeping a duplicate
 * mounted in the DOM root would run thousands of store selectors on each edit. */
export function PreviewSceneRenderer() {
  const workerRendering = useSyncExternalStore(subscribePreviewRendering, () => previewRuntime.rendering, () => false)
  const pinned = useSyncExternalStore(subscribeExportPinned, isExportPinned, () => false)
  return !workerRendering || pinned ? <VisualScene /> : null
}
