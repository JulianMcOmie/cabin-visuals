import { DEFAULT_SCENE_BACKGROUND, type Scene, type Track } from '../editor/types'
import { defaultLightingTracks } from '../editor/core/defaultLighting'
import type { AudioClip } from '../editor/store/AudioStore'
import type { VideoClip } from '../editor/store/VideoStore'
import type { PhotoClip } from '../editor/store/PhotoStore'
import type { LoopRegion } from '../editor/core/loopRegion'
import type { ViewAspect } from '../editor/store/ProjectStore'

/**
 * The serialized project - the shape of the `projects.data` blob. A thin
 * envelope over the editor's document state, plus media catalogs, the loop
 * region, and a schemaVersion that drives upgradeDocument() on load.
 *
 * Add persisted fields to both this type and serialize()'s explicit field
 * list, and default additive fields on hydrate for older saves.
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
 * v10 renames the transform param keys onto the canonical tf* set; v11 pins
 * pre-existing Oscilloscopes to full-frame; v12 de-specializes directors -
 * track type 'director' + directorId became type 'base' + a composition
 * instrumentId (sceneBindings unchanged). v14 pins pre-FINISH 3D Shapes to
 * Gloss. v15 is the Text Display clips redesign: the `text`/`color`/`font`
 * params move onto per-track `lyricClips` + `styleLanes`, word notes revoice
 * from pitch 48 onto the style-lane band (PLAIN = 58), the 60-72 height band
 * retires, and `wordFormation` child tracks are converted to clip layouts and
 * dropped.
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
  /** The template (or lyric style) the project is currently on, so the editor's
   *  Templates tab can mark it. Template documents carry their own id here and
   *  it rides through create-from-template verbatim; applyTemplate re-stamps
   *  it. Additive within v9 - absent means unknown/scratch. */
  appliedTemplateId?: string | null
  /** Small captured frame (JPEG data URL) for the projects-page card. Written
   *  by autosave when the editor's canvas is available; absent otherwise. */
  thumbnail?: string
}

/** A fresh, valid document - matches the stores' initial state. */
export function emptyDocument(): ProjectDocument {
  const mainId = crypto.randomUUID()
  const firstSceneId = crypto.randomUUID()
  // The seeded Lighting group every visual scene is born with. Saved blobs of
  // this document later walk UPGRADES[17], whose has-a-light-track guard keeps
  // it from seeding a second rig.
  const lighting = defaultLightingTracks()
  return {
    // Keep in step with upgrade.ts's CURRENT_VERSION (a literal here because
    // upgrade.ts imports this module - the constant would be a cycle). A stale
    // stamp is harmless today (fresh docs re-walk no-op steps on load) but
    // misleading to read.
    schemaVersion: 12,
    bpm: 120,
    beatsPerBar: 4,
    totalBars: 32,
    scenes: {
      [mainId]: { id: mainId, name: 'Composite', isMain: true, backgroundColor: DEFAULT_SCENE_BACKGROUND, backgroundTransparent: false, tracks: {}, rootTrackIds: [] },
      [firstSceneId]: { id: firstSceneId, name: 'Scene 1', isMain: false, backgroundColor: DEFAULT_SCENE_BACKGROUND, backgroundTransparent: false, tracks: lighting.tracks, rootTrackIds: [lighting.rootId] },
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
