import type { Track } from '../editor/types'
import type { AudioClip } from '../editor/store/AudioStore'

/**
 * The serialized project — the shape of the `projects.data` blob. A thin
 * envelope over the editor's own model: the non-function fields of
 * ProjectStore, plus the audio clip descriptor and a schemaVersion that
 * drives upgradeDocument() on load.
 *
 * The field list deliberately mirrors ProjectStore's state; serialize() picks
 * fields generically (like HistoryStore does), so a field added to the store
 * is persisted by default without touching this file's runtime behavior —
 * only this type needs the new field to stay honest.
 */
export interface ProjectDocument {
  schemaVersion: number
  bpm: number
  beatsPerBar: number
  totalBars: number
  tracks: Record<string, Track>
  rootTrackIds: string[]
  audioClip?: AudioClip | null
}

/** A fresh, valid document — matches the DB column default in db/schema.ts
 *  and ProjectStore's initial state. */
export function emptyDocument(): ProjectDocument {
  return {
    schemaVersion: 1,
    bpm: 120,
    beatsPerBar: 4,
    totalBars: 32,
    tracks: {},
    rootTrackIds: [],
  }
}
