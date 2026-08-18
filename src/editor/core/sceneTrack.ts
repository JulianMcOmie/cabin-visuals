// The scene instrument - the scene itself, exposed as a device you can point
// movers, colorizers and automation lanes at.
//
// It is a VIRTUAL track, and that is the whole design: `Scene.tracks` never
// holds an entry for it and `Scene.rootTrackIds` never mentions it. Its state
// is three optional fields on the Scene (see editor/types.ts), and THIS file is
// the one place that turns them into a synthetic `group` track. Every reader -
// the timeline, the inspector, the resolver, the engine - then sees an ordinary
// track and needs no branch of its own; ProjectStore's set() wrapper calls
// `dematerializeSceneTrack` to fold edits back down onto the Scene.
//
// Two things it deliberately is NOT:
//
// - **Not the parent of your tracks in the document.** Its `childIds` are only
//   its own lanes, so turning it on does not re-indent the arrangement, does not
//   move a single id out of `rootTrackIds`, and cannot be undone into a
//   different track forest. The "applies to the whole scene" part is done by the
//   RESOLVER (core/visual/resolve.ts), which parents every root object on it and
//   broadcasts its chain entries to all of them.
// - **Not a real group you can drag things into.** Nothing may be re-parented
//   onto it except the lanes it accepts; `isSceneTrackId` is the guard every
//   destructive/structural store action checks.
//
// React-free on purpose - the store, the engine and the UI all import it.

import type { Scene, Track } from '../types'

/** Ids are derived from the scene id, never minted, so the same scene always
 *  produces the same track id across reloads, undo and re-materialization -
 *  which is what lets UIStore selection, collapsed sets and the inspector hold
 *  a reference to something that does not exist in the document. */
const SCENE_TRACK_ID_PREFIX = 'scene-track:'

export function sceneTrackId(sceneId: string): string {
  return `${SCENE_TRACK_ID_PREFIX}${sceneId}`
}

export function isSceneTrackId(id: string | undefined | null): boolean {
  return !!id && id.startsWith(SCENE_TRACK_ID_PREFIX)
}

/** The scene instrument's own colour - a neutral pewter, deliberately outside
 *  the OKLCH hue cycle new tracks walk (utils/trackColors.ts) so the scene row
 *  never reads as "just another track that happens to be first". */
export const SCENE_TRACK_COLOR = '#8a8f9c'

/** Child types the scene instrument accepts. Object tracks are NOT among them:
 *  the scene already contains every object in it, so nesting one would be
 *  saying the same thing twice, and `rootTrackIds` is where objects live. */
const SCENE_CHAIN_CHILD_TYPES = new Set<Track['type']>(['mover', 'splitter', 'automation'])

export function canBeSceneTrackChild(track: Pick<Track, 'type'>): boolean {
  return SCENE_CHAIN_CHILD_TYPES.has(track.type)
}

export interface SceneTrackView {
  tracks: Record<string, Track>
  rootTrackIds: string[]
}

// Memoized on the Scene object's identity. ProjectStore updates immutably, so a
// scene that did not change keeps its view - which matters twice over: React
// rows memo on track identity (components/CLAUDE.md's render budget), and the
// visual engine reuses a scene's whole resolved graph when `tracks` and
// `rootTrackIds` are referentially unchanged (core/visual/CLAUDE.md). Building
// a fresh object per call would quietly defeat both.
const viewCache = new WeakMap<Scene, SceneTrackView>()

/** The scene's track forest as every reader should see it: unchanged when the
 *  scene instrument is off, and with the synthetic scene track spliced in at
 *  the FRONT of the roots when it is on.
 *
 *  Front is load-bearing. `resolveProject` walks roots depth-first and gives a
 *  group its DFS slot (`afterObjectIndex`), so the scene node must be composed
 *  before any object reads it as a parent. */
export function sceneTrackView(scene: Scene): SceneTrackView {
  const cached = viewCache.get(scene)
  if (cached) return cached
  const view = buildView(scene)
  viewCache.set(scene, view)
  return view
}

