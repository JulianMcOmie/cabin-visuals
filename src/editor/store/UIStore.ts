import { create } from 'zustand'

interface EditingBlockRef {
  trackId: string
  blockId: string
}

interface UIState {
  selectedTrackId: string | null;
  setSelectedTrackId: (id: string | null) => void;

  // Block selection in the tracks timeline (by block id; ids are globally unique)
  selectedBlockIds: Set<string>
  setSelectedBlockIds: (ids: Set<string>) => void

  editingBlock: EditingBlockRef | null
  setEditingBlock: (ref: EditingBlockRef | null) => void

  midiPixelsPerBeat: number
  setMidiPixelsPerBeat: (pixels: number) => void
  midiRowScale: number
  setMidiRowScale: (scale: number) => void
}

export const useUIStore = create<UIState>((set) => ({
  selectedTrackId: null,

  setSelectedTrackId: (id) => set({ selectedTrackId: id }),

  selectedBlockIds: new Set(),
  setSelectedBlockIds: (ids) => set({ selectedBlockIds: ids }),

  editingBlock: null,
  setEditingBlock: (ref) => set({ editingBlock: ref }),

  midiPixelsPerBeat: 40,
  setMidiPixelsPerBeat: (pixels) =>
    set({ midiPixelsPerBeat: Math.max(5, Math.min(200, pixels)) }),

  midiRowScale: 1.0,
  setMidiRowScale: (scale) =>
    set({ midiRowScale: Math.max(0.5, Math.min(2.0, scale)) }),
}));
