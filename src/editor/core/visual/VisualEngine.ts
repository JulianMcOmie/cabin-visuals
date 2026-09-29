import { createVisualEngine } from './VisualEngineInstance'

export { createVisualEngine } from './VisualEngineInstance'
export type { ObjectListEntry, SceneBackdrop, VisualEngineInstance } from './VisualEngineInstance'

/** The shared editor engine - the one whose frame owns the grade (look.ts).
 *  Preview evaluators have their own state. */
export const visualEngine = createVisualEngine({ frameLooks: true })
export const {
  setProject,
  syncParams,
  computeAtBeat,
  getSceneBackdrop,
  getSceneFxOverrides,
  setPreviewObjectState,
  getObjectState,
  isTrackStaggered,
  getCompositionLayers,
  setMainCompositionOverride,
  setMainPreviewEnabled,
  setEditorPreviewSceneId,
  setMountedRenderScenes,
  getMountedRenderScenes,
  getVisualCopies,
  getPeakVisualCopyOpacity,
  getVisualCopy,
  getVisualCopyCount,
  subscribeObjects,
  getObjectList,
  getResolvedNotes,
  findTrackId,
  isTrackActive,
} = visualEngine
export { layerSceneIds } from './layerScenes'
