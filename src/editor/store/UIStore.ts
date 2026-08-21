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
export const PREVIEW_QUALITIES = ['final', 'auto', 'fast', 'fastest'] as const
export type PreviewQuality = (typeof PREVIEW_QUALITIES)[number]

/** Linear resolution factor each level renders the canvas pipeline at. Fragment
 *  cost is the SQUARE of this, so 'fastest' is ~16× less pixel work.
 *  'auto' is listed at its PLAYING scale; `previewQualityScale` below is what
 *  callers should read, since auto's whole point is that it depends on the
 *  transport. */
export const PREVIEW_QUALITY_SCALE: Record<PreviewQuality, number> = {
  final: 1,
  auto: 0.5,
  fast: 0.5,
  fastest: 0.25,
}

/** The scale to render at right now. AUTO softens the picture only while the
 *  transport runs - motion hides the resolution drop, and the paused frame is
 *  the one you actually scrutinise (and the one a preview capture grabs), so
 *  it snaps back to full the moment playback stops. Every other level is a
 *  fixed choice and ignores the transport. */
export function previewQualityScale(quality: PreviewQuality, isPlaying: boolean): number {
  if (quality === 'auto') return isPlaying ? PREVIEW_QUALITY_SCALE.auto : 1
  return PREVIEW_QUALITY_SCALE[quality]
}

/** What the 3D canvas shows: the Composite's final frame, or the scene being edited. */
export type CanvasView = 'main' | 'scene'

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

  // midi vim: the piano roll's modal keyboard editor (see components/midi/vim).
  // Session state on purpose - it is NOT remembered across reloads, because a
  // roll that silently opens with the keyboard claimed reads as a broken
  // editor. Double-tap Shift (or the toolbar chip) is one gesture to re-arm.
  midiVimEnabled: boolean
  setMidiVimEnabled: (on: boolean) => void

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

  // What the 3D canvas shows: 'main' holds on the Composite scene's final
  // director composition (the deliverable - the resting default), 'scene' follows
  // whichever scene is being edited so edits are always visible. Session
  // state on purpose: an ephemeral viewing choice, never part of the document.
  canvasView: CanvasView
  setCanvasView: (view: CanvasView) => void

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
  // `activeId` is the row being moved (its content ghosts); only set for an
  // existing-track drag. `line` is always a straight rule at the landing depth's
  // bracket - see trackDrop.ts for why it never bends around a would-be child.
  // `replace` is the library drag's swap-in-place target (an instrument card over an
  // instrument row's middle band): the row previews the incoming instrument in `color`
  // and the drag ghost names the swap via `oldName`. Never set by the nest-drag.
  trackDrop: {
    activeId?: string
    line: { top: number; left: number } | null
    intoId: string | null
    replace?: { trackId: string; oldName: string; name: string; color: string } | null
  } | null
  setTrackDrop: (v: {
    activeId?: string
    line: { top: number; left: number } | null
    intoId: string | null
    replace?: { trackId: string; oldName: string; name: string; color: string } | null
  } | null) => void

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

  // True from a ?project= bind until its document has hydrated (or failed).
  // The timeline reads it to show a loading mark instead of the empty-scene
  // "Let's start composing" list - the stores are deliberately blanked while
  // the row is on the wire, and an empty store during that window is a
  // loading state, not an empty project. Session-only, never serialized.
  documentLoading: boolean
  setDocumentLoading: (v: boolean) => void

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
  // Marquee drags rebuild the Set every pointermove; only publish when the
  // membership actually changed, or every row re-renders per pixel.
  setSelectedBlockIds: (ids) => set((s) => {
    const prev = s.selectedBlockIds
    if (prev.size === ids.size) {
      let same = true
      for (const id of ids) if (!prev.has(id)) { same = false; break }
      if (same) return s
    }
    return { selectedBlockIds: ids }
  }),

  editingBlock: null,
  setEditingBlock: (ref) => set({ editingBlock: ref }),

  midiPixelsPerBeat: 40,
  setMidiPixelsPerBeat: (pixels) =>
    set({ midiPixelsPerBeat: Math.max(5, Math.min(200, pixels)) }),

  midiVimEnabled: false,
  setMidiVimEnabled: (on) => set({ midiVimEnabled: on }),

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
  canvasView: 'main',
  setCanvasView: (view) => set({ canvasView: view }),

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
  // Nest/library drags mint a new object per pointermove; skip the publish
  // when nothing inside it moved (TimelineArea subscribes to the whole thing).
  setTrackDrop: (v) => set((s) => {
    const p = s.trackDrop
    if (p === v) return s
    if (p && v
      && p.activeId === v.activeId && p.intoId === v.intoId
      && (p.line?.top === v.line?.top) && (p.line?.left === v.line?.left)
      && (p.replace?.trackId === v.replace?.trackId) && (p.replace?.name === v.replace?.name)
      && (p.replace?.oldName === v.replace?.oldName) && (p.replace?.color === v.replace?.color)) return s
    return { trackDrop: v }
  }),

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

  documentLoading: false,
  setDocumentLoading: (v) => set({ documentLoading: v }),

  modalOpen: false,
  setModalOpen: (v) => set({ modalOpen: v }),
}));
