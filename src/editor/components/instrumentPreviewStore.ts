import { getInstrument } from '../instruments'
import { getMoverOrSplitterDefinition } from '../core/visualCopies/registry'
import { get2DPreview } from './InstrumentPreview2D'
import type { ResolvedNote } from '../core/visual/types'
import type { InstrumentItem } from './LeftSidebar'

// The hover-preview TARGET store, split out of InstrumentHoverPreview.tsx so
// the things that only SET a preview (library cards, timeline track rows) can
// import a few hundred bytes instead of the whole popup module - which mounts
// its own r3f Canvas + Bloom and now loads after first paint (see LeftSidebar).
// InstrumentHoverPreview reads this store through `subscribePreview` /
// `getCurrentPreview` and re-exports the setters for its older importers.

// Instruments whose real render needs context a popup can't provide (uploads,
// live audio, the scene camera, scenes to composite) get a bespoke canvas-2D
// vignette instead (InstrumentPreview2D) - that covers the Main essentials and
// every Director, so the whole library previews.
export function canPreview(item: InstrumentItem): boolean {
  if (get2DPreview(item.id)) return true
  if (item.kind === 'object') return !!getInstrument(item.id)
  if (item.kind === 'mover' || item.kind === 'splitter' || item.kind === 'colorizer') return !!getMoverOrSplitterDefinition(item.id)
  // A rack has no object of its own: it previews as the thing it actually
  // does, which is three solids taking the frame in turn (SwitcherPreview).
  if (item.kind === 'switcher') return true
  return false
}

export type PreviewTarget = {
  item: InstrumentItem
  anchor: { left: number; top: number }
  /** Track-row previews: the row's real notes + follow-the-transport sync. */
  notes?: ResolvedNote[]
  sync?: boolean
  /** Mover/splitter rows: the track's stored settings. */
  inputValues?: Record<string, number>
  /** Timeline rows: preview the real project track (settings, notes, chain) -
   *  falls back to the generic preview when it can't resolve to an object. */
  projectTrackId?: string
}

let currentPreview: PreviewTarget | null = null
const previewListeners = new Set<() => void>()

/** Dismiss the popup only if it is showing this project track — a deleted
 *  row unmounts without ever getting a mouseleave, so its unmount calls this
 *  (unconditional clearing would kill a neighbor row's preview instead). */
export function clearInstrumentPreviewFor(projectTrackId: string): void {
  if (currentPreview?.projectTrackId === projectTrackId) setInstrumentPreview(null)
}

export function setInstrumentPreview(target: PreviewTarget | null): void {
  currentPreview = target && canPreview(target.item) ? target : null
  previewListeners.forEach((l) => l())
}

export function subscribePreview(l: () => void): () => void {
  previewListeners.add(l)
  return () => previewListeners.delete(l)
}

export function getCurrentPreview(): PreviewTarget | null {
  return currentPreview
}
