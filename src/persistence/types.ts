import type { Track } from '../editor/types'
import type { AudioClip } from '../editor/store/AudioStore'

/**
 * The serialized project - the shape of the `projects.data` blob. A thin
 * envelope over the editor's own model: the non-function fields of
 * ProjectStore, plus the audioClips catalog and a schemaVersion that
 * drives upgradeDocument() on load.
 *
 * The field list deliberately mirrors ProjectStore's state; serialize() picks
 * fields generically (like HistoryStore does), so a field added to the store
 * is persisted by default without touching this file's runtime behavior -
 * only this type needs the new field to stay honest.
 *
 * v2: `audioClips` (the catalog, keyed by ref) replaced v1's single `audioClip`;
 * audio placement lives inside `tracks` as `audioBlocks`.
 */
export interface ProjectDocument {
  schemaVersion: number
  bpm: number
  beatsPerBar: number
  totalBars: number
  tracks: Record<string, Track>
  rootTrackIds: string[]
  audioClips: Record<string, AudioClip>
}

/** A fresh, valid document - matches ProjectStore's + AudioStore's initial state. */
export function emptyDocument(): ProjectDocument {
  return {
    schemaVersion: 2,
    bpm: 120,
    beatsPerBar: 4,
    totalBars: 32,
    tracks: {},
    rootTrackIds: [],
    audioClips: {},
  }
}
