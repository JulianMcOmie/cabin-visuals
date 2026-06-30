import { create } from 'zustand'
import type { Track, Block, Note } from '../types'

export const MIN_BPM = 20
export const MAX_BPM = 300

// Deep-clone with fresh IDs at every level (used by paste + alt-drag duplicate).
const cloneNote = (n: Note): Note => ({ ...n, id: crypto.randomUUID() })
export const cloneBlock = (b: Block): Block => ({
  ...b,
  id: crypto.randomUUID(),
  notes: b.notes.map(cloneNote),
})
export const cloneTrack = (t: Track): Track => ({
  ...t,
  id: crypto.randomUUID(),
  blocks: t.blocks.map(cloneBlock),
  childIds: [],
})

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
  deleteTrack: (trackId: string) => void
  insertTrackCopy: (srcId: string, index: number) => void
  reorderRootTracks: (orderedIds: string[]) => void
  toggleMute: (trackId: string) => void
  toggleSolo: (trackId: string) => void
  setTrackParam: (trackId: string, key: string, value: number) => void
  setTrackInstrument: (trackId: string, instrumentId: string, name?: string) => void
  setTrackTargets: (trackId: string, targets: Track['targets']) => void
  setBpm: (bpm: number) => void
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
      if (track.parentId) return { tracks }
      const rootTrackIds = [...s.rootTrackIds]
      if (atIndex == null || atIndex < 0 || atIndex > rootTrackIds.length) rootTrackIds.push(track.id)
      else rootTrackIds.splice(atIndex, 0, track.id)
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
          [trackId]: {
            ...track,
            blocks: track.blocks.map((b) =>
              b.id === blockId ? { ...b, notes: [...b.notes, note] } : b
            ),
          },
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
          [trackId]: {
            ...track,
            blocks: track.blocks.map((b) =>
              b.id === blockId ? { ...b, notes } : b
            ),
          },
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
          [trackId]: {
            ...track,
            blocks: track.blocks.map((b) =>
              b.id === blockId ? { ...b, ...updates } : b
            ),
          },
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
          [trackId]: {
            ...track,
            blocks: track.blocks.filter((b) => b.id !== blockId),
          },
        },
      }
    }),

  deleteBlocks: (blockIds) =>
    set((s) => {
      const tracks: Record<string, Track> = {}
      for (const [id, t] of Object.entries(s.tracks)) {
        const blocks = t.blocks.filter((b) => !blockIds.has(b.id))
        tracks[id] = blocks.length === t.blocks.length ? t : { ...t, blocks }
      }
      return { tracks }
    }),

  deleteTrack: (trackId) =>
    set((s) => {
      if (!s.tracks[trackId]) return s
      const tracks: Record<string, Track> = {}
      for (const [id, t] of Object.entries(s.tracks)) {
        if (id === trackId) continue
        // Drop any track-scoped routings that pointed at the deleted track.
        tracks[id] = t.targets?.some((r) => r.scope.kind === 'track' && r.scope.id === trackId)
          ? { ...t, targets: t.targets.filter((r) => !(r.scope.kind === 'track' && r.scope.id === trackId)) }
          : t
      }
      return {
        tracks,
        rootTrackIds: s.rootTrackIds.filter((id) => id !== trackId),
      }
    }),

  // Insert an identical copy of a track at a given root index (Alt-drag commit).
  // The original is left untouched.
  insertTrackCopy: (srcId, index) =>
    set((s) => {
      const src = s.tracks[srcId]
      if (!src) return s
      const copy = cloneTrack(src)
      const rootTrackIds = [...s.rootTrackIds]
      const i = Math.max(0, Math.min(rootTrackIds.length, index))
      rootTrackIds.splice(i, 0, copy.id)
      return { tracks: { ...s.tracks, [copy.id]: copy }, rootTrackIds }
    }),

  reorderRootTracks: (orderedIds) =>
    set({ rootTrackIds: orderedIds }),

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
          [trackId]: { ...track, instrumentId, params: {}, name: name ?? track.name },
        },
      }
    }),

  setTrackTargets: (trackId, targets) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, targets } } }
    }),

  setBpm: (bpm) => set({ bpm: Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(bpm))) }),
}))
