import { useUIStore } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'
import { flattenVisualRows } from '../components/timeline/trackTree'

// The timeline's selection transitions, centralized so the rules live in one
// place instead of scattered set() calls:
//  · selecting a track keeps ITS selected blocks and deselects everyone else's;
//  · re-selecting the selected track never toggles it off;
//  · deselecting a track (empty space / Esc) deselects its blocks with it -
//    blocks on OTHER tracks are left alone (no standing invariant is enforced:
//    a track and foreign blocks may be selected at the same time);
//  · a newly added track/instrument becomes the selection (blocks clear);
//  · a newly added block becomes the only selected block (track untouched).

/** Ids of every block (MIDI + audio) living on `trackId`. */
function blockIdsOn(trackId: string): Set<string> {
  const t = useProjectStore.getState().tracks[trackId]
  const ids = new Set<string>()
  if (!t) return ids
  for (const b of t.blocks) ids.add(b.id)
  for (const b of t.audioBlocks ?? []) ids.add(b.id)
  return ids
}

/** Select a track. Its already-selected blocks stay; blocks on other tracks
 *  deselect. Clicking the currently selected track keeps it selected. */
export function selectTrack(trackId: string) {
  const ui = useUIStore.getState()
  const own = blockIdsOn(trackId)
  const kept = new Set([...ui.selectedBlockIds].filter((id) => own.has(id)))
  ui.setSelectedTrackId(trackId)
  if (kept.size !== ui.selectedBlockIds.size) ui.setSelectedBlockIds(kept)
}

/** Deselect the selected track; its selected blocks deselect with it. */
export function deselectTrack() {
  const ui = useUIStore.getState()
  const trackId = ui.selectedTrackId
  if (!trackId) return
  const own = blockIdsOn(trackId)
  const kept = new Set([...ui.selectedBlockIds].filter((id) => !own.has(id)))
  ui.setSelectedTrackId(null)
  if (kept.size !== ui.selectedBlockIds.size) ui.setSelectedBlockIds(kept)
}

/** After a track (and its subtree) is deleted: clear the track selection and
 *  drop selected block ids that no longer resolve to a live block. */
export function pruneSelectionAfterTrackDelete() {
  const ui = useUIStore.getState()
  const { tracks } = useProjectStore.getState()
  const live = new Set<string>()
  for (const t of Object.values(tracks)) {
    for (const b of t.blocks) live.add(b.id)
    for (const b of t.audioBlocks ?? []) live.add(b.id)
  }
  const kept = new Set([...ui.selectedBlockIds].filter((id) => live.has(id)))
  ui.setSelectedTrackId(null)
  if (kept.size !== ui.selectedBlockIds.size) ui.setSelectedBlockIds(kept)
}

/** Ctrl/cmd-click: toggle a track in the multi-selection. The primary follows
 *  the toggle (added track becomes primary; removing the primary hands it to
 *  any remaining member). */
export function toggleTrackInSelection(trackId: string) {
  const ui = useUIStore.getState()
  const next = new Set(ui.selectedTrackIds)
  if (ui.selectedTrackId) next.add(ui.selectedTrackId)
  let primary: string | null = ui.selectedTrackId
  if (next.has(trackId)) {
    next.delete(trackId)
    if (primary === trackId) primary = next.values().next().value ?? null
  } else {
    next.add(trackId)
    primary = trackId
  }
  // Direct setState: setSelectedTrackId deliberately collapses the group.
  useUIStore.setState({ selectedTrackId: primary, selectedTrackIds: next })
}

/** Shift-click: select the visible range between the primary (anchor) and
 *  `targetId`, both ends inclusive, in flattened visual-row order. The pinned
 *  audio track never joins. The anchor stays primary, so successive
 *  shift-clicks re-range from the same anchor (Logic-style). With no anchor,
 *  a shift-click is a plain select. */
export function selectTrackRange(targetId: string) {
  const ui = useUIStore.getState()
  const { tracks, rootTrackIds } = useProjectStore.getState()
  const anchor = ui.selectedTrackId
  if (!anchor || anchor === targetId || !tracks[anchor]) {
    selectTrack(targetId)
    return
  }
  const ids = flattenVisualRows(tracks, rootTrackIds, ui.collapsedTrackIds)
    .filter((r) => r.kind === 'track')
    .map((r) => r.id)
  const a = ids.indexOf(anchor)
  const b = ids.indexOf(targetId)
  if (a < 0 || b < 0) {
    selectTrack(targetId)
    return
  }
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  const range = ids.slice(lo, hi + 1).filter((id) => tracks[id]?.type !== 'audio')
  // Direct setState: setSelectedTrackId deliberately collapses the group.
  useUIStore.setState({ selectedTrackId: anchor, selectedTrackIds: new Set(range) })
}

/** Delete every selected track (the ctrl-click group ∪ the primary) - fired
 *  in one synchronous burst, so history collapses it into one undo step. */
export function deleteSelectedTracks() {
  const ui = useUIStore.getState()
  const ids = new Set(ui.selectedTrackIds)
  if (ui.selectedTrackId) ids.add(ui.selectedTrackId)
  if (ids.size === 0) return
  const store = useProjectStore.getState()
  // An id already deleted as part of an earlier selection member's subtree
  // just no-ops (deleteTrack guards on a live track).
  for (const id of ids) store.deleteTrack(id)
  pruneSelectionAfterTrackDelete()
  useUIStore.setState({ selectedTrackIds: new Set() })
}

/** A newly added track/instrument becomes THE selection; all blocks deselect. */
export function selectNewTrack(trackId: string) {
  const ui = useUIStore.getState()
  ui.setSelectedTrackId(trackId)
  if (ui.selectedBlockIds.size > 0) ui.setSelectedBlockIds(new Set())
}

/** A newly added block becomes the only selected block; track selection stays. */
export function selectNewBlock(blockId: string) {
  useUIStore.getState().setSelectedBlockIds(new Set([blockId]))
}

// ── Marquee/drag → row-click suppression ──
// A marquee drag that ends over a track row also fires a click on it; selecting
// that track would prune the selection the marquee just made. Gestures flag
// their movement here; the row click checks it. Time-boxed so a swallowed click
// can never leave the flag stale.
let suppressUntil = 0

export function suppressTrackSelectBriefly() {
  suppressUntil = performance.now() + 300
}

export function shouldSuppressTrackSelect(): boolean {
  return performance.now() < suppressUntil
}
