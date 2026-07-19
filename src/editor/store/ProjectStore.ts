import { create } from 'zustand'
import { getEffect } from '../effects'
import { MOVER_TRACK_COLOR, AUDIO_TRACK_COLOR, OBJECT_TRACK_COLOR } from '../utils/trackColors'
import { getMoverOrSplitterDefinition } from '../core/visualCopies/registry'
import { loopLengthBeats, tileLoopNotes } from '../core/visual/noteFlatten'
import { DEFAULT_ADSR } from '../core/visual/adsr'
import type { ImportedMidiTrack } from '../core/midiImport'
import { placeTranscription, type LyricWord, type TranscribedWord } from '../utils/lyricPlacement'
import { DEFAULT_SCENE_BACKGROUND, type Scene, type Track, type Block, type Note, type AudioBlock, type AdsrEnvelope, type EffectInstance, type InterpolationMode, type VideoPad, type PhotoPad, type Routing } from '../types'
import type { ProjectDocument } from '../../persistence/types'

export const MIN_BPM = 20
export const MAX_BPM = 300
export const MIN_TOTAL_BARS = 1
export const MAX_TOTAL_BARS = 512

// Deep-clone with fresh IDs at every level (used by paste + alt-drag duplicate).
const cloneNote = (n: Note): Note => ({ ...n, id: crypto.randomUUID() })
export const cloneBlock = (b: Block): Block => ({
  ...b,
  id: crypto.randomUUID(),
  notes: b.notes.map(cloneNote),
})
const cloneAudioBlock = (b: AudioBlock): AudioBlock => ({ ...b, id: crypto.randomUUID() })
const BLOCK_SPLIT_EPSILON_BEATS = 0.000001

type IdFactory = () => string

function splitNotePart(note: Note, startBeat: number, endBeat: number, shiftBeat: number, id: string | IdFactory): Note | null {
  const noteStart = note.startBeat
  const noteEnd = note.startBeat + note.durationBeats
  const clippedStart = Math.max(startBeat, noteStart)
  const clippedEnd = Math.min(endBeat, noteEnd)
  if (clippedEnd - clippedStart <= BLOCK_SPLIT_EPSILON_BEATS) return null
  return {
    ...note,
    id: typeof id === 'function' ? id() : id,
    startBeat: clippedStart - shiftBeat,
    durationBeats: clippedEnd - clippedStart,
  }
}

export function splitBlockAtBeat(
  block: Block,
  splitBeat: number,
  beatsPerBar: number,
  makeId: IdFactory = () => crypto.randomUUID(),
): { left: Block; right: Block } | null {
  const blockStartBeat = block.startBar * beatsPerBar
  const blockDurationBeats = block.durationBars * beatsPerBar
  const blockEndBeat = blockStartBeat + blockDurationBeats
  if (
    splitBeat <= blockStartBeat + BLOCK_SPLIT_EPSILON_BEATS
    || splitBeat >= blockEndBeat - BLOCK_SPLIT_EPSILON_BEATS
  ) {
    return null
  }

  const splitOffsetBeats = splitBeat - blockStartBeat
  const leftDurationBars = splitOffsetBeats / beatsPerBar
  const rightDurationBars = (blockEndBeat - splitBeat) / beatsPerBar
  const left: Block = {
    ...block,
    durationBars: leftDurationBars,
  }
  const right: Block = {
    ...block,
    id: makeId(),
    startBar: splitBeat / beatsPerBar,
    durationBars: rightDurationBars,
  }

  if (block.loop) {
    // Both halves keep looping. The right half starts mid-stream, so each note
    // shifts by the split offset modulo the loop length - the phase its repeats
    // had before the cut, kept inside the pattern window [0, loop length).
    // The loop length is pinned explicitly on both halves because the right
    // half's re-phased notes could infer a different one.
    const loopBeats = loopLengthBeats(block, beatsPerBar)
    const loopLengthBars = loopBeats / beatsPerBar
    return {
      left: { ...left, loopLengthBars },
      right: {
        ...right,
        loopLengthBars,
        notes: block.notes.map((note) => {
          const rem = (note.startBeat - splitOffsetBeats) % loopBeats
          return {
            ...note,
            id: makeId(),
            startBeat: rem < 0 ? rem + loopBeats : rem,
          }
        }),
      },
    }
  }

  const leftNotes: Note[] = []
  const rightNotes: Note[] = []
  for (const note of block.notes) {
    const leftPart = splitNotePart(note, 0, splitOffsetBeats, 0, note.id)
    if (leftPart) leftNotes.push(leftPart)

    const rightPart = splitNotePart(note, splitOffsetBeats, blockDurationBeats, splitOffsetBeats, makeId)
    if (rightPart) rightNotes.push(rightPart)
  }

  return {
    left: { ...left, notes: leftNotes },
    right: { ...right, notes: rightNotes },
  }
}

export interface TrackTreeSnapshot {
  rootId: string
  tracks: Record<string, Track>
}

function cloneRoutingScope(scope: NonNullable<Track['targets']>[number]['scope'], idMap: Map<string, string>): NonNullable<Track['targets']>[number]['scope'] {
  if (scope.kind === 'tag') return { ...scope }
  return { ...scope, id: idMap.get(scope.id) ?? scope.id }
}

function cloneTrackRecord(t: Track, id: string, parentId: string | null, childIds: string[], idMap: Map<string, string>): Track {
  return {
    ...t,
    id,
    params: t.params ? { ...t.params } : undefined,
    stringParams: t.stringParams ? { ...t.stringParams } : undefined,
    blocks: t.blocks.map(cloneBlock),
    childIds,
    parentId: parentId ?? undefined,
    tags: t.tags ? [...t.tags] : undefined,
    targets: t.targets?.map((r) => ({ ...r, scope: cloneRoutingScope(r.scope, idMap) })),
    inputValues: t.inputValues ? { ...t.inputValues } : undefined,
    effects: t.effects?.map((e) => ({ ...e, id: crypto.randomUUID(), settings: { ...e.settings } })),
    audioBlocks: t.audioBlocks?.map(cloneAudioBlock),
  }
}

export const cloneTrack = (t: Track): Track => ({
  ...cloneTrackRecord(t, crypto.randomUUID(), t.parentId ?? null, [], new Map()),
})

export function snapshotTrackTree(rootId: string, tracks: Record<string, Track>): TrackTreeSnapshot | null {
  if (!tracks[rootId]) return null
  const out: Record<string, Track> = {}
  const seen = new Set<string>()
  const visit = (id: string) => {
    if (seen.has(id)) return
    const track = tracks[id]
    if (!track) return
    seen.add(id)
    out[id] = track
    for (const childId of track.childIds) visit(childId)
  }
  visit(rootId)
  return { rootId, tracks: out }
}

export function cloneTrackTree(snapshot: TrackTreeSnapshot, parentId?: string | null): Track[] {
  const root = snapshot.tracks[snapshot.rootId]
  if (!root) return []
  const ids = Object.keys(snapshot.tracks)
  const idMap = new Map(ids.map((id) => [id, crypto.randomUUID()]))
  const out: Track[] = []
  const visit = (oldId: string, nextParentId: string | null) => {
    const src = snapshot.tracks[oldId]
    const nextId = idMap.get(oldId)
    if (!src || !nextId) return
    const nextChildIds = src.childIds
      .filter((childId) => snapshot.tracks[childId])
      .map((childId) => idMap.get(childId)!)
    out.push(cloneTrackRecord(src, nextId, nextParentId, nextChildIds, idMap))
    for (const childId of src.childIds) {
      if (snapshot.tracks[childId]) visit(childId, nextId)
    }
  }
  visit(snapshot.rootId, parentId === undefined ? root.parentId ?? null : parentId)
  return out
}

