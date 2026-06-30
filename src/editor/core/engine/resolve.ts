import type { Track } from '../../types'
import { getInstrument } from '../../instruments'
import { getModulator } from '../../instruments/modulators'
import type {
  ResolvedGraph,
  ResolvedObject,
  ResolvedNote,
  ModulatorInstance,
  ResolvedRouting,
} from './types'

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
 * Flatten the project into objects + modulator signals + routings. A track is a
 * modulator if its instrumentId is in the modulator registry (its notes become a
 * signal, fanned out by routings to the ports of the objects its scopes resolve to);
 * otherwise it's an object track. Resolution is two-pass: objects (and the tag
 * index) first, so tag-scoped routings can expand to the objects carrying that tag.
 * Non-incremental skeleton — resolve is trivially cheap at this scale.
 */
export function resolveProject(p: ProjectSnapshot): ResolvedGraph {
  const objects: ResolvedObject[] = []
  const modulators: ModulatorInstance[] = []
  const routings: ResolvedRouting[] = []
  const tagIndex = new Map<string, string[]>()
  // Defer modulator tracks to a second pass — the tag index isn't built until all
  // objects are known.
  const modTracks: { id: string; track: Track }[] = []

  for (const id of p.rootTrackIds) {
    const track = p.tracks[id]
    if (!track || !track.instrumentId) continue

    if (getModulator(track.instrumentId)) {
      if (!track.muted) modTracks.push({ id, track })
      continue
    }

    // Object track.
    const tags = track.tags ?? []
    objects.push({
      trackId: id,
      instrumentId: track.instrumentId,
      muted: track.muted,
      params: track.params ?? {},
      ports: getInstrument(track.instrumentId)?.ports ?? [],
      notes: flattenNotes(track, p.beatsPerBar),
      tags,
    })
    for (const tag of tags) {
      const list = tagIndex.get(tag)
      if (list) list.push(id)
      else tagIndex.set(tag, [id])
    }
  }

  // Expand a routing's scope to the concrete object trackIds it hits.
  const objectsForScope = (scope: NonNullable<Track['targets']>[number]['scope']): string[] => {
    switch (scope.kind) {
      case 'track': return [scope.id]
      case 'tag': return tagIndex.get(scope.tag) ?? []
      case 'subtree': return [] // nested hierarchy — resolved in phase 5
    }
  }

  // Second pass: each modulator track is one signal; its routings fan that signal
  // out to every object their scope resolves to (deduped per object+port).
  for (const { id, track } of modTracks) {
    const triggers = flattenNotes(track, p.beatsPerBar)
    modulators.push({ id, kind: 'pulse', triggers })
    const seen = new Set<string>()
    for (const routing of track.targets ?? []) {
      for (const targetObjectId of objectsForScope(routing.scope)) {
        const key = `${targetObjectId}.${routing.port}`
        if (seen.has(key)) continue
        seen.add(key)
        routings.push({ modulatorId: id, targetObjectId, targetPort: routing.port, amount: routing.amount })
      }
    }
  }

  // Built-in: each non-muted object pulses from its own notes into its `energy`
  // port (the Cube's original self-pulse). Explicit modulator tracks add on top.
  for (const obj of objects) {
    if (!obj.muted && obj.notes.length > 0) {
      const modId = `${obj.trackId}:pulse`
      modulators.push({ id: modId, kind: 'pulse', triggers: obj.notes })
      routings.push({ modulatorId: modId, targetObjectId: obj.trackId, targetPort: 'energy', amount: 1 })
    }
  }

  // Bucket routings by port — the matrix's per-port lookup.
  const routingsByPort = new Map<string, ResolvedRouting[]>()
  for (const r of routings) {
    const list = routingsByPort.get(r.targetPort)
    if (list) list.push(r)
    else routingsByPort.set(r.targetPort, [r])
  }

  return { objects, modulators, routingsByPort, tagIndex }
}
