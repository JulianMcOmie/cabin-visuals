import type { Track, Block } from '../../types'
import { getInstrument } from '../../instruments'
import { getModulator } from '../../instruments/modulators'
import type {
  ResolvedGraph,
  ResolvedObject,
  ResolvedNote,
  ResolvedAutomation,
  ModulatorInstance,
  ResolvedRouting,
  BlackoutRegion,
} from './types'
import { isModifierType, combineModifier } from './trackTypes'
import { extractKeyframes } from './automation'
import { isNumberParam, type ObjectInstrumentDef } from '../../instruments/types'

/** The slice of the project the resolver reads. ProjectStore's state satisfies it
 *  structurally, so the engine never imports the store's internals. */
export interface ProjectSnapshot {
  tracks: Record<string, Track>
  rootTrackIds: string[]
  beatsPerBar: number
  bpm: number
}

/** Track ids in depth-first order across the whole forest (roots, then each one's
 *  descendants). The engine treats nested and top-level tracks uniformly — nesting
 *  only adds transform inheritance (later); every object/modulator still resolves.
 *  A visited set guards against malformed cyclic data. */
function flattenTree(p: ProjectSnapshot): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const visit = (id: string) => {
    if (seen.has(id)) return
    const track = p.tracks[id]
    if (!track) return
    seen.add(id)
    out.push(id)
    for (const childId of track.childIds ?? []) visit(childId)
  }
  for (const id of p.rootTrackIds) visit(id)
  return out
}

/** Flatten a list of blocks to absolute project beats (with block bounds). */
function flattenBlocks(blocks: Block[], beatsPerBar: number): ResolvedNote[] {
  const notes: ResolvedNote[] = []
  for (const block of blocks) {
    const blockStartBeat = block.startBar * beatsPerBar
    const blockEndBeat = blockStartBeat + block.durationBars * beatsPerBar
    for (const note of block.notes) {
      notes.push({
        beat: blockStartBeat + note.startBeat,
        blockStartBeat,
        blockEndBeat,
        pitch: note.pitch,
        velocity: note.velocity,
        durationBeats: note.durationBeats,
      })
    }
  }
  notes.sort((a, b) => a.beat - b.beat)
  return notes
}

/** Flatten a track's own notes (its `blocks`) to absolute project beats. */
function flattenNotes(track: Track, beatsPerBar: number): ResolvedNote[] {
  return flattenBlocks(track.blocks, beatsPerBar)
}

/** Gather an object track's `automation` child tracks into resolved keyframe lanes.
 *  Each maps one of the object's params (its note pitch → the param's [min,max]); the
 *  engine samples them per frame. Children with no target param or an unknown param are
 *  skipped. Muted automation children are ignored (a quick disable). */
function resolveAutomations(track: Track, def: ObjectInstrumentDef | undefined, p: ProjectSnapshot): ResolvedAutomation[] {
  const out: ResolvedAutomation[] = []
  if (!def) return out
  // Per-object solo among this track's automation children.
  const anyAutoSolo = (track.childIds ?? []).some((cid) => {
    const c = p.tracks[cid]
    return !!c && !c.instrumentId && c.type === 'automation' && !!c.solo
  })
  for (const childId of track.childIds ?? []) {
    const child = p.tracks[childId]
    if (!child || child.instrumentId || child.type !== 'automation') continue
    if (child.muted || (anyAutoSolo && !child.solo)) continue
    const param = child.targetParam
    if (!param) continue
    const pdef = def.params.find((pd) => pd.key === param)
    if (!pdef || !isNumberParam(pdef)) continue
    out.push({
      param,
      mode: child.interpolation ?? 'linear',
      keyframes: extractKeyframes(child.blocks, p.beatsPerBar, pdef.min, pdef.max),
    })
  }
  return out
}

/** Gather an object track's `ability` child tracks into per-key note streams. Solo is
 *  per-object: if any ability child is soloed, the non-soloed ones go silent. */
