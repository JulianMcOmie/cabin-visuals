import { useProjectStore } from '../editor/store/ProjectStore'
import { useAudioStore } from '../editor/store/AudioStore'
import { useVideoStore } from '../editor/store/VideoStore'
import { usePhotoStore } from '../editor/store/PhotoStore'
import type { ProjectDocument } from './types'
import { CURRENT_VERSION } from './upgrade'

/**
 * ProjectStore state → document. Picks fields generically (every non-function
 * field), the same boundary HistoryStore snapshots - so a field added to the
 * store is persisted by default, with no extra wiring. The audioClips catalog
 * rides along from AudioStore (metadata only; bytes are the bucket's job).
 */
export function serialize(state = useProjectStore.getState()): ProjectDocument {
  const doc: Record<string, unknown> = { schemaVersion: CURRENT_VERSION }
  const s = state as unknown as Record<string, unknown>
  for (const k in s) if (typeof s[k] !== 'function') doc[k] = s[k]
  doc.audioClips = useAudioStore.getState().audioClips
  doc.videoClips = useVideoStore.getState().videoClips
  doc.photoClips = usePhotoStore.getState().photoClips
  return doc as unknown as ProjectDocument
}

/** Document → stores. The inverse of serialize(); same shape HistoryStore
 *  restores into on undo (setState shallow-merges; actions are untouched). */
export function hydrate(doc: ProjectDocument) {
  const { schemaVersion: _v, audioClips, videoClips, photoClips, ...fields } = doc
  useProjectStore.setState(fields)
  useAudioStore.setState({ audioClips: audioClips ?? {} })
  useVideoStore.setState({ videoClips: videoClips ?? {} })
  usePhotoStore.setState({ photoClips: photoClips ?? {} })
}
