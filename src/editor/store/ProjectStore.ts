import { create } from 'zustand'
import { getEffect } from '../effects'
import { nextTrackColor, AUDIO_TRACK_COLOR } from '../utils/trackColors'
import { getMoverOrSplitterDefinition } from '../core/visualCopies/registry'
// Capability checks only. core/directors is React-free; the store must NEVER
// import instruments/index (components import stores - instant cycle).
import { compositionDef, isCompositionTrack } from '../core/directors'
import { TRANSFORM_PARAM_DEFS } from '../core/transform'
import { seedSceneBindings } from '../core/directors/sceneBindings'
import { seedSwitcherBindings } from '../core/switcherBindings'
import { SWITCHER_MODE_PARAM } from '../core/visualCopies/switcher'
import { canBeSceneTrackChild, dematerializeSceneTrack, isSceneTrackId, sceneTrackId, sceneTrackView } from '../core/sceneTrack'
import { loopLengthBeats, tileLoopNotes } from '../core/visual/noteFlatten'
import { DEFAULT_ADSR } from '../core/visual/adsr'
import { AUTOMATION_AMOUNT_MAX, DEFAULT_BURST, DEFAULT_CYCLE, DEFAULT_NOISE } from '../core/visual/automation'
import type { ImportedMidiTrack } from '../core/midiImport'
import type { AspectRatioId } from '../core/aspectRatios'
import { placeTranscription, invertStrobeSpans, groupTimingIntoLines, type LyricWord, type TranscribedWord } from '../utils/lyricPlacement'
import { DEFAULT_SCENE_BACKGROUND, defaultSceneGradient, sceneBackdropMode, type SceneBackdropMode, type SceneGradient, type Scene, type Track, type Block, type Note, type AudioBlock, type AdsrEnvelope, type AutomationMode, type EffectInstance, type InterpolationMode, type VideoPad, type PhotoPad, type Routing } from '../types'
import type { ProjectDocument } from '../../persistence/types'
import { upgradeDocument } from '../../persistence/upgrade'
import { useVideoStore } from './VideoStore'
import { songEndBars, trimLoopsToSongEnd } from './songEnd'
import { clipsFromPlacedWords, laneIndexForPitch, MAX_STYLE_LANES, resolveStyleLanes } from '../core/visual/lyricClips'
import type { LyricClip, StyleLane } from '../types'

export const MIN_BPM = 20
export const MAX_BPM = 300
export const MIN_TOTAL_BARS = 1
export const MAX_TOTAL_BARS = 512

/** The colour of the last id in the list that resolves to a track. */
function lastColorIn(ids: string[], tracks: Record<string, Track>): string | undefined {
  for (let i = ids.length - 1; i >= 0; i--) {
    const track = tracks[ids[i]]
    if (track) return track.color
  }
  return undefined
}

/** Colour for a track about to be created: the hue cycle continues from the
 *  most recent sibling (a child's siblings live under its parent; a root
 *  track's are the root rows), seeded by deep sapphire on an empty project. */
export function resolveNextTrackColor(s: { tracks: Record<string, Track>; rootTrackIds: string[] }, parentId?: string | null): string {
  if (parentId) {
    const parent = s.tracks[parentId]
    if (parent) return nextTrackColor(lastColorIn(parent.childIds, s.tracks) ?? parent.color)
  }
  return nextTrackColor(lastColorIn(s.rootTrackIds, s.tracks))
}

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

