import { create } from 'zustand'
import { TRACK_LABEL_WIDTH } from '../constants'

interface EditingBlockRef {
  trackId: string
  blockId: string
}

// The MIDI editor's vertical zoom is a step function (like Logic), not a
// continuous scale: row heights come from this ladder only. ~15% per rung,
// same 14-56px span the old continuous scale covered, 28 as the default.
export const MIDI_ROW_HEIGHTS = [14, 16, 18, 21, 24, 28, 32, 37, 42, 49, 56]

const snapMidiRowHeight = (px: number) =>
  MIDI_ROW_HEIGHTS.reduce((best, h) => (Math.abs(h - px) < Math.abs(best - px) ? h : best))

interface UIState {
  selectedTrackId: string | null;
  setSelectedTrackId: (id: string | null) => void;

  // Parent tracks collapsed in the timeline (their descendant rows are hidden). Pure
  // view state - collapsed tracks still resolve and render in the 3D scene.
  collapsedTrackIds: Set<string>
  setTrackCollapsed: (id: string, collapsed: boolean) => void

  // Block selection in the tracks timeline (by block id; ids are globally unique)
  selectedBlockIds: Set<string>
  setSelectedBlockIds: (ids: Set<string>) => void

  editingBlock: EditingBlockRef | null
  setEditingBlock: (ref: EditingBlockRef | null) => void

  midiPixelsPerBeat: number
  setMidiPixelsPerBeat: (pixels: number) => void
  // Always one of MIDI_ROW_HEIGHTS - set() snaps, step() moves one rung.
  midiRowHeight: number
  setMidiRowHeight: (px: number) => void
  stepMidiRowHeight: (direction: 1 | -1) => void

  // Horizontal zoom for the tracks timeline (pixels per beat).
  tracksPixelsPerBeat: number
  setTracksPixelsPerBeat: (pixels: number) => void

  // Vertical zoom for the tracks timeline (track row height in px).
  tracksRowHeight: number
  setTracksRowHeight: (px: number) => void

  // Width of the frozen track-label column (drag its right edge to resize).
  tracksLabelWidth: number
  setTracksLabelWidth: (px: number) => void

  // Width of the MIDI editor's label gutter (same gesture as the track labels).
  midiLabelWidth: number
  setMidiLabelWidth: (px: number) => void

  // Fraction (0–1) of the right section's height given to the upper (editor + canvas)
  // region; the rest goes to the tracks/piano-roll below. Drag the divider to set it.
  topPanelFraction: number
  setTopPanelFraction: (fraction: number) => void

  // Saved tracks-timeline scroll, so returning from the MIDI editor restores the view.
  tracksScrollLeft: number
  tracksScrollTop: number
  setTracksScroll: (left: number, top: number) => void

  // Live drop indicator for a track drag - shared by the in-timeline nest-drag and a
  // library instrument being dragged in (which is owned by a sibling component, so the
  // indicator is bridged here for the timeline to render). null = no drag in progress.
  // `activeId` is the row being moved (dimmed); only set for an existing-track drag.
  trackDrop: { activeId?: string; line: { top: number; left: number } | null; intoId: string | null } | null
  setTrackDrop: (v: { activeId?: string; line: { top: number; left: number } | null; intoId: string | null } | null) => void

  // True while an effect is being dragged from the library - the Track Editor uses it
  // to switch to its Effects tab and highlight the drop zone.
  effectDragging: boolean
  setEffectDragging: (v: boolean) => void

  // True while an instrument is being dragged from the library - the timeline uses it
  // to light up the track-label column as the drop zone.
  libraryDragging: boolean
  setLibraryDragging: (v: boolean) => void

  // The open project's row name (set at load) - display-only editor chrome, e.g.
  // the export dialog's default filename. NOT the document (never serialized).
  projectName: string | null
  setProjectName: (name: string | null) => void

  // True while a modal dialog (export, clip picker) is up. Editor surfaces with
  // document/window-level pointer handling that an overlay div can't block -
  // e.g. react-resizable-panels' hit-testing - must check this and stand down.
  modalOpen: boolean
  setModalOpen: (v: boolean) => void
}

export const useUIStore = create<UIState>((set) => ({
  selectedTrackId: null,

  setSelectedTrackId: (id) => set({ selectedTrackId: id }),

  collapsedTrackIds: new Set(),
  setTrackCollapsed: (id, collapsed) =>
    set((s) => {
      const next = new Set(s.collapsedTrackIds)
      if (collapsed) next.add(id)
      else next.delete(id)
      return { collapsedTrackIds: next }
    }),

  selectedBlockIds: new Set(),
  setSelectedBlockIds: (ids) => set({ selectedBlockIds: ids }),

  editingBlock: null,
  setEditingBlock: (ref) => set({ editingBlock: ref }),

  midiPixelsPerBeat: 40,
  setMidiPixelsPerBeat: (pixels) =>
    set({ midiPixelsPerBeat: Math.max(5, Math.min(200, pixels)) }),

  midiRowHeight: 28,
  setMidiRowHeight: (px) => set({ midiRowHeight: snapMidiRowHeight(px) }),
  stepMidiRowHeight: (direction) =>
    set((s) => {
      const idx = MIDI_ROW_HEIGHTS.indexOf(snapMidiRowHeight(s.midiRowHeight))
      const next = Math.max(0, Math.min(MIDI_ROW_HEIGHTS.length - 1, idx + direction))
      return { midiRowHeight: MIDI_ROW_HEIGHTS[next] }
    }),

  tracksPixelsPerBeat: 16,
  setTracksPixelsPerBeat: (pixels) =>
    set({ tracksPixelsPerBeat: Math.max(2, Math.min(100, pixels)) }),

  tracksRowHeight: 44,
  setTracksRowHeight: (px) =>
    set({ tracksRowHeight: Math.max(28, Math.min(200, px)) }),

  tracksLabelWidth: TRACK_LABEL_WIDTH,
  setTracksLabelWidth: (px) =>
    set({ tracksLabelWidth: Math.max(96, Math.min(480, px)) }),

  midiLabelWidth: 88,
  setMidiLabelWidth: (px) =>
    set({ midiLabelWidth: Math.max(56, Math.min(360, px)) }),

  topPanelFraction: 0.45,
  // Clamp ≈ the panels' old min sizes (top ≥ 30%, bottom ≥ 15%).
  setTopPanelFraction: (f) =>
    set({ topPanelFraction: Math.max(0.3, Math.min(0.85, f)) }),

  tracksScrollLeft: 0,
  tracksScrollTop: 0,
  setTracksScroll: (left, top) => set({ tracksScrollLeft: left, tracksScrollTop: top }),

  trackDrop: null,
  setTrackDrop: (v) => set({ trackDrop: v }),

  effectDragging: false,
  setEffectDragging: (v) => set({ effectDragging: v }),

  libraryDragging: false,
  setLibraryDragging: (v) => set({ libraryDragging: v }),

  projectName: null,
  setProjectName: (name) => set({ projectName: name }),

  modalOpen: false,
  setModalOpen: (v) => set({ modalOpen: v }),
}));
