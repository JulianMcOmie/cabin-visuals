import { create } from 'zustand'
import { getEffect } from '../effects'
import { MOVER_TRACK_COLOR, AUDIO_TRACK_COLOR, OBJECT_TRACK_COLOR } from '../utils/modifierColors'
import { firstMoverMidiInput, getMover, isMoverMidiInput } from '../core/visual/movers/registry'
import { loopLengthBeats, tileLoopNotes } from '../core/visual/noteFlatten'
import type { ImportedMidiTrack } from '../core/midiImport'
import type { Track, TrackType, Block, Note, AudioBlock, EffectInstance, InterpolationMode, MidiMode, SubsetWeightSpec, VideoPad } from '../types'

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
    envelope: t.envelope ? { ...t.envelope } : undefined,
    weight: t.weight ? { ...t.weight } : undefined,
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

interface ProjectState {
  tracks: Record<string, Track>
  rootTrackIds: string[]
  // Project-level musical settings. Here (not TimeStore) so they're part of the
  // undoable document; currentBeat/isPlaying stay in TimeStore (ephemeral transport).
  bpm: number
  beatsPerBar: number
  totalBars: number
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
  /** Convert a track into an event modifier of the given type (no instrument). */
  setTrackModifier: (trackId: string, type: TrackType, name: string) => void
  /** Convert a track into a mover row (no instrument). */
  setTrackMover: (trackId: string, moverId: string, name: string) => void
  addMoverTrack: (parentId: string, moverId: string, moverLabel: string) => void
  setMoverInput: (trackId: string, key: string, value: number) => void
  setMoverDepth: (trackId: string, value: number) => void
  setMoverMidiMode: (trackId: string, mode: MidiMode) => void
  setMoverMidiTarget: (trackId: string, input: string | undefined) => void
  setMoverEnvelope: (trackId: string, envelope: { attack: number; decay: number }) => void
  setMoverWeight: (trackId: string, weight: SubsetWeightSpec) => void
  setMoverOpMode: (trackId: string, mode: 'transform' | 'add') => void
  /** Add an `automation` child track under `parentId`, driving the given param over
   *  time. No-op if one already automates that param. */
  addAutomationTrack: (parentId: string, paramKey: string, paramLabel: string) => void
  /** Add an `ability` child track under `parentId` for one of the parent instrument's
   *  abilities (opt-in). No-op if that ability already has a track. */
  addAbilityTrack: (parentId: string, abilityKey: string, abilityLabel: string) => void
  /** Set an automation track's interpolation mode between keyframes. */
  setTrackInterpolation: (trackId: string, mode: InterpolationMode) => void
  setTrackTargets: (trackId: string, targets: Track['targets']) => void
  setTrackTags: (trackId: string, tags: string[]) => void
  /** Draw this object on top of everything (depth-ignored overlay). */
  setTrackOnTop: (trackId: string, onTop: boolean) => void
  /** Replace a Video track's ordered pads (its bank of source moments). */
  setTrackVideoPads: (trackId: string, videoPads: VideoPad[]) => void
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
  addAudioBlock: (trackId: string, block: AudioBlock) => void
  updateAudioBlock: (trackId: string, blockId: string, updates: Partial<AudioBlock>) => void
  deleteAudioBlock: (trackId: string, blockId: string) => void
  // Visual effects (plugins) on a track.
  addEffect: (trackId: string, pluginId: string) => void
  removeEffect: (trackId: string, instanceId: string) => void
  setEffectSetting: (trackId: string, instanceId: string, key: string, value: number) => void
  toggleEffect: (trackId: string, instanceId: string) => void
  setBpm: (bpm: number) => void
  setTotalBars: (bars: number) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  tracks: {},
  rootTrackIds: [],
  bpm: 120,
  beatsPerBar: 4,
  totalBars: 32,

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
            depth: undefined,
            inputValues: undefined,
            envelope: undefined,
            midiMode: undefined,
            midiTargetInput: undefined,
            weight: undefined,
            name: name ?? track.name,
          },
        },
      }
    }),

  // Convert to an event modifier: set the type, drop the instrument + params.
  setTrackModifier: (trackId, type, name) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: {
            ...track,
            type,
            instrumentId: '',
            params: {},
            stringParams: {},
            moverId: undefined,
            depth: undefined,
            inputValues: undefined,
            envelope: undefined,
            midiMode: undefined,
            midiTargetInput: undefined,
            weight: undefined,
            name,
          },
        },
      }
    }),

  setTrackMover: (trackId, moverId, name) =>
    set((s) => {
      const track = s.tracks[trackId]
      const def = getMover(moverId)
      if (!track || !def) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: {
            ...track,
            type: 'mover',
            instrumentId: '',
            moverId,
            depth: track.depth ?? 1,
            inputValues: {},
            envelope: track.envelope ?? { attack: 0.05, decay: 0.4 },
            midiMode: track.midiMode ?? 'none',
            midiTargetInput: isMoverMidiInput(def, track.midiTargetInput)
              ? track.midiTargetInput
              : firstMoverMidiInput(def),
            weight: track.weight ?? { mode: 'all' },
            opMode: track.opMode ?? 'transform',
            params: {},
            stringParams: {},
            color: MOVER_TRACK_COLOR,
            name,
          },
        },
      }
    }),

  addMoverTrack: (parentId, moverId, moverLabel) =>
    set((s) => {
      const parent = s.tracks[parentId]
      const def = getMover(moverId)
      if (!parent || !def) return s
      const id = crypto.randomUUID()
      const track: Track = {
        id,
        name: moverLabel,
        type: 'mover',
        instrumentId: '',
        moverId,
        depth: 1,
        inputValues: {},
        envelope: { attack: 0.05, decay: 0.4 },
        midiMode: 'none',
        midiTargetInput: firstMoverMidiInput(def),
        weight: { mode: 'all' },
        opMode: 'transform',
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
      if (!track || track.type !== 'mover') return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, inputValues: { ...track.inputValues, [key]: value } } } }
    }),

  setMoverDepth: (trackId, value) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track || track.type !== 'mover') return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, depth: value } } }
    }),

  setMoverMidiMode: (trackId, mode) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track || track.type !== 'mover') return s
      const def = getMover(track.moverId)
      const midiTargetInput = mode === 'continuous' && def && !isMoverMidiInput(def, track.midiTargetInput)
        ? firstMoverMidiInput(def)
        : track.midiTargetInput
      return { tracks: { ...s.tracks, [trackId]: { ...track, midiMode: mode, midiTargetInput } } }
    }),

  setMoverMidiTarget: (trackId, input) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track || track.type !== 'mover') return s
      const def = getMover(track.moverId)
      if (!def || !isMoverMidiInput(def, input)) return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, midiTargetInput: input } } }
    }),

  setMoverEnvelope: (trackId, envelope) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track || track.type !== 'mover') return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, envelope } } }
    }),

  setMoverWeight: (trackId, weight) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track || track.type !== 'mover') return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, weight } } }
    }),

  setMoverOpMode: (trackId, opMode) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track || track.type !== 'mover') return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, opMode } } }
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

  setBpm: (bpm) => set({ bpm: Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(bpm))) }),

  // Blocks past the new end are left alone (the timeline just ends sooner);
  // the transport clamps the playhead to the project length on its own.
  setTotalBars: (bars) => set({ totalBars: Math.max(MIN_TOTAL_BARS, Math.min(MAX_TOTAL_BARS, Math.round(bars))) }),
}))
