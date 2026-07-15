import { DEFAULT_SCENE_BACKGROUND, type Scene, type Track } from '../editor/types'
import type { AudioClip } from '../editor/store/AudioStore'
import type { VideoClip } from '../editor/store/VideoStore'
import type { PhotoClip } from '../editor/store/PhotoStore'
import type { LoopRegion } from '../editor/core/loopRegion'
import type { ViewAspect } from '../editor/store/ProjectStore'

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
 * v5 introduced scenes; v6 adds each scene's background color; v7 removes
 * retired event-modifier tracks; v8 adds transparent scene backgrounds; v9
 * replaces the basic shapes' numeric hue with a concrete color string.
 */
export interface ProjectDocument {
  schemaVersion: number
  bpm: number
  beatsPerBar: number
  totalBars: number
  scenes: Record<string, Scene>
  /** Display order, including Main first. Exactly one referenced scene has isMain=true. */
  sceneOrder: string[]
  /** Last selected editor tab. Optional so early v5 documents still hydrate. */
  activeSceneId?: string
  /** Audio remains project-global and is projected into every scene timeline. */
  audioTracks: Record<string, Track>
  audioRootTrackIds: string[]
  audioClips: Record<string, AudioClip>
  videoClips?: Record<string, VideoClip>
  photoClips?: Record<string, PhotoClip>
  loopRegion?: LoopRegion | null
  /** Editor viewport aspect pin. Additive within v9 - absent in older saves,
   *  defaulted to 'fill' on hydrate. No schema bump: purely additive. */
  viewAspect?: ViewAspect
}

/** A fresh, valid document - matches the stores' initial state. */
export function emptyDocument(): ProjectDocument {
  const mainId = crypto.randomUUID()
  const firstSceneId = crypto.randomUUID()
  return {
    schemaVersion: 9,
    bpm: 120,
    beatsPerBar: 4,
    totalBars: 32,
    scenes: {
      [mainId]: { id: mainId, name: 'Main', isMain: true, backgroundColor: DEFAULT_SCENE_BACKGROUND, backgroundTransparent: false, tracks: {}, rootTrackIds: [] },
      [firstSceneId]: { id: firstSceneId, name: 'Scene 1', isMain: false, backgroundColor: DEFAULT_SCENE_BACKGROUND, backgroundTransparent: false, tracks: {}, rootTrackIds: [] },
    },
    sceneOrder: [mainId, firstSceneId],
    activeSceneId: firstSceneId,
    audioTracks: {},
    audioRootTrackIds: [],
    audioClips: {},
    videoClips: {},
    photoClips: {},
    loopRegion: null,
    viewAspect: 'fill',
  }
}