// A scene lane's `parentId` must name the synthetic track, because that is how
// every consumer decides what it is: `isChainChild` in resolve.ts reads
// `p.tracks[track.parentId]` to tell a chain entry from a globally-routed mover,
// and the inspector resolves a lane's parent the same way. Rather than trust the
// stored field (undo, duplicateScene and hand-built fixtures all have to get it
// right), the view normalizes it - cached on the ORIGINAL track's identity so a
// normalized lane keeps its reference across re-materialization, which is what
// resolve.ts's per-track WeakMap cache and the memo'd timeline rows compare on.
const reparentCache = new WeakMap<Track, Track>()

function withSceneParent(track: Track, parentId: string): Track {
  if (track.parentId === parentId) return track
  const cached = reparentCache.get(track)
  if (cached && cached.parentId === parentId) return cached
  const next = { ...track, parentId }
  reparentCache.set(track, next)
  return next
}

function buildView(scene: Scene): SceneTrackView {
  if (!scene.sceneTrackEnabled) {
    // Identity-preserving: the pre-feature document, byte for byte.
    return { tracks: scene.tracks, rootTrackIds: scene.rootTrackIds }
  }
  const id = sceneTrackId(scene.id)
  // Only lanes that still exist - a deleted lane must not leave a dangling id,
  // because flattenTree would silently stop walking the rest of the children.
  const childIds = (scene.sceneTrackChildIds ?? []).filter((cid) => !!scene.tracks[cid])
  const track: Track = {
    id,
    name: scene.name,
    type: 'group',
    instrumentId: '',
    params: scene.sceneTrackParams,
    stringParams: scene.sceneTrackStringParams,
    effects: scene.effects,
    color: SCENE_TRACK_COLOR,
    muted: false,
    solo: false,
    blocks: [],
    childIds,
  }
  const tracks: Record<string, Track> = { ...scene.tracks, [id]: track }
  for (const cid of childIds) tracks[cid] = withSceneParent(scene.tracks[cid], id)
  return { tracks, rootTrackIds: [id, ...scene.rootTrackIds] }
}

/**
 * The inverse of `sceneTrackView`: split a written-through view back into the
 * Scene's own fields. ProjectStore's set() wrapper runs this on every edit that
 * touches `tracks`/`rootTrackIds`, so an ordinary action (`setTrackParam`,
 * `addTrack`, `removeTrack`, a nest drag) reaches the scene instrument with no
 * special case of its own.
 *
 * Returns the fields to merge onto the Scene. `tracks` and `rootTrackIds` come
 * back with every trace of the synthetic track removed.
 */
export function dematerializeSceneTrack(
  sceneId: string,
  tracks: Record<string, Track>,
  rootTrackIds: string[],
): Pick<Scene, 'tracks' | 'rootTrackIds' | 'effects' | 'sceneTrackParams' | 'sceneTrackStringParams' | 'sceneTrackChildIds'> {
  const id = sceneTrackId(sceneId)
  const synthetic = tracks[id]
  if (!synthetic) {
    return {
      tracks,
      rootTrackIds: rootTrackIds.filter((rid) => rid !== id),
      sceneTrackParams: undefined,
      sceneTrackStringParams: undefined,
      sceneTrackChildIds: undefined,
    }
  }
  const rest: Record<string, Track> = {}
  for (const [tid, track] of Object.entries(tracks)) {
    if (tid === id) continue
    rest[tid] = track
  }
  return {
    tracks: rest,
    rootTrackIds: rootTrackIds.filter((rid) => rid !== id),
    // The scene instrument's effect chain IS `Scene.effects` - the same chain
    // the inspector shows when nothing is selected. Folding it back here is
    // what lets the ordinary per-track effect actions (addEffect, toggleEffect,
    // reorderEffect) drive it with no special case in TrackEditor. (The engine
    // still does not APPLY scene effects - see Scene.effects in types.ts.)
    effects: synthetic.effects,
    // Empty is stored as absence so an untouched scene instrument grows no
    // fields and a save written before this feature round-trips identically.
    sceneTrackParams: emptyOrUndefined(synthetic.params),
    sceneTrackStringParams: emptyOrUndefined(synthetic.stringParams),
    sceneTrackChildIds: synthetic.childIds.length ? [...synthetic.childIds] : undefined,
  }
}

function emptyOrUndefined<T extends object>(value: T | undefined): T | undefined {
  return value && Object.keys(value).length > 0 ? value : undefined
}
