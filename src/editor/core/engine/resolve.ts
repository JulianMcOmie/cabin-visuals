import type { Track } from '../../types'
import { getInstrument } from '../../instruments'
import type { ResolvedGraph, ResolvedObject, ResolvedNote, ModulatorInstance } from './types'

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
      ports: getInstrument(track.instrumentId)?.ports ?? [],
      notes,
    })
  }

  // Built-in modulation: each non-muted object pulses from its own notes into its
  // `energy` port (reproducing the Cube's old self-pulse, now through the matrix).
  // Explicit modulator tracks routed to ports arrive in the next commit.
  const modulators: ModulatorInstance[] = []
  for (const obj of objects) {
    if (!obj.muted && obj.notes.length > 0) {
      modulators.push({
        id: `${obj.trackId}:pulse`,
        kind: 'pulse',
        triggers: obj.notes,
        targetObjectId: obj.trackId,
        targetPort: 'energy',
      })
    }
  }

  return { objects, modulators }
}
