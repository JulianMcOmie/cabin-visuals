import { create } from 'zustand'
import type { Note, Block } from '../types'
import type { TrackTreeSnapshot } from './ProjectStore'

/**
 * In-app clipboard shared across both editors. Snapshots are normalized at copy
 * time (earliest element shifted to 0) so paste is just "add the playhead
 * offset". Paste is responsible for cloning with fresh IDs.
 */
export type Clip =
  | { kind: 'notes'; notes: Note[] }
  // Each copied block carries the track it came from (startBar normalized so the
  // earliest across ALL copied blocks is 0). Paste dispatches on how many
  // distinct source tracks there are: one -> the selected track; several ->
  // each block back into its own source track (preserving the arrangement).
  | { kind: 'blocks'; blocks: { sourceTrackId: string; block: Block }[] }
  | { kind: 'track'; tree: TrackTreeSnapshot }

interface ClipboardState {
  clip: Clip | null
  setClip: (clip: Clip | null) => void
}

export const useClipboardStore = create<ClipboardState>((set) => ({
  clip: null,
  setClip: (clip) => set({ clip }),
}))
