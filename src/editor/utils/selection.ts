import { useUIStore } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'

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
