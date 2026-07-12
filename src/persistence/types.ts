import type { Track } from '../editor/types'
import type { AudioClip } from '../editor/store/AudioStore'
import type { VideoClip } from '../editor/store/VideoStore'
import type { PhotoClip } from '../editor/store/PhotoStore'
import type { LoopRegion } from '../editor/core/loopRegion'

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
 * (the Video instrument's SOURCE catalog) is additive within v3 - absent in
 * older saves, defaulted on hydrate.
 * v4: video pads - each track's `videoRefs: string[]` became
 * `videoPads: VideoPad[]` ((source, in-point) pairs; see upgrade.ts). The
 * `videoClips` source catalog is unchanged.
 * `photoClips` (the Photo instrument's SOURCE catalog) is additive within v4 -
 * absent in older saves, defaulted on hydrate; photo placement lives inside
 * `tracks` as `photoPads`. No schema bump: purely additive.
 * `loopRegion` is also additive within v4; older saves hydrate it as unset.
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
  photoClips?: Record<string, PhotoClip>
  loopRegion?: LoopRegion | null
}

/** A fresh, valid document - matches the stores' initial state. */
export function emptyDocument(): ProjectDocument {
  return {
    schemaVersion: 4,
    bpm: 120,
    beatsPerBar: 4,
    totalBars: 32,
    tracks: {},
    rootTrackIds: [],
    audioClips: {},
    videoClips: {},
    photoClips: {},
    loopRegion: null,
  }
}