export interface BlockSplit {
  /** All replacement regions in timeline order. */
  blocks: Block[]
  left: Block
  /** The replacement region whose left edge is the split beat. */
  right: Block
}

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
): BlockSplit | null {
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
    const loopBeats = loopLengthBeats(block, beatsPerBar)
    const loopLengthBars = loopBeats / beatsPerBar
    const leftLoop = { ...left, loopLengthBars }
    const rawPhase = splitOffsetBeats % loopBeats
    const phase = rawPhase < 0 ? rawPhase + loopBeats : rawPhase
    const onSeam = phase <= BLOCK_SPLIT_EPSILON_BEATS
      || loopBeats - phase <= BLOCK_SPLIT_EPSILON_BEATS

    // A cut on an existing seam starts a fresh, phase-zero copy of the source
    // pattern. This is deliberately not a re-phased pattern: its first region
    // is the base loop and any remaining duration is made from its repeats.
    if (onSeam) {
      const seamRight: Block = {
        ...right,
        loopLengthBars,
        notes: block.notes.map((note) => ({ ...note, id: makeId() })),
      }
      return { blocks: [leftLoop, seamRight], left: leftLoop, right: seamRight }
    }

    // Between seams, preserve the incomplete occurrence as a literal MIDI
    // region from the playhead to the next original seam. A new phase-zero
    // loop can then begin at that seam without changing the pattern heard on
    // the timeline. When the block ends before the seam, only the remainder is
    // needed, so this naturally produces two rather than three non-empty parts.
    const nextSeamOffset = splitOffsetBeats + (loopBeats - phase)
    const remainderEndOffset = Math.min(nextSeamOffset, blockDurationBeats)
    const remainderNotes: Note[] = []
    for (const occurrence of tileLoopNotes(block.notes, loopBeats, blockDurationBeats)) {
      const occurrenceEnd = occurrence.startBeat + occurrence.durationBeats
      const clippedStart = Math.max(splitOffsetBeats, occurrence.startBeat)
      const clippedEnd = Math.min(remainderEndOffset, occurrenceEnd)
      if (clippedEnd - clippedStart <= BLOCK_SPLIT_EPSILON_BEATS) continue
      remainderNotes.push({
        ...occurrence.note,
        id: makeId(),
        startBeat: clippedStart - splitOffsetBeats,
        durationBeats: clippedEnd - clippedStart,
      })
    }
    remainderNotes.sort((a, b) => a.startBeat - b.startBeat)

    const remainder: Block = {
      ...right,
      durationBars: (remainderEndOffset - splitOffsetBeats) / beatsPerBar,
      loop: false,
      loopLengthBars: undefined,
      notes: remainderNotes,
    }
    const blocks = [leftLoop, remainder]

    if (nextSeamOffset < blockDurationBeats - BLOCK_SPLIT_EPSILON_BEATS) {
      const resumedLoop: Block = {
        ...block,
        id: makeId(),
        startBar: (blockStartBeat + nextSeamOffset) / beatsPerBar,
        durationBars: (blockDurationBeats - nextSeamOffset) / beatsPerBar,
        loopLengthBars,
        notes: block.notes.map((note) => ({ ...note, id: makeId() })),
      }
      blocks.push(resumedLoop)
    }

    return {
      blocks,
      left: leftLoop,
      right: remainder,
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

  const plainLeft = { ...left, notes: leftNotes }
  const plainRight = { ...right, notes: rightNotes }
  return { blocks: [plainLeft, plainRight], left: plainLeft, right: plainRight }
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
/**
 * Wrap a selection in a new container track: members reparent under it in
 * timeline (DFS) order and the container lands in the first member's slot. One
 * set() = one undo step; returns the container's id, or null if nothing
 * eligible was selected.
 *
 * Shared by `groupTracks` (⌘⇧G) and `wrapTracksInSwitcher`, which differ only in
 * which tracks may join and what the container is. The slot arithmetic is the
 * fiddly part - an insertion index counted among the siblings that REMAIN once
 * every member is detached - so it lives here once rather than in each caller.
 */
function wrapSelection(
  set: (fn: (s: ProjectState) => Partial<ProjectState> | ProjectState) => void,
  trackIds: string[],
  opts: {
    eligible: (track: Track) => boolean
    build: (id: string, parentId: string | null, members: string[], color: string) => Track
  },
): string | null {
  let newId: string | null = null
  set((s) => {
    const selected = new Set(trackIds)
    // Timeline (DFS) order, so the container's children read in the order the
    // user sees them, whatever order the selection was clicked in.
    const ordered: string[] = []
    const visit = (id: string) => {
      const t = s.tracks[id]
      if (!t) return
      if (selected.has(id)) ordered.push(id)
      for (const c of t.childIds ?? []) visit(c)
    }
    for (const rid of s.rootTrackIds) visit(rid)
    const members = ordered.filter((id) => {
      const t = s.tracks[id]!
      if (!opts.eligible(t)) return false
      // Inside another selected track's subtree: rides along with its ancestor.
      for (let cur = t.parentId; cur != null; cur = s.tracks[cur]?.parentId) {
        if (selected.has(cur)) return false
      }
      return true
    })
    if (members.length === 0) return s
    const first = s.tracks[members[0]]!
    const parentId = first.parentId ?? null
    const id = crypto.randomUUID()
    const memberSet = new Set(members)
    const tracks: Record<string, Track> = { ...s.tracks }
    let rootTrackIds = [...s.rootTrackIds]
    const siblings = parentId != null ? tracks[parentId]!.childIds : rootTrackIds
    const firstAt = siblings.indexOf(members[0])
    const insertAt = siblings
      .slice(0, firstAt < 0 ? siblings.length : firstAt)
      .filter((sid) => !memberSet.has(sid)).length
    for (const mid of members) {
      const m = tracks[mid]!
      if (m.parentId != null) {
        const op = tracks[m.parentId]
        if (op) tracks[m.parentId] = { ...op, childIds: op.childIds.filter((c) => !memberSet.has(c)) }
      } else {
        rootTrackIds = rootTrackIds.filter((rid) => !memberSet.has(rid))
      }
      tracks[mid] = { ...m, parentId: id }
    }
    tracks[id] = opts.build(id, parentId, members, resolveNextTrackColor(s, parentId))
    if (parentId != null) {
      const np = tracks[parentId]!
      const childIds = np.childIds.filter((c) => !memberSet.has(c))
      childIds.splice(Math.min(insertAt, childIds.length), 0, id)
      tracks[parentId] = { ...np, childIds }
    } else {
      const min = audioPinnedCount(tracks, rootTrackIds)
      rootTrackIds.splice(Math.max(min, Math.min(insertAt, rootTrackIds.length)), 0, id)
    }
    newId = id
    return { tracks, rootTrackIds }
  })
  return newId
}

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

/** Editor viewport aspect pin - a project-level display setting. Every export
 *  shape is pinnable (core/aspectRatios.ts), so the viewport can preview what
 *  any release will compose like; 'fill' is the unpinned panel. */
export type ViewAspect = 'fill' | AspectRatioId

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
  /** The template (or lyric style) this project is currently on - the id of
   *  the last template document created-from or applied, so the Templates tab
   *  can mark the current one. Null for scratch projects and older saves. */
  appliedTemplateId: string | null
  setActiveScene: (sceneId: string) => void
  addScene: () => string
  renameScene: (sceneId: string, name: string) => void
  setSceneBackgroundColor: (sceneId: string, color: string) => void
  setSceneBackgroundTransparent: (sceneId: string, transparent: boolean) => void
  setSceneBackdropMode: (sceneId: string, mode: SceneBackdropMode) => void
  /** Merges into the scene's gradient (seeding defaults if it never had one).
   *  Pass `enabled` only via setSceneBackdropMode - it owns mode consistency. */
  setSceneBackgroundGradient: (sceneId: string, patch: Partial<Omit<SceneGradient, 'enabled'>>) => void
  addSceneEffect: (sceneId: string, pluginId: string) => void
  removeSceneEffect: (sceneId: string, instanceId: string) => void
  setSceneEffectSetting: (sceneId: string, instanceId: string, key: string, value: number) => void
  toggleSceneEffect: (sceneId: string, instanceId: string) => void
  reorderSceneEffect: (sceneId: string, instanceId: string, direction: -1 | 1) => void
  /** Show/hide the scene instrument (core/sceneTrack.ts) for one scene.
   *  Turning it OFF keeps its params and lanes on the Scene, so the shortcut is
   *  a peek rather than a destructive toggle - but the lanes stop resolving, so
   *  a hidden scene instrument affects nothing. */
  setSceneTrackEnabled: (sceneId: string, enabled: boolean) => void
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
  insertTrackCopy: (srcId: string, parentId: string | null, index?: number) => string | null
  addTrackTree: (tree: Track[], atIndex?: number) => void
  reorderRootTracks: (orderedIds: string[]) => void
  /** Re-parent a track: parentId=null makes it a root. `index` positions it among
   *  its new siblings (root list or the parent's childIds). No-op on a cycle. */
  setTrackParent: (trackId: string, parentId: string | null, index?: number) => void
  /** Move several tracks at once to `parentId`, inserted contiguously at `index`.
   *  `index` counts the siblings that REMAIN after every moved track is detached
   *  (the drop-target convention). Order of `trackIds` is preserved; members whose
   *  ancestor is also moving are skipped (the subtree rides along). One set() =
   *  one undo step. */
  setTracksParent: (trackIds: string[], parentId: string | null, index?: number) => void
  /** Wrap the given tracks in a new 'group' folder track (⌘⇧G): members
   *  reparent under it in timeline (DFS) order and the group lands in the
   *  first member's slot. Lanes and audio never join; a selected track inside
   *  another selected track's subtree rides along with its ancestor. One
   *  set() = one undo step. Returns the group's id, or null if nothing
   *  groupable was selected. */
  groupTracks: (trackIds: string[]) => string | null
  /** Wrap the given tracks in a new 'switcher' rack: each becomes one of its
   *  rows, in timeline order, and the rack lands in the first one's slot. Any
   *  track kind may join - devices are switched in the chain, objects and
   *  groups are switched for visibility. Returns the switcher's id, or null if
   *  nothing rackable was selected. One set() = one undo step. */
  wrapTracksInSwitcher: (trackIds: string[]) => string | null
  /** Dissolve a group or a switcher: its member tracks splice back into the
   *  container's slot in order; the container's own lanes (a group's tf*
   *  automation, a switcher's MIDI lane) die with it. */
  ungroupTrack: (trackId: string) => void
  renameTrack: (trackId: string, name: string) => void
  toggleMute: (trackId: string) => void
  toggleSolo: (trackId: string) => void
  setTrackParam: (trackId: string, key: string, value: number) => void
  setTrackStringParam: (trackId: string, key: string, value: string) => void
  /** Convert a track to an instrument. A COMPOSITION instrument id on the Main
   *  scene additionally seeds sceneBindings and drops child lanes (the former
   *  setTrackDirector semantics). */
  setTrackInstrument: (trackId: string, instrumentId: string, name?: string) => void
  /** Convert a track into a mover row (no instrument). */
  setTrackMover: (trackId: string, moverId: string, name: string) => void
  /** Rebind a composition track's MIDI rows to scenes. */
  setSceneBindings: (trackId: string, bindings: NonNullable<Track['sceneBindings']>) => void
  addMoverTrack: (parentId: string, moverId: string, moverLabel: string) => void
  setMoverInput: (trackId: string, key: string, value: number) => void
  /** Add a `wordFormation` child track under `parentId` (a text instrument): one
   *  arrangement its words are seated into while this lane's notes are the most
   *  recent. Unlike the other lane types there is no uniqueness rule - several
   *  formations under one text track is the whole point, and they are told apart
   *  by which one played last. */
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
  /** Set (or clear, with undefined) an automation track's burst mode. Setting one
   *  mode clears the others - a lane is in exactly one mode. */
  setTrackBurst: (trackId: string, burst: Track['burst'] | undefined) => void
  /** Set (or clear, with undefined) an automation track's cycle mode (the motion
   *  curve stretched between note onsets). Same exclusivity as noise/burst. */
  setTrackCycle: (trackId: string, cycle: Track['cycle'] | undefined) => void
  /** Set (or clear) an automation lane's row-spread config (value sub-range,
   *  row count, integer snap, spread curve). An empty object clears. */
  setTrackAutomationRange: (trackId: string, range: Track['automationRange'] | undefined) => void
  /** Put an automation lane in one of its four modes, in ONE action (so it is one
   *  undo step). Re-entering a mode starts from that mode's defaults. */
  setAutomationMode: (trackId: string, mode: AutomationMode) => void
  /** Retarget an automation lane onto another of its parent's params (same
   *  addressing as addAutomationTrack, fx: keys included). No-ops if a sibling
   *  lane already drives that param. `rename` carries the new label onto the
   *  lane's name (the caller passes true when the old name was the auto-name,
   *  so a user's custom name survives). */
  setAutomationTarget: (trackId: string, paramKey: string, paramLabel: string, rename: boolean) => void
  /** Fix an automation lane's target after a drag moved (or copied) it under a
   *  new parent. `available` is every target the new parent offers (the caller
   *  resolves it - the store can't read instrument defs; see the import note at
   *  the top). Prefers restoring `previousTargetParam` when the lane fits here
   *  again (that's what makes dragging BACK work), keeps a target that still
   *  fits, and otherwise falls to the first free option while remembering the
   *  displaced one. `rename` mirrors setAutomationTarget's flag. */
  remapAutomationTarget: (trackId: string, available: { key: string; label: string }[], rename: boolean) => void
  /** Set an automation lane's output amount (a whole-lane gain, any mode).
   *  Clamped to [0, AUTOMATION_AMOUNT_MAX]; 1 is stored as absence. */
  setTrackAutomationAmount: (trackId: string, amount: number) => void
  setTrackTargets: (trackId: string, targets: Track['targets']) => void
  /** Which copies a mover/splitter row acts on. `undefined` = all of them, which
   *  is how neutral targeting is stored (see core/visualCopies/copyTargets.ts). */
  setTrackCopyTargets: (trackId: string, copyTargets: Track['copyTargets']) => void
  setTrackTags: (trackId: string, tags: string[]) => void
  /** Draw this object on top of everything (depth-ignored overlay). */
  setTrackOnTop: (trackId: string, onTop: boolean) => void
  /** Set an audio track's output volume (linear gain, clamped to [0, 1.5]).
   *  Unity is stored as absence, like automationAmount. A volume-only change
   *  is applied as a live gain by the audio engine WITHOUT re-arming players
   *  (see usePlayback's subscription), so dragging the fader stays smooth. */
  setTrackVolume: (trackId: string, volume: number) => void
  /** Replace a Video track's ordered pads (its bank of source moments). */
  setTrackVideoPads: (trackId: string, videoPads: VideoPad[]) => void
  /** Replace a Photo track's ordered photos (its bank). */
  setTrackPhotoPads: (trackId: string, photoPads: PhotoPad[]) => void
  /** Create an audio track (top of the root tracks) holding one block at bar 0
   *  spanning the whole clip. The load pipeline's landing spot - files dropped
   *  on the track area end here; a project can hold several. Returns the new
   *  track's id (for selection). */
  addAudioTrack: (clip: { ref: string; fileName: string; duration: number }) => string
  /** Create one root track per imported MIDI track (default instrument, one
   *  block spanning its notes, whole bars), growing totalBars if the content
   *  overruns. One set() so the whole import is a single undo step. Returns
   *  the new track ids in order. */
  importMidiTracks: (imported: ImportedMidiTrack[]) => string[]
  /** The Midi Roll template's refill contract (the Lyrics-track sibling): a
   *  root 'Midi Roll' track wearing that instrument takes the whole imported
   *  file's notes - every file track merged onto the one roll, styling kept,
   *  placeholder pattern replaced. Returns the track id, or null when no such
   *  track exists (plain imports mint their own tracks via importMidiTracks). */
  refillMidiRollTrack: (imported: ImportedMidiTrack[]) => string | null
  /** Fill a Text Display track with lyrics: one "Next word" note per word
   *  (beats are project-absolute), the words joined into the text param. A
   *  root track named 'Lyrics' (the lyric templates ship one, styled) is
   *  REFILLED in place - words swap, styling stays; otherwise a fresh track
   *  is created. Pass the aligner's sung-seconds `timing` so the track keeps
   *  seconds as its source of truth (setBpm re-derives the beats from it).
   *  One set() = one undo step. Returns the track id, or null when there are
   *  no words.
   *
   *  Pass `targetId` to refill THAT Text Display track instead (the panel's
   *  Transcribe button, where the words belong on the track you pressed it
   *  from, whatever it is named). */
  addLyricTrack: (words: LyricWord[], timing?: TranscribedWord[], targetId?: string) => string | null
  /** Rebuild a Lyrics track's notes + text from its lyricTiming: word-by-word
   *  (one note per word) or whole lines at once (one note per grouped line). */
  setLyricGrouping: (trackId: string, grouping: 'words' | 'lines') => void
  // Lyric clips + style lanes (Text Display; core/visual/lyricClips.ts).
  addLyricClip: (trackId: string, clip: Omit<LyricClip, 'id'>) => void
  updateLyricClip: (trackId: string, clipId: string, updates: Partial<Omit<LyricClip, 'id'>>) => void
  removeLyricClip: (trackId: string, clipId: string) => void
  /** Alt-drag duplicate: copy a clip in place and return the copy's id (the
   *  gesture then drags the copy). */
  duplicateLyricClip: (trackId: string, clipId: string) => string | null
  /** Rewrite ONE word in place (the note-editing path). Writes through to the
   *  clip's words, padding if a starved note's slot is past the end. */
  setLyricClipWord: (trackId: string, clipId: string, wordIndex: number, word: string) => void
  /** Paste-and-slice: one text line → one clip, laid down the timeline from
   *  `startBeat` (default 0), 1 bar per clip, replacing existing clips. */
  sliceLyricsIntoClips: (trackId: string, text: string, startBeat?: number) => void
  updateStyleLane: (trackId: string, index: number, updates: Partial<StyleLane>) => void
  addStyleLane: (trackId: string) => void
  removeStyleLane: (trackId: string, index: number) => void
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

// Text Display's default word pitch: the PLAIN style lane (STYLE_PITCH_TOP - 2;
// see core/visual/lyricClips.ts - pitch picks the lane, lane styles the word).
const TEXT_WORD_PITCH = 58
// Text Display's 1-frame giant-text insert (its PITCH_ZOOM_FLASH).
const TEXT_ZOOM_FLASH_PITCH = 46
// Color Filters' Invert row - the Monochrome style's polarity strobe.
const INVERT_FILTER_PITCH = 72

function makeInitialScenes(): { scenes: Record<string, Scene>; sceneOrder: string[]; activeSceneId: string } {
  const mainId = crypto.randomUUID()
  const firstId = crypto.randomUUID()
  return {
    scenes: {
      [mainId]: { id: mainId, name: 'Composite', isMain: true, backgroundColor: DEFAULT_SCENE_BACKGROUND, backgroundTransparent: false, tracks: {}, rootTrackIds: [] },
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
  // The scene instrument is spliced in HERE and nowhere else on the read path:
  // it is virtual (core/sceneTrack.ts), so the flattened view is the only place
  // the rest of the editor can meet it as an ordinary track. The engine gets
  // the same splice from its own `sceneTrackView` call, per scene.
  const view = scene ? sceneTrackView(scene) : { tracks: {}, rootTrackIds: [] }
  return {
    tracks: { ...audioTracks, ...view.tracks },
    rootTrackIds: [...audioRootTrackIds, ...view.rootTrackIds],
  }
}

/** One scene-effect edit: the scene with its new chain, plus - when that scene
 *  is the active one - the rebuilt flattened view, so a materialized scene
 *  track (⌘⇧S) re-derives with the new chain immediately. Same discipline as
 *  setSceneTrackEnabled; cheap when the scene track is off (viewForScene is a
 *  spread), and inactive scenes need no view at all. */
function sceneEffectsPatch(
  s: ProjectState,
  sceneId: string,
  effects: EffectInstance[],
): Partial<ProjectState> {
  const scenes = { ...s.scenes, [sceneId]: { ...s.scenes[sceneId], effects } }
  return sceneId === s.activeSceneId
    ? { scenes, ...viewForScene(scenes, sceneId, s.audioTracks, s.audioRootTrackIds) }
    : { scenes }
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
    // Peel the synthetic scene track back off before it can be written into the
    // document (core/sceneTrack.ts). Every ordinary track action - param
    // writes, adding a lane, deleting one, a nest drag - therefore reaches the
    // scene instrument with no special case of its own, and `tracks` /
    // `rootTrackIds` on the Scene stay exactly what they were before the
    // feature existed. Skipped entirely while it's off, so the untouched path
    // allocates nothing new.
    const scenePatch = active.sceneTrackEnabled
      ? dematerializeSceneTrack(active.id, sceneTracks, sceneRootTrackIds)
      : { tracks: sceneTracks, rootTrackIds: sceneRootTrackIds }
    return {
      ...value,
      scenes: {
        ...s.scenes,
        [active.id]: { ...active, ...scenePatch },
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
  appliedTemplateId: null,

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
          if (!isCompositionTrack(track)) continue
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

  // The backdrop is ONE three-way choice (color | gradient | transparent)
  // spread across two fields; writing both here keeps a mode switch atomic -
  // a single undo step, never an intermediate state where transparency and an
  // enabled gradient disagree. The gradient's setup survives leaving the mode.
  setSceneBackdropMode: (sceneId, mode) => rawSet((s) => {
    const scene = s.scenes[sceneId]
    if (!scene || sceneBackdropMode(scene) === mode) return s
    const gradient = scene.backgroundGradient ?? defaultSceneGradient()
    return {
      scenes: {
        ...s.scenes,
        [sceneId]: {
          ...scene,
          backgroundTransparent: mode === 'transparent',
          backgroundGradient: { ...gradient, enabled: mode === 'gradient' },
        },
      },
    }
  }),

  setSceneBackgroundGradient: (sceneId, patch) => rawSet((s) => {
    const scene = s.scenes[sceneId]
    if (!scene) return s
    const gradient = { ...(scene.backgroundGradient ?? defaultSceneGradient()), ...patch }
    return { scenes: { ...s.scenes, [sceneId]: { ...scene, backgroundGradient: gradient } } }
  }),

  // Scene-level effect chain - same contract as the per-track actions below,
  // but the chain lives on the scene itself (Scene.effects). Applied by
  // VisualScene's compositor as full-frame passes, and surfaced as the scene
  // instrument's effect channel when ⌘⇧S shows it (core/sceneTrack.ts folds
  // the synthetic track's `effects` back onto this field). Each action ships
  // through `sceneEffectsPatch`, which also REBUILDS the flattened view when
  // the edited scene is active: the materialized scene track carries this
  // chain as `track.effects`, so skipping the rebuild leaves the timeline row
  // and inspector showing the pre-edit chain until an unrelated edit.
  addSceneEffect: (sceneId, pluginId) => rawSet((s) => {
    const scene = s.scenes[sceneId]
    const plugin = getEffect(pluginId)
    if (!scene || !plugin) return s
    const settings: Record<string, number> = {}
    for (const p of plugin.params) if (typeof p.default === 'number') settings[p.key] = p.default
    const instance: EffectInstance = { id: crypto.randomUUID(), pluginId, enabled: true, settings }
    return sceneEffectsPatch(s, sceneId, [...(scene.effects ?? []), instance])
  }),

  removeSceneEffect: (sceneId, instanceId) => rawSet((s) => {
    const scene = s.scenes[sceneId]
    if (!scene?.effects) return s
    return sceneEffectsPatch(s, sceneId, scene.effects.filter((e) => e.id !== instanceId))
  }),

  setSceneEffectSetting: (sceneId, instanceId, key, value) => rawSet((s) => {
    const scene = s.scenes[sceneId]
    if (!scene?.effects) return s
    return sceneEffectsPatch(s, sceneId,
      scene.effects.map((e) => e.id === instanceId ? { ...e, settings: { ...e.settings, [key]: value } } : e))
  }),

  toggleSceneEffect: (sceneId, instanceId) => rawSet((s) => {
    const scene = s.scenes[sceneId]
    if (!scene?.effects) return s
    return sceneEffectsPatch(s, sceneId,
      scene.effects.map((e) => e.id === instanceId ? { ...e, enabled: !e.enabled } : e))
  }),

  reorderSceneEffect: (sceneId, instanceId, direction) => rawSet((s) => {
    const scene = s.scenes[sceneId]
    if (!scene?.effects) return s
    const from = scene.effects.findIndex((e) => e.id === instanceId)
    const to = from + direction
    if (from < 0 || to < 0 || to >= scene.effects.length) return s
    const effects = scene.effects.slice()
    effects[from] = scene.effects[to]
    effects[to] = scene.effects[from]
    return sceneEffectsPatch(s, sceneId, effects)
  }),

  setSceneTrackEnabled: (sceneId, enabled) => rawSet((s) => {
    const scene = s.scenes[sceneId]
    if (!scene || !!scene.sceneTrackEnabled === enabled) return s
    // Absence is the OFF state (core/sceneTrack.ts reads it as "no scene
    // instrument at all"), so turning it off drops the field rather than
    // storing false - a scene that has never been peeked at stays byte-identical
    // to a pre-feature save. Its params and lanes are deliberately kept.
    const next: Scene = { ...scene, sceneTrackEnabled: enabled }
    if (!enabled) delete next.sceneTrackEnabled
    const scenes = { ...s.scenes, [sceneId]: next }
    // The flattened view is derived, so it has to be rebuilt when the scene
    // being toggled is the one on screen.
    return sceneId === s.activeSceneId
      ? { scenes, ...viewForScene(scenes, sceneId, s.audioTracks, s.audioRootTrackIds) }
      : { scenes }
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
      // The scene instrument's lanes are not in `rootTrackIds` (it is virtual -
      // core/sceneTrack.ts), so they need their own clone pass or the copy
      // arrives with a scene instrument whose lanes all dangle.
      nextId = crypto.randomUUID()
      const sceneTrackChildIds: string[] = []
      for (const childId of source.sceneTrackChildIds ?? []) {
        const snapshot = snapshotTrackTree(childId, source.tracks)
        if (!snapshot) continue
        const tree = cloneTrackTree(snapshot, sceneTrackId(nextId))
        if (tree[0]) sceneTrackChildIds.push(tree[0].id)
        for (const track of tree) tracks[track.id] = track
      }
      const scene: Scene = {
        id: nextId,
        name: `${source.name} Copy`,
        isMain: false,
        backgroundColor: source.backgroundColor,
        backgroundTransparent: source.backgroundTransparent,
        backgroundGradient: source.backgroundGradient && { ...source.backgroundGradient },
        // Fresh instance ids, per the clone convention - duplicated chains must
        // never share ids with the source.
        effects: source.effects?.map((e) => ({ ...e, id: crypto.randomUUID(), settings: { ...e.settings } })),
        tracks,
        rootTrackIds,
        sceneTrackEnabled: source.sceneTrackEnabled,
        sceneTrackParams: source.sceneTrackParams && { ...source.sceneTrackParams },
        sceneTrackStringParams: source.sceneTrackStringParams && { ...source.sceneTrackStringParams },
        sceneTrackChildIds: sceneTrackChildIds.length ? sceneTrackChildIds : undefined,
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
      // Hand-built tracks (console scripts, E2E) sometimes arrive without an id.
      // Left alone, the record keys it "undefined", rootTrackIds gains a literal
      // undefined (persisted as null), and the timeline row renders key={undefined}
      // - React's missing-key warning pointing at TimelineArea's keyed map. Mint one.
      if (!track.id) track = { ...track, id: crypto.randomUUID() }
      // The scene instrument takes only the lane types it can express - an
      // object nested under it would say what `rootTrackIds` already says, and
      // the dematerializer has nowhere to put it. Land it at root instead of
      // dropping the add on the floor. (core/sceneTrack.ts)
      if (isSceneTrackId(track.parentId) && !canBeSceneTrackChild(track)) {
        track = { ...track, parentId: undefined }
      }
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

          const split = splitBlockAtBeat(block, beat, beatsPerBar)
          if (!split) {
            blocks.push(block)
            continue
          }

          blocks.push(...split.blocks)
          splitBlockIds.add(split.right.id)
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
      // The scene instrument is virtual: there is no document entry to remove,
      // and deleting it here would silently take its lanes with it. ⌘⇧S hides
      // it (setSceneTrackEnabled); nothing deletes it.
      if (isSceneTrackId(trackId)) return s
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
    // `source.tracks` is the document, so the virtual scene instrument is
    // simply absent here and needs no guard of its own - but a scene LANE is
    // present and has to be refused, and its parentId check does that.
    const root = source?.tracks[trackId]
    if (!source || !target || source.id === target.id || !root || root.parentId || root.type === 'audio') return s
    // Main is composition-only, and mainOnly composers never leave it. Crop
    // (composition def, mainOnly false) passes BOTH ways - moving it between
    // Main and a scene deliberately switches which resolve path picks it up.
    const rootDef = root.type === 'base' ? compositionDef(root.instrumentId) : undefined
    if (target.isMain && !isCompositionTrack(root)) return s
    if (!target.isMain && rootDef?.mainOnly) return s

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

  // Insert an identical copy of a track subtree under `parentId` (null = root) at a
  // given sibling index (undefined = append) - the Alt-drag commit. The original is
  // left untouched.
  insertTrackCopy: (srcId, parentId, index) => {
    let newId: string | null = null
    set((s) => {
      const snapshot = snapshotTrackTree(srcId, s.tracks)
      if (!snapshot) return s
      // Nothing nests under the audio track (the UI blocks this; the backstop).
      if (parentId != null && (!s.tracks[parentId] || s.tracks[parentId].type === 'audio')) return s
      // The scene instrument is one per scene and virtual - it cannot be copied,
      // and only its own lane types may be copied onto it.
      if (isSceneTrackId(srcId)) return s
      if (isSceneTrackId(parentId) && !canBeSceneTrackChild(snapshot.tracks[srcId])) return s
      const tree = cloneTrackTree(snapshot, parentId)
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
      // The scene instrument is pinned the same way, and takes only the lane
      // types it can express (core/sceneTrack.ts) - an object nested under it
      // would say what `rootTrackIds` already says.
      if (isSceneTrackId(trackId)) return s
      if (isSceneTrackId(parentId) && !canBeSceneTrackChild(child)) return s
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

  setTracksParent: (trackIds, parentId, index) =>
    set((s) => {
      // Same per-track guards as setTrackParent, applied member-wise.
      const requested = trackIds.filter((id) => {
        const child = s.tracks[id]
        if (!child || child.type === 'audio' || id === parentId) return false
        if (parentId != null && (!s.tracks[parentId] || s.tracks[parentId].type === 'audio')) return false
        if (isSceneTrackId(id)) return false
        if (isSceneTrackId(parentId) && !canBeSceneTrackChild(child)) return false
        for (let cur: string | undefined = parentId ?? undefined; cur != null; cur = s.tracks[cur]?.parentId) {
          if (cur === id) return false
        }
        return true
      })
      // A member whose ancestor also moves rides along inside that subtree.
      const moving = new Set(requested)
      const ids = requested.filter((id) => {
        for (let cur = s.tracks[id]?.parentId; cur != null; cur = s.tracks[cur]?.parentId) {
          if (moving.has(cur)) return false
        }
        return true
      })
      if (ids.length === 0) return s

      const tracks = { ...s.tracks }
      let rootTrackIds = [...s.rootTrackIds]
      const movingSet = new Set(ids)

      // Detach EVERY moved track first, so the insertion index means "among the
      // remaining siblings" even when some members already live under the target
      // parent ahead of the insertion point.
      for (const id of ids) {
        const child = tracks[id]
        const oldParentId = child.parentId
        if (oldParentId != null) {
          const op = tracks[oldParentId]
          if (op) tracks[oldParentId] = { ...op, childIds: op.childIds.filter((c) => !movingSet.has(c)) }
        } else {
          rootTrackIds = rootTrackIds.filter((rid) => !movingSet.has(rid))
        }
        tracks[id] = { ...child, parentId: parentId ?? undefined }
      }

      if (parentId != null) {
        const np = tracks[parentId]
        const childIds = np.childIds.filter((c) => !movingSet.has(c))
        const i = index == null ? childIds.length : Math.max(0, Math.min(childIds.length, index))
        childIds.splice(i, 0, ...ids)
        tracks[parentId] = { ...np, childIds }
      } else {
        const min = audioPinnedCount(tracks, rootTrackIds)
        const i = index == null ? rootTrackIds.length : Math.max(min, Math.min(rootTrackIds.length, index))
        rootTrackIds.splice(i, 0, ...ids)
      }
      return { tracks, rootTrackIds }
    }),

  groupTracks: (trackIds) => wrapSelection(set, trackIds, {
    // Lanes live only on their parent and audio is pinned - neither joins.
    eligible: (t) => t.type !== 'audio' && t.type !== 'automation'
      && t.type !== 'ability' && t.type !== 'envelope'
      // The scene instrument is the scene; it cannot be a member of anything.
      && !isSceneTrackId(t.id),
    build: (id, parentId, members, color) => ({
      id,
      name: 'Group',
      type: 'group',
      instrumentId: '',
      color,
      muted: false,
      solo: false,
      blocks: [],
      parentId: parentId ?? undefined,
      childIds: members,
    }),
  }),

  wrapTracksInSwitcher: (trackIds) => wrapSelection(set, trackIds, {
    // A rack is generic: devices, objects, groups and nested racks all make
    // rows. Only the lanes that live on their parent, and audio, stay out -
    // the same exclusions grouping makes.
    eligible: (t) => t.type !== 'audio' && t.type !== 'automation'
      && t.type !== 'ability' && t.type !== 'envelope'
      // The scene instrument is the scene; it cannot be a member of anything.
      && !isSceneTrackId(t.id),
    build: (id, parentId, members, color) => ({
      id,
      name: 'Switcher',
      type: 'switcher',
      instrumentId: '',
      color,
      muted: false,
      solo: false,
      blocks: [],
      parentId: parentId ?? undefined,
      childIds: members,
      params: { [SWITCHER_MODE_PARAM.key]: SWITCHER_MODE_PARAM.default },
      // Seeded here so the pitches are explicit in the document from the first
      // save; `orderedSwitcherBindings` self-heals anything that goes stale
      // later, exactly as the scene bindings do.
      switcherBindings: seedSwitcherBindings(members),
    }),
  }),

  ungroupTrack: (trackId) =>
    set((s) => {
      const g = s.tracks[trackId]
      // Switchers dissolve the same way groups do - the members splice back
      // into the container's slot and the container's own lane dies with it.
      if (!g || (g.type !== 'group' && g.type !== 'switcher')) return s
      // The scene instrument is a group only by materialization; dissolving it
      // would delete its lanes and leave the Scene's fields orphaned. ⌘⇧S hides
      // it instead (setSceneTrackEnabled).
      if (isSceneTrackId(trackId)) return s
      const parentId = g.parentId ?? null
      // Members splice back where the group was; the group's own lanes are
      // meaningless without it and are deleted, subtrees included.
      const memberIds = g.childIds.filter((cid) => {
        const c = s.tracks[cid]
        return !!c && c.type !== 'automation' && c.type !== 'ability'
          && c.type !== 'envelope'
      })
      const memberSet = new Set(memberIds)
      const doomed = new Set<string>()
      const queue = [trackId, ...g.childIds.filter((cid) => !memberSet.has(cid))]
      while (queue.length) {
        const id = queue.pop()!
        if (doomed.has(id) || memberSet.has(id)) continue
        doomed.add(id)
        for (const c of s.tracks[id]?.childIds ?? []) queue.push(c)
      }
      const tracks: Record<string, Track> = {}
      for (const [id, t] of Object.entries(s.tracks)) {
        if (doomed.has(id)) continue
        tracks[id] = t
      }
      for (const mid of memberIds) {
        const m = tracks[mid]
        if (m) tracks[mid] = { ...m, parentId: parentId ?? undefined }
      }
      let rootTrackIds = [...s.rootTrackIds]
      if (parentId != null) {
        const np = tracks[parentId]
        if (np) {
          const childIds = [...np.childIds]
          const at = childIds.indexOf(trackId)
          childIds.splice(at < 0 ? childIds.length : at, at < 0 ? 0 : 1, ...memberIds)
          tracks[parentId] = { ...np, childIds: childIds.filter((c) => !doomed.has(c)) }
        }
      } else {
        const at = rootTrackIds.indexOf(trackId)
        rootTrackIds.splice(at < 0 ? rootTrackIds.length : at, at < 0 ? 0 : 1, ...memberIds)
        rootTrackIds = rootTrackIds.filter((rid) => !doomed.has(rid))
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

  // Swap a track's instrument in place (library double-click or drag-onto-row).
  // Wardrobe semantics: the outgoing instrument's own params/stringParams are
  // stashed under its id in paramsByInstrument and restored exactly if the track
  // ever swaps back - so A→B→A is lossless, not a reset. The canonical tf*
  // transform is instrument-independent and rides the live params through every
  // swap instead of entering the stash. First time an instrument is worn it
  // starts at its defaults. The track is renamed to match (tracks are named
  // after their instrument), unless a name isn't supplied.
  setTrackInstrument: (trackId, instrumentId, name) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track || track.instrumentId === instrumentId) return s
      const tfKeys = new Set<string>(TRANSFORM_PARAM_DEFS.map((p) => p.key))
      const live = Object.entries(track.params ?? {})
      const tfParams = Object.fromEntries(live.filter(([k]) => tfKeys.has(k)))
      const ownParams = Object.fromEntries(live.filter(([k]) => !tfKeys.has(k)))
      const stash = { ...(track.paramsByInstrument ?? {}) }
      if (track.instrumentId) {
        stash[track.instrumentId] = { params: ownParams, stringParams: track.stringParams ?? {} }
      }
      const restored = stash[instrumentId]
      const base: Track = {
        ...track,
        type: 'base',
        instrumentId,
        params: { ...(restored?.params ?? {}), ...tfParams },
        stringParams: { ...(restored?.stringParams ?? {}) },
        paramsByInstrument: stash,
        moverId: undefined,
        splitterId: undefined,
        inputValues: undefined,
        name: name ?? track.name,
      }
      // Converting to a composition instrument ON MAIN carries the extra
      // conversion semantics the director era had: seed the scene bindings
      // and drop child lanes (they addressed the previous instrument's
      // params). Off Main - crop in a visual scene - it is an ordinary
      // instrument change.
      const composition = compositionDef(instrumentId) && s.scenes[s.activeSceneId]?.isMain
      return {
        tracks: {
          ...s.tracks,
          [trackId]: composition
            ? { ...base, sceneBindings: seedSceneBindings(s.scenes, s.sceneOrder), childIds: [] }
            : base,
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
            name,
          },
        },
      }
    }),

  setSceneBindings: (trackId, bindings) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track || !isCompositionTrack(track)) return s
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
        color: resolveNextTrackColor(s, parentId),
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
        // Param lanes have no definition to declare an identity, so they take
        // their own hue-cycle color - lanes no longer inherit their parent.
        color: resolveNextTrackColor(s, parentId),
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
        // Param lanes have no definition to declare an identity, so they take
        // their own hue-cycle color - lanes no longer inherit their parent.
        color: resolveNextTrackColor(s, parentId),
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

  addLyricClip: (trackId, clip) =>
    set((s) => {
      const t = s.tracks[trackId]
      if (!t || t.instrumentId !== 'textDisplay') return s
      const next: LyricClip = { ...clip, id: crypto.randomUUID() }
      return { tracks: { ...s.tracks, [trackId]: { ...t, lyricClips: [...(t.lyricClips ?? []), next] } } }
    }),

  updateLyricClip: (trackId, clipId, updates) =>
    set((s) => {
      const t = s.tracks[trackId]
      if (!t?.lyricClips) return s
      const lyricClips = t.lyricClips.map((c) => (c.id === clipId ? { ...c, ...updates } : c))
      return { tracks: { ...s.tracks, [trackId]: { ...t, lyricClips } } }
    }),

  removeLyricClip: (trackId, clipId) =>
    set((s) => {
      const t = s.tracks[trackId]
      if (!t?.lyricClips) return s
      return { tracks: { ...s.tracks, [trackId]: { ...t, lyricClips: t.lyricClips.filter((c) => c.id !== clipId) } } }
    }),

  duplicateLyricClip: (trackId, clipId) => {
    let newId: string | null = null
    set((s) => {
      const t = s.tracks[trackId]
      const src = t?.lyricClips?.find((c) => c.id === clipId)
      if (!t || !src) return s
      newId = crypto.randomUUID()
      const copy: LyricClip = { ...src, id: newId, words: [...src.words], layout: { ...src.layout } }
      return { tracks: { ...s.tracks, [trackId]: { ...t, lyricClips: [...t.lyricClips!, copy] } } }
    })
    return newId
  },

  setLyricClipWord: (trackId, clipId, wordIndex, word) =>
    set((s) => {
      const t = s.tracks[trackId]
      const clip = t?.lyricClips?.find((c) => c.id === clipId)
      if (!t || !clip || wordIndex < 0) return s
      const words = [...clip.words]
      while (words.length <= wordIndex) words.push('')
      words[wordIndex] = word
      const lyricClips = t.lyricClips!.map((c) => (c.id === clipId ? { ...c, words } : c))
      return { tracks: { ...s.tracks, [trackId]: { ...t, lyricClips } } }
    }),

  sliceLyricsIntoClips: (trackId, text, startBeat = 0) =>
    set((s) => {
      const t = s.tracks[trackId]
      if (!t || t.instrumentId !== 'textDisplay') return s
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      if (lines.length === 0) return s
      const barBeats = s.beatsPerBar
      const lyricClips: LyricClip[] = lines.map((line, i) => ({
        id: crypto.randomUUID(),
        startBeat: startBeat + i * barBeats,
        durationBeats: barBeats,
        words: line.split(/\s+/),
        layout: t.lyricClips?.[0]?.layout ?? { kind: 'one' },
      }))
      return { tracks: { ...s.tracks, [trackId]: { ...t, lyricClips } } }
    }),

  updateStyleLane: (trackId, index, updates) =>
    set((s) => {
      const t = s.tracks[trackId]
      if (!t || t.instrumentId !== 'textDisplay') return s
      // Resolve to the full lane set first so editing lane 3 of a track still
      // on the defaults stores all five (partial stores would re-default the
      // rest out from under the edit).
      const lanes = resolveStyleLanes(t.styleLanes)
      if (index < 0 || index >= lanes.length) return s
      const styleLanes = lanes.map((l, i) => (i === index ? { ...l, ...updates } : l))
      return { tracks: { ...s.tracks, [trackId]: { ...t, styleLanes } } }
    }),

  addStyleLane: (trackId) =>
    set((s) => {
      const t = s.tracks[trackId]
      if (!t || t.instrumentId !== 'textDisplay') return s
      const lanes = resolveStyleLanes(t.styleLanes)
      if (lanes.length >= MAX_STYLE_LANES) return s
      const styleLanes = [...lanes, { name: `LANE ${lanes.length + 1}`, font: 0, color: '#ffffff', size: 1 }]
      return { tracks: { ...s.tracks, [trackId]: { ...t, styleLanes } } }
    }),

  removeStyleLane: (trackId, index) =>
    set((s) => {
      const t = s.tracks[trackId]
      if (!t || t.instrumentId !== 'textDisplay') return s
      const lanes = resolveStyleLanes(t.styleLanes)
      // Never below one lane - a text track with no rows can't sing.
      if (lanes.length <= 1 || index < 0 || index >= lanes.length) return s
      const styleLanes = lanes.filter((_, i) => i !== index)
      return { tracks: { ...s.tracks, [trackId]: { ...t, styleLanes } } }
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
        // Param lanes have no definition to declare an identity, so they take
        // their own hue-cycle color - lanes no longer inherit their parent.
        color: resolveNextTrackColor(s, parentId),
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

  // The non-keyframe modes are mutually exclusive: setting one drops the
  // others, so a lane is never ambiguous (the engine would silently prefer burst).
  setTrackNoise: (trackId, noise) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, noise, burst: noise ? undefined : track.burst, cycle: noise ? undefined : track.cycle } } }
    }),

  setTrackAutomationRange: (trackId, range) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      const empty = !range || Object.keys(range).length === 0
      return { tracks: { ...s.tracks, [trackId]: { ...track, automationRange: empty ? undefined : range } } }
    }),
  setTrackBurst: (trackId, burst) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, burst, noise: burst ? undefined : track.noise, cycle: burst ? undefined : track.cycle } } }
    }),

  setTrackCycle: (trackId, cycle) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, cycle, noise: cycle ? undefined : track.noise, burst: cycle ? undefined : track.burst } } }
    }),

  setAutomationMode: (trackId, mode) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      // Each mode's config is what identifies it, so switching is just choosing
      // which one exists. A fresh noise seed per entry = a fresh random take.
      const next: Track = {
        ...track,
        noise: mode === 'noise'
          ? track.noise ?? { ...DEFAULT_NOISE, seed: Math.floor(Math.random() * 1e9) }
          : undefined,
        burst: mode === 'burst' ? track.burst ?? { ...DEFAULT_BURST } : undefined,
        cycle: mode === 'cycle' ? track.cycle ?? { ...DEFAULT_CYCLE } : undefined,
      }
      return { tracks: { ...s.tracks, [trackId]: next } }
    }),

  setAutomationTarget: (trackId, paramKey, paramLabel, rename) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track || track.type !== 'automation' || track.targetParam === paramKey) return s
      // Same one-lane-per-param rule as addAutomationTrack: retargeting onto a
      // param a sibling lane already drives would stack duplicates.
      const parent = track.parentId ? s.tracks[track.parentId] : undefined
      const taken = (parent?.childIds ?? []).some((cid) => {
        const c = s.tracks[cid]
        return !!c && c.id !== trackId && c.type === 'automation' && c.targetParam === paramKey
      })
      if (taken) return s
      // The row-spread config speaks the OLD param's value units; a stale
      // sub-range on a new param is nonsense, so it resets to the full span.
      // Note pitches re-map onto the new param's range by construction. A
      // deliberate retarget also forgets any drag-displaced previous target.
      const next: Track = { ...track, targetParam: paramKey, automationRange: undefined, previousTargetParam: undefined }
      if (rename) next.name = paramLabel
      return { tracks: { ...s.tracks, [trackId]: next } }
    }),

  remapAutomationTarget: (trackId, available, rename) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track || track.type !== 'automation') return s
      const parent = track.parentId ? s.tracks[track.parentId] : undefined
      if (!parent) return s
      // Same one-lane-per-param rule as setAutomationTarget: a target a sibling
      // lane already drives counts as unavailable here.
      const taken = new Set((parent.childIds ?? [])
        .map((cid) => s.tracks[cid])
        .filter((c) => !!c && c.id !== trackId && c.type === 'automation')
        .map((c) => c!.targetParam))
      const usable = (key: string | undefined) =>
        !!key && !taken.has(key) && available.some((o) => o.key === key)
      const retarget = (key: string, label: string, previous: string | undefined): { tracks: Record<string, Track> } => {
        // Range resets like setAutomationTarget's: it speaks the old param's units.
        const next: Track = { ...track, targetParam: key, previousTargetParam: previous, automationRange: undefined }
        if (rename) next.name = label
        return { tracks: { ...s.tracks, [trackId]: next } }
      }
      // The displaced original wins over a still-fitting default: that is what
      // makes dragging the lane back to its old parent restore it.
      const previous = track.previousTargetParam
      if (usable(previous)) {
        const option = available.find((o) => o.key === previous)!
        return retarget(option.key, option.label, undefined)
      }
      if (usable(track.targetParam)) return s
      const fallback = available.find((o) => !taken.has(o.key))
      if (!fallback || fallback.key === track.targetParam) return s
      return retarget(fallback.key, fallback.label, track.previousTargetParam ?? track.targetParam)
    }),

  setTrackAutomationAmount: (trackId, amount) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      const clamped = Math.max(0, Math.min(AUTOMATION_AMOUNT_MAX, amount))
      // Neutral gain is stored as absence, so untouched lanes don't grow a field.
      return { tracks: { ...s.tracks, [trackId]: { ...track, automationAmount: clamped === 1 ? undefined : clamped } } }
    }),

  setTrackTargets: (trackId, targets) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, targets } } }
    }),

  setTrackCopyTargets: (trackId, copyTargets) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, copyTargets } } }
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

  setTrackVolume: (trackId, volume) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      const clamped = Math.max(0, Math.min(1.5, volume))
      // Unity gain is stored as absence, so untouched tracks don't grow a field.
      return { tracks: { ...s.tracks, [trackId]: { ...track, volume: clamped === 1 ? undefined : clamped } } }
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
          // An imported MIDI file lands as a Midi Roll: the notes ARE the
          // visual, whatever their pitch range - swap the instrument after.
          instrumentId: 'midiRoll',
          // Chain through the partially-built maps so multi-track imports
          // step the hue cycle per track.
          color: resolveNextTrackColor({ tracks, rootTrackIds }),
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

  refillMidiRollTrack: (imported) => {
    let resultId: string | null = null
    set((s) => {
      const existingId = s.rootTrackIds.find((tid) => {
        const t = s.tracks[tid]
        return t?.type === 'base' && t.instrumentId === 'midiRoll' && t.name === 'Midi Roll'
      })
      if (!existingId) return s
      const notes = imported.flatMap((t) => t.notes)
      if (notes.length === 0) return s
      const endBeat = Math.max(...imported.map((t) => t.endBeat))
      const durationBars = Math.min(MAX_TOTAL_BARS, Math.max(1, Math.ceil(endBeat / s.beatsPerBar)))
      // One block at bar 0 replaces whatever the track held (the template's
      // placeholder pattern); file-absolute beats ARE block-relative here.
      const block: Block = {
        id: crypto.randomUUID(),
        startBar: 0,
        durationBars,
        loop: false,
        notes: notes.map((n) => ({ ...n, id: crypto.randomUUID() })),
      }
      resultId = existingId
      // Grow (never shrink) the project if the file overruns, like MIDI import.
      const totalBars = durationBars > s.totalBars ? durationBars : s.totalBars
      return {
        tracks: { ...s.tracks, [existingId]: { ...s.tracks[existingId], blocks: [block] } },
        totalBars,
      }
    })
    return resultId
  },

  addLyricTrack: (words, timing, targetId) => {
    if (words.length === 0) return null
    let resultId: string | null = null
    set((s) => {
      // A lyric-template project ships a styled root track named 'Lyrics' -
      // refill it (words swap, styling stays) instead of stacking a second one.
      // An explicit target wins: that is the track the button was pressed on.
      const named = s.rootTrackIds.find((tid) => {
        const t = s.tracks[tid]
        return t?.type === 'base' && t.instrumentId === 'textDisplay' && t.name === 'Lyrics'
      })
      const targeted = targetId && s.tracks[targetId]?.instrumentId === 'textDisplay' ? targetId : undefined
      const existingId = targeted ?? named
      // Particle-words tracks get a "-" lead-in: a dash word with a note at the
      // very start, skipped when the song's first word already lands there.
      // The cloud then idles as a dash and streams into the first sung word,
      // instead of holding the idle sphere through the whole intro (extracted
      // from "wormhole template glow"). Plane-text tracks skip it - a dash
      // hanging on screen at t=0 is noise there. lyricTiming stays sung-words
      // only, so a BPM rescale rebuilds notes without the dash - the same fate
      // it would have when added by hand.
      const particleWords = existingId
        ? (s.tracks[existingId].params?.particleEnabled ?? 0) >= 0.5
        : false
      const placed = particleWords && words[0].startBeat > 0.5
        ? [{ word: '-', startBeat: 0, durationBeats: 0.25 }, ...words]
        : words
      const lastBeat = Math.max(...placed.map((w) => w.startBeat + w.durationBeats))
      const durationBars = Math.min(MAX_TOTAL_BARS, Math.max(1, Math.ceil(lastBeat / s.beatsPerBar)))
      // One clip per sung line (clipsFromPlacedWords cuts at punctuation, gaps
      // and a word cap) - the clip is the phrase, so stack-style cards and
      // scatter phrases both follow the singing with no extra bookkeeping.
      // The style's arrangement survives a refill: existing clips' layout is
      // carried onto the rebuilt ones.
      const existingTrack = existingId ? s.tracks[existingId] : undefined
      const carriedLayout = existingTrack?.lyricClips?.[0]?.layout ?? { kind: 'one' as const }
      const lyricClips = clipsFromPlacedWords(placed).map((c) => ({ ...c, layout: carriedLayout }))
      // Stack arrangements keep their 1-frame zoom flashes on the card
      // boundaries - which are now simply the clips' starts.
      const flashNotes: Note[] = carriedLayout.kind === 'stack'
        ? lyricClips.map((c) => ({
            id: crypto.randomUUID(),
            startBeat: c.startBeat,
            durationBeats: 0.1,
            pitch: TEXT_ZOOM_FLASH_PITCH,
            velocity: 100,
          }))
        : []
      const block: Block = {
        id: crypto.randomUUID(),
        startBar: 0,
        durationBars,
        loop: false,
        notes: [
          ...placed.map((w) => ({
            id: crypto.randomUUID(),
            startBeat: w.startBeat,
            durationBeats: w.durationBeats,
            pitch: TEXT_WORD_PITCH,
            velocity: 100,
          })),
          ...flashNotes,
        ],
      }
      // Grow (never shrink) the project if the lyrics overrun, like MIDI import.
      const totalBars = durationBars > s.totalBars ? durationBars : s.totalBars

      // The template's repeat-to-the-ceiling loop blocks trim to the song's end
      // - max(lyrics end, audio end) - so visuals stop when the music does
      // instead of looping forever into empty timeline. `durationBars` is the
      // block being written on this very call, so it is passed explicitly
      // rather than read back out of state.
      // ...but only on the template path. Transcribing into a hand-made track
      // (an explicit target that is not the template's 'Lyrics' track) must not
      // reach across the project and shorten loops the user chose themselves.
      const endBars = Math.max(durationBars, songEndBars(s))
      let trimmedTracks = !targeted || targeted === named
        ? trimLoopsToSongEnd(s.tracks, endBars)
        : s.tracks

      // Monochrome's polarity strobe follows the SINGING: rebuild the style's
      // 'Invert Strobe' track (a Color Filters sibling the template ships)
      // from the real word times, so the frame flips per phrase and never
      // strobes through an instrumental. No strobe track = nothing happens.
      const strobeId = s.rootTrackIds.find((tid) => {
        const t = s.tracks[tid]
        return t?.type === 'base' && t.instrumentId === 'colorFilters' && t.name === 'Invert Strobe'
      })
      if (strobeId) {
        const spans = invertStrobeSpans(placed)
        trimmedTracks = {
          ...trimmedTracks,
          [strobeId]: {
            ...trimmedTracks[strobeId],
            blocks: [{
              id: crypto.randomUUID(),
              startBar: 0,
              durationBars,
              loop: false,
              notes: spans.map((span) => ({
                id: crypto.randomUUID(),
                startBeat: span.startBeat,
                durationBeats: span.durationBeats,
                pitch: INVERT_FILTER_PITCH,
                velocity: span.velocity,
              })),
            }],
          },
        }
      }

      if (existingId) {
        const existing = s.tracks[existingId]
        resultId = existingId
        const updated: Track = {
          ...existing,
          lyricClips,
          lyricTiming: timing ?? existing.lyricTiming,
          // A refill arrives word-per-note, so the grouping resets with it -
          // a stale 'lines' flag would desync the next rebuild from the sheet.
          lyricGrouping: 'words',
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
        color: resolveNextTrackColor(s),
        muted: false,
        solo: false,
        lyricClips,
        lyricTiming: timing,
        lyricGrouping: 'words',
        blocks: [block],
        childIds: [],
      }
      return { tracks: { ...trimmedTracks, [id]: track }, rootTrackIds: [...s.rootTrackIds, id], totalBars }
    })
    return resultId
  },

  setLyricGrouping: (trackId, grouping) =>
    set((s) => {
      const t = s.tracks[trackId]
      if (!t) return s
      // Hand-typed tracks (no sung timing): clips are already the sheet, so
      // there is nothing to rebuild - just remember the preference.
      if (!t.lyricTiming?.length || t.blocks.length === 0) {
        if ((t.lyricGrouping ?? 'words') === grouping) return s
        return { tracks: { ...s.tracks, [trackId]: { ...t, lyricGrouping: grouping } } }
      }
      if ((t.lyricGrouping ?? 'words') === grouping) return s
      // Same audio anchor the BPM rescale uses: words place relative to the
      // song's start bar and trim.
      let audioBlock: { startBar: number; trimStart: number } | undefined
      for (const id of s.rootTrackIds) {
        const at = s.tracks[id]
        if (at?.type === 'audio' && at.audioBlocks?.length) { audioBlock = at.audioBlocks[0]; break }
      }
      const units = grouping === 'lines' ? groupTimingIntoLines(t.lyricTiming) : t.lyricTiming
      const placed = placeTranscription(units, audioBlock ?? { startBar: 0, trimStart: 0 }, s.bpm, s.beatsPerBar, true)
      if (placed.length === 0) return s
      const lastBeat = Math.max(...placed.map((w) => w.startBeat + w.durationBeats))
      const durationBars = Math.min(MAX_TOTAL_BARS, Math.max(1, Math.ceil(lastBeat / s.beatsPerBar)))
      // Lines grouping: each placed unit IS a line, shown whole on one note -
      // its clip carries the line as a single !...! grouped entry. Words
      // grouping re-cuts lines from the placed words. Layout carries over.
      const carriedLayout = t.lyricClips?.[0]?.layout ?? { kind: 'one' as const }
      const lyricClips = (grouping === 'lines'
        ? placed.map((w, i) => ({
            id: crypto.randomUUID(),
            startBeat: w.startBeat,
            durationBeats: Math.max(0.25, (i + 1 < placed.length ? placed[i + 1].startBeat : w.startBeat + w.durationBeats + 2) - w.startBeat),
            words: [`!${w.word}!`],
            layout: { kind: 'one' as const },
          }))
        : clipsFromPlacedWords(placed)
      ).map((c) => ({ ...c, layout: carriedLayout }))
      const flashNotes: Note[] = carriedLayout.kind === 'stack'
        ? lyricClips.map((c) => ({
            id: crypto.randomUUID(),
            startBeat: c.startBeat,
            durationBeats: 0.1,
            pitch: TEXT_ZOOM_FLASH_PITCH,
            velocity: 100,
          }))
        : []
      const block: Block = {
        ...t.blocks[0],
        startBar: 0,
        durationBars,
        notes: [
          ...placed.map((w) => ({
            id: crypto.randomUUID(),
            startBeat: w.startBeat,
            durationBeats: w.durationBeats,
            pitch: TEXT_WORD_PITCH,
            velocity: 100,
          })),
          ...flashNotes,
        ],
      }
      return {
        tracks: {
          ...s.tracks,
          [trackId]: {
            ...t,
            lyricGrouping: grouping,
            lyricClips,
            blocks: [block],
          },
        },
        totalBars: Math.max(s.totalBars, durationBars),
      }
    }),

  applyTemplate: (templateDoc) => {
    // Templates are authored documents like any save: walk them through the
    // upgrade chain first, so a template written against an older schema
    // (text params, formation lanes) arrives converted (clips + style lanes)
    // and this function only ever sees the current shape.
    templateDoc = upgradeDocument(templateDoc)
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

    // Template-shipped video sources (public-asset placeholder clips): merge
    // them into the catalog so the incoming tracks' videoPads resolve. A new
    // project created FROM a template gets these via hydrate(); this covers
    // switching templates inside the editor. Merge, don't replace - the
    // project's own uploaded clips must survive a template switch.
    if (templateDoc.videoClips && Object.keys(templateDoc.videoClips).length > 0) {
      useVideoStore.setState((v) => ({ videoClips: { ...templateDoc.videoClips, ...v.videoClips } }))
    }

    set((s) => {
      const audioIds = s.rootTrackIds.filter((id) => s.tracks[id]?.type === 'audio')
      const kept: Record<string, Track> = {}
      for (const id of audioIds) kept[id] = s.tracks[id]
      const hasAudio = audioIds.length > 0

      // Lyric carry-over: when BOTH the project and the template ship a root
      // 'Lyrics' Text Display track (the lyric-template contract), switching
      // templates keeps the project's words - the template's styling wins,
      // but the transcribed text, word notes, and timing survive the swap.
      const findLyrics = (tracks: Record<string, Track>, roots: string[]) =>
        roots.find((id) => {
          const t = tracks[id]
          return t?.type === 'base' && t.instrumentId === 'textDisplay' && t.name === 'Lyrics'
        })
      const existingLyricsId = findLyrics(s.tracks, s.rootTrackIds)
      const templateLyricsId = findLyrics(cloned, clonedRoots)
      if (existingLyricsId && templateLyricsId) {
        const existing = s.tracks[existingLyricsId]
        const tplLyrics = cloned[templateLyricsId]
        // The project's WORDS survive; the template's ARRANGEMENT wins - its
        // lead clip's layout restyles every carried clip, the same way its
        // style lanes restyle the notes.
        const carriedLayout = tplLyrics.lyricClips?.[0]?.layout ?? { kind: 'one' as const }
        let lyricClips = (existing.lyricClips?.length ? existing.lyricClips : tplLyrics.lyricClips ?? [])
          .map((c) => ({ ...c, id: crypto.randomUUID(), layout: carriedLayout }))
        let blocks = existing.blocks.length > 0 ? existing.blocks : tplLyrics.blocks
        // Particle-words styles (wormhole) open on a "-" lead-in: a dash word
        // noted at the very start, so the cloud idles as a dash and streams
        // into the first sung word instead of holding the sphere through the
        // intro. Added here as well as in addLyricTrack because the lyric-setup
        // flow transcribes BEFORE the style is picked - at refill time there is
        // no particle track yet, so the carry-across is where the two finally
        // meet. Skipped when a word note ALREADY sits at the very start
        // (which also makes it idempotent across re-applies).
        if ((tplLyrics.params?.particleEnabled ?? 0) >= 0.5
          && existing.blocks.length > 0 && blocks[0].startBar === 0) {
          const first = blocks[0]
          const firstWordBeat = first.notes.reduce(
            (m, n) => (laneIndexForPitch(n.pitch, MAX_STYLE_LANES) >= 0 ? Math.min(m, n.startBeat) : m),
            Infinity,
          )
          if (firstWordBeat > 0.5 && firstWordBeat !== Infinity) {
            // The dash gets its own little clip before the first sung one, so
            // the note at beat 0 has a word to take without shifting anything.
            lyricClips = [
              {
                id: crypto.randomUUID(),
                startBeat: 0,
                durationBeats: Math.max(0.25, (lyricClips[0]?.startBeat ?? firstWordBeat) - 0.01),
                words: ['-'],
                layout: carriedLayout,
              },
              ...lyricClips,
            ]
            blocks = [
              {
                ...first,
                notes: [
                  { id: crypto.randomUUID(), startBeat: 0, durationBeats: 0.25, pitch: TEXT_WORD_PITCH, velocity: 100 },
                  ...first.notes,
                ],
              },
              ...blocks.slice(1),
            ]
          }
        }
        // Stack styles keep their 1-frame zoom flashes ON the Lyrics block:
        // drop whatever flashes the previous style carried (they belonged to
        // ITS card grid) and re-derive them at the incoming style's card
        // boundaries from the carried words.
        if (blocks.length > 0 && blocks[0].startBar === 0) {
          const first = blocks[0]
          const stripped = first.notes.filter((note) => note.pitch !== TEXT_ZOOM_FLASH_PITCH)
          if (carriedLayout.kind === 'stack') {
            // Card boundaries are simply the carried clips' starts now.
            blocks = [{
              ...first,
              notes: [
                ...stripped,
                ...lyricClips.filter((c) => c.words.length > 0).map((c) => ({
                  id: crypto.randomUUID(),
                  startBeat: c.startBeat,
                  durationBeats: 0.1,
                  pitch: TEXT_ZOOM_FLASH_PITCH,
                  velocity: 100,
                })),
              ],
            }, ...blocks.slice(1)]
          } else if (stripped.length !== first.notes.length) {
            blocks = [{ ...first, notes: stripped }, ...blocks.slice(1)]
          }
        }

        cloned[templateLyricsId] = {
          ...tplLyrics,
          lyricClips,
          blocks,
          ...(existing.lyricTiming ? { lyricTiming: existing.lyricTiming } : {}),
        }

        // Monochrome's polarity strobe follows the words: when the incoming
        // template ships an 'Invert Strobe' track and real words are being
        // carried across, rebuild the strobe's notes from those words - the
        // frame then flips per sung phrase and never strobes through an
        // instrumental (the template's own pattern only fits its placeholder).
        const strobeCloneId = clonedRoots.find((id) => {
          const t = cloned[id]
          return t?.instrumentId === 'colorFilters' && t.name === 'Invert Strobe'
        })
        if (strobeCloneId && existing.blocks.length > 0 && blocks[0].startBar === 0) {
          const carriedWords = blocks[0].notes
            .filter((note) => laneIndexForPitch(note.pitch, MAX_STYLE_LANES) >= 0)
            .map((note) => ({ startBeat: note.startBeat, durationBeats: note.durationBeats }))
            .sort((a, b) => a.startBeat - b.startBeat)
          const spans = invertStrobeSpans(carriedWords)
          cloned[strobeCloneId] = {
            ...cloned[strobeCloneId],
            blocks: [{
              id: crypto.randomUUID(),
              startBar: 0,
              durationBars: blocks[0].durationBars,
              loop: false,
              notes: spans.map((span) => ({
                id: crypto.randomUUID(),
                startBeat: span.startBeat,
                durationBeats: span.durationBeats,
                pitch: INVERT_FILTER_PITCH,
                velocity: span.velocity,
              })),
            }],
          }
        }
      }

      // With a song present, the template's repeat-to-the-ceiling loop blocks
      // trim to the song's end - the same rule transcription applies - so a
      // post-transcription template switch doesn't reintroduce ambience that
      // runs forever past the music. Without audio the ceiling stays: a later
      // transcription does the trimming (blocks never re-grow).
      if (hasAudio) {
        // Song end is measured against the INCOMING document's Lyrics track (the
        // carried-over words, set just above), not the outgoing project's, so a
        // style switch trims to where the words actually land.
        let endBars = songEndBars({
          bpm: s.bpm,
          beatsPerBar: s.beatsPerBar,
          tracks: { ...kept, ...cloned },
          rootTrackIds: [...audioIds, ...clonedRoots],
        })
        if (templateLyricsId) {
          for (const b of cloned[templateLyricsId].blocks) {
            endBars = Math.max(endBars, b.startBar + b.durationBars)
          }
        }
        const trimmed = trimLoopsToSongEnd(cloned, endBars)
        for (const [id, t] of Object.entries(trimmed)) cloned[id] = t
      }

      return {
        tracks: { ...kept, ...cloned },
        rootTrackIds: [...audioIds, ...clonedRoots],
        bpm: hasAudio ? s.bpm : templateDoc.bpm,
        totalBars: Math.max(s.totalBars, templateDoc.totalBars),
        appliedTemplateId: templateDoc.appliedTemplateId ?? null,
      }
    })
    // Stamp the SCENE the template landed in too: multi-scene projects wear a
    // template per scene, and the Templates tab highlights the active scene's.
    // (A separate patch - the live-view write-through above rebuilds the
    // active scene record itself and would discard a scenes field.)
    set((s) => {
      const scene = s.scenes[s.activeSceneId]
      if (!scene || scene.isMain) return s
      return {
        scenes: {
          ...s.scenes,
          [scene.id]: { ...scene, appliedTemplateId: templateDoc.appliedTemplateId ?? null },
        },
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
      const tracks = {
        ...s.tracks,
        [trackId]: {
          ...track,
          audioBlocks: track.audioBlocks.map((b) => (b.id === blockId ? { ...b, ...updates } : b)),
        },
      }
      // Moving the audio's span moves the song's end, so ceiling-length loop
      // blocks follow it down. This is where a track added BY HAND after the
      // template was applied finally gets trimmed - the other two trim sites
      // only fire on transcribe and on template apply, so anything created
      // between them used to keep the full 512 bars.
      //
      // One-way, matching the existing rule: dragging the audio shorter cuts the
      // visuals, dragging it back out does not regrow them.
      const spanChanged = updates.trimEnd !== undefined || updates.trimStart !== undefined
        || updates.startBar !== undefined
      if (!spanChanged) return { tracks }
      return { tracks: trimLoopsToSongEnd(tracks, songEndBars({ ...s, tracks })) }
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
      // Two decimals, not integers: real songs sit off the grid ("My My Time
      // Flies" is 106.4), and rounding here silently defeated both a typed
      // fractional tempo and the detector's fractional estimate.
      const next = Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(bpm * 100) / 100))
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
        // Rebuild at the track's grouping: a lines-mode track must come back
        // with one note per LINE, or the notes outrun the display entries.
        const units = t.lyricGrouping === 'lines' ? groupTimingIntoLines(t.lyricTiming) : t.lyricTiming
        const words = placeTranscription(units, audioBlock ?? { startBar: 0, trimStart: 0 }, next, s.beatsPerBar, true)
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
            pitch: TEXT_WORD_PITCH,
            velocity: 100,
          })),
        }
        // Clip beats derive from the sung seconds too, so they rescale with
        // the notes (layout carried, like the transcription refill).
        const carriedLayout = t.lyricClips?.[0]?.layout ?? { kind: 'one' as const }
        const lyricClips = (t.lyricGrouping === 'lines'
          ? words.map((w, i) => ({
              id: crypto.randomUUID(),
              startBeat: w.startBeat,
              durationBeats: Math.max(0.25, (i + 1 < words.length ? words[i + 1].startBeat : w.startBeat + w.durationBeats + 2) - w.startBeat),
              words: [`!${w.word}!`],
              layout: { kind: 'one' as const },
            }))
          : clipsFromPlacedWords(words)
        ).map((c) => ({ ...c, layout: carriedLayout }))
        if (tracks === s.tracks) tracks = { ...s.tracks }
        tracks[id] = { ...t, blocks: [block], lyricClips }
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
