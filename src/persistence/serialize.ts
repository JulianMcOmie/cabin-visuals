import { useProjectStore } from '../editor/store/ProjectStore'
import { useAudioStore } from '../editor/store/AudioStore'
import { useVideoStore } from '../editor/store/VideoStore'
import { usePhotoStore } from '../editor/store/PhotoStore'
import { useTimeStore } from '../editor/store/TimeStore'
import type { ProjectDocument } from './types'
import { CURRENT_VERSION } from './upgrade'

/**
 * ProjectStore state → document. Picks fields generically (every non-function
 * field), the same boundary HistoryStore snapshots - so a field added to the
 * store is persisted by default, with no extra wiring. The audioClips catalog
 * rides along from AudioStore (metadata only; bytes are the bucket's job).
 */
export function serialize(state = useProjectStore.getState()): ProjectDocument {
  return {
    schemaVersion: CURRENT_VERSION,
    bpm: state.bpm,
    beatsPerBar: state.beatsPerBar,
    totalBars: state.totalBars,
    scenes: state.scenes,
    sceneOrder: state.sceneOrder,
    activeSceneId: state.activeSceneId,
    audioTracks: state.audioTracks,
    audioRootTrackIds: state.audioRootTrackIds,
    audioClips: useAudioStore.getState().audioClips,
    videoClips: useVideoStore.getState().videoClips,
    photoClips: usePhotoStore.getState().photoClips,
    loopRegion: useTimeStore.getState().loopRegion,
    viewAspect: state.viewAspect,
  }
}

/** Document → stores. The inverse of serialize(); same shape HistoryStore
 *  restores into on undo (setState shallow-merges; actions are untouched). */
export function hydrate(doc: ProjectDocument) {
  const { schemaVersion: _v, audioClips, videoClips, photoClips, loopRegion, viewAspect, ...fields } = doc
  void _v
  const activeSceneId = fields.activeSceneId && fields.scenes[fields.activeSceneId]
    ? fields.activeSceneId
    : fields.sceneOrder.find((id) => !fields.scenes[id]?.isMain) ?? fields.sceneOrder[0]
  const scene = fields.scenes[activeSceneId]
  useProjectStore.setState({
    ...fields,
    activeSceneId,
    tracks: { ...fields.audioTracks, ...(scene?.tracks ?? {}) },
    rootTrackIds: [...fields.audioRootTrackIds, ...(scene?.rootTrackIds ?? [])],
    // Explicit default: an older save without the field must reset the store,
    // not inherit whatever the previously open project had.
    viewAspect: viewAspect ?? 'fill',
  })
  useAudioStore.setState({ audioClips: audioClips ?? {} })
  useVideoStore.setState({ videoClips: videoClips ?? {} })
  usePhotoStore.setState({ photoClips: photoClips ?? {} })
  useTimeStore.setState({ loopRegion: loopRegion ?? null })
}
