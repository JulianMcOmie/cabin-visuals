import type { Track } from '../types'
import type { EditingBlockRef } from '../store/UIStore'

/** Opening a member keeps the MIDI selection; opening outside it starts a new roll. */
export function midiBlocksToOpen(
  tracks: Record<string, Track>, selected: ReadonlySet<string>, clicked: EditingBlockRef,
): EditingBlockRef[] {
  const ids = selected.has(clicked.blockId) ? selected : new Set([clicked.blockId])
  return Object.values(tracks)
    .filter(track => track.type !== 'audio')
    .flatMap(track => track.blocks.filter(block => ids.has(block.id)).map(block => ({
      trackId: track.id, blockId: block.id, startBar: block.startBar,
    })))
    .sort((a, b) => a.startBar - b.startBar || a.trackId.localeCompare(b.trackId) || a.blockId.localeCompare(b.blockId))
    .map(({ trackId, blockId }) => ({ trackId, blockId }))
}
