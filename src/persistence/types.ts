import type { Track } from '../editor/types'
import type { AudioClip } from '../editor/store/AudioStore'
import type { VideoClip } from '../editor/store/VideoStore'

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
 * v3: track type 'dimension' became 'mover' (see upgrade.ts). `videoClips`
 * (the Video instrument's catalog; placement is `track.videoRefs`) is additive
 * within v3 - absent in older saves, defaulted on hydrate.
 */
export interface ProjectDocument {
  schemaVersion: number
  bpm: number
  beatsPerBar: number
  totalBars: number
  tracks: Record<string, Track>
  rootTrackIds: string[]
  audioClips: Record<string, AudioClip>
  videoClips?: Record<string, VideoClip>
}

/** A fresh, valid document - matches the stores' initial state. */
export function emptyDocument(): ProjectDocument {
  return {
    schemaVersion: 3,
    bpm: 120,
    beatsPerBar: 4,
    totalBars: 32,
    tracks: {},
    rootTrackIds: [],
    audioClips: {},
    videoClips: {},
  }
}