/** Audio tracks sit as a pinned block at the top of the root list (the backing
 *  tracks lead the arrangement) - nothing non-audio may land above them.
 *  Returns the first root index open to other tracks. */
export function audioPinnedCount(tracks: Record<string, Track>, rootTrackIds: string[]): number {
  let n = 0
  while (n < rootTrackIds.length && tracks[rootTrackIds[n]]?.type === 'audio') n++
  return n
}

function insertTrackTreeIntoState(
  s: ProjectState,
  tree: Track[],
  atIndex?: number,
): Pick<ProjectState, 'tracks'> | Pick<ProjectState, 'tracks' | 'rootTrackIds'> {
  if (tree.length === 0) return { tracks: s.tracks }
  const root = tree[0]
  const tracks = { ...s.tracks }
  for (const track of tree) tracks[track.id] = track

  if (root.parentId) {
    const parent = tracks[root.parentId]
    if (parent) {
      const childIds = parent.childIds.filter((id) => id !== root.id)
      const i = atIndex == null || atIndex < 0 || atIndex > childIds.length ? childIds.length : atIndex
      childIds.splice(i, 0, root.id)
      tracks[root.parentId] = { ...parent, childIds }
      return { tracks }
    }
    tracks[root.id] = { ...root, parentId: undefined }
  }

  const rootTrackIds = [...s.rootTrackIds]
  const min = audioPinnedCount(tracks, rootTrackIds)
  if (atIndex == null || atIndex < 0 || atIndex > rootTrackIds.length) rootTrackIds.push(root.id)
  else rootTrackIds.splice(Math.max(min, atIndex), 0, root.id)
  return { tracks, rootTrackIds }
}

/** Editor viewport aspect pin - a project-level display setting. */
export type ViewAspect = 'fill' | '16:9' | '9:16'

export interface ProjectState {
  scenes: Record<string, Scene>
  /** Main first, followed by visual scenes in tab order. */
  sceneOrder: string[]
  /** Selected editor tab. Persisted with the project, but omitted from undo history. */
  activeSceneId: string
  /** Project-global audio, projected into every active scene's compatibility view. */
  audioTracks: Record<string, Track>
  audioRootTrackIds: string[]
  /** Compatibility view of active scene + global audio. Existing editor gestures
   * keep using this while scene ownership lives exclusively in `scenes`. */
  tracks: Record<string, Track>
  rootTrackIds: string[]
  // Project-level musical settings. Here (not TimeStore) so they're part of the
  // undoable document; currentBeat/isPlaying stay in TimeStore (ephemeral transport).
  bpm: number
  beatsPerBar: number
  totalBars: number
  /** The editor viewport's pinned aspect ('fill' = fill the panel). A project
   *  setting: persisted with the document, and 16:9/9:16 seeds the export
   *  dialog's default aspect. */
  viewAspect: ViewAspect
  setActiveScene: (sceneId: string) => void
  addScene: () => string
  renameScene: (sceneId: string, name: string) => void
  setSceneBackgroundColor: (sceneId: string, color: string) => void
  setSceneBackgroundTransparent: (sceneId: string, transparent: boolean) => void
  duplicateScene: (sceneId: string) => string | null
  deleteScene: (sceneId: string) => void
  reorderScenes: (sceneIds: string[]) => void
  addTrack: (track: Track, atIndex?: number) => void
  addBlock: (trackId: string, block: Block) => void
  addBlocks: (trackId: string, blocks: Block[]) => void
  addNote: (trackId: string, blockId: string, note: Note) => void
  updateBlockNotes: (trackId: string, blockId: string, notes: Note[]) => void
  updateBlock: (trackId: string, blockId: string, updates: Partial<Block>) => void
  moveBlock: (fromTrackId: string, blockId: string, toTrackId: string) => void
  deleteBlock: (trackId: string, blockId: string) => void
  deleteBlocks: (blockIds: Set<string>) => void
  splitBlocksAtBeat: (blockIds: Set<string>, beat: number) => Set<string> | null
  joinBlocks: (blockIds: Set<string>) => Set<string> | null
  deleteTrack: (trackId: string) => void
  /** Move one root track and its complete child subtree to another compatible scene. */
  moveTrackToScene: (trackId: string, targetSceneId: string) => void
  /** Returns the new copy's id (for selection), or null if the source vanished. */
  insertTrackCopy: (srcId: string, index: number) => string | null
  addTrackTree: (tree: Track[], atIndex?: number) => void
  reorderRootTracks: (orderedIds: string[]) => void
  /** Re-parent a track: parentId=null makes it a root. `index` positions it among
   *  its new siblings (root list or the parent's childIds). No-op on a cycle. */
  setTrackParent: (trackId: string, parentId: string | null, index?: number) => void
  renameTrack: (trackId: string, name: string) => void
  toggleMute: (trackId: string) => void
  toggleSolo: (trackId: string) => void
  setTrackParam: (trackId: string, key: string, value: number) => void
  setTrackStringParam: (trackId: string, key: string, value: string) => void
  setTrackInstrument: (trackId: string, instrumentId: string, name?: string) => void
  /** Convert a track into a mover row (no instrument). */
  setTrackMover: (trackId: string, moverId: string, name: string) => void
  setTrackDirector: (trackId: string, directorId: string, name: string) => void
  setDirectorSceneBindings: (trackId: string, bindings: NonNullable<Track['sceneBindings']>) => void
  addMoverTrack: (parentId: string, moverId: string, moverLabel: string) => void
  setMoverInput: (trackId: string, key: string, value: number) => void
  /** Add an `automation` child track under `parentId`, driving the given param over
   *  time. No-op if one already automates that param. */
  addAutomationTrack: (parentId: string, paramKey: string, paramLabel: string) => void
  /** Add an `ability` child track under `parentId` for one of the parent instrument's
   *  abilities (opt-in). No-op if that ability already has a track. */
  addAbilityTrack: (parentId: string, abilityKey: string, abilityLabel: string) => void
  /** Add an `envelope` child track under `parentId`: its notes gate an ADSR that
   *  modulates `targetParam` (a numeric parent param, an fx:<id>:<key> effect
   *  setting, or the reserved 'opacity' key). `envTarget` is the value reached at
   *  full gain (callers pass the param's max by default; omitted for 'opacity').
   *  No-op if an envelope already targets that param. */
  addEnvelopeTrack: (parentId: string, targetParam: string, targetLabel: string, envTarget?: number) => void
  setEnvelopeAdsr: (trackId: string, adsr: AdsrEnvelope) => void
  setEnvelopeDepth: (trackId: string, value: number) => void
  setEnvelopeTarget: (trackId: string, value: number) => void
  /** Set an automation track's interpolation mode between keyframes. */
  setTrackInterpolation: (trackId: string, mode: InterpolationMode) => void
  /** Set (or clear, with undefined) an automation track's noise mode. */
  setTrackNoise: (trackId: string, noise: Track['noise'] | undefined) => void
  setTrackTargets: (trackId: string, targets: Track['targets']) => void
  setTrackTags: (trackId: string, tags: string[]) => void
  /** Draw this object on top of everything (depth-ignored overlay). */
  setTrackOnTop: (trackId: string, onTop: boolean) => void
  /** Replace a Video track's ordered pads (its bank of source moments). */
  setTrackVideoPads: (trackId: string, videoPads: VideoPad[]) => void
  /** Replace a Photo track's ordered photos (its bank). */
  setTrackPhotoPads: (trackId: string, photoPads: PhotoPad[]) => void
  /** Create an audio track (top of the root tracks) holding one block at bar 0
   *  spanning the whole clip. The load pipeline's landing spot - the AudioBar
   *  button and files dropped on the track area both end here; a project can
   *  hold several. Returns the new track's id (for selection). */
  addAudioTrack: (clip: { ref: string; fileName: string; duration: number }) => string
  /** Create one root track per imported MIDI track (default instrument, one
   *  block spanning its notes, whole bars), growing totalBars if the content
   *  overruns. One set() so the whole import is a single undo step. Returns
   *  the new track ids in order. */
  importMidiTracks: (imported: ImportedMidiTrack[]) => string[]
  /** Fill a Text Display track with lyrics: one "Next word" note per word
   *  (beats are project-absolute), the words joined into the text param. A
   *  root track named 'Lyrics' (the lyric templates ship one, styled) is
   *  REFILLED in place - words swap, styling stays; otherwise a fresh track
   *  is created. Pass the aligner's sung-seconds `timing` so the track keeps
   *  seconds as its source of truth (setBpm re-derives the beats from it).
   *  One set() = one undo step. Returns the track id, or null when there are
   *  no words. */
  addLyricTrack: (words: LyricWord[], timing?: TranscribedWord[]) => string | null
  /** Switch the active scene onto a template: its visual tracks replace the
   *  scene's (audio tracks stay, and with a song present the song's BPM wins
   *  over the template's). Every id is reminted, so re-applying can never
   *  collide. One set() = one undo step. */
  applyTemplate: (templateDoc: ProjectDocument) => void
  addAudioBlock: (trackId: string, block: AudioBlock) => void
  updateAudioBlock: (trackId: string, blockId: string, updates: Partial<AudioBlock>) => void
  deleteAudioBlock: (trackId: string, blockId: string) => void
  // Visual effects (plugins) on a track.
  addEffect: (trackId: string, pluginId: string) => void
  removeEffect: (trackId: string, instanceId: string) => void
  setEffectSetting: (trackId: string, instanceId: string, key: string, value: number) => void
  toggleEffect: (trackId: string, instanceId: string) => void
  reorderEffect: (trackId: string, instanceId: string, direction: -1 | 1) => void
  setBpm: (bpm: number) => void
  setTotalBars: (bars: number) => void
  setViewAspect: (aspect: ViewAspect) => void
}

