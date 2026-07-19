import type { Track } from '../../types'
import { getInstrument } from '../../instruments'
import type {
  ResolvedGraph,
  ResolvedObject,
  ResolvedNote,
  ResolvedAutomation,
  ResolvedEffectAutomation,
  ResolvedEnvelope,
} from './types'
import { DEFAULT_ADSR } from './adsr'
import { getEffect } from '../../effects'
import { parseFxTarget } from '../../effects/automation'
import { extractKeyframes, extractNoiseGates } from './automation'
import { isNumberParam, type ObjectInstrumentDef } from '../../instruments/types'
import { getMoverOrSplitterDefinition } from '../visualCopies/registry'
import { mergeDefinitionSettings } from '../visualCopies/definitions'
import type { MoverOrSplitter } from '../visualCopies/types'
import { resolveVisualCopies } from '../visualCopies/resolveVisualCopies'
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
    // Noise mode: the notes become burst gates instead of keyframes.
    if (child.noise) {
      out.push({
        param,
        mode: 'linear',
        keyframes: [],
        noise: child.noise,
        gates: extractNoiseGates(child.blocks, p.beatsPerBar, pdef.min, pdef.max, p.totalBars),
        min: pdef.min,
        max: pdef.max,
      })
      continue
    }
    out.push({
      param,
      mode: child.interpolation ?? 'linear',
      keyframes: extractKeyframes(child.blocks, p.beatsPerBar, pdef.min, pdef.max, p.totalBars),
    })
  }
  return out
}

/** Gather automation children whose target is fx-namespaced (`fx:<instanceId>:<key>`)
 *  into effect-override lanes. `enabled` is the 0/1 pseudo-param; anything else must
 *  match one of the plugin's numeric params (its [min,max] scales the pitch mapping). */
function resolveEffectAutomations(track: Track, p: ProjectSnapshot): ResolvedEffectAutomation[] {
  const out: ResolvedEffectAutomation[] = []
  const effects = track.effects ?? []
  if (effects.length === 0) return out
  const anyAutoSolo = (track.childIds ?? []).some((cid) => {
    const c = p.tracks[cid]
    return !!c && !c.instrumentId && c.type === 'automation' && !!c.solo
  })
  for (const childId of track.childIds ?? []) {
    const child = p.tracks[childId]
    if (!child || child.instrumentId || child.type !== 'automation') continue
    if (child.muted || (anyAutoSolo && !child.solo)) continue
    const target = parseFxTarget(child.targetParam)
    if (!target) continue
    const instance = effects.find((e) => e.id === target.instanceId)
    if (!instance) continue
    let min = 0
    let max = 1
    if (target.key !== 'enabled') {
      const pdef = getEffect(instance.pluginId)?.params.find((pd) => pd.key === target.key)
      if (!pdef || !isNumberParam(pdef)) continue
      min = pdef.min
      max = pdef.max
    }
    out.push({
      instanceId: target.instanceId,
      key: target.key,
      mode: child.interpolation ?? 'linear',
      keyframes: extractKeyframes(child.blocks, p.beatsPerBar, min, max, p.totalBars),
    })
  }
  return out
}

/** The reserved envelope target: multiplies the object's rendered opacity, so every
 *  instrument is fade-able without exposing a param (renderer-level, per the design
 *  doc). Wins over an instrument's own numeric param of the same key. */
export const ENVELOPE_OPACITY_TARGET = 'opacity'

const clampTo = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

/** Gather an object track's `envelope` child tracks. Each is a note-gated ADSR
 *  modulating one target: the reserved 'opacity' key, one of the parent's numeric
 *  params, or an fx-namespaced effect setting. Mute/solo mirror automation children
 *  (their own solo pool, per object). Unknown/non-numeric targets are skipped. */
