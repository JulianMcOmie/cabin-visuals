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
import { automationAmount, automationLaneValueBounds, extractBurstGates, extractKeyframes, extractNoiseGates, sampleAutomationLane } from './automation'
import { isNumberParam, type ObjectInstrumentDef, type ParamDef } from '../../instruments/types'
import { withTransformParams } from '../transform'
import { getMoverOrSplitterDefinition } from '../visualCopies/registry'
import { mergeDefinitionSettings } from '../visualCopies/definitions'
import { framedMoverOrSplitter } from '../visualCopies/moverFrame'
import type { MoverOrSplitter } from '../visualCopies/types'
import { structuralCopyCount } from '../visualCopies/resolveVisualCopies'
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

/** Gather a track's `automation` child tracks into resolved keyframe lanes over
 *  the given params (an instrument def's for object tracks, a MoverOrSplitter
 *  def's for mover/splitter tracks, a director def's for director tracks -
 *  the latter resolved per frame by VisualEngine's resolveComposition, since
 *  director tracks never enter the resolved graph). Each lane maps one param
 *  (its note pitch → the param's [min,max]); the engine samples them per frame.
 *  Children with no target param or an unknown param are skipped. Muted
 *  automation children are ignored (a quick disable); solo pools per parent. */
export function resolveAutomationLanes(track: Track, params: ParamDef[], p: ProjectSnapshot): ResolvedAutomation[] {
  const out: ResolvedAutomation[] = []
  // Per-parent solo pool among this track's automation children.
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
    const pdef = params.find((pd) => pd.key === param)
    if (!pdef || !isNumberParam(pdef)) continue
    // The lane's output gain, applied at extraction so every consumer of the
    // resolved lane (engine, hover preview, paramAtBeat) agrees on the values.
    const amount = automationAmount(child)
    // Burst mode: the notes become ADSR bursts aimed at their own pitch-value,
    // travelling from whatever value sits underneath (hence `base`).
    if (child.burst) {
      out.push({
        param,
        mode: 'linear',
        keyframes: [],
        burst: child.burst,
        bursts: extractBurstGates(child.blocks, p.beatsPerBar, pdef.min, pdef.max, p.totalBars, amount),
        min: pdef.min,
        max: pdef.max,
        base: pdef.default,
      })
      continue
    }
    // Noise mode: the notes become wobble gates instead of keyframes. Amount
    // scales the wobble's deviation along with its centers - a tamed lane
    // shrinks as a whole, not just where its notes sit.
    if (child.noise) {
      out.push({
        param,
        mode: 'linear',
        keyframes: [],
        noise: amount === 1 ? child.noise : { ...child.noise, range: child.noise.range * amount },
        gates: extractNoiseGates(child.blocks, p.beatsPerBar, pdef.min, pdef.max, p.totalBars, amount),
        min: pdef.min,
        max: pdef.max,
      })
      continue
    }
    out.push({
      param,
      mode: child.interpolation ?? 'linear',
      keyframes: extractKeyframes(child.blocks, p.beatsPerBar, pdef.min, pdef.max, p.totalBars, amount),
    })
  }
  return out
}

/** Gather an object track's `automation` child tracks into resolved keyframe lanes.
 *  The canonical transform params (core/transform.ts) are automatable on every
 *  object track, exactly like the instrument's own params. */
function resolveAutomations(track: Track, def: ObjectInstrumentDef | undefined, p: ProjectSnapshot): ResolvedAutomation[] {
  return def ? resolveAutomationLanes(track, withTransformParams(def.params), p) : []
}

/** Sample one beat of every automation lane into a settings/params overlay.
 *  Mirrors computeAtBeat's merge: an inert lane (noise/burst between its gates)
 *  contributes nothing, so `settings` shows through; keyframe lanes hold their
 *  endpoints outside the range. `settings` is what bursts travel away from. */