export type { LyricWord, TranscribedWord } from '../utils/lyricPlacement'

// Text Display's "advance to the next word" pitch (its PITCH_NEXT_WORD).
const TEXT_NEXT_WORD_PITCH = 48

function makeInitialScenes(): { scenes: Record<string, Scene>; sceneOrder: string[]; activeSceneId: string } {
  const mainId = crypto.randomUUID()
  const firstId = crypto.randomUUID()
  return {
    scenes: {
      [mainId]: { id: mainId, name: 'Main', isMain: true, backgroundColor: DEFAULT_SCENE_BACKGROUND, backgroundTransparent: false, tracks: {}, rootTrackIds: [] },
      [firstId]: { id: firstId, name: 'Scene 1', isMain: false, backgroundColor: DEFAULT_SCENE_BACKGROUND, backgroundTransparent: false, tracks: {}, rootTrackIds: [] },
    },
    sceneOrder: [mainId, firstId],
    activeSceneId: firstId,
  }
}

export function viewForScene(
  scenes: Record<string, Scene>,
  sceneId: string,
  audioTracks: Record<string, Track>,
  audioRootTrackIds: string[],
): Pick<ProjectState, 'tracks' | 'rootTrackIds'> {
  const scene = scenes[sceneId]
  return {
    tracks: { ...audioTracks, ...(scene?.tracks ?? {}) },
    rootTrackIds: [...audioRootTrackIds, ...(scene?.rootTrackIds ?? [])],
  }
}

export function sceneSnapshot(state: ProjectState, sceneId: string) {
  const scene = state.scenes[sceneId]
  return scene ? { tracks: scene.tracks, rootTrackIds: scene.rootTrackIds, bpm: state.bpm, beatsPerBar: state.beatsPerBar, totalBars: state.totalBars } : null
}

