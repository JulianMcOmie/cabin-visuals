import type { Track } from '../../types'
import { getInstrument } from '../../instruments'
import { getModulator } from '../../instruments/modulators'
import type { ResolvedGraph, ResolvedObject, ResolvedNote, ModulatorInstance } from './types'

/** The slice of the project the resolver reads. ProjectStore's state satisfies it
 *  structurally, so the engine never imports the store's internals. */
export interface ProjectSnapshot {
  tracks: Record<string, Track>
  rootTrackIds: string[]
  beatsPerBar: number
}

/** Flatten a track's notes to absolute project beats (with block bounds). */
function flattenNotes(track: Track, beatsPerBar: number): ResolvedNote[] {
  const notes: ResolvedNote[] = []
  for (const block of track.blocks) {
    const blockStartBeat = block.startBar * beatsPerBar
    const blockEndBeat = blockStartBeat + block.durationBars * beatsPerBar
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
  return notes
}

/**
 * Flatten the project into objects + modulators. A track is a modulator if its
 * instrumentId is in the modulator registry (its notes become triggers routed to
 * the ports of the object tracks it targets); otherwise it's an object track.
 * Non-incremental skeleton — resolve is trivially cheap at this scale.
 */
export function resolveProject(p: ProjectSnapshot): ResolvedGraph {
  const objects: ResolvedObject[] = []
  const modulators: ModulatorInstance[] = []

  for (const id of p.rootTrackIds) {
    const track = p.tracks[id]
    if (!track || !track.instrumentId) continue

    // Modulator track: notes → triggers, routed to each target's port.
    const modDef = getModulator(track.instrumentId)
    if (modDef) {
      if (track.muted) continue
      const triggers = flattenNotes(track, p.beatsPerBar)
      for (const routing of track.targets ?? []) {
        // Only track-scope resolves today; tag/subtree scopes land in later phases.
        if (routing.scope.kind !== 'track') continue
        modulators.push({
          id: `${id}->${routing.scope.id}.${routing.port}`,
          kind: modDef.signal,
          triggers,
          targetObjectId: routing.scope.id,
          targetPort: routing.port,
        })
      }
      continue
    }

    // Object track.
    objects.push({
      trackId: id,
      instrumentId: track.instrumentId,
      muted: track.muted,
      params: track.params ?? {},
      ports: getInstrument(track.instrumentId)?.ports ?? [],
      notes: flattenNotes(track, p.beatsPerBar),
    })
  }

  // Built-in: each non-muted object pulses from its own notes into its `energy`
  // port (the Cube's original self-pulse). Explicit modulator tracks add on top.
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
