import { createVisualEngine } from './VisualEngineInstance'

export { createVisualEngine } from './VisualEngineInstance'
export type { ObjectListEntry, SceneBackdrop, VisualEngineInstance } from './VisualEngineInstance'

/** The shared editor engine. Preview evaluators have their own state. */
export const visualEngine = createVisualEngine()
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
  getObjectList
} = visualEngine
