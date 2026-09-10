import type { ProjectDocument } from './types'

/** Sample inside the first authored visual note instead of the usually empty
 * beat zero. Bounded document scan, no graph resolve or live playhead changes. */
export function thumbnailBeat(document: ProjectDocument, sceneId: string): number {
  let first = Infinity
  for (const track of Object.values(document.scenes[sceneId]?.tracks ?? {})) {
    if (track.type !== 'base') continue
    for (const block of track.blocks) for (const note of block.notes) {
      if (note.durationBeats <= 0 || note.velocity <= 0) continue
      const start = block.startBar * document.beatsPerBar + note.startBeat
      if (start >= 0 && note.startBeat < block.durationBars * document.beatsPerBar) {
        first = Math.min(first, start + Math.min(0.25, note.durationBeats / 2))
      }
    }
  }
  return Number.isFinite(first) ? first : 0
}
