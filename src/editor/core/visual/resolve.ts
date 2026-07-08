import { Matrix4 } from 'three'
import type { Track } from '../../types'
import { getInstrument } from '../../instruments'
import type {
  ResolvedGraph,
  ResolvedObject,
  ResolvedNote,
  ResolvedAutomation,
  ResolvedMover,
  BlackoutRegion,
} from './types'
import { isModifierType, combineModifier, MIDI_AMOUNT_MAX, MIDI_AMOUNT_MIN, pitchToValue } from '../trackTypes'
import { extractKeyframes, type AutomationKeyframe } from './automation'
import { isNumberParam, type ObjectInstrumentDef } from '../../instruments/types'
import { firstMoverMidiInput, getMover, isMoverMidiInput, DEFAULT_SUBSET_WEIGHT } from './movers/registry'
import { identitySV } from './stateVector'
import { flattenTrackNotes as flattenTrackNotesRaw } from './noteFlatten'

/** The slice of the project the resolver reads. ProjectStore's state satisfies it
 *  structurally, so the engine never imports the store's internals. */
export interface ProjectSnapshot {
  tracks: Record<string, Track>
  rootTrackIds: string[]
  beatsPerBar: number
  bpm: number
  totalBars?: number
}

/** Track ids in depth-first order across the whole forest (roots, then each one's
 *  descendants). The engine treats nested and top-level tracks uniformly - nesting
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

function flattenTrackNotes(track: Track, p: ProjectSnapshot): ResolvedNote[] {
  return flattenTrackNotesRaw(track, p.beatsPerBar, p.totalBars)
}

function paramsWithDefaults(def: ObjectInstrumentDef | undefined, params: Record<string, number>): Record<string, number> {
  if (!def) return params
  const out: Record<string, number> = {}
  for (const p of def.params) if (typeof p.default === 'number') out[p.key] = p.default
  return { ...out, ...params }
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
      keyframes: extractKeyframes(child.blocks, p.beatsPerBar, pdef.min, pdef.max, p.totalBars),
    })
  }
  return out
}

function resolveMoverAutomations(track: Track, d: NonNullable<ReturnType<typeof getMover>>, p: ProjectSnapshot): ResolvedAutomation[] {
  const out: ResolvedAutomation[] = []
  const anyAutoSolo = (track.childIds ?? []).some((cid) => {
    const c = p.tracks[cid]
    return !!c && !c.instrumentId && c.type === 'automation' && !!c.solo
  })
  for (const childId of track.childIds ?? []) {
    const child = p.tracks[childId]
    if (!child || child.instrumentId || child.type !== 'automation') continue
    if (child.muted || (anyAutoSolo && !child.solo)) continue
    const inputName = child.targetParam
    if (!inputName) continue
    const input = d.inputs[inputName]
    if (!input) continue
    out.push({
      param: inputName,
      mode: child.interpolation ?? 'linear',
      keyframes: extractKeyframes(child.blocks, p.beatsPerBar, input.min, input.max, p.totalBars),
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
    events.set(child.abilityKey as string, off ? [] : flattenTrackNotes(child, p))
  }
  return events
}

function resolveMoverTrack(track: Track, p: ProjectSnapshot): ResolvedMover | null {
  const def = getMover(track.moverId)
  if (!def) return null
  const notes = flattenTrackNotes(track, p)
  const inputBase: Record<string, number> = {}
  const continuousKeyframes: Record<string, AutomationKeyframe[]> = {}
  const amountKeyframes = notes.map((note) => ({
    beat: note.beat,
    value: pitchToValue(note.pitch, MIDI_AMOUNT_MIN, MIDI_AMOUNT_MAX),
  }))
  for (const [inputName, input] of Object.entries(def.inputs)) {
    inputBase[inputName] = track.inputValues?.[inputName] ?? input.default
    continuousKeyframes[inputName] = notes.map((note) => ({
      beat: note.beat,
      value: pitchToValue(note.pitch, input.min, input.max),
    }))
  }
  const midiTargetInput = isMoverMidiInput(def, track.midiTargetInput)
    ? track.midiTargetInput
    : firstMoverMidiInput(def)
  return {
    trackId: track.id,
    def,
    depth: track.depth ?? 1,
    bypassed: !!track.muted,
    inputBase,
    opMode: track.opMode ?? 'transform',
    midiMode: track.midiMode ?? 'none',
    midiTargetInput,
    interpolation: track.interpolation ?? 'linear',
    envelope: track.envelope,
    notes,
    continuousKeyframes,
    amountKeyframes,
    weight: track.weight ?? DEFAULT_SUBSET_WEIGHT,
    automations: resolveMoverAutomations(track, def, p),
  }
}

function resolveMoverChain(track: Track, p: ProjectSnapshot): ResolvedMover[] {
  const chain: ResolvedMover[] = []
  const anyMoverSolo = (track.childIds ?? []).some((cid) => {
    const child = p.tracks[cid]
    return !!child && child.type === 'mover' && !!child.solo
  })
  for (const childId of track.childIds ?? []) {
    const child = p.tracks[childId]
    if (!child || child.type !== 'mover') continue
    if (anyMoverSolo && !child.solo) continue
    const d = resolveMoverTrack(child, p)
    if (d) chain.push(d)
  }
  return chain
}

/** Fold a track's event-modifier children into its note stream (in child order) and
 *  collect blackout regions from `mute` children. A modifier is a no-instrument child
 *  whose type is a modifier type - consumed here, never resolved as its own object. */
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
    const self = flattenTrackNotes(child, p)
    if (child.type === 'mute') {
      for (const n of self) blackouts.push({ start: n.beat, end: n.beat + (n.durationBeats || 0.25) })
    }
    notes = combineModifier(child.type, notes, self, p.beatsPerBar)
  }
  return { notes, blackouts }
}

