import { useProjectStore, viewForScene } from '../editor/store/ProjectStore'
import { useAudioStore } from '../editor/store/AudioStore'
import { useVideoStore } from '../editor/store/VideoStore'
import { usePhotoStore } from '../editor/store/PhotoStore'
import { useTimeStore } from '../editor/store/TimeStore'
import { useUIStore } from '../editor/store/UIStore'
import type { ProjectDocument } from './types'
import { CURRENT_VERSION } from './upgrade'

/**
 * ProjectStore state → document. Add persisted fields here and to
 * ProjectDocument; the flattened scene view stays out of the document.
 * Media catalogs and the loop region ride along from their own stores.
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
    appliedTemplateId: state.appliedTemplateId,
  }
}

/** Document → stores. The inverse of serialize(); same shape HistoryStore
 *  restores into on undo (setState shallow-merges; actions are untouched). */
export function hydrate(doc: ProjectDocument) {
  const { schemaVersion: _v, audioClips, videoClips, photoClips, loopRegion, viewAspect, appliedTemplateId, ...fields } = doc
  void _v
  const activeSceneId = fields.activeSceneId && fields.scenes[fields.activeSceneId]
    ? fields.activeSceneId
    : fields.sceneOrder.find((id) => !fields.scenes[id]?.isMain) ?? fields.sceneOrder[0]
  useProjectStore.setState({
    ...fields,
    activeSceneId,
    // Through viewForScene rather than inline, so a loaded project gets the
    // same flattened view every other path builds - including the virtual
    // scene instrument (core/sceneTrack.ts), which is derived and therefore
    // absent from the saved document.
    ...viewForScene(fields.scenes, activeSceneId, fields.audioTracks, fields.audioRootTrackIds),
    // Explicit default: an older save without the field must reset the store,
    // not inherit whatever the previously open project had.
    viewAspect: viewAspect ?? 'fill',
    appliedTemplateId: appliedTemplateId ?? null,
  })
  useAudioStore.setState({ audioClips: audioClips ?? {} })
  useVideoStore.setState({ videoClips: videoClips ?? {} })
  usePhotoStore.setState({ photoClips: photoClips ?? {} })
  // Playhead back to the start. currentBeat is session-scoped module state
  // that survives client-side navigation, so without this a newly opened (or
  // freshly created) project inherits wherever the PREVIOUS project's playhead
  // happened to sit and the timeline starts mid-song. Only project loads come
  // through hydrate - undo restores ProjectStore directly - so undo never
  // yanks the playhead.
  useTimeStore.setState({ loopRegion: loopRegion ?? null, currentBeat: 0 })
  // The timeline's scroll is the same kind of session-scoped module state, and
  // needs the same reset for the same reason: TimelineArea restores it from
  // here on mount (so returning from the MIDI editor lands where you left
  // off), so without this a newly opened or freshly CREATED project inherits
  // the previous one's scroll - and since an empty project is narrower, the
  // browser clamps that offset to the end and the tracks area opens hard
  // against its right edge, past the end of a song that isn't there yet.
  useUIStore.setState({ tracksScrollLeft: 0, tracksScrollTop: 0 })
}
