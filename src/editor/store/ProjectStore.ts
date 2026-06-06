import { create } from 'zustand'
import type { Track, Block, Note } from '../types'

interface ProjectState {
  tracks: Track[]
  addTrack: (track: Track) => void
  addBlock: (trackId: string, block: Block) => void
  addNote: (trackId: string, blockId: string, note: Note) => void
  toggleMute: (trackId: string) => void
  toggleSolo: (trackId: string) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  tracks: [],

  addTrack: (track) =>
    set((s) => ({ tracks: [...s.tracks, track] })),

  addBlock: (trackId, block) =>
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === trackId ? { ...t, blocks: [...t.blocks, block] } : t
      ),
    })),

  addNote: (trackId, blockId, note) =>
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id !== trackId ? t : {
          ...t,
          blocks: t.blocks.map((b) =>
            b.id === blockId ? { ...b, notes: [...b.notes, note] } : b
          ),
        }
      ),
    })),

  toggleMute: (trackId) =>
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === trackId ? { ...t, muted: !t.muted } : t
      ),
    })),

  toggleSolo: (trackId) =>
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === trackId ? { ...t, solo: !t.solo } : t
      ),
    })),
}))