/**
 * Flatten the project into resolved objects (with their mover chains) plus the tag
 * index. Objects resolve first so tag-scoped top-level movers can expand to the
 * objects carrying that tag.
 * Non-incremental skeleton - resolve is trivially cheap at this scale.
 */
export function resolveProject(p: ProjectSnapshot): ResolvedGraph {
  const objects: ResolvedObject[] = []
  const tagIndex = new Map<string, string[]>()

  // Real solo, scoped to OBJECTS: if any object is soloed, non-soloed objects go off
  // (muted). Children (modifiers/automation) keep their own mute, so soloing an
  // object never disables its own automation or its modifiers. Ability-lane solo is
  // separate (per object, in resolveAbilityEvents).
  const isObjectTrack = (t: Track) => !!t.instrumentId
  const anyObjectSolo = Object.values(p.tracks).some((t) => t.solo && isObjectTrack(t))
  const objectOff = (track: Track) => !!track.muted || (anyObjectSolo && !track.solo)

  for (const id of flattenTree(p)) {
    const track = p.tracks[id]
    if (!track || !track.instrumentId) continue

    // Object track - fold its event-modifier children into its note stream.
    const tags = track.tags ?? []
    const def = getInstrument(track.instrumentId)
    if (!def) continue // unknown instrument (removed, or a legacy modulator) renders nothing
    const params = track.params ?? {}
    const paramsForCount = paramsWithDefaults(def, params)
    const elementCount = Math.max(1, Math.min(512, Math.round(def?.elementCount?.(paramsForCount) ?? 1)))
    const { notes, blackouts } = applyModifiers(track, flattenTrackNotes(track, p), p)
    const moverChain = resolveMoverChain(track, p)
    objects.push({
      trackId: id,
      instrumentId: track.instrumentId,
      parentId: track.parentId,
      muted: objectOff(track),
      params,
      stringParams: track.stringParams ?? {},
      localTransform: def?.localTransform,
      elementCount,
      layoutState: def?.layoutState,
      elementMatrices: Array.from({ length: elementCount }, () => new Matrix4()),
      elementOpacities: Array.from({ length: elementCount }, () => 1),
      notes,
      blackouts,
      abilityEvents: resolveAbilityEvents(track, p),
      automations: resolveAutomations(track, def, p),
      moverChain,
      scratchBase: identitySV(),
      scratchA: identitySV(),
      scratchB: identitySV(),
      scratchEntry: identitySV(),
      scratchAdd: identitySV(),
      scratchInputs: {},
      scratchChannels: {},
      tags,
    })
    for (const tag of tags) {
      const list = tagIndex.get(tag)
      if (list) list.push(id)
      else tagIndex.set(tag, [id])
    }
  }

  const objectIds = new Set(objects.map((o) => o.trackId))
  const objectById = new Map(objects.map((o) => [o.trackId, o]))

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

  // Top-level movers are global: they target existing objects by track/tag/subtree
  // and append after each object's local child movers. Root order is user-visible
  // chain order, so do not sort or normalize this pass.
  for (const trackId of p.rootTrackIds) {
    const track = p.tracks[trackId]
    if (!track || track.type !== 'mover') continue
    const d = resolveMoverTrack(track, p)
    if (!d) continue
    const seenTargets = new Set<string>()
    for (const routing of track.targets ?? []) {
      for (const targetObjectId of objectsForScope(routing.scope)) {
        if (seenTargets.has(targetObjectId)) continue
        seenTargets.add(targetObjectId)
        const obj = objectById.get(targetObjectId)
        if (!obj) continue
        obj.moverChain.push(d)
      }
    }
  }

  return { objects, tagIndex }
}
