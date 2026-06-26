import { create } from 'zustand'
import type { Track, Block, Note } from '../types'

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
  name: `${t.name} copy`,
  blocks: t.blocks.map(cloneBlock),
  childIds: [],
})

interface ProjectState {
  tracks: Record<string, Track>
  rootTrackIds: string[]
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
  altDuplicateTrack: (srcId: string) => void
  reorderRootTracks: (orderedIds: string[]) => void
  toggleMute: (trackId: string) => void
  toggleSolo: (trackId: string) => void
  setTrackParam: (trackId: string, key: string, value: number) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  tracks: {},
  rootTrackIds: [],

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
        // Drop any routing/automation targets that pointed at the deleted track.
        tracks[id] = t.targets?.some((tg) => tg.targetTrackId === trackId)
          ? { ...t, targets: t.targets.filter((tg) => tg.targetTrackId !== trackId) }
          : t
      }
      return {
        tracks,
        rootTrackIds: s.rootTrackIds.filter((id) => id !== trackId),
      }
    }),

  // Alt-drag duplicate. To make dnd-kit drag the *copy* (so it lands at the drop)
  // while the original stays put, we keep the dragged id (srcId) as the moving
  // copy — fresh block/note ids, "copy" name — and re-key the original under a new
  // id parked right after it. The end-of-drag reorder then settles the original
  // back into srcId's original slot.
  altDuplicateTrack: (srcId) =>
    set((s) => {
      const src = s.tracks[srcId]
      if (!src) return s
      const stayId = crypto.randomUUID()
      const staying: Track = { ...src, id: stayId }
      const moving: Track = { ...src, name: `${src.name} copy`, blocks: src.blocks.map(cloneBlock) }
      const idx = s.rootTrackIds.indexOf(srcId)
      const rootTrackIds = [...s.rootTrackIds]
      if (idx >= 0) rootTrackIds.splice(idx + 1, 0, stayId)
      else rootTrackIds.push(stayId)
      return { tracks: { ...s.tracks, [srcId]: moving, [stayId]: staying }, rootTrackIds }
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
}))
