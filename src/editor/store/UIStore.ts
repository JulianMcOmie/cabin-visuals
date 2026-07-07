import { create } from 'zustand'
import { TRACK_LABEL_WIDTH } from '../constants'

interface EditingBlockRef {
  trackId: string
  blockId: string
}

interface UIState {
  selectedTrackId: string | null;
  setSelectedTrackId: (id: string | null) => void;

  // Parent tracks collapsed in the timeline (their descendant rows are hidden). Pure
  // view state — collapsed tracks still resolve and render in the 3D scene.
  collapsedTrackIds: Set<string>
  setTrackCollapsed: (id: string, collapsed: boolean) => void

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

  // Width of the frozen track-label column (drag its right edge to resize).
  tracksLabelWidth: number
  setTracksLabelWidth: (px: number) => void

  // Fraction (0–1) of the right section's height given to the upper (editor + canvas)
  // region; the rest goes to the tracks/piano-roll below. Drag the divider to set it.
  topPanelFraction: number
  setTopPanelFraction: (fraction: number) => void

  // Saved tracks-timeline scroll, so returning from the MIDI editor restores the view.
  tracksScrollLeft: number
  tracksScrollTop: number
  setTracksScroll: (left: number, top: number) => void

  // Live drop indicator for a track drag — shared by the in-timeline nest-drag and a
  // library instrument being dragged in (which is owned by a sibling component, so the
  // indicator is bridged here for the timeline to render). null = no drag in progress.
  // `activeId` is the row being moved (dimmed); only set for an existing-track drag.
  trackDrop: { activeId?: string; line: { top: number; left: number } | null; intoId: string | null } | null
  setTrackDrop: (v: { activeId?: string; line: { top: number; left: number } | null; intoId: string | null } | null) => void

  // True while an effect is being dragged from the library — the Track Editor uses it
  // to switch to its Effects tab and highlight the drop zone.
  effectDragging: boolean
  setEffectDragging: (v: boolean) => void

  // The open project's row name (set at load) — display-only editor chrome, e.g.
  // the export dialog's default filename. NOT the document (never serialized).
  projectName: string | null
  setProjectName: (name: string | null) => void
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

  midiRowScale: 1.0,
  setMidiRowScale: (scale) =>
    set({ midiRowScale: Math.max(0.5, Math.min(2.0, scale)) }),

  tracksPixelsPerBeat: 16,
  setTracksPixelsPerBeat: (pixels) =>
    set({ tracksPixelsPerBeat: Math.max(2, Math.min(100, pixels)) }),

  tracksRowHeight: 44,
  setTracksRowHeight: (px) =>
    set({ tracksRowHeight: Math.max(28, Math.min(200, px)) }),

  tracksLabelWidth: TRACK_LABEL_WIDTH,
  setTracksLabelWidth: (px) =>
    set({ tracksLabelWidth: Math.max(96, Math.min(480, px)) }),

  topPanelFraction: 0.66,
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

  projectName: null,
  setProjectName: (name) => set({ projectName: name }),
}));
