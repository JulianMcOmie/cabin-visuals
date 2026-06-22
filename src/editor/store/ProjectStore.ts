import { create } from 'zustand'
import type { Track, Block, Note } from '../types'

interface ProjectState {
  tracks: Record<string, Track>
  rootTrackIds: string[]
  addTrack: (track: Track) => void
  addBlock: (trackId: string, block: Block) => void
  addNote: (trackId: string, blockId: string, note: Note) => void
  updateBlockNotes: (trackId: string, blockId: string, notes: Note[]) => void
  updateBlock: (trackId: string, blockId: string, updates: Partial<Block>) => void
  moveBlock: (fromTrackId: string, blockId: string, toTrackId: string) => void
  deleteBlock: (trackId: string, blockId: string) => void
  reorderRootTracks: (orderedIds: string[]) => void
  toggleMute: (trackId: string) => void
  toggleSolo: (trackId: string) => void
  setTrackParam: (trackId: string, key: string, value: number) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  tracks: {},
  rootTrackIds: [],

  addTrack: (track) =>
    set((s) => ({
      tracks: { ...s.tracks, [track.id]: track },
      rootTrackIds: track.parentId ? s.rootTrackIds : [...s.rootTrackIds, track.id],
    })),

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
