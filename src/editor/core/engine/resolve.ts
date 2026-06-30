import type { Track } from '../../types'
import type { ResolvedGraph, ResolvedObject, ResolvedNote } from './types'

/** The slice of the project the resolver reads. ProjectStore's state satisfies it
 *  structurally, so the engine never imports the store's internals. */
export interface ProjectSnapshot {
  tracks: Record<string, Track>
  rootTrackIds: string[]
  beatsPerBar: number
}

/**
 * Flatten the project into renderable objects. Today: each top-level track with an
 * instrument becomes one object, and its notes are flattened to absolute beats.
 * Nested hierarchy, event modifiers, and modulators arrive in later phases — this
 * is the non-incremental skeleton (resolve is trivially cheap at this scale).
 */
export function resolveProject(p: ProjectSnapshot): ResolvedGraph {
  const objects: ResolvedObject[] = []

  for (const id of p.rootTrackIds) {
    const track = p.tracks[id]
    if (!track || !track.instrumentId) continue

    const notes: ResolvedNote[] = []
    for (const block of track.blocks) {
      const blockStartBeat = block.startBar * p.beatsPerBar
      const blockEndBeat = blockStartBeat + block.durationBars * p.beatsPerBar
      for (const note of block.notes) {
        notes.push({
          beat: blockStartBeat + note.startBeat,
          blockStartBeat,
          blockEndBeat,
          pitch: note.pitch,
          velocity: note.velocity,
        })
      }
    }
    notes.sort((a, b) => a.beat - b.beat)

    objects.push({
      trackId: id,
      instrumentId: track.instrumentId,
      muted: track.muted,
      params: track.params ?? {},
      notes,
    })
  }

  return { objects }
}
