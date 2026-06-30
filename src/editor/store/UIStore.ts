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

  // Horizontal zoom for the tracks timeline (pixels per beat).
  tracksPixelsPerBeat: number
  setTracksPixelsPerBeat: (pixels: number) => void

  // Vertical zoom for the tracks timeline (track row height in px).
  tracksRowHeight: number
  setTracksRowHeight: (px: number) => void

  // Saved tracks-timeline scroll, so returning from the MIDI editor restores the view.
  tracksScrollLeft: number
  tracksScrollTop: number
  setTracksScroll: (left: number, top: number) => void

  // Dragging a library instrument into the track list: the live insertion gap,
  // bridged from the library (which owns the drag) to the timeline (which reflows
  // its rows). null = not dragging; insertIndex null = not over a valid drop slot.
  libraryDrag: { insertIndex: number | null; rowHeight: number } | null
  setLibraryDrag: (v: { insertIndex: number | null; rowHeight: number } | null) => void
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

  tracksPixelsPerBeat: 16,
  setTracksPixelsPerBeat: (pixels) =>
    set({ tracksPixelsPerBeat: Math.max(2, Math.min(100, pixels)) }),

  tracksRowHeight: 48,
  setTracksRowHeight: (px) =>
    set({ tracksRowHeight: Math.max(28, Math.min(200, px)) }),

  tracksScrollLeft: 0,
  tracksScrollTop: 0,
  setTracksScroll: (left, top) => set({ tracksScrollLeft: left, tracksScrollTop: top }),

  libraryDrag: null,
  setLibraryDrag: (v) => set({ libraryDrag: v }),
}));
