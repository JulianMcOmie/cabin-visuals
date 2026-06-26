import { create } from 'zustand'
import type { Note, Block, Track } from '../types'

/**
 * In-app clipboard shared across both editors. Snapshots are normalized at copy
 * time (earliest element shifted to 0) so paste is just "add the playhead
 * offset". Paste is responsible for cloning with fresh IDs.
 */
export type Clip =
  | { kind: 'notes'; notes: Note[] }
  | { kind: 'blocks'; blocks: Block[]; sourceTrackId: string }
  | { kind: 'track'; track: Track }

interface ClipboardState {
  clip: Clip | null
  setClip: (clip: Clip | null) => void
}

export const useClipboardStore = create<ClipboardState>((set) => ({
  clip: null,
  setClip: (clip) => set({ clip }),
}))