function resolveEnvelopes(track: Track, def: ObjectInstrumentDef | undefined, p: ProjectSnapshot): ResolvedEnvelope[] {
  const out: ResolvedEnvelope[] = []
  const anyEnvSolo = (track.childIds ?? []).some((cid) => {
    const c = p.tracks[cid]
    return !!c && !c.instrumentId && c.type === 'envelope' && !!c.solo
  })
  for (const childId of track.childIds ?? []) {
    const child = p.tracks[childId]
    if (!child || child.instrumentId || child.type !== 'envelope') continue
    if (child.muted || (anyEnvSolo && !child.solo)) continue
    const target = child.targetParam
    if (!target) continue
    const adsr = { ...DEFAULT_ADSR, ...child.adsr }
    const depth = clampTo(child.envDepth ?? 1, 0, 1)
    const notes = flattenTrackNotes(child, p)
    if (target === ENVELOPE_OPACITY_TARGET) {
      out.push({ trackId: child.id, kind: 'opacity', min: 0, max: 1, envTarget: 1, adsr, depth, notes })
      continue
    }
    const fx = parseFxTarget(target)
    if (fx) {
      const instance = (track.effects ?? []).find((e) => e.id === fx.instanceId)
      const pdef = instance ? getEffect(instance.pluginId)?.params.find((pd) => pd.key === fx.key) : undefined
      if (!instance || !pdef || !isNumberParam(pdef)) continue // 'enabled' is a 0/1 toggle - no ADSR
      out.push({
        trackId: child.id,
        kind: 'fx',
        instanceId: fx.instanceId,
        key: fx.key,
        fxBase: instance.settings[fx.key] ?? pdef.default,
        min: pdef.min,
        max: pdef.max,
        envTarget: clampTo(child.envTarget ?? pdef.max, pdef.min, pdef.max),
        adsr,
        depth,
        notes,
      })
      continue
    }
    const pdef = def?.params.find((pd) => pd.key === target)
    if (!pdef || !isNumberParam(pdef)) continue
    out.push({
      trackId: child.id,
      kind: 'param',
      param: target,
      paramDefault: pdef.default,
      min: pdef.min,
      max: pdef.max,
      envTarget: clampTo(child.envTarget ?? pdef.max, pdef.min, pdef.max),
      adsr,
      depth,
      notes,
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


/** The definition id a track contributes to the mover-and-splitter chain.
 *  Ids unknown to the registry (e.g. deleted legacy movers in old saved
 *  projects) resolve to nothing and are skipped. */
function moverOrSplitterId(track: Track): string | undefined {
  if (track.type === 'splitter') return track.splitterId
  if (track.type === 'mover') return track.moverId
  return undefined
}

/** Resolve one mover/splitter track through the registry: merge the
 *  definition's numeric param defaults with the track's stored inputValues,
 *  flatten its notes, and let the definition close over both. Returns null for
 *  unknown ids. */
function resolveMoverOrSplitterTrack(track: Track, p: ProjectSnapshot): MoverOrSplitter | null {
  const def = getMoverOrSplitterDefinition(moverOrSplitterId(track))
  if (!def) return null
  const settings = mergeDefinitionSettings(def, track.inputValues)
  return def.resolve({ settings, notes: flattenTrackNotes(track, p) })
}

/** Collect an object track's mover and splitter children together, in exact
 *  childIds order. Muted entries are removed from the chain (a structural
 *  change - the copy count may drop); solo is a pool among the chain children. */
function resolveMoverAndSplitterChain(track: Track, p: ProjectSnapshot): MoverOrSplitter[] {
  const candidates = (track.childIds ?? [])
    .map((cid) => p.tracks[cid])
    .filter((c): c is Track => !!c && !!getMoverOrSplitterDefinition(moverOrSplitterId(c)))
  const anySolo = candidates.some((c) => c.solo)
  const chain: MoverOrSplitter[] = []
  for (const child of candidates) {
    if (child.muted || (anySolo && !child.solo)) continue
    const resolved = resolveMoverOrSplitterTrack(child, p)
    if (resolved) chain.push(resolved)
  }
  return chain
}

/** True when this mover/splitter resolves as a LOCAL chain entry of its parent
 *  instrument (see resolveMoverAndSplitterChain) - i.e. its parent is a valid
 *  instrument track. Everything else (root level, nested under a plain group
 *  track or another mover, or under an instrument the registry no longer knows)
 *  is a mover "without a parent instrument": it routes globally through its
 *  `targets`, appended to the end of each target object's chain. */
function isLocalChainChild(track: Track, p: ProjectSnapshot): boolean {
  const parent = track.parentId ? p.tracks[track.parentId] : undefined
  return !!parent && !!getInstrument(parent.instrumentId)
}

function globalTrackTargetsObject(track: Track, object: Track, p: ProjectSnapshot): boolean {
  return (track.targets ?? []).some(({ scope }) => {
    if (scope.kind === 'track') return scope.id === object.id
    if (scope.kind === 'tag') return (object.tags ?? []).includes(scope.tag)
    let current: Track | undefined = object
    while (current) {
      if (current.id === scope.id) return true
      current = current.parentId ? p.tracks[current.parentId] : undefined
    }
    return false
  })
}

/** Structural copy count immediately before one mover/splitter track. This is
 * editor metadata only: it evaluates the same enabled prefix as resolveProject,
 * so an index-aware definition can expose exactly the rows it can address. A
 * top-level entry may target objects with different prefix counts; one MIDI lane
 * must serve all of them, so its row set uses the largest target count. Global
 * entries (movers without a parent instrument) apply in depth-first tree order. */
export function getPriorVisualCopyCount(trackId: string, p: ProjectSnapshot): number {
  const target = p.tracks[trackId]
  if (!target) return 1

  // A local chain child counts the entries above it within its parent
  // instrument's chain; a global entry (no parent instrument) counts each
  // target's local chain plus every preceding global that hits it.
  if (isLocalChainChild(target, p)) {
    const parent = p.tracks[target.parentId!]
    if (!parent) return 1
    const candidates = (parent.childIds ?? [])
      .map((id) => p.tracks[id])
      .filter((child): child is Track => !!child && !!getMoverOrSplitterDefinition(moverOrSplitterId(child)))
    const anySolo = candidates.some((child) => child.solo)
    const prefix: MoverOrSplitter[] = []
    for (const child of candidates) {
      if (child.id === trackId) break
      if (child.muted || (anySolo && !child.solo)) continue
      const resolved = resolveMoverOrSplitterTrack(child, p)
      if (resolved) prefix.push(resolved)
    }
    return resolveVisualCopies(prefix, 0).length
  }

  const objects = Object.values(p.tracks).filter(
    (track) => !!track.instrumentId && !!getInstrument(track.instrumentId),
  )
  const targetObjects = objects.filter((object) => globalTrackTargetsObject(target, object, p))
  let largestCount = 1
  for (const object of targetObjects) {
    const prefix = resolveMoverAndSplitterChain(object, p)
    for (const globalId of flattenTree(p)) {
      if (globalId === trackId) break
      const global = p.tracks[globalId]
      if (
        !global || global.muted ||
        !getMoverOrSplitterDefinition(moverOrSplitterId(global)) ||
        isLocalChainChild(global, p) ||
        !globalTrackTargetsObject(global, object, p)
      ) continue
      const resolved = resolveMoverOrSplitterTrack(global, p)
      if (resolved) prefix.push(resolved)
    }
    largestCount = Math.max(largestCount, resolveVisualCopies(prefix, 0).length)
  }
  return largestCount
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
  // (muted). Child automation keeps its own mute, so soloing an object never
  // disables its automation. Ability-lane solo is
  // separate (per object, in resolveAbilityEvents).
  const isObjectTrack = (t: Track) => !!t.instrumentId
  const anyObjectSolo = Object.values(p.tracks).some((t) => t.solo && isObjectTrack(t))
  const objectOff = (track: Track) => !!track.muted || (anyObjectSolo && !track.solo)

  for (const id of flattenTree(p)) {
    const track = p.tracks[id]
    if (!track || !track.instrumentId) continue

    const tags = track.tags ?? []
    const def = getInstrument(track.instrumentId)
    if (!def) continue // unknown instrument (removed, or a legacy modulator) renders nothing
    const params = track.params ?? {}
    const notes = flattenTrackNotes(track, p)
    const moverAndSplitterChain = resolveMoverAndSplitterChain(track, p)
    objects.push({
      trackId: id,
      instrumentId: track.instrumentId,
      parentId: track.parentId,
      muted: objectOff(track),
      params,
      stringParams: track.stringParams ?? {},
      localTransform: def?.localTransform,
      notes,
      abilityEvents: resolveAbilityEvents(track, p),
      automations: resolveAutomations(track, def, p),
      effectAutomations: resolveEffectAutomations(track, p),
      envelopes: resolveEnvelopes(track, def, p),
      moverAndSplitterChain,
      // Fresh array per resolve: the gate ref-compares it, so a clip-bank edit
      // (which lands via resolve) is always visible to it.
      videoPads: track.videoPads ? [...track.videoPads] : undefined,
      // Same contract for the Photo instrument's bank.
      photoPads: track.photoPads ? [...track.photoPads] : undefined,
      scratchBase: identitySV(),
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

  // Movers and splitters WITHOUT a parent instrument are global: they target
  // existing objects by track/tag/subtree and append to moverAndSplitterChain -
  // after every object's local children, in depth-first tree order (roots first,
  // so root-level entries keep their historical rootTrackIds order). Duplicate
  // routes from one entry to the same target object are deduplicated. Muted
  // entries are skipped; entries with no targets affect nothing.
  for (const trackId of flattenTree(p)) {
    const track = p.tracks[trackId]
    if (!track || track.muted || !getMoverOrSplitterDefinition(moverOrSplitterId(track))) continue
    if (isLocalChainChild(track, p)) continue
    const resolved = resolveMoverOrSplitterTrack(track, p)
    if (!resolved) continue
    const seenTargets = new Set<string>()
    for (const routing of track.targets ?? []) {
      for (const targetObjectId of objectsForScope(routing.scope)) {
        if (seenTargets.has(targetObjectId)) continue
        seenTargets.add(targetObjectId)
        objectById.get(targetObjectId)?.moverAndSplitterChain.push(resolved)
      }
    }
  }

  return { objects, tagIndex }
}
