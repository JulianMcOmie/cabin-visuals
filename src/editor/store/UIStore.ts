import { create } from 'zustand'
import { TRACK_LABEL_WIDTH } from '../constants'
import type { LoopRegion } from '../core/loopRegion'

export interface EditingBlockRef {
  trackId: string
  blockId: string
}

/** The library sidebar's tabs. Declared here rather than in LeftSidebar so the
 *  store can type a request to open one without importing the component. */
export type LibraryTabId = 'instruments' | 'loops' | 'templates'

// The MIDI editor's vertical zoom range (row height in px), 28 as the default.
export const MIDI_ROW_HEIGHT_MIN = 14
export const MIDI_ROW_HEIGHT_MAX = 56

/**
 * Fast Preview levels, slowest-and-truest first. 'final' is the picture the
 * export renders; the others buy playback smoothness by rendering fewer pixels.
 * The ORDER of this array is the cycle order of the toolbar control.
 */
export const PREVIEW_QUALITIES = ['final', 'fast', 'fastest'] as const
export type PreviewQuality = (typeof PREVIEW_QUALITIES)[number]

/** Linear resolution factor each level renders the canvas pipeline at. Fragment
 *  cost is the SQUARE of this, so 'fastest' is ~16× less pixel work. */
export const PREVIEW_QUALITY_SCALE: Record<PreviewQuality, number> = {
  final: 1,
  fast: 0.5,
  fastest: 0.25,
}

interface UIState {
  selectedTrackId: string | null;
  setSelectedTrackId: (id: string | null) => void;

  // Multi-selection of tracks (ctrl/cmd-click), primarily for bulk delete.
  // setSelectedTrackId collapses it - any single-select resets the group.
  selectedTrackIds: Set<string>
  setSelectedTrackIds: (ids: Set<string>) => void

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
  midiRowHeight: number
  setMidiRowHeight: (px: number) => void

  // Horizontal zoom for the tracks timeline (pixels per beat).
  tracksPixelsPerBeat: number
  setTracksPixelsPerBeat: (pixels: number) => void

  // Vertical zoom for the tracks timeline (track row height in px).
  tracksRowHeight: number
  setTracksRowHeight: (px: number) => void

  // Fast Preview: how much fidelity the 3D canvas trades for playback speed.
  // 'final' is what exports; the faster levels shrink every offscreen render
  // target by PREVIEW_QUALITY_SCALE, so a frame costs scale² of the full
  // fragment work and the final pass upscales it back to the canvas. Pinned
  // renders (export, preview capture) always render at 'final' regardless.
  previewQuality: PreviewQuality
  setPreviewQuality: (quality: PreviewQuality) => void

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

  // A one-shot request to bring the library forward on a given tab - fired by
  // the empty scene's action list, which offers "start from a template" from a
  // surface that can't reach either piece of state (the pane's open/closed
  // lives in App's local state behind the toggle glide, the tab inside
  // LeftSidebar). Both consumers react to a CHANGE rather than to presence, so
  // neither has to clear it and there is no race over who clears first; the
  // nonce is what makes a repeat request re-fire.
  libraryRequest: { tab: LibraryTabId; nonce: number } | null
  requestLibraryTab: (tab: LibraryTabId) => void

  // Live state of a loop-pattern drag from the library: non-null lights the
  // lane region as the drop zone, and `target` is the row/bar under the
  // cursor - Track.tsx draws the would-be block there so the drag literally
  // turns into a MIDI block over a lane.
  loopDrag: { name: string; durationBars: number; target: { trackId: string; bar: number } | null } | null
  setLoopDrag: (v: UIState['loopDrag']) => void

  // Live state of an audible audio-block drag (sync mode): while set, the
  // transport loops `loop` (overriding the user's loop region), the dragged
  // block swaps its oscilloscope for a transient-resolution waveform, and the
  // timeline highlights the looped span. null = no sync drag in progress.
  audioSyncDrag: { trackId: string; blockId: string; loop: LoopRegion } | null
  setAudioSyncDrag: (v: UIState['audioSyncDrag']) => void

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

  setSelectedTrackId: (id) =>
    set({ selectedTrackId: id, selectedTrackIds: id ? new Set([id]) : new Set() }),

  selectedTrackIds: new Set(),
  setSelectedTrackIds: (ids) => set({ selectedTrackIds: ids }),

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
  setMidiRowHeight: (px) =>
    set({ midiRowHeight: Math.max(MIDI_ROW_HEIGHT_MIN, Math.min(MIDI_ROW_HEIGHT_MAX, px)) }),

  tracksPixelsPerBeat: 16,
  setTracksPixelsPerBeat: (pixels) =>
    set({ tracksPixelsPerBeat: Math.max(2, Math.min(100, pixels)) }),

  tracksRowHeight: 44,
  setTracksRowHeight: (px) =>
    set({ tracksRowHeight: Math.max(28, Math.min(200, px)) }),

  previewQuality: 'final',
  setPreviewQuality: (quality) => set({ previewQuality: quality }),

  tracksLabelWidth: TRACK_LABEL_WIDTH,
  setTracksLabelWidth: (px) =>
    set({ tracksLabelWidth: Math.max(96, Math.min(480, px)) }),

  midiLabelWidth: 108,
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

  libraryRequest: null,
  requestLibraryTab: (tab) => set({ libraryRequest: { tab, nonce: Date.now() } }),

  loopDrag: null,
  setLoopDrag: (v) => set({ loopDrag: v }),

  audioSyncDrag: null,
  setAudioSyncDrag: (v) => set({ audioSyncDrag: v }),

  projectName: null,
  setProjectName: (name) => set({ projectName: name }),

  modalOpen: false,
  setModalOpen: (v) => set({ modalOpen: v }),
}));
