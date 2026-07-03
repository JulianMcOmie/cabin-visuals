import { useProjectStore } from '../editor/store/ProjectStore'
import { useAudioStore } from '../editor/store/AudioStore'
import type { ProjectDocument } from './types'
import { CURRENT_VERSION } from './upgrade'

/**
 * ProjectStore state → document. Picks fields generically (every non-function
 * field), the same boundary HistoryStore snapshots — so a field added to the
 * store is persisted by default, with no extra wiring. The audio clip
 * descriptor rides along from AudioStore (metadata only; bytes are
 * audioStorage's job).
 */
export function serialize(state = useProjectStore.getState()): ProjectDocument {
  const doc: Record<string, unknown> = { schemaVersion: CURRENT_VERSION }
  const s = state as unknown as Record<string, unknown>
  for (const k in s) if (typeof s[k] !== 'function') doc[k] = s[k]
  doc.audioClip = useAudioStore.getState().clip
  return doc as unknown as ProjectDocument
}

/** Document → stores. The inverse of serialize(); same shape HistoryStore
 *  restores into on undo (setState shallow-merges; actions are untouched). */
export function hydrate(doc: ProjectDocument) {
  const { schemaVersion: _v, audioClip, ...fields } = doc
  useProjectStore.setState(fields)
  useAudioStore.setState({ clip: audioClip ?? null })
}