function sampleAutomationLanes(
  lanes: ResolvedAutomation[],
  beat: number,
  settings: Record<string, string | number>,
): Record<string, number> {
  const values: Record<string, number> = {}
  for (const lane of lanes) {
    // Only numeric params get lanes, so a string-valued setting can never be the
    // base here - fall back to the param's default if one somehow collides.
    const underneath = settings[lane.param]
    const v = sampleAutomationLane(lane, beat, typeof underneath === 'number' ? underneath : lane.base ?? 0)
    if (!Number.isNaN(v)) values[lane.param] = v
  }
  return values
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
    let base = instance.settings[target.key] ?? 0
    if (target.key !== 'enabled') {
      const pdef = getEffect(instance.pluginId)?.params.find((pd) => pd.key === target.key)
      if (!pdef || !isNumberParam(pdef)) continue
      min = pdef.min
      max = pdef.max
      base = instance.settings[target.key] ?? pdef.default
    }
    // The lane's output gain. 'enabled' is exempt: it is a 0/1 switch read
    // against a 0.5 threshold, and a gain there would just be a surprise
    // off-switch.
    const amount = target.key === 'enabled' ? 1 : automationAmount(child)
    // Burst mode: each note fires the ADSR from the stored setting toward its own
    // pitch-value. The 0/1 'enabled' pseudo-param has no range to travel through,
    // so it stays a keyframe lane whatever the track says.
    if (child.burst && target.key !== 'enabled') {
      out.push({
        instanceId: target.instanceId,
        key: target.key,
        mode: 'linear',
        keyframes: [],
        burst: child.burst,
        bursts: extractBurstGates(child.blocks, p.beatsPerBar, min, max, p.totalBars, amount),
        min,
        max,
        base,
      })
      continue
    }
    out.push({
      instanceId: target.instanceId,
      key: target.key,
      mode: child.interpolation ?? 'linear',
      keyframes: extractKeyframes(child.blocks, p.beatsPerBar, min, max, p.totalBars, amount),
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
    const pdef = def ? withTransformParams(def.params).find((pd) => pd.key === target) : undefined
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
 *  definition's param defaults with the track's stored inputValues (numeric)
 *  and stringParams (color/string),
 *  flatten its notes, and let the definition close over both. Returns null for
 *  unknown ids. Automation children overlay their params per beat: the resolved
 *  closure re-resolves with the beat-sampled settings, memoized per beat. The
 *  memo is a cache, not playback state - re-resolving at a repeated beat yields
 *  the identical closure, so scrub == playback == export still holds. */
function resolveMoverOrSplitterTrack(track: Track, p: ProjectSnapshot): MoverOrSplitter | null {
  const def = getMoverOrSplitterDefinition(moverOrSplitterId(track))
  if (!def) return null
  const settings = mergeDefinitionSettings(def, track.inputValues, track.stringParams)
  const notes = flattenTrackNotes(track, p)
  const resolved = def.resolve({ settings, notes })
  const automation = resolveAutomationLanes(track, def.params, p)
  // This track's own mover/splitter children are not chain entries of the object:
  // they are this entry's FRAME, and they move it (visualCopies/moverFrame.ts).
  // Collected by the same function as an object's chain, so frames nest.
  const frame = resolveMoverAndSplitterChain(track, p)
  if (automation.length === 0) return framedMoverOrSplitter(resolved, frame)
  let cachedBeat = Number.NaN
  let cached = resolved
  const wrapped: MoverOrSplitter = {
    apply(visualCopy, context) {
      if (context.beat !== cachedBeat) {
        cachedBeat = context.beat
        cached = def.resolve({ settings: { ...settings, ...sampleAutomationLanes(automation, context.beat, settings) }, notes })
      }
      return cached.apply(visualCopy, context)
    },
  }
  // A time remap is deliberately taken from the UN-automated resolution: it is
  // asked for the REAL beat (while apply is asked for the warped one), so
  // routing it through the memo above would thrash the cache every frame. The
  // only thing this loses is automating a remap's own params, which for Freeze
  // means automating a two-value "on release" switch.
  if (resolved.warpBeat) wrapped.warpBeat = (beat) => resolved.warpBeat!(beat)
  const entry = framedMoverOrSplitter(wrapped, frame)
  // Automation makes the per-beat settings - and so possibly the COPY COUNT -
  // vary with the beat, which a single-beat structural probe cannot see. Hand
  // the probe the definition resolved at every lane's maximum reach (and
  // minimum, for a count that shrinks as a param grows) so the mounted pool is
  // sized to everything the lanes can reach (structuralCopyCount in
  // visualCopies/resolveVisualCopies.ts). Probe-only closures: frames don't
  // change counts, so they skip the framing wrapper.
  const maxOverlay: Record<string, number> = {}
  const minOverlay: Record<string, number> = {}
  for (const lane of automation) {
    const underneath = settings[lane.param]
    const bounds = automationLaneValueBounds(lane, typeof underneath === 'number' ? underneath : lane.base ?? 0)
    maxOverlay[lane.param] = bounds.max
    minOverlay[lane.param] = bounds.min
  }
  entry.structuralVariants = [
    def.resolve({ settings: { ...settings, ...maxOverlay }, notes }),
    def.resolve({ settings: { ...settings, ...minOverlay }, notes }),
  ]
  return entry
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

/** True when this mover/splitter belongs to a parent's chain rather than routing
 *  itself: either a LOCAL entry of its parent instrument's chain, or a FRAME
 *  entry of a parent mover/splitter, which moves that parent
 *  (visualCopies/moverFrame.ts). Both are collected by
 *  resolveMoverAndSplitterChain from the parent's childIds, so the same prefix
 *  logic counts either one. Everything else (root level, nested under a plain
 *  group track, or under an instrument the registry no longer knows) is a mover
 *  "without a parent": it routes globally through its `targets`, appended to the
 *  end of each target object's chain. */
function isChainChild(track: Track, p: ProjectSnapshot): boolean {
  const parent = track.parentId ? p.tracks[track.parentId] : undefined
  if (!parent) return false
  return !!getInstrument(parent.instrumentId)
    || !!getMoverOrSplitterDefinition(moverOrSplitterId(parent))
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

  // A chain child counts the entries above it within its parent's chain -
  // an instrument's local chain, or a parent mover's frame chain; a global entry
  // counts each target's local chain plus every preceding global that hits it.
  if (isChainChild(target, p)) {
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
    // Structural, not single-beat: an automated entry above this one may breathe
    // its count with the beat, and the MIDI rows must address the mounted pool.
    return structuralCopyCount(prefix)
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
        isChainChild(global, p) ||
        !globalTrackTargetsObject(global, object, p)
      ) continue
      const resolved = resolveMoverOrSplitterTrack(global, p)
      if (resolved) prefix.push(resolved)
    }
    largestCount = Math.max(largestCount, structuralCopyCount(prefix))
  }
  return largestCount
}

// ── Per-track resolve reuse ──────────────────────────────────────────────────
// resolveProject runs debounced after every edit burst, and in a large project
// the note flattening (loop tiling) and chain-closure building dominate - a
// one-note edit re-resolving 30 dense tracks costs tens of ms right when the
// gesture ends. The store updates immutably with per-track reference
// preservation, so an object's resolution can be reused by identity: the cache
// is keyed WEAKLY on the object track's own reference (an edit to the track
// replaces the ref, and the old entry is GC'd with it) and validated against
// everything else its resolvers read - the subtree refs (child lanes at any
// depth, including mover frames) and the tempo fields. Cached entries are never
// emitted directly: each resolve emits a shallow copy with its own chain array
// (global movers append per resolve), solo-derived mute, and scratchBase.
// The shared inner closures are stateful-but-pure (per-beat memos), same as
// one instance serving several target objects within a single resolve.
const objectResolveCache = new WeakMap<Track, { deps: unknown[]; entry: ResolvedObject }>()
const globalMoverResolveCache = new WeakMap<Track, { deps: unknown[]; resolved: MoverOrSplitter | null }>()

/** Everything a track's resolvers read, as an identity-comparable list: the
 *  track itself, its whole subtree (DFS), and the tempo fields. */
function resolveDeps(track: Track, p: ProjectSnapshot): unknown[] {
  const deps: unknown[] = [p.beatsPerBar, p.totalBars]
  const seen = new Set<string>()
  const visit = (t: Track) => {
    if (seen.has(t.id)) return
    seen.add(t.id)
    deps.push(t)
    for (const cid of t.childIds ?? []) {
      const c = p.tracks[cid]
      if (c) visit(c)
    }
  }
  visit(track)
  return deps
}

function depsEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Flatten the project into resolved objects (with their mover chains) plus the tag
 * index. Objects resolve first so tag-scoped top-level movers can expand to the
 * objects carrying that tag.
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

    const deps = resolveDeps(track, p)
    const cached = objectResolveCache.get(track)
    let base: ResolvedObject
    if (cached && depsEqual(cached.deps, deps)) {
      base = cached.entry
    } else {
      base = {
        trackId: id,
        instrumentId: track.instrumentId,
        parentId: track.parentId,
        muted: false, // per-resolve (solo pool) - set on the emitted copy below
        params: track.params ?? {},
        stringParams: track.stringParams ?? {},
        localTransform: def?.localTransform,
        notes: flattenTrackNotes(track, p),
        abilityEvents: resolveAbilityEvents(track, p),
        automations: resolveAutomations(track, def, p),
        effectAutomations: resolveEffectAutomations(track, p),
        envelopes: resolveEnvelopes(track, def, p),
        moverAndSplitterChain: resolveMoverAndSplitterChain(track, p),
        // Fresh array whenever the track changed: the gate ref-compares it, so
        // a pad-bank edit (which lands via resolve) is always visible to it.
        videoPads: track.videoPads ? [...track.videoPads] : undefined,
        // Same contract for the Photo instrument's bank.
        photoPads: track.photoPads ? [...track.photoPads] : undefined,
        scratchBase: identitySV(),
        tags,
      }
      objectResolveCache.set(track, { deps, entry: base })
    }
    objects.push({
      ...base,
      muted: objectOff(track),
      // Own array per resolve: the global-mover pass below appends into it.
      moverAndSplitterChain: [...base.moverAndSplitterChain],
      scratchBase: identitySV(),
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
    if (isChainChild(track, p)) continue
    // Same identity-keyed reuse as objects: a global entry re-resolves only
    // when its own subtree (settings, notes, automation, frame) changed.
    const deps = resolveDeps(track, p)
    const cached = globalMoverResolveCache.get(track)
    let resolved: MoverOrSplitter | null
    if (cached && depsEqual(cached.deps, deps)) {
      resolved = cached.resolved
    } else {
      resolved = resolveMoverOrSplitterTrack(track, p)
      globalMoverResolveCache.set(track, { deps, resolved })
    }
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
