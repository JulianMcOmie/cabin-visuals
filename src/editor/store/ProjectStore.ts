import { create } from 'zustand'
import type { Track, Block, Note } from '../types'

interface ProjectState {
  tracks: Record<string, Track>
  rootTrackIds: string[]
  addTrack: (track: Track) => void
  addBlock: (trackId: string, block: Block) => void
  addNote: (trackId: string, blockId: string, note: Note) => void
  updateBlockNotes: (trackId: string, blockId: string, notes: Note[]) => void
  toggleMute: (trackId: string) => void
  toggleSolo: (trackId: string) => void
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
}))