function resolveAbilityEvents(track: Track, p: ProjectSnapshot): Map<string, ResolvedNote[]> {
  const events = new Map<string, ResolvedNote[]>()
  const children = (track.childIds ?? [])
    .map((cid) => p.tracks[cid])
    .filter((c): c is Track => !!c && !c.instrumentId && c.type === 'ability' && !!c.abilityKey)
  const anySolo = children.some((c) => c.solo)
  for (const child of children) {
    const off = !!child.muted || (anySolo && !child.solo)
    events.set(child.abilityKey as string, off ? [] : flattenNotes(child, p.beatsPerBar))
  }
  return events
}

/** Fold a track's event-modifier children into its note stream (in child order) and
 *  collect blackout regions from `mute` children. A modifier is a no-instrument child
 *  whose type is a modifier type — consumed here, never resolved as its own object. */
function applyModifiers(
  track: Track,
  baseNotes: ResolvedNote[],
  p: ProjectSnapshot,
): { notes: ResolvedNote[]; blackouts: BlackoutRegion[] } {
  let notes = baseNotes
  const blackouts: BlackoutRegion[] = []
  // Per-object solo among this track's modifier children.
  const anyModSolo = (track.childIds ?? []).some((cid) => {
    const c = p.tracks[cid]
    return !!c && !c.instrumentId && isModifierType(c.type) && !!c.solo
  })
  for (const childId of track.childIds ?? []) {
    const child = p.tracks[childId]
    if (!child || child.instrumentId || !isModifierType(child.type)) continue
    if (child.muted || (anyModSolo && !child.solo)) continue
    const self = flattenNotes(child, p.beatsPerBar)
    if (child.type === 'mute') {
      for (const n of self) blackouts.push({ start: n.beat, end: n.beat + (n.durationBeats || 0.25) })
    }
    notes = combineModifier(child.type, notes, self, p.beatsPerBar)
  }
  return { notes, blackouts }
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

  // Real solo, scoped to OBJECTS: if any object is soloed, non-soloed objects go off
  // (muted). Modulators + children (modifiers/automation) keep their own mute, so
  // soloing an object never disables its own automation, its modifiers, or a modulator
  // that targets it. Ability-lane solo is separate (per object, in resolveAbilityEvents).
  const isObjectTrack = (t: Track) => !!t.instrumentId && !getModulator(t.instrumentId)
  const anyObjectSolo = Object.values(p.tracks).some((t) => t.solo && isObjectTrack(t))
  const objectOff = (track: Track) => !!track.muted || (anyObjectSolo && !track.solo)

  for (const id of flattenTree(p)) {
    const track = p.tracks[id]
    if (!track || !track.instrumentId) continue

    if (getModulator(track.instrumentId)) {
      if (!track.muted) modTracks.push({ id, track })
      continue
    }

    // Object track — fold its event-modifier children into its note stream.
    const tags = track.tags ?? []
    const def = getInstrument(track.instrumentId)
    const { notes, blackouts } = applyModifiers(track, flattenNotes(track, p.beatsPerBar), p)
    objects.push({
      trackId: id,
      instrumentId: track.instrumentId,
      parentId: track.parentId,
      muted: objectOff(track),
      params: track.params ?? {},
      ports: def?.ports ?? [],
      stringParams: track.stringParams ?? {},
      localTransform: def?.localTransform,
      notes,
      blackouts,
      abilityEvents: resolveAbilityEvents(track, p),
      automations: resolveAutomations(track, def, p),
      tags,
    })
    for (const tag of tags) {
      const list = tagIndex.get(tag)
      if (list) list.push(id)
      else tagIndex.set(tag, [id])
    }
  }

  const objectIds = new Set(objects.map((o) => o.trackId))

  // The scope root and all its descendants that are objects (depth-first).
  const objectsInSubtree = (rootId: string): string[] => {
    const ids: string[] = []
    const visit = (id: string) => {
      const track = p.tracks[id]
      if (!track) return
      if (objectIds.has(id)) ids.push(id)
      for (const childId of track.childIds ?? []) visit(childId)
    }
    visit(rootId)
    return ids
  }

  // Expand a routing's scope to the concrete object trackIds it hits.
  const objectsForScope = (scope: NonNullable<Track['targets']>[number]['scope']): string[] => {
    switch (scope.kind) {
      case 'track': return [scope.id]
      case 'tag': return tagIndex.get(scope.tag) ?? []
      case 'subtree': return objectsInSubtree(scope.id)
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