export const useProjectStore = create<ProjectState>((rawSet) => {
  const initial = makeInitialScenes()

  // Every legacy track edit writes the active compatibility view. Split that
  // patch back into global audio and the active scene before publishing it.
  const set = ((partial: unknown) => rawSet((s) => {
    const value = typeof partial === 'function'
      ? (partial as (state: ProjectState) => Partial<ProjectState> | ProjectState)(s)
      : partial as Partial<ProjectState>
    if (value === s) return s
    if (!value || (!('tracks' in value) && !('rootTrackIds' in value))) return value

    const nextTracks = value.tracks ?? s.tracks
    const nextRoots = value.rootTrackIds ?? s.rootTrackIds
    const audioTracks: Record<string, Track> = {}
    const sceneTracks: Record<string, Track> = {}
    for (const [id, track] of Object.entries(nextTracks)) {
      if (track.type === 'audio') audioTracks[id] = track
      else sceneTracks[id] = track
    }
    const audioRootTrackIds = nextRoots.filter((id) => !!audioTracks[id])
    const sceneRootTrackIds = nextRoots.filter((id) => !!sceneTracks[id])
    const active = s.scenes[s.activeSceneId]
    if (!active) return value
    return {
      ...value,
      scenes: {
        ...s.scenes,
        [active.id]: { ...active, tracks: sceneTracks, rootTrackIds: sceneRootTrackIds },
      },
      audioTracks,
      audioRootTrackIds,
    }
  })) as typeof rawSet

  return ({
  scenes: initial.scenes,
  sceneOrder: initial.sceneOrder,
  activeSceneId: initial.activeSceneId,
  audioTracks: {},
  audioRootTrackIds: [],
  tracks: {},
  rootTrackIds: [],
  bpm: 120,
  beatsPerBar: 4,
  totalBars: 32,
  viewAspect: 'fill',

  setActiveScene: (sceneId) => rawSet((s) => {
    if (!s.scenes[sceneId] || sceneId === s.activeSceneId) return s
    return { activeSceneId: sceneId, ...viewForScene(s.scenes, sceneId, s.audioTracks, s.audioRootTrackIds) }
  }),

  addScene: () => {
    const id = crypto.randomUUID()
    rawSet((s) => {
      const visualCount = s.sceneOrder.filter((sid) => !s.scenes[sid]?.isMain).length
      const scene: Scene = { id, name: `Scene ${visualCount + 1}`, isMain: false, backgroundColor: DEFAULT_SCENE_BACKGROUND, backgroundTransparent: false, tracks: {}, rootTrackIds: [] }
      const scenes = { ...s.scenes, [id]: scene }
      const mainId = s.sceneOrder.find((sid) => s.scenes[sid]?.isMain)
      if (mainId) {
        const main = scenes[mainId]
        const tracks = { ...main.tracks }
        for (const [trackId, track] of Object.entries(tracks)) {
          if (track.type !== 'director') continue
          const nextPitch = Math.max(59, ...(track.sceneBindings ?? []).map((b) => b.pitch)) + 1
          tracks[trackId] = { ...track, sceneBindings: [...(track.sceneBindings ?? []), { sceneId: id, pitch: nextPitch }] }
        }
        scenes[mainId] = { ...main, tracks }
      }
      const sceneOrder = [...s.sceneOrder, id]
      return mainId === s.activeSceneId
        ? { scenes, sceneOrder, ...viewForScene(scenes, mainId, s.audioTracks, s.audioRootTrackIds) }
        : { scenes, sceneOrder }
    })
    return id
  },

  renameScene: (sceneId, name) => rawSet((s) => {
    const scene = s.scenes[sceneId]
    const trimmed = name.trim()
    if (!scene || !trimmed || trimmed === scene.name || scene.isMain) return s
    return { scenes: { ...s.scenes, [sceneId]: { ...scene, name: trimmed } } }
  }),

  setSceneBackgroundColor: (sceneId, color) => rawSet((s) => {
    const scene = s.scenes[sceneId]
    if (!scene || scene.backgroundColor === color) return s
    return { scenes: { ...s.scenes, [sceneId]: { ...scene, backgroundColor: color } } }
  }),

  setSceneBackgroundTransparent: (sceneId, transparent) => rawSet((s) => {
    const scene = s.scenes[sceneId]
    if (!scene || scene.backgroundTransparent === transparent) return s
    return { scenes: { ...s.scenes, [sceneId]: { ...scene, backgroundTransparent: transparent } } }
  }),

  duplicateScene: (sceneId) => {
    let nextId: string | null = null
    rawSet((s) => {
      const source = s.scenes[sceneId]
      if (!source || source.isMain) return s
      const tracks: Record<string, Track> = {}
      const rootTrackIds: string[] = []
      for (const rootId of source.rootTrackIds) {
        const snapshot = snapshotTrackTree(rootId, source.tracks)
        if (!snapshot) continue
        const tree = cloneTrackTree(snapshot, null)
        if (tree[0]) rootTrackIds.push(tree[0].id)
        for (const track of tree) tracks[track.id] = track
      }
      nextId = crypto.randomUUID()
      const scene: Scene = {
        id: nextId,
        name: `${source.name} Copy`,
        isMain: false,
        backgroundColor: source.backgroundColor,
        backgroundTransparent: source.backgroundTransparent,
        tracks,
        rootTrackIds,
      }
      const at = Math.max(0, s.sceneOrder.indexOf(sceneId)) + 1
      const sceneOrder = s.sceneOrder.slice()
      sceneOrder.splice(at, 0, nextId)
      return { scenes: { ...s.scenes, [nextId]: scene }, sceneOrder }
    })
    return nextId
  },

  deleteScene: (sceneId) => rawSet((s) => {
    const scene = s.scenes[sceneId]
    const visuals = s.sceneOrder.filter((id) => !s.scenes[id]?.isMain)
    if (!scene || scene.isMain || visuals.length <= 1) return s
    const scenes = { ...s.scenes }
    delete scenes[sceneId]
    const mainId = s.sceneOrder.find((id) => s.scenes[id]?.isMain)
    if (mainId && scenes[mainId]) {
      const main = scenes[mainId]
      const tracks = Object.fromEntries(Object.entries(main.tracks).map(([id, track]) => [
        id,
        track.sceneBindings ? { ...track, sceneBindings: track.sceneBindings.filter((binding) => binding.sceneId !== sceneId) } : track,
      ]))
      scenes[mainId] = { ...main, tracks }
    }
    const sceneOrder = s.sceneOrder.filter((id) => id !== sceneId)
    const activeSceneId = s.activeSceneId === sceneId ? visuals.find((id) => id !== sceneId)! : s.activeSceneId
    return { scenes, sceneOrder, activeSceneId, ...viewForScene(scenes, activeSceneId, s.audioTracks, s.audioRootTrackIds) }
  }),

  reorderScenes: (sceneIds) => rawSet((s) => {
    const main = s.sceneOrder.find((id) => s.scenes[id]?.isMain)
    const valid = sceneIds.filter((id) => s.scenes[id] && !s.scenes[id].isMain)
    return { sceneOrder: main ? [main, ...valid] : valid }
  }),

  addTrack: (track, atIndex) =>
    set((s) => {
      const tracks = { ...s.tracks, [track.id]: track }
      // Nested under a parent: insert into the parent's childIds at atIndex.
      if (track.parentId) {
        const parent = tracks[track.parentId]
        if (parent) {
          const childIds = [...parent.childIds]
          const i = atIndex == null || atIndex < 0 || atIndex > childIds.length ? childIds.length : atIndex
          childIds.splice(i, 0, track.id)
          tracks[track.parentId] = { ...parent, childIds }
        }
        return { tracks }
      }
      const rootTrackIds = [...s.rootTrackIds]
      // Never above the pinned audio tracks at the top of the root list.
      const min = track.type !== 'audio' ? audioPinnedCount(s.tracks, rootTrackIds) : 0
      if (atIndex == null || atIndex < 0 || atIndex > rootTrackIds.length) rootTrackIds.push(track.id)
      else rootTrackIds.splice(Math.max(min, atIndex), 0, track.id)
      return { tracks, rootTrackIds }
    }),

  addBlock: (trackId, block) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, blocks: [...track.blocks, block] },
        },
      }
    }),

  addBlocks: (trackId, blocks) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track || blocks.length === 0) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, blocks: [...track.blocks, ...blocks] },
        },
      }
    }),

  addNote: (trackId, blockId, note) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, blocks: track.blocks.map((b) =>
            b.id === blockId ? { ...b, notes: [...b.notes, note] } : b
          ) },
        },
      }
    }),

  updateBlockNotes: (trackId, blockId, notes) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, blocks: track.blocks.map((b) =>
            b.id === blockId ? { ...b, notes } : b
          ) },
        },
      }
    }),

  updateBlock: (trackId, blockId, updates) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, blocks: track.blocks.map((b) =>
            b.id === blockId ? { ...b, ...updates } : b
          ) },
        },
      }
    }),

  moveBlock: (fromTrackId, blockId, toTrackId) =>
    set((s) => {
      if (fromTrackId === toTrackId) return s
      const fromTrack = s.tracks[fromTrackId]
      const toTrack = s.tracks[toTrackId]
      if (!fromTrack || !toTrack) return s
      const block = fromTrack.blocks.find((b) => b.id === blockId)
      if (!block) return s
      return {
        tracks: {
          ...s.tracks,
          [fromTrackId]: {
            ...fromTrack,
            blocks: fromTrack.blocks.filter((b) => b.id !== blockId),
          },
          [toTrackId]: {
            ...toTrack,
            blocks: [...toTrack.blocks, block],
          },
        },
      }
    }),

  deleteBlock: (trackId, blockId) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, blocks: track.blocks.filter((b) => b.id !== blockId) },
        },
      }
    }),

  deleteBlocks: (blockIds) =>
    set((s) => {
      const tracks: Record<string, Track> = {}
      for (const [id, t] of Object.entries(s.tracks)) {
        const blocks = t.blocks.filter((b) => !blockIds.has(b.id))
        let next = blocks.length !== t.blocks.length ? { ...t, blocks } : t
        // Audio blocks share the selection model, so a selected one deletes too.
        if (t.audioBlocks?.some((b) => blockIds.has(b.id))) {
          next = { ...next, audioBlocks: t.audioBlocks.filter((b) => !blockIds.has(b.id)) }
        }
        tracks[id] = next
      }
      return { tracks }
    }),

  splitBlocksAtBeat: (blockIds, beat) => {
    if (blockIds.size === 0) return null
    let nextSelection: Set<string> | null = null

    set((s) => {
      const { beatsPerBar } = s
      const tracks: Record<string, Track> = {}
      let changed = false
      const splitBlockIds = new Set<string>()

      for (const [id, track] of Object.entries(s.tracks)) {
        let trackChanged = false
        const blocks: Block[] = []

        for (const block of track.blocks) {
          if (!blockIds.has(block.id)) {
            blocks.push(block)
            continue
          }

          const blockStartBeat = block.startBar * beatsPerBar
          const blockEndBeat = blockStartBeat + block.durationBars * beatsPerBar
          if (beat <= blockStartBeat || beat >= blockEndBeat) {
            blocks.push(block)
            continue
          }

          const splitBeat = beat - blockStartBeat
          const leftNotes: Note[] = []
          const rightNotes: Note[] = []

          for (const note of block.notes) {
            const noteStart = note.startBeat
            const noteEnd = note.startBeat + note.durationBeats

            if (noteEnd <= splitBeat) {
              leftNotes.push(note)
            } else if (noteStart >= splitBeat) {
              rightNotes.push({ ...note, startBeat: note.startBeat - splitBeat })
            } else {
              leftNotes.push({ ...note, durationBeats: splitBeat - note.startBeat })
              rightNotes.push({
                ...note,
                id: crypto.randomUUID(),
                startBeat: 0,
                durationBeats: noteEnd - splitBeat,
              })
            }
          }

          const rightBlock: Block = {
            ...block,
            id: crypto.randomUUID(),
            startBar: beat / beatsPerBar,
            durationBars: (blockEndBeat - beat) / beatsPerBar,
            notes: rightNotes,
          }

          blocks.push(
            { ...block, durationBars: splitBeat / beatsPerBar, notes: leftNotes },
            rightBlock,
          )
          splitBlockIds.add(rightBlock.id)
          trackChanged = true
          changed = true
        }

        tracks[id] = trackChanged ? { ...track, blocks } : track
      }

      if (!changed) return s
      nextSelection = splitBlockIds
      return { tracks }
    })

    return nextSelection
  },

  joinBlocks: (blockIds) => {
    if (blockIds.size === 0) return null
    let nextSelection: Set<string> | null = null

    set((s) => {
      const { beatsPerBar } = s
      const tracks: Record<string, Track> = {}
      const joinedBlockIds = new Set<string>()
      let changed = false

      for (const [id, track] of Object.entries(s.tracks)) {
        const originalIndexes = new Map(track.blocks.map((block, index) => [block.id, index]))
        const selectedBlocks = track.blocks.filter((block) => blockIds.has(block.id))

        if (selectedBlocks.length < 2) {
          tracks[id] = track
          continue
        }

        const sortedBlocks = [...selectedBlocks].sort((a, b) =>
          a.startBar - b.startBar || (originalIndexes.get(a.id) ?? 0) - (originalIndexes.get(b.id) ?? 0)
        )
        const sourceBlock = sortedBlocks[0]
        const startBar = Math.min(...sortedBlocks.map((block) => block.startBar))
        const endBar = Math.max(...sortedBlocks.map((block) => block.startBar + block.durationBars))
        const joinedStartBeat = startBar * beatsPerBar
        const selectedIds = new Set(sortedBlocks.map((block) => block.id))

        const notes = sortedBlocks.flatMap((block) => {
          const blockStartBeat = block.startBar * beatsPerBar
          // A looped block joins as its literal repeats (baked); the joined
          // block is plain, so the loop must become real notes. Fresh ids -
          // one pattern note becomes several.
          if (block.loop) {
            return tileLoopNotes(block.notes, loopLengthBeats(block, beatsPerBar), block.durationBars * beatsPerBar)
              .map((t) => ({
                ...t.note,
                id: crypto.randomUUID(),
                startBeat: blockStartBeat + t.startBeat - joinedStartBeat,
                durationBeats: t.durationBeats,
              }))
          }
          return block.notes.map((note) => ({
            ...note,
            startBeat: blockStartBeat + note.startBeat - joinedStartBeat,
          }))
        }).sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)

        const joinedBlock: Block = {
          ...sourceBlock,
          startBar,
          durationBars: endBar - startBar,
          loop: false,
          loopLengthBars: undefined,
          notes,
        }

        const blocks = [
          ...track.blocks.filter((block) => !selectedIds.has(block.id)),
          joinedBlock,
        ].sort((a, b) =>
          a.startBar - b.startBar || (originalIndexes.get(a.id) ?? 0) - (originalIndexes.get(b.id) ?? 0)
        )

        tracks[id] = { ...track, blocks }
        joinedBlockIds.add(joinedBlock.id)
        changed = true
      }

      if (!changed) return s
      nextSelection = joinedBlockIds
      return { tracks }
    })

    return nextSelection
  },

  deleteTrack: (trackId) =>
    set((s) => {
      const target = s.tracks[trackId]
      if (!target) return s
      // Deleting a track takes its whole subtree with it - automation and ability
      // lanes are meaningless without their parent, and nested children go too.
      const doomed = new Set<string>()
      const queue = [trackId]
      while (queue.length) {
        const id = queue.pop()!
        if (doomed.has(id)) continue
        doomed.add(id)
        for (const c of s.tracks[id]?.childIds ?? []) queue.push(c)
      }

      const tracks: Record<string, Track> = {}
      for (const [id, t] of Object.entries(s.tracks)) {
        if (doomed.has(id)) continue
        let nt = t
        if (id === target.parentId) {
          nt = { ...nt, childIds: nt.childIds.filter((c) => c !== trackId) }
        }
        // Drop any track-scoped routings that pointed into the deleted subtree.
        if (nt.targets?.some((r) => r.scope.kind === 'track' && doomed.has(r.scope.id))) {
          nt = { ...nt, targets: nt.targets.filter((r) => !(r.scope.kind === 'track' && doomed.has(r.scope.id))) }
        }
        tracks[id] = nt
      }

      const rootTrackIds = target.parentId == null
        ? s.rootTrackIds.filter((id) => id !== trackId)
        : s.rootTrackIds
      return { tracks, rootTrackIds }
    }),

  moveTrackToScene: (trackId, targetSceneId) => rawSet((s) => {
    const source = s.scenes[s.activeSceneId]
    const target = s.scenes[targetSceneId]
    const root = source?.tracks[trackId]
    if (!source || !target || source.id === target.id || !root || root.parentId || root.type === 'audio') return s
    if ((root.type === 'director') !== target.isMain) return s

    const snapshot = snapshotTrackTree(trackId, source.tracks)
    if (!snapshot) return s
    const movedIds = Object.keys(snapshot.tracks)
    if (movedIds.some((id) => target.tracks[id])) return s

    const sourceTracks = { ...source.tracks }
    for (const id of movedIds) delete sourceTracks[id]
    const targetTracks = { ...target.tracks }
    for (const [id, track] of Object.entries(snapshot.tracks)) {
      targetTracks[id] = id === trackId ? { ...track, parentId: undefined } : track
    }

    const scenes = {
      ...s.scenes,
      [source.id]: { ...source, tracks: sourceTracks, rootTrackIds: source.rootTrackIds.filter((id) => id !== trackId) },
      [target.id]: { ...target, tracks: targetTracks, rootTrackIds: [...target.rootTrackIds, trackId] },
    }
    return { scenes, ...viewForScene(scenes, s.activeSceneId, s.audioTracks, s.audioRootTrackIds) }
  }),

  // Insert an identical copy of a track subtree at a given sibling/root index
  // (Alt-drag commit). The original is left untouched.
  insertTrackCopy: (srcId, index) => {
    let newId: string | null = null
    set((s) => {
      const snapshot = snapshotTrackTree(srcId, s.tracks)
      if (!snapshot) return s
      const src = s.tracks[srcId]
      const tree = cloneTrackTree(snapshot, src.parentId ?? null)
      newId = tree[0]?.id ?? null
      return insertTrackTreeIntoState(s, tree, index)
    })
    return newId
  },

  addTrackTree: (tree, atIndex) =>
    set((s) => insertTrackTreeIntoState(s, tree, atIndex)),

  reorderRootTracks: (orderedIds) =>
    set({ rootTrackIds: orderedIds }),

  setTrackParent: (trackId, parentId, index) =>
    set((s) => {
      const child = s.tracks[trackId]
      if (!child) return s
      if (parentId === trackId) return s
      if (parentId != null && !s.tracks[parentId]) return s
      // The audio track is pinned at the top: it never moves, and nothing nests
      // under it (the UI blocks both; this is the backstop).
      if (child.type === 'audio') return s
      if (parentId != null && s.tracks[parentId].type === 'audio') return s
      // Cycle guard: the new parent must not sit inside trackId's own subtree.
      for (let cur: string | undefined = parentId ?? undefined; cur != null; cur = s.tracks[cur]?.parentId) {
        if (cur === trackId) return s
      }

      const tracks = { ...s.tracks }
      let rootTrackIds = [...s.rootTrackIds]

      // Detach from current location.
      const oldParentId = child.parentId
      if (oldParentId != null) {
        const op = tracks[oldParentId]
        if (op) tracks[oldParentId] = { ...op, childIds: op.childIds.filter((c) => c !== trackId) }
      } else {
        rootTrackIds = rootTrackIds.filter((id) => id !== trackId)
      }

      // Attach to the new location at `index` (default: end of the sibling list).
      tracks[trackId] = { ...child, parentId: parentId ?? undefined }
      if (parentId != null) {
        const np = tracks[parentId]
        const childIds = np.childIds.filter((c) => c !== trackId)
        const i = index == null ? childIds.length : Math.max(0, Math.min(childIds.length, index))
        childIds.splice(i, 0, trackId)
        tracks[parentId] = { ...np, childIds }
      } else {
        // Never above the pinned audio tracks at the top of the root list.
        const min = audioPinnedCount(tracks, rootTrackIds)
        const i = index == null ? rootTrackIds.length : Math.max(min, Math.min(rootTrackIds.length, index))
        rootTrackIds.splice(i, 0, trackId)
      }
      return { tracks, rootTrackIds }
    }),

  renameTrack: (trackId, name) =>
    set((s) => {
      const track = s.tracks[trackId]
      const trimmed = name.trim()
      // An empty rename is a cancel, not a nameless track.
      if (!track || !trimmed || trimmed === track.name) return s
      return {
        tracks: { ...s.tracks, [trackId]: { ...track, name: trimmed } },
      }
    }),

  toggleMute: (trackId) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: { ...s.tracks, [trackId]: { ...track, muted: !track.muted } },
      }
    }),

  toggleSolo: (trackId) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: { ...s.tracks, [trackId]: { ...track, solo: !track.solo } },
      }
    }),

  setTrackParam: (trackId, key, value) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, params: { ...track.params, [key]: value } },
        },
      }
    }),

  setTrackStringParam: (trackId, key, value) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, stringParams: { ...track.stringParams, [key]: value } },
        },
      }
    }),

  // Swap a track's instrument (double-click in the library). Params are instrument-
  // specific, so they reset to the new instrument's defaults rather than carrying
  // stale keys across; the track is renamed to match (tracks are named after their
  // instrument), unless a name isn't supplied.
  setTrackInstrument: (trackId, instrumentId, name) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track || track.instrumentId === instrumentId) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: {
            ...track,
            type: 'base',
            instrumentId,
            params: {},
            stringParams: {},
            moverId: undefined,
            splitterId: undefined,
            inputValues: undefined,
            name: name ?? track.name,
          },
        },
      }
    }),

  setTrackMover: (trackId, moverId, name) =>
    set((s) => {
      const track = s.tracks[trackId]
      const def = getMoverOrSplitterDefinition(moverId)
      if (!track || !def) return s
      const isSplitter = def.kind === 'splitter'
      return {
        tracks: {
          ...s.tracks,
          [trackId]: {
            ...track,
            type: isSplitter ? 'splitter' : 'mover',
            instrumentId: '',
            moverId: isSplitter ? undefined : moverId,
            splitterId: isSplitter ? moverId : undefined,
            inputValues: {},
            params: {},
            stringParams: {},
            color: MOVER_TRACK_COLOR,
            name,
          },
        },
      }
    }),

  setTrackDirector: (trackId, directorId, name) =>
    set((s) => {
      const scene = s.scenes[s.activeSceneId]
      const track = s.tracks[trackId]
      if (!scene?.isMain || !track) return s
      const visualIds = s.sceneOrder.filter((id) => s.scenes[id] && !s.scenes[id].isMain)
      return {
        tracks: {
          ...s.tracks,
          [trackId]: {
            ...track,
            name,
            type: 'director',
            instrumentId: '',
            directorId,
            params: {},
            stringParams: {},
            sceneBindings: visualIds.map((sceneId, i) => ({ sceneId, pitch: 60 + i })),
            childIds: [],
          },
        },
      }
    }),

  setDirectorSceneBindings: (trackId, bindings) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track || track.type !== 'director') return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, sceneBindings: bindings } } }
    }),

  addMoverTrack: (parentId, moverId, moverLabel) =>
    set((s) => {
      const parent = s.tracks[parentId]
      const def = getMoverOrSplitterDefinition(moverId)
      if (!parent || !def) return s
      const id = crypto.randomUUID()
      const isSplitter = def.kind === 'splitter'
      const track: Track = {
        id,
        name: moverLabel,
        type: isSplitter ? 'splitter' : 'mover',
        instrumentId: '',
        moverId: isSplitter ? undefined : moverId,
        splitterId: isSplitter ? moverId : undefined,
        inputValues: {},
        color: MOVER_TRACK_COLOR,
        muted: false,
        solo: false,
        blocks: [],
        childIds: [],
        parentId,
      }
      return {
        tracks: {
          ...s.tracks,
          [id]: track,
          [parentId]: { ...parent, childIds: [...parent.childIds, id] },
        },
      }
    }),

  setMoverInput: (trackId, key, value) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track || (track.type !== 'mover' && track.type !== 'splitter')) return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, inputValues: { ...track.inputValues, [key]: value } } } }
    }),

  addAutomationTrack: (parentId, paramKey, paramLabel) =>
    set((s) => {
      const parent = s.tracks[parentId]
      if (!parent) return s
      // One automation lane per param - don't stack duplicates.
      const exists = parent.childIds.some((cid) => {
        const c = s.tracks[cid]
        return c?.type === 'automation' && c.targetParam === paramKey
      })
      if (exists) return s
      const id = crypto.randomUUID()
      const track: Track = {
        id,
        name: paramLabel,
        type: 'automation',
        instrumentId: '',
        targetParam: paramKey,
        interpolation: 'linear',
        color: parent.color,
        muted: false,
        solo: false,
        blocks: [],
        childIds: [],
        parentId,
      }
      return {
        tracks: {
          ...s.tracks,
          [id]: track,
          [parentId]: { ...parent, childIds: [...parent.childIds, id] },
        },
      }
    }),

  addEnvelopeTrack: (parentId, targetParam, targetLabel, envTarget) =>
    set((s) => {
      const parent = s.tracks[parentId]
      if (!parent) return s
      // One envelope lane per target - don't stack duplicates.
      const exists = parent.childIds.some((cid) => {
        const c = s.tracks[cid]
        return c?.type === 'envelope' && c.targetParam === targetParam
      })
      if (exists) return s
      const id = crypto.randomUUID()
      const track: Track = {
        id,
        name: `Env · ${targetLabel}`,
        type: 'envelope',
        instrumentId: '',
        targetParam,
        adsr: { ...DEFAULT_ADSR },
        envDepth: 1,
        envTarget,
        color: parent.color,
        muted: false,
        solo: false,
        blocks: [],
        childIds: [],
        parentId,
      }
      return {
        tracks: {
          ...s.tracks,
          [id]: track,
          [parentId]: { ...parent, childIds: [...parent.childIds, id] },
        },
      }
    }),

  setEnvelopeAdsr: (trackId, adsr) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track || track.type !== 'envelope') return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, adsr } } }
    }),

  setEnvelopeDepth: (trackId, value) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track || track.type !== 'envelope') return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, envDepth: value } } }
    }),

  setEnvelopeTarget: (trackId, value) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track || track.type !== 'envelope') return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, envTarget: value } } }
    }),

  addAbilityTrack: (parentId, abilityKey, abilityLabel) =>
    set((s) => {
      const parent = s.tracks[parentId]
      if (!parent) return s
      // One ability track per ability - don't stack duplicates.
      const exists = parent.childIds.some((cid) => {
        const c = s.tracks[cid]
        return c?.type === 'ability' && c.abilityKey === abilityKey
      })
      if (exists) return s
      const id = crypto.randomUUID()
      const track: Track = {
        id,
        name: abilityLabel,
        type: 'ability',
        instrumentId: '',
        abilityKey,
        color: parent.color,
        muted: false,
        solo: false,
        blocks: [],
        childIds: [],
        parentId,
      }
      return {
        tracks: {
          ...s.tracks,
          [id]: track,
          [parentId]: { ...parent, childIds: [...parent.childIds, id] },
        },
      }
    }),

  setTrackInterpolation: (trackId, mode) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, interpolation: mode } } }
    }),

  setTrackNoise: (trackId, noise) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, noise } } }
    }),

  setTrackTargets: (trackId, targets) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, targets } } }
    }),

  setTrackTags: (trackId, tags) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, tags } } }
    }),

  setTrackOnTop: (trackId, onTop) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, onTop } } }
    }),

  setTrackVideoPads: (trackId, videoPads) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, videoPads } } }
    }),

  setTrackPhotoPads: (trackId, photoPads) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, photoPads } } }
    }),

  addAudioTrack: (clip) => {
    const id = crypto.randomUUID()
    set((s) => {
      const track: Track = {
        id,
        name: clip.fileName,
        type: 'audio',
        instrumentId: '',
        color: AUDIO_TRACK_COLOR,
        muted: false,
        solo: false,
        blocks: [],
        childIds: [],
        audioBlocks: [{
          id: crypto.randomUUID(),
          clipRef: clip.ref,
          startBar: 0,
          trimStart: 0,
          trimEnd: clip.duration,
        }],
      }
      // Top of the track rows - the backing track leads the arrangement.
      return { tracks: { ...s.tracks, [id]: track }, rootTrackIds: [id, ...s.rootTrackIds] }
    })
    return id
  },

  importMidiTracks: (imported) => {
    const ids: string[] = []
    set((s) => {
      const withNotes = imported.filter((t) => t.notes.length > 0)
      if (withNotes.length === 0) return s
      const tracks = { ...s.tracks }
      const rootTrackIds = [...s.rootTrackIds]
      let maxEndBar = 0
      withNotes.forEach((t, i) => {
        // One block spanning first note to last, on whole project bars; the
        // notes' file-absolute beats become block-relative.
        const firstBeat = Math.min(...t.notes.map((n) => n.startBeat))
        const startBar = Math.floor(firstBeat / s.beatsPerBar)
        const blockStartBeat = startBar * s.beatsPerBar
        const durationBars = Math.max(1, Math.ceil((t.endBeat - blockStartBeat) / s.beatsPerBar))
        const block: Block = {
          id: crypto.randomUUID(),
          startBar,
          durationBars,
          loop: false,
          notes: t.notes.map((n) => ({ ...n, startBeat: n.startBeat - blockStartBeat })),
        }
        const id = crypto.randomUUID()
        tracks[id] = {
          id,
          name: t.name || `MIDI ${i + 1}`,
          type: 'base',
          instrumentId: 'cube',
          color: OBJECT_TRACK_COLOR,
          muted: false,
          solo: false,
          blocks: [block],
          childIds: [],
        }
        rootTrackIds.push(id)
        ids.push(id)
        maxEndBar = Math.max(maxEndBar, startBar + durationBars)
      })
      // Grow (never shrink) the project if the file overruns; blocks past the
      // MAX_TOTAL_BARS clamp are tolerated, the timeline just ends sooner.
      const totalBars = maxEndBar > s.totalBars
        ? Math.min(MAX_TOTAL_BARS, maxEndBar)
        : s.totalBars
      return { tracks, rootTrackIds, totalBars }
    })
    return ids
  },

  addLyricTrack: (words, timing) => {
    if (words.length === 0) return null
    let resultId: string | null = null
    set((s) => {
      const text = words.map((w) => w.word).join(' ')
      const lastBeat = Math.max(...words.map((w) => w.startBeat + w.durationBeats))
      const durationBars = Math.min(MAX_TOTAL_BARS, Math.max(1, Math.ceil(lastBeat / s.beatsPerBar)))
      const block: Block = {
        id: crypto.randomUUID(),
        startBar: 0,
        durationBars,
        loop: false,
        notes: words.map((w) => ({
          id: crypto.randomUUID(),
          startBeat: w.startBeat,
          durationBeats: w.durationBeats,
          pitch: TEXT_NEXT_WORD_PITCH,
          velocity: 100,
        })),
      }
      // Grow (never shrink) the project if the lyrics overrun, like MIDI import.
      const totalBars = durationBars > s.totalBars ? durationBars : s.totalBars

      // The song's end in bars (audio blocks' spans at the current tempo) -
      // the template's repeat-to-the-ceiling loop blocks get trimmed to
      // max(lyrics end, audio end), so visuals stop when the music does
      // instead of looping forever into empty timeline.
      const secPerBeat = 60 / s.bpm
      let audioEndBars = 0
      for (const tid of s.rootTrackIds) {
        const at = s.tracks[tid]
        if (at?.type !== 'audio') continue
        for (const ab of at.audioBlocks ?? []) {
          const beats = Math.max(0, ab.trimEnd - ab.trimStart) / secPerBeat
          audioEndBars = Math.max(audioEndBars, ab.startBar + Math.ceil(beats / s.beatsPerBar))
        }
      }
      const endBars = Math.max(durationBars, audioEndBars)
      const trimmedTracks: Record<string, Track> = {}
      for (const [tid, t] of Object.entries(s.tracks)) {
        const needsTrim = t.blocks.some((b) => b.loop && b.startBar + b.durationBars > endBars)
        trimmedTracks[tid] = needsTrim
          ? {
              ...t,
              blocks: t.blocks.map((b) =>
                b.loop && b.startBar + b.durationBars > endBars
                  ? { ...b, durationBars: Math.max(1, endBars - b.startBar) }
                  : b,
              ),
            }
          : t
      }

      // A lyric-template project ships a styled root track named 'Lyrics' -
      // refill it (words swap, styling stays) instead of stacking a second one.
      const existingId = s.rootTrackIds.find((tid) => {
        const t = s.tracks[tid]
        return t?.type === 'base' && t.instrumentId === 'textDisplay' && t.name === 'Lyrics'
      })
      if (existingId) {
        const existing = s.tracks[existingId]
        resultId = existingId
        const updated: Track = {
          ...existing,
          stringParams: { ...existing.stringParams, text },
          lyricTiming: timing ?? existing.lyricTiming,
          blocks: [block],
        }
        return { tracks: { ...trimmedTracks, [existingId]: updated }, totalBars }
      }

      const id = crypto.randomUUID()
      resultId = id
      const track: Track = {
        id,
        name: 'Lyrics',
        type: 'base',
        instrumentId: 'textDisplay',
        color: OBJECT_TRACK_COLOR,
        muted: false,
        solo: false,
        stringParams: { text },
        lyricTiming: timing,
        blocks: [block],
        childIds: [],
      }
      return { tracks: { ...trimmedTracks, [id]: track }, rootTrackIds: [...s.rootTrackIds, id], totalBars }
    })
    return resultId
  },

  applyTemplate: (templateDoc) => {
    // The template's content lives in its non-main scene.
    const srcSceneId = templateDoc.sceneOrder.find((id) => !templateDoc.scenes[id]?.isMain)
    const src = srcSceneId ? templateDoc.scenes[srcSceneId] : undefined
    if (!src) return

    // Remint every id (template documents are shared module state, and the
    // same template can be applied more than once).
    const idMap = new Map<string, string>()
    for (const id of Object.keys(src.tracks)) idMap.set(id, crypto.randomUUID())
    const remapScope = (scope: Routing['scope']): Routing['scope'] =>
      scope.kind === 'tag' ? scope : { ...scope, id: idMap.get(scope.id) ?? scope.id }
    const cloned: Record<string, Track> = {}
    for (const [oldId, t] of Object.entries(src.tracks)) {
      const c = structuredClone(t)
      c.id = idMap.get(oldId)!
      if (c.parentId) c.parentId = idMap.get(c.parentId)
      c.childIds = t.childIds.map((cid) => idMap.get(cid)).filter((x): x is string => !!x)
      c.blocks = c.blocks.map((b) => ({
        ...b,
        id: crypto.randomUUID(),
        notes: b.notes.map((n) => ({ ...n, id: crypto.randomUUID() })),
      }))
      if (c.targets) c.targets = c.targets.map((r) => ({ ...r, scope: remapScope(r.scope) }))
      cloned[c.id] = c
    }
    const clonedRoots = src.rootTrackIds.map((id) => idMap.get(id)).filter((x): x is string => !!x)

    set((s) => {
      const audioIds = s.rootTrackIds.filter((id) => s.tracks[id]?.type === 'audio')
      const kept: Record<string, Track> = {}
      for (const id of audioIds) kept[id] = s.tracks[id]
      const hasAudio = audioIds.length > 0
      return {
        tracks: { ...kept, ...cloned },
        rootTrackIds: [...audioIds, ...clonedRoots],
        bpm: hasAudio ? s.bpm : templateDoc.bpm,
        totalBars: Math.max(s.totalBars, templateDoc.totalBars),
      }
    })
  },

  addAudioBlock: (trackId, block) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (track?.type !== 'audio') return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, audioBlocks: [...(track.audioBlocks ?? []), block] },
        },
      }
    }),

  updateAudioBlock: (trackId, blockId, updates) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track?.audioBlocks) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: {
            ...track,
            audioBlocks: track.audioBlocks.map((b) => (b.id === blockId ? { ...b, ...updates } : b)),
          },
        },
      }
    }),

  deleteAudioBlock: (trackId, blockId) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track?.audioBlocks) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, audioBlocks: track.audioBlocks.filter((b) => b.id !== blockId) },
        },
      }
    }),

  addEffect: (trackId, pluginId) =>
    set((s) => {
      const track = s.tracks[trackId]
      const plugin = getEffect(pluginId)
      if (!track || !plugin) return s
      const settings: Record<string, number> = {}
      for (const p of plugin.params) if (typeof p.default === 'number') settings[p.key] = p.default
      const instance: EffectInstance = { id: crypto.randomUUID(), pluginId, enabled: true, settings }
      return { tracks: { ...s.tracks, [trackId]: { ...track, effects: [...(track.effects ?? []), instance] } } }
    }),

  removeEffect: (trackId, instanceId) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track?.effects) return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, effects: track.effects.filter((e) => e.id !== instanceId) } } }
    }),

  setEffectSetting: (trackId, instanceId, key, value) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track?.effects) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, effects: track.effects.map((e) => e.id === instanceId ? { ...e, settings: { ...e.settings, [key]: value } } : e) },
        },
      }
    }),

  toggleEffect: (trackId, instanceId) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track?.effects) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, effects: track.effects.map((e) => e.id === instanceId ? { ...e, enabled: !e.enabled } : e) },
        },
      }
    }),

  // Chain order is meaningful: transforms nest first-innermost, clones wrap in order,
  // shaders post-process in order. A plain array swap keeps instance ids stable, so
  // fx automation targets (fx:<instanceId>:<key>) keep resolving after a move.
  reorderEffect: (trackId, instanceId, direction) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track?.effects) return s
      const from = track.effects.findIndex((e) => e.id === instanceId)
      const to = from + direction
      if (from < 0 || to < 0 || to >= track.effects.length) return s
      const effects = track.effects.slice()
      effects[from] = track.effects[to]
      effects[to] = track.effects[from]
      return { tracks: { ...s.tracks, [trackId]: { ...track, effects } } }
    }),

  setBpm: (bpm) =>
    set((s) => {
      const next = Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(bpm)))
      if (next === s.bpm) return s
      // The transcribed Lyrics track's truth is SECONDS (lyricTiming); its
      // beats are derived. Re-derive them at the new tempo so a BPM
      // correction never moves words off their sung time. Only tracks
      // carrying lyricTiming rescale - everything else keeps its beats.
      let audioBlock: { startBar: number; trimStart: number } | undefined
      for (const id of s.rootTrackIds) {
        const t = s.tracks[id]
        if (t?.type === 'audio' && t.audioBlocks?.length) { audioBlock = t.audioBlocks[0]; break }
      }
      let tracks = s.tracks
      let totalBars = s.totalBars
      for (const [id, t] of Object.entries(s.tracks)) {
        if (!t.lyricTiming?.length || t.blocks.length === 0) continue
        const words = placeTranscription(t.lyricTiming, audioBlock ?? { startBar: 0, trimStart: 0 }, next, s.beatsPerBar, true)
        if (words.length === 0) continue
        const lastBeat = Math.max(...words.map((w) => w.startBeat + w.durationBeats))
        const durationBars = Math.min(MAX_TOTAL_BARS, Math.max(1, Math.ceil(lastBeat / s.beatsPerBar)))
        const block: Block = {
          ...t.blocks[0],
          startBar: 0,
          durationBars,
          notes: words.map((w) => ({
            id: crypto.randomUUID(),
            startBeat: w.startBeat,
            durationBeats: w.durationBeats,
            pitch: TEXT_NEXT_WORD_PITCH,
            velocity: 100,
          })),
        }
        if (tracks === s.tracks) tracks = { ...s.tracks }
        tracks[id] = { ...t, blocks: [block] }
        totalBars = Math.max(totalBars, durationBars)
      }
      return tracks === s.tracks ? { bpm: next } : { bpm: next, tracks, totalBars }
    }),

  // Blocks past the new end are left alone (the timeline just ends sooner);
  // the transport clamps the playhead to the project length on its own.
  setTotalBars: (bars) => set({ totalBars: Math.max(MIN_TOTAL_BARS, Math.min(MAX_TOTAL_BARS, Math.round(bars))) }),

  setViewAspect: (aspect) => set({ viewAspect: aspect }),
  })
})
