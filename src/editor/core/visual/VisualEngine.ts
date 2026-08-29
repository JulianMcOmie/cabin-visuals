import { Color, Matrix4, type Scene as ThreeScene } from 'three'
import { mixOklabLinearRgb, rotateHueOklabLinearRgb } from '../../utils/oklch'
import { sceneTrackView } from '../sceneTrack'
import { resolveAutomationLanes, resolveProject, type ProjectSnapshot } from './resolve'
import { evaluatePulse } from './energy'
import { sampleAutomationLane } from './automation'
import { DEFAULT_ADSR, evaluateAdsrGain } from './adsr'
import { composeMatrix, identitySV, localTransformToSV } from './stateVector'
import { isIdentityTransform, readTrackTransform, trackOpacity } from '../transform'
import { identityVisualCopy } from '../visualCopies/identityVisualCopy'
import { chainEmitsCopyClocks, copyClockShift, resolveVisualCopies, structuralCopyCount, warpChainBeat, type CopyClocks } from '../visualCopies/resolveVisualCopies'
import type { VisualCopy } from '../visualCopies/types'
import type { ResolvedGraph, ResolvedGroup, ObjectState, ResolvedEnvelope, ResolvedNote } from './types'
import { MIN_SOUNDING_BEATS, soundingNoteWindow } from './noteWindow'
import type { ProjectState } from '../../store/ProjectStore'
import { DEFAULT_SCENE_BACKGROUND, type Scene, type SceneGradient, type Track } from '../../types'
import { compositionAutomatableParams, compositionDef, isCompositionTrack, type CompositionLayer } from '../directors'
import { clamp } from '../../utils/math'

// The engine is a plain module singleton, NOT a zustand/React store: per-frame
// state must never trigger React re-renders. Renderers read it imperatively from
// useFrame. The only React-visible signal is the object LIST (see below).

let graphs = new Map<string, ResolvedGraph>()
/** What each scene's graph was resolved FROM, for the reuse test in setProject. */
type GraphInputs = Parameters<typeof resolveProject>[0]
let graphInputs = new Map<string, GraphInputs>()
interface VisualProject {
  scenes: Record<string, Scene>
  sceneOrder: string[]
  activeSceneId: string
  bpm: number
  beatsPerBar: number
  totalBars: number
}
let project: VisualProject | null = null
let compositionLayers: CompositionLayer[] = []
let activeTrackIds = new Set<string>()
let mainCompositionOverride = false
let mainPreviewEnabled = false
let editorPreviewSceneId: string | null = null
let mountedRenderScenes = new Map<string, ThreeScene>()
// Project bpm, mirrored on every setProject/syncParams - computeAtBeat derives
// secPerBeat from it so instruments can convert beat-ages to seconds.
let bpm = 120
// One ObjectState per object, REUSED across frames: computeAtBeat overwrites
// every field in place rather than minting a fresh object per object per
// frame. Every consumer pulls it fresh each frame (getObjectState in useFrame)
// and none compares state objects by identity, so the reuse is invisible -
// and it keeps ~25-field allocations off the per-frame heap. The same goes
// for `activeNotes`: a per-object scratch array refilled each frame.
const states = new Map<string, ObjectState>()
const activeNoteScratch = new Map<string, ResolvedNote[]>()
// World transforms, reused across frames (one Matrix4 per object). Also the source
// of each object's parent transform during composition.
const worldMatrices = new Map<string, Matrix4>()
// Cumulative GROUP tfOpacity down each ancestor chain (opacity has no place in
// a matrix). Groups multiply their own trackOpacity in; objects pass their
// parent's value through unchanged - an object's own tfOpacity deliberately
// does NOT cascade to its children, which is today's nested-track behavior.
const inheritedOpacities = new Map<string, number>()
const _local = new Matrix4()
// Scratch for the canonical track transform (core/transform.ts): composed as the
// PARENT of the instrument's own localTransform, so panel position/rotation/size
// inherit to child tracks and scale mover layouts (group-fader semantics).
const _tfMat = new Matrix4()
const _tfSV = identitySV()

// Per-track VisualCopy cache - deliberately SEPARATE from ObjectState. The
// STRUCTURAL copy count is fixed once per resolve at the chain's MAXIMUM reach
// (definitions contract: count never depends on beat - MIDI gates opacity, not
// slots - and automated settings probe at their lanes' extremes, so a count
// that breathes with automation stays inside the pool); the copy VALUES
// (matrices/opacity/color shift) refresh imperatively per frame in
// computeAtBeat, so React never reconciles during playback.
const visualCopiesByTrack = new Map<string, VisualCopy[]>()
const visualCopyCounts = new Map<string, number>()
const copyCountWarned = new Set<string>()
// ── Per-copy object states (time emitters) ──────────────────────────────────
// A chain carrying a Stagger gives each copy its OWN CLOCK, and "the copy at
// its clock" has to mean the WHOLE object, not just its chain: params, energy,
// active notes, envelopes, the instrument's own local animation. For tracks
// whose chain declares the time channel (`emitsCopyClocks` - structural, fixed
// per resolve), computeAtBeat builds one extra ObjectState per shifted copy,
// each a re-run of the same per-object assembly at `objBeat - offset`. Slots
// whose offset is 0 stay null and fall through to the shared object state.
// Purity holds: a copy state is a pure function of (beat - offset), so
// pause/scrub/export agree exactly.
//
// CHILD POSITION routes each lane's clock (the same rule the chain follows -
// see resolve.ts's orderEmitterClocks): a lane ABOVE the emitter is pattern and
// samples at the copy's own clock, a lane AFTER it is a live overlay and
// samples the real timeline. The resolver stamps every lane with
// `clockSkipEmitters` (how many emitters it does not ride) and the kernel's
// per-copy offset checkpoints let this file subtract exactly those emitters
// back out (`copyClockShift`). The instrument itself - params base, energy,
// active notes, localTransform - is above everything and always rides the copy
// clock; the switcher gate (`blackedOut`) stays object-clocked.
let staggeredTracks = new Set<string>()
const copyStatesByTrack = new Map<string, (ObjectState | null)[]>()
const copyClocksScratch: CopyClocks = { beatOffsets: null, birthBeats: null, checkpoints: null }
const _copySV = identitySV()
// The hidden copies that pad a frame's output up to the structural pool size.
// VisualCopies are immutable by contract (visualCopies/types.ts), so ONE
// opacity-0 identity copy can stand in every padded slot of every track; the
// pool grows to the deepest padding ever asked for and is never rebuilt.
const hiddenCopyPool: VisualCopy[] = []
function hiddenCopy(index: number): VisualCopy {
  let copy = hiddenCopyPool[index]
  if (!copy) {
    copy = identityVisualCopy()
    copy.opacity = 0
    hiddenCopyPool[index] = copy
  }
  return copy
}

/** One structural render-list entry per VisualCopy occurrence. The renderer
 *  mounts one ObjectRenderer per entry; each pulls exactly its copy per frame.
 *  Entry count changes only on resolve (chain/config edits), NEVER from MIDI
 *  gates - hidden copies stay mounted at opacity zero. */
export interface ObjectListEntry {
  sceneId: string
  trackId: string
  instrumentId: string
  visualCopyIndex: number
  /** Crop tracks masking this object (see ResolvedObject.maskSourceIds).
   *  Structural: changes only on resolve, like everything else here. */
  maskSourceIds: readonly string[]
  /** True on a Crop entry that masks routed targets instead of its scene -
   *  VisualScene's scene-wide crop pass must skip it. */
  masksTargets: boolean
}

// External-store signal for the object list, so VisualScene reconciles the scene
// tree when objects appear/disappear (on resolve) - never per frame.
let objectList: ObjectListEntry[] = []
const listeners = new Set<() => void>()

function publishList() {
  objectList = [...graphs.entries()].flatMap(([sceneId, graph]) => graph.objects.flatMap((o) => {
    const count = Math.max(1, visualCopyCounts.get(o.trackId) ?? 1)
    return Array.from({ length: count }, (_, visualCopyIndex) => ({
      sceneId,
      trackId: o.trackId,
      instrumentId: o.instrumentId,
      visualCopyIndex,
      maskSourceIds: o.maskSourceIds,
      masksTargets: o.masksTargets,
    }))
  }))
  listeners.forEach((l) => l())
}

/** Re-derive the graph from the project (called debounced, off the edit path). */
function normalizeProject(p: ProjectState | ProjectSnapshot): VisualProject {
  if ('scenes' in p) return p
  const id = '__legacy_scene__'
  return {
    scenes: { [id]: { id, name: 'Scene 1', isMain: false, backgroundColor: DEFAULT_SCENE_BACKGROUND, backgroundTransparent: false, tracks: p.tracks, rootTrackIds: p.rootTrackIds } },
    sceneOrder: [id],
    activeSceneId: id,
    bpm: p.bpm,
    beatsPerBar: p.beatsPerBar,
    totalBars: p.totalBars ?? 32,
  }
}

export function setProject(input: ProjectState | ProjectSnapshot) {
  const p = normalizeProject(input)
  project = p
  // Dev-only cost trace: `performance.getEntriesByName('cabin:setProject')`
  // from the console shows what each debounced structural resolve cost.
  const tStart = process.env.NODE_ENV !== 'production' ? performance.now() : 0
  // Structural resolve is the expensive step, and the debounced subscription
  // funnels EVERY store change through here - including ones that touch no
  // scene content at all (selecting a scene, transport fields). A scene whose
  // inputs are identity-equal to last time keeps its previous graph: the store
  // updates immutably, so reference equality is a sound "unchanged" test.
  const prevGraphs = graphs
  const prevInputs = graphInputs
  const nextInputs = new Map<string, GraphInputs>()
  let allReused = prevGraphs.size > 0
  graphs = new Map()
  for (const sceneId of p.sceneOrder) {
    const scene = p.scenes[sceneId]
    // Main holds composition tracks (base tracks whose instrumentId names a
    // composition def). They resolve per-frame in resolveComposition, never as
    // scene objects - this skip is the load-bearing gate that keeps them out
    // of the object graphs.
    if (!scene || scene.isMain) continue
    // The scene instrument is virtual, so the resolver only meets it if we
    // splice it in here (core/sceneTrack.ts). `sceneTrackView` memoizes on the
    // Scene's identity, which is what keeps the reference test below - and with
    // it the whole-graph reuse - working exactly as before.
    const view = sceneTrackView(scene)
    const inputs: GraphInputs = {
      tracks: view.tracks,
      rootTrackIds: view.rootTrackIds,
      bpm: p.bpm,
      beatsPerBar: p.beatsPerBar,
      totalBars: p.totalBars,
    }
    const prev = prevInputs.get(sceneId)
    const reusable = !!prev
      && prev.tracks === inputs.tracks
      && prev.rootTrackIds === inputs.rootTrackIds
      && prev.bpm === inputs.bpm
      && prev.beatsPerBar === inputs.beatsPerBar
      && prev.totalBars === inputs.totalBars
      && prevGraphs.has(sceneId)
    if (!reusable) allReused = false
    graphs.set(sceneId, reusable ? prevGraphs.get(sceneId)! : resolveProject(inputs))
    nextInputs.set(sceneId, inputs)
  }
  graphInputs = nextInputs
  bpm = p.bpm
  if (process.env.NODE_ENV !== 'production') {
    performance.measure('cabin:setProject', { start: tStart, end: performance.now() })
  }
  // Every graph survived untouched (and no scene fell away): the object list,
  // per-object caches and copy counts are all still valid - skip the sweep
  // and, crucially, the re-publish that would re-render the scene tree.
  if (allReused && graphs.size === prevGraphs.size) return
  // Drop per-object caches for tracks that no longer resolve to an object.
  const live = new Set([...graphs.values()].flatMap((graph) => [
    ...graph.objects.map((o) => o.trackId),
    // Groups own a world matrix + inherited opacity too, so they count as live.
    ...(graph.groups ?? []).map((g) => g.trackId),
  ]))
  for (const id of states.keys()) if (!live.has(id)) states.delete(id)
  for (const id of activeNoteScratch.keys()) if (!live.has(id)) activeNoteScratch.delete(id)
  for (const id of worldMatrices.keys()) if (!live.has(id)) worldMatrices.delete(id)
  for (const id of inheritedOpacities.keys()) if (!live.has(id)) inheritedOpacities.delete(id)
  for (const id of visualCopiesByTrack.keys()) if (!live.has(id)) visualCopiesByTrack.delete(id)
  for (const id of visualCopyCounts.keys()) if (!live.has(id)) visualCopyCounts.delete(id)
  copyCountWarned.clear()
  staggeredTracks = new Set()
  // Fix each track's STRUCTURAL copy count now. Counts are beat-independent by
  // contract, but automation can vary a chain entry's SETTINGS per beat, so the
  // probe (structuralCopyCount) also measures each entry at its lanes' maximum
  // reach - the pool is sized to everything the automation can ask for, and
  // frames where it asks for less are padded with hidden copies. The beat-0
  // values are real, so copies are readable before the first computeAtBeat.
  for (const graph of graphs.values()) for (const obj of graph.objects) {
    const copies = resolveVisualCopies(obj.moverAndSplitterChain, 0)
    const structuralCount = Math.max(copies.length, structuralCopyCount(obj.moverAndSplitterChain))
    while (copies.length < structuralCount) copies.push(hiddenCopy(copies.length))
    visualCopyCounts.set(obj.trackId, structuralCount)
    visualCopiesByTrack.set(obj.trackId, copies)
    if (chainEmitsCopyClocks(obj.moverAndSplitterChain)) staggeredTracks.add(obj.trackId)
  }
  // Per-copy states exist exactly for the staggered set - a stale entry for a
  // track whose chain lost its emitter would keep serving frozen clocks.
  for (const id of copyStatesByTrack.keys()) if (!staggeredTracks.has(id)) copyStatesByTrack.delete(id)
  publishList()
}

/**
 * Refresh just the base params on the already-resolved objects, in place. Called
 * synchronously on every edit (not debounced) so slider drags are reactive at
 * 60fps, while the expensive structural resolve stays debounced. Reads params from
 * the same source as resolve (`track.params`), so the engine remains the sole owner
 * of params - `computeAtBeat`/renderers are unchanged. Tracks not yet (or no longer)
 * in the graph are skipped; the debounced setProject reconciles structure shortly.
 */
export function syncParams(input: ProjectState | ProjectSnapshot) {
  const p = normalizeProject(input)
  project = p
  bpm = p.bpm
  for (const [sceneId, graph] of graphs) {
    // Group tf* knobs follow the same 60fps rule as instrument params: the
    // strip's sliders write params, and the frame after must see them.
    const scene = p.scenes[sceneId]
    for (const grp of graph.groups ?? []) {
      // Through the materialized view, so the scene instrument's own transform
      // strip is live at 60fps like every other group's - its params live on
      // the Scene, not in `tracks`.
      const track = scene && sceneTrackView(scene).tracks[grp.trackId]
      if (track) grp.params = track.params ?? {}
    }
  }
  for (const [sceneId, graph] of graphs) for (const obj of graph.objects) {
    const sceneTracks = p.scenes[sceneId]?.tracks ?? {}
    const track = sceneTracks[obj.trackId]
    if (track) {
      obj.params = track.params ?? {}
      obj.stringParams = track.stringParams ?? {}
    }
    // Envelope lanes: keep the slider-driven fields (ADSR/depth/target) live at
    // 60fps like instrument params; structure (notes, target kind) waits for resolve.
    for (const env of obj.envelopes) {
      const eTrack = sceneTracks[env.trackId]
      if (!eTrack) continue
      env.adsr = { ...DEFAULT_ADSR, ...eTrack.adsr }
      env.depth = clamp(eTrack.envDepth ?? 1, 0, 1)
      if (env.kind !== 'opacity') env.envTarget = clamp(eTrack.envTarget ?? env.max, env.min, env.max)
      if (env.kind === 'fx' && track) {
        const inst = track.effects?.find((e) => e.id === env.instanceId)
        if (inst && env.key !== undefined) env.fxBase = inst.settings[env.key] ?? env.fxBase
      }
    }
    // Style lanes are a document field; the store's immutable updates hand the
    // resolved object a fresh array identity on any edit, so a paused frame
    // repaints through the frame signature with no work here. (Lyric CLIPS are
    // notes now, so they arrive through the structural re-resolve like every
    // other note edit and need no fast-path sync.)
    if (obj.styleLanes !== sceneTracks[obj.trackId]?.styleLanes && sceneTracks[obj.trackId]) {
      obj.styleLanes = sceneTracks[obj.trackId].styleLanes
    }
  }
}

function clampOpacity(v: number): number {
  return clamp(v, 0, 1)
}

// Composition tracks resolve per frame (they never enter the graph), which used
// to mean re-gathering their automation lanes from the document every frame.
// The lanes are a function of the director track, its child lane tracks and
// the tempo fields, so they are cached on the track's reference and validated
// against those inputs by identity - the same invalidation resolve.ts's
// per-track cache uses: the store updates immutably, so a lane edit mints a new
// child track ref and a re-parent mints a new director ref. Cached lanes carry
// per-beat memos internally, exactly as the object path's cached lanes do.
type CompositionSnapshot = Parameters<typeof resolveAutomationLanes>[2]
interface CompositionLaneCache {
  deps: unknown[]
  lanes: ReturnType<typeof resolveAutomationLanes>
}
const compositionLaneCache = new WeakMap<Track, CompositionLaneCache>()

function compositionLanes(
  track: Track,
  def: NonNullable<ReturnType<typeof compositionDef>>,
  p: CompositionSnapshot,
): ReturnType<typeof resolveAutomationLanes> {
  const hit = compositionLaneCache.get(track)
  if (hit) {
    let valid = hit.deps.length === track.childIds.length + 3
      && hit.deps[0] === p.bpm && hit.deps[1] === p.beatsPerBar && hit.deps[2] === p.totalBars
    for (let i = 0; valid && i < track.childIds.length; i++) {
      if (hit.deps[i + 3] !== p.tracks[track.childIds[i]]) valid = false
    }
    if (valid) return hit.lanes
  }
  const lanes = resolveAutomationLanes(track, compositionAutomatableParams(def), p)
  const deps: unknown[] = [p.bpm, p.beatsPerBar, p.totalBars]
  for (const cid of track.childIds) deps.push(p.tracks[cid])
  compositionLaneCache.set(track, { deps, lanes })
  return lanes
}

function resolveComposition(beat: number): CompositionLayer[] {
  if (!project) return []
  const selected = mainCompositionOverride || mainPreviewEnabled
    ? project.sceneOrder.map((id) => project!.scenes[id]).find((scene) => scene?.isMain)
    : (editorPreviewSceneId ? project.scenes[editorPreviewSceneId] : undefined) ?? project.scenes[project.activeSceneId]
  if (selected && !selected.isMain) {
    return [{ directorTrackId: '__preview__', sceneId: selected.id, opacity: 1, viewport: { x: 0, y: 0, width: 1, height: 1 } }]
  }

  const main = project.sceneOrder.map((id) => project!.scenes[id]).find((scene) => scene?.isMain)
  const visualFallback = project.sceneOrder.find((id) => project!.scenes[id] && !project!.scenes[id].isMain)
  if (!main) return visualFallback
    ? [{ directorTrackId: '__implicit__', sceneId: visualFallback, opacity: 1, viewport: { x: 0, y: 0, width: 1, height: 1 } }]
    : []

  const directors = main.rootTrackIds
    .map((id) => main.tracks[id])
    .filter((track) => track && isCompositionTrack(track) && !track.muted)
  const anySolo = directors.some((track) => track.solo)
  // Automation lanes under a composition track keyframe its params (opacity +
  // the def's own) exactly like object-track lanes. Composition tracks never
  // enter the resolved graph (setProject skips Main), so their lanes are
  // gathered and sampled right here, per frame - a pure function of the beat
  // (like the note flattening the defs already do every frame), so
  // scrub == playback == export holds.
  const mainSnapshot = {
    tracks: main.tracks,
    rootTrackIds: main.rootTrackIds,
    beatsPerBar: project.beatsPerBar,
    bpm: project.bpm,
    totalBars: project.totalBars,
  }
  // Timeline rows are a visual stack: the first/topmost director renders last.
  // Resolve bottom-to-top, preserving each director's own internal layer order.
  const layers = directors.slice().reverse().flatMap((rawTrack) => {
    if (anySolo && !rawTrack.solo) return []
    const def = compositionDef(rawTrack.instrumentId)
    let track = rawTrack
    if (def && rawTrack.childIds.length) {
      const lanes = compositionLanes(rawTrack, def, mainSnapshot)
      if (lanes.length) {
        const params = { ...rawTrack.params }
        for (const lane of lanes) {
          // NaN = inert lane this frame (noise/burst between gates) - keep the
          // value underneath. Bursts travel from it, so lanes stack in order.
          const v = sampleAutomationLane(lane, beat, params[lane.param] ?? lane.base ?? 0)
          if (!Number.isNaN(v)) params[lane.param] = v
        }
        track = { ...rawTrack, params }
      }
    }
    const opacity = clampOpacity(track.params?.opacity ?? 1)
    return (def?.resolve(track, {
      beat,
      beatsPerBar: project!.beatsPerBar,
      totalBars: project!.totalBars,
      scenes: project!.scenes,
      sceneOrder: project!.sceneOrder,
    }) ?? []).map((layer) => ({ ...layer, opacity: clampOpacity(layer.opacity * opacity) }))
  })
  // A director is allowed to intentionally produce no layers (for example,
  // Cut when none of its hold-gated rows are active). Only projects with no
  // active director at all receive the implicit Scene 1 fallback.
  if (directors.length > 0 || !visualFallback) return layers
  return [{ directorTrackId: '__implicit__', sceneId: visualFallback, opacity: 1, viewport: { x: 0, y: 0, width: 1, height: 1 } }]
}

/** Per frame (runs first, from VisualBeatSync): compose each object's world
 *  transform down the hierarchy, then stash state for the renderer to pull.
 *  graph.objects is in parent-before-child order (resolve walks the tree DFS), so a
 *  parent's world is always ready when its children compose. */
export function computeAtBeat(beat: number) {
  const secPerBeat = 60 / bpm
  compositionLayers = resolveComposition(beat)
  // Backdrops before the objects: cheap (one chain per scene that has one, and
  // nothing at all otherwise), and VisualScene clears with the result before it
  // renders anything into the scene's target.
  computeSceneBackdrops(beat)
  computeSceneFxOverrides(beat)
  const activeSceneIds = new Set(compositionLayers.map((layer) => layer.sceneId))
  activeTrackIds = new Set()
  const activeGraphs = [...activeSceneIds].map((id) => graphs.get(id)).filter((graph): graph is ResolvedGraph => !!graph)
  for (const graph of activeGraphs) {
  // GROUP tracks are placement-only nodes: interleave them among the objects
  // at their DFS position (afterObjectIndex), so a group's world matrix and
  // cumulative opacity are always composed before any member reads them -
  // the same parent-before-child guarantee the objects array itself carries.
  const groupNodes = graph.groups ?? []
  let nextGroup = 0
  for (let objIndex = 0; objIndex <= graph.objects.length; objIndex++) {
    while (nextGroup < groupNodes.length && groupNodes[nextGroup].afterObjectIndex <= objIndex) {
      composeGroupPlacement(groupNodes[nextGroup++], beat)
    }
    if (objIndex === graph.objects.length) break
    const obj = graph.objects[objIndex]
    activeTrackIds.add(obj.trackId)
    // A chain entry may remap WHEN this object is evaluated (Freeze; see
    // MoverOrSplitter.warpBeat). Everything below reads objBeat rather than the
    // playhead beat, which is what makes a frozen object a true still frame
    // instead of a still frame of a thing that is still animating. The remap
    // itself is a pure function of the real beat, so scrub == playback ==
    // export holds. Objects with no remap get beat back, unchanged.
    const objBeat = warpChainBeat(obj.moverAndSplitterChain, beat)
    // Off this frame: muted/soloed-out (a resolve-time constant), or switched
    // off by a SWITCHER standing above it (a pure function of the beat, so the
    // pause invariant holds). Gating on objBeat rather than the playhead beat
    // matches the device arm, which gates on `context.beat` for the same
    // reason: it is the beat everything else about this object is read at.
    const switchedOff = obj.liveAt ? !obj.liveAt(objBeat) : false
    const off = obj.muted || switchedOff
    // The note-pulse signal (the old implicit `energy` port, now direct).
    const energy = !off && obj.notes.length > 0 ? evaluatePulse(obj.notes, objBeat) : 0
    // Automation drives params over time: overlay each lane's sampled value onto the
    // base params for this frame (a pure function of the beat, so scrub == playback).
    let params = obj.params
    if (obj.automations.length) {
      params = { ...obj.params }
      for (const auto of obj.automations) {
        // NaN = the lane is inert this frame (a noise/burst lane between its
        // gates, an empty lane) - leave the base value alone. Burst lanes travel
        // from whatever is already in `params`, so lanes stack in order.
        const v = sampleAutomationLane(auto, objBeat, params[auto.param] ?? auto.base ?? 0)
        if (!Number.isNaN(v)) params[auto.param] = v
      }
    }
    // Envelope lanes overlay next - documented merge order: base ← automation ←
    // envelope. Each lane's ADSR gain is closed-form from its gate notes (adsr.ts),
    // so this stays a pure function of the beat too. A lane with no notes is inert
    // (adding an envelope track never changes the picture until you play gates).
    //  - param target:   value = base + (envTarget - base) * gain * depth
    //  - opacity target: multiplier = mix(1, gain, depth) = 1 - depth + depth*gain,
    //    multiplied onto the object's rendered opacity below (depth 1 = fully
    //    note-gated, invisible between gates; depth 0 = no effect)
    //  - fx target: same lerp as params, written into effectOverrides further down
    let opacityGate = 1
    let fxEnvelopes: { env: ResolvedEnvelope; gain: number }[] | null = null
    for (const env of obj.envelopes) {
      if (env.notes.length === 0) continue
      const gain = evaluateAdsrGain(env.notes, objBeat, env.adsr)
      if (env.kind === 'opacity') {
        opacityGate *= 1 - env.depth + env.depth * gain
      } else if (env.kind === 'param' && env.param !== undefined) {
        if (params === obj.params) params = { ...obj.params }
        const base = params[env.param] ?? env.paramDefault ?? 0
        params[env.param] = base + (env.envTarget - base) * (gain * env.depth)
      } else if (env.kind === 'fx') {
        ;(fxEnvelopes ??= []).push({ env, gain })
      }
    }
    let world = worldMatrices.get(obj.trackId)
    if (!world) { world = new Matrix4(); worldMatrices.set(obj.trackId, world) }
    const parentWorld = obj.parentId ? worldMatrices.get(obj.parentId) : undefined
    const local = obj.localTransform ? obj.localTransform({ params, energy, beat: objBeat }) : {}
    localTransformToSV(local, obj.scratchBase)
    // The size scale is a MESH property, not a placement property: strip it from
    // the local matrix so the VisualCopy chain (movers) and child tracks compose
    // in unscaled placement space - mover distances and child placements no longer
    // shrink/grow with an instrument's size. Renderers multiply it back in AFTER
    // the copy transform (uniform scale commutes, so an un-moved, un-parented
    // object produces the exact same final matrix as before).
    const meshScale = Math.exp(obj.scratchBase.logScale)
    obj.scratchBase.logScale = 0
    composeMatrix(obj.scratchBase, _local)
    // Canonical track transform (panel/strip): parents the instrument's own
    // local transform. Unlike the instrument mesh scale stripped above, tfSize
    // stays IN the matrix - children and mover layouts inherit it.
    if (!isIdentityTransform(params)) {
      localTransformToSV(readTrackTransform(params), _tfSV)
      composeMatrix(_tfSV, _tfMat)
      _local.premultiply(_tfMat)
    }
    // Ancestor GROUP opacity cascades onto members (a matrix can't carry it);
    // an object passes its parent's value through unchanged - its own
    // tfOpacity stays local to it, as it always has for nested tracks.
    const inheritedOpacity = obj.parentId ? inheritedOpacities.get(obj.parentId) ?? 1 : 1
    inheritedOpacities.set(obj.trackId, inheritedOpacity)
    const opacity = clampOpacity(obj.scratchBase.opacity * opacityGate * trackOpacity(params) * inheritedOpacity)
    if (parentWorld) world.multiplyMatrices(parentWorld, _local)
    else world.copy(_local)

    // Effect automation lanes sample per frame into an override map the effect
    // wrappers merge over each instance's stored settings ('enabled' as 0/1).
    let effectOverrides: Record<string, Record<string, number>> | undefined
    if (obj.effectAutomations.length) {
      effectOverrides = {}
      for (const ea of obj.effectAutomations) {
        // Value first, slot second: an inert lane must not leave an empty
        // override map behind (effectiveEffectState would then copy settings
        // for nothing).
        const base = effectOverrides[ea.instanceId]?.[ea.key] ?? ea.base ?? 0
        const v = sampleAutomationLane(ea, objBeat, base)
        if (!Number.isNaN(v)) (effectOverrides[ea.instanceId] ??= {})[ea.key] = v
      }
    }
    // fx-targeted envelopes lerp on top of the sampled automation (or the stored
    // setting when no lane drives that key) - same merge order as params.
    if (fxEnvelopes) {
      effectOverrides ??= {}
      for (const { env, gain } of fxEnvelopes) {
        if (env.instanceId === undefined || env.key === undefined) continue
        const slot = (effectOverrides[env.instanceId] ??= {})
        const base = slot[env.key] ?? env.fxBase ?? 0
        slot[env.key] = base + (env.envTarget - base) * (gain * env.depth)
      }
    }

    // Muted, soloed-out, or switched off by a rack above it: all hidden the
    // same way. The object stays MOUNTED either way - a switcher gates
    // visibility, never structure, so the object list is unchanged and there is
    // nothing for the renderer to reconcile per beat.
    const blackedOut = off
    // Notes live at this beat - pitch-reactive instruments read them (a zero-length note
    // stays "on" for a hair so single-tick triggers still register). The stream is
    // sorted by onset, so only the bisected window of notes that can be sounding is
    // tested (noteWindow.ts), into a per-object scratch array reused every frame.
    let activeNotes = activeNoteScratch.get(obj.trackId)
    if (!activeNotes) { activeNotes = []; activeNoteScratch.set(obj.trackId, activeNotes) }
    activeNotes.length = 0
    {
      const notes = obj.notes
      const { start, end } = soundingNoteWindow(notes, objBeat)
      for (let i = start; i < end; i++) {
        const n = notes[i]
        if (objBeat >= n.beat && objBeat < n.beat + (n.durationBeats || MIN_SOUNDING_BEATS)) activeNotes.push(n)
      }
    }
    let state = states.get(obj.trackId)
    if (!state) {
      state = {
        beat: objBeat,
        secPerBeat,
        beatsPerBar: 4,
        params,
        energy,
        videoPads: obj.videoPads,
        photoPads: obj.photoPads,
        synthMods: obj.synthMods,
        world,
        meshScale,
        opacity,
        effectOverrides,
        blackedOut,
        stringParams: obj.stringParams,
        abilityEvents: obj.abilityEvents,
        lyricClips: obj.lyricClips,
        styleLanes: obj.styleLanes,
        notes: obj.notes,
        activeNotes,
        automations: obj.automations,
        baseParams: obj.params,
      }
      states.set(obj.trackId, state)
    }
    state.beat = objBeat
    state.secPerBeat = secPerBeat
    state.beatsPerBar = project?.beatsPerBar ?? 4
    state.params = params
    state.energy = energy
    state.videoPads = obj.videoPads
    state.photoPads = obj.photoPads
    state.synthMods = obj.synthMods
    state.world = world
    state.meshScale = meshScale
    state.opacity = opacity
    state.effectOverrides = effectOverrides
    state.blackedOut = blackedOut
    state.stringParams = obj.stringParams
    state.abilityEvents = obj.abilityEvents
    state.lyricClips = obj.lyricClips
    state.styleLanes = obj.styleLanes
    state.notes = obj.notes
    state.activeNotes = activeNotes
    // The object's own lanes, by reference (no per-frame allocation). Handed to
    // instruments so they can ask what a param was at some OTHER beat - see
    // paramAtBeat. `params` above is still the answer for "right now".
    state.automations = obj.automations
    state.baseParams = obj.params

    // Evaluate the new VisualCopy chain at this beat (pure function of beat +
    // resolved chain, so scrub == playback == export). The structural count was
    // fixed at resolve time as the chain's MAXIMUM reach (automated counts
    // legitimately breathe below it - the shortfall is padded with hidden
    // copies so the renderer's occurrence list never disagrees with React's).
    // OVERFLOWING the pool is still a contract violation - a definition varying
    // its count with the beat, or one non-monotonic in an automated param - so
    // warn and truncate rather than render copies that have no mount.
    const staggered = staggeredTracks.has(obj.trackId)
    const copies = resolveVisualCopies(
      obj.moverAndSplitterChain, objBeat, world, staggered ? copyClocksScratch : undefined,
    )
    const structuralCount = visualCopyCounts.get(obj.trackId) ?? copies.length
    if (copies.length > structuralCount) {
      if (!copyCountWarned.has(obj.trackId)) {
        copyCountWarned.add(obj.trackId)
        console.warn(
          `VisualCopy count for track ${obj.trackId} exceeded its structural pool (${copies.length} vs ${structuralCount}). ` +
            'Definitions must gate copies by opacity, not by adding slots per beat.',
        )
      }
      copies.length = structuralCount
    }
    while (copies.length < structuralCount) copies.push(hiddenCopy(copies.length))
    visualCopiesByTrack.set(obj.trackId, copies)
    if (staggered) {
      computeCopyStates(
        obj, objBeat, structuralCount, copyClocksScratch,
        secPerBeat, off, parentWorld, inheritedOpacity, blackedOut,
      )
    }
  }
  }
}

/** One staggered object's per-copy states: for every copy whose chain clock is
 *  shifted, the same per-object assembly computeAtBeat just ran - energy,
 *  automation/envelope overlays, effect lanes, active notes, the instrument's
 *  own localTransform - re-run at `objBeat - offset`. Offset-0 slots stay null
 *  and read through to the shared object state. See the block comment at
 *  `staggeredTracks` for what deliberately stays on the object clock. */
function computeCopyStates(
  obj: ResolvedGraph['objects'][number],
  objBeat: number,
  structuralCount: number,
  clocks: CopyClocks,
  secPerBeat: number,
  off: boolean,
  parentWorld: Matrix4 | undefined,
  inheritedOpacity: number,
  blackedOut: boolean,
) {
  let slots = copyStatesByTrack.get(obj.trackId)
  if (!slots) { slots = []; copyStatesByTrack.set(obj.trackId, slots) }
  slots.length = structuralCount
  for (let i = 0; i < structuralCount; i++) {
    // Padded hidden copies sit past the kernel's clock arrays and carry no
    // shift; offset-0 copies need no state of their own.
    const offset = clocks.beatOffsets?.[i] ?? 0
    if (offset === 0) { slots[i] = null; continue }
    const copyBeat = objBeat - offset
    // Each lane rides only the emitters below its own child position: the
    // resolver stamped `clockSkipEmitters` (emitters ABOVE the lane, skipped),
    // and the kernel's checkpoints carry each emitter's share of this copy's
    // offset. Skip 0 = the full copy clock (a pattern lane); skipping every
    // emitter = the object clock (a live lane after the emitter).
    const checkpoints = clocks.checkpoints?.[i] ?? null
    const laneBeatFor = (skip: number | undefined) =>
      objBeat - (skip ? copyClockShift(offset, checkpoints, skip) : offset)

    const energy = !off && obj.notes.length > 0 ? evaluatePulse(obj.notes, copyBeat) : 0
    let params = obj.params
    if (obj.automations.length) {
      params = { ...obj.params }
      for (const auto of obj.automations) {
        const v = sampleAutomationLane(auto, laneBeatFor(auto.clockSkipEmitters), params[auto.param] ?? auto.base ?? 0)
        if (!Number.isNaN(v)) params[auto.param] = v
      }
    }
    let opacityGate = 1
    let fxEnvelopes: { env: ResolvedEnvelope; gain: number }[] | null = null
    for (const env of obj.envelopes) {
      if (env.notes.length === 0) continue
      const gain = evaluateAdsrGain(env.notes, laneBeatFor(env.clockSkipEmitters), env.adsr)
      if (env.kind === 'opacity') {
        opacityGate *= 1 - env.depth + env.depth * gain
      } else if (env.kind === 'param' && env.param !== undefined) {
        if (params === obj.params) params = { ...obj.params }
        const base = params[env.param] ?? env.paramDefault ?? 0
        params[env.param] = base + (env.envTarget - base) * (gain * env.depth)
      } else if (env.kind === 'fx') {
        ;(fxEnvelopes ??= []).push({ env, gain })
      }
    }

    let state = slots[i]
    if (!state) {
      // A copy state OWNS its world matrix and active-note scratch (the shared
      // per-track ones belong to the object state); everything else is
      // overwritten in place per frame, exactly like the object path.
      state = {
        beat: copyBeat, secPerBeat, beatsPerBar: 4,
        params, energy,
        videoPads: obj.videoPads, photoPads: obj.photoPads, synthMods: obj.synthMods,
        world: new Matrix4(), meshScale: 1, opacity: 1,
        effectOverrides: undefined, blackedOut,
        stringParams: obj.stringParams, abilityEvents: obj.abilityEvents,
        lyricClips: obj.lyricClips, styleLanes: obj.styleLanes,
        notes: obj.notes, activeNotes: [],
        automations: obj.automations, baseParams: obj.params,
      }
      slots[i] = state
    }

    const local = obj.localTransform ? obj.localTransform({ params, energy, beat: copyBeat }) : {}
    localTransformToSV(local, _copySV)
    const meshScale = Math.exp(_copySV.logScale)
    _copySV.logScale = 0
    composeMatrix(_copySV, _local)
    if (!isIdentityTransform(params)) {
      localTransformToSV(readTrackTransform(params), _tfSV)
      composeMatrix(_tfSV, _tfMat)
      _local.premultiply(_tfMat)
    }
    if (parentWorld) state.world.multiplyMatrices(parentWorld, _local)
    else state.world.copy(_local)
    const opacity = clampOpacity(_copySV.opacity * opacityGate * trackOpacity(params) * inheritedOpacity)

    let effectOverrides: Record<string, Record<string, number>> | undefined
    if (obj.effectAutomations.length) {
      effectOverrides = {}
      for (const ea of obj.effectAutomations) {
        const base = effectOverrides[ea.instanceId]?.[ea.key] ?? ea.base ?? 0
        const v = sampleAutomationLane(ea, laneBeatFor(ea.clockSkipEmitters), base)
        if (!Number.isNaN(v)) (effectOverrides[ea.instanceId] ??= {})[ea.key] = v
      }
    }
    if (fxEnvelopes) {
      effectOverrides ??= {}
      for (const { env, gain } of fxEnvelopes) {
        if (env.instanceId === undefined || env.key === undefined) continue
        const slot = (effectOverrides[env.instanceId] ??= {})
        const base = slot[env.key] ?? env.fxBase ?? 0
        slot[env.key] = base + (env.envTarget - base) * (gain * env.depth)
      }
    }

    const activeNotes = state.activeNotes
    activeNotes.length = 0
    {
      const notes = obj.notes
      const { start, end } = soundingNoteWindow(notes, copyBeat)
      for (let k = start; k < end; k++) {
        const n = notes[k]
        if (copyBeat >= n.beat && copyBeat < n.beat + (n.durationBeats || MIN_SOUNDING_BEATS)) activeNotes.push(n)
      }
    }

    state.beat = copyBeat
    state.secPerBeat = secPerBeat
    state.beatsPerBar = project?.beatsPerBar ?? 4
    state.params = params
    state.energy = energy
    state.videoPads = obj.videoPads
    state.photoPads = obj.photoPads
    state.synthMods = obj.synthMods
    state.meshScale = meshScale
    state.opacity = opacity
    state.effectOverrides = effectOverrides
    state.blackedOut = blackedOut
    state.stringParams = obj.stringParams
    state.abilityEvents = obj.abilityEvents
    state.lyricClips = obj.lyricClips
    state.styleLanes = obj.styleLanes
    state.notes = obj.notes
    state.automations = obj.automations
    state.baseParams = obj.params
  }
}

/** Compose one group's placement for this frame: its canonical tf* params
 *  (overlaid by their automation lanes - a pure function of the beat) become a
 *  matrix parented on the group's own parent, published into worldMatrices for
 *  member subtrees to inherit; tfOpacity accumulates into inheritedOpacities.
 *  Groups never warp time - a broadcast Freeze warps each member object. */
function composeGroupPlacement(grp: ResolvedGroup, beat: number) {
  let params = grp.params
  if (grp.automations.length) {
    params = { ...grp.params }
    for (const auto of grp.automations) {
      const v = sampleAutomationLane(auto, beat, params[auto.param] ?? auto.base ?? 0)
      if (!Number.isNaN(v)) params[auto.param] = v
    }
  }
  let world = worldMatrices.get(grp.trackId)
  if (!world) { world = new Matrix4(); worldMatrices.set(grp.trackId, world) }
  if (isIdentityTransform(params)) {
    _local.identity()
  } else {
    localTransformToSV(readTrackTransform(params), _tfSV)
    composeMatrix(_tfSV, _local)
  }
  const parentWorld = grp.parentId ? worldMatrices.get(grp.parentId) : undefined
  if (parentWorld) world.multiplyMatrices(parentWorld, _local)
  else world.copy(_local)
  const parentOpacity = grp.parentId ? inheritedOpacities.get(grp.parentId) ?? 1 : 1
  inheritedOpacities.set(grp.trackId, parentOpacity * trackOpacity(params))
}

// ── Scene backdrops ──────────────────────────────────────────────────────────
// A colorizer on the scene instrument (core/sceneTrack.ts) paints the BACKDROP.
// The chain is resolved apart from every object chain (`graph.backdropChain`),
// evaluated here once per frame, and the result is what VisualScene clears and
// paints the gradient with - so background colour becomes automatable through
// exactly the machinery every other colorizer already has, and stays a pure
// function of the beat.

/** What a scene's backdrop actually renders as this frame - the document's own
 *  colours when nothing drives them, else those colours run through the scene
 *  instrument's colorizer chain. */
export interface SceneBackdrop {
  color: string
  gradient: SceneGradient | null
  transparent: boolean
}

const sceneBackdrops = new Map<string, SceneBackdrop>()
const _backdropColor = new Color()
const _backdropTint = new Color()

/** Both gradient stops travel through the SAME shift, so a hue sweep turns the
 *  whole backdrop rather than pulling its two ends apart. */
function shiftedGradient(gradient: SceneGradient, shift: VisualCopy['colorShift']): SceneGradient {
  return {
    ...gradient,
    from: shiftHex(gradient.from, shift),
    to: shiftHex(gradient.to, shift),
  }
}

function shiftHex(hex: string, shift: VisualCopy['colorShift']): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex
  _backdropColor.set(hex)
  const tintMix = shift.tint && /^#[0-9a-f]{6}$/i.test(shift.tint)
    ? clamp(shift.tintAmount, 0, 1)
    : 0
  if (tintMix > 0) {
    _backdropTint.set(shift.tint as string)
    if (shift.tintPerceptual) mixOklabLinearRgb(_backdropColor, _backdropTint, tintMix)
    else _backdropColor.lerp(_backdropTint, tintMix)
  }
  // Same order and the same two hue regimes as instrumentColor.ts, which is the
  // object-side twin of this function - a colorizer must not mean one thing on
  // a cube and another on the wall behind it.
  if (shift.huePerceptual) {
    rotateHueOklabLinearRgb(_backdropColor, shift.hue)
    _backdropColor.offsetHSL(0, shift.saturation, shift.lightness)
  } else {
    _backdropColor.offsetHSL(shift.hue, shift.saturation, shift.lightness)
  }
  return `#${_backdropColor.getHexString()}`
}

function computeSceneBackdrops(beat: number) {
  sceneBackdrops.clear()
  if (!project) return
  for (const [sceneId, graph] of graphs) {
    const scene = project.scenes[sceneId]
    if (!scene) continue
    const stored: SceneBackdrop = {
      color: scene.backgroundColor ?? DEFAULT_SCENE_BACKGROUND,
      gradient: scene.backgroundGradient?.enabled ? scene.backgroundGradient : null,
      transparent: scene.backgroundTransparent,
    }
    // No colorizers on the scene, or a transparent backdrop (there is no colour
    // to shift, and tinting alpha away would be a surprise): the stored values.
    if (!graph.backdropChain?.length || stored.transparent) {
      sceneBackdrops.set(sceneId, stored)
      continue
    }
    // The chain is evaluated exactly as an object's would be, then only copy 0
    // is read: a backdrop is one surface, so a SPLITTER on the scene has
    // nothing to multiply here (it still multiplies the objects, through the
    // ordinary member broadcast). Colorizers accumulate into copy 0's shift.
    const copies = resolveVisualCopies(graph.backdropChain, beat)
    const shift = copies[0]?.colorShift
    if (!shift) {
      sceneBackdrops.set(sceneId, stored)
      continue
    }
    sceneBackdrops.set(sceneId, {
      color: shiftHex(stored.color, shift),
      gradient: stored.gradient ? shiftedGradient(stored.gradient, shift) : null,
      transparent: false,
    })
  }
}

/** The renderer's pull for one scene's backdrop this frame. Falls back to the
 *  document when the engine has not resolved that scene (Main, or before the
 *  first computeAtBeat), so callers never need a branch. */
export function getSceneBackdrop(sceneId: string): SceneBackdrop | undefined {
  return sceneBackdrops.get(sceneId)
}

// ── Scene effect-chain automation ────────────────────────────────────────────
// The scene instrument's `fx:<instanceId>:<key>` lanes (graph.sceneFxAutomations)
// drive the scene EFFECT chain, which lives on the Scene rather than on any
// object - so their per-frame samples land in a per-scene override map instead
// of an ObjectState. VisualScene merges them over each instance's stored
// settings with the same effectiveEffectState the object wrappers use. Sampled
// at the playhead beat: the scene chain has no warpBeat of its own.

const sceneFxOverrides = new Map<string, Record<string, Record<string, number>>>()

function computeSceneFxOverrides(beat: number) {
  sceneFxOverrides.clear()
  for (const [sceneId, graph] of graphs) {
    const lanes = graph.sceneFxAutomations
    if (!lanes?.length) continue
    const overrides: Record<string, Record<string, number>> = {}
    for (const ea of lanes) {
      // Value first, slot second - an inert lane must not leave an empty
      // override map behind (same rule as the object path above).
      const base = overrides[ea.instanceId]?.[ea.key] ?? ea.base ?? 0
      const v = sampleAutomationLane(ea, beat, base)
      if (!Number.isNaN(v)) (overrides[ea.instanceId] ??= {})[ea.key] = v
    }
    if (Object.keys(overrides).length) sceneFxOverrides.set(sceneId, overrides)
  }
}

/** Per-frame sampled fx-lane values for one scene's effect chain
 *  (instanceId → key → value), or undefined when nothing drives it. */
export function getSceneFxOverrides(sceneId: string): Record<string, Record<string, number>> | undefined {
  return sceneFxOverrides.get(sceneId)
}

// Preview objects (instrument-browser hover popups): synthetic states
// registered by a preview canvas's driver, resolved through the same
// getObjectState pull instruments already use - so an instrument component
// mounts unchanged in a popup <Canvas> under a reserved preview trackId.
// Keyed and consulted FIRST so a preview can never collide with (or be
// shadowed by) a real track id.
const previewStates = new Map<string, ObjectState>()

export function setPreviewObjectState(trackId: string, state: ObjectState | null): void {
  if (state) previewStates.set(trackId, state)
  else previewStates.delete(trackId)
}

/** Pull API for the renderer. Pass the occurrence's `visualCopyIndex` to read
 *  a STAGGERED copy's own state - the whole object evaluated on that copy's
 *  clock (see `staggeredTracks`). Unshifted copies, unstaggered tracks and
 *  index-less callers all read the shared object state, exactly as before. */
export function getObjectState(trackId: string, visualCopyIndex?: number): ObjectState | undefined {
  const preview = previewStates.get(trackId)
  if (preview) return preview
  if (!activeTrackIds.has(trackId)) return undefined
  if (visualCopyIndex !== undefined) {
    const copyState = copyStatesByTrack.get(trackId)?.[visualCopyIndex]
    if (copyState) return copyState
  }
  return states.get(trackId)
}

/** True when this track's chain carries a time emitter (structural, fixed per
 *  resolve): its copies run on their own clocks, so per-copy renderers must
 *  read `getObjectState(trackId, index)` and the instanced fast path must
 *  stand down (one shared state cannot draw N differently-parameterized
 *  copies). */
export function isTrackStaggered(trackId: string): boolean {
  return staggeredTracks.has(trackId)
}

/** Ordered final-frame layers. Multiple director tracks already concatenate here;
 * the first UI only exposes Scene Switcher, but the engine has no singular-director path. */
export function getCompositionLayers(): CompositionLayer[] {
  return compositionLayers
}

export function setMainCompositionOverride(value: boolean) {
  mainCompositionOverride = value
}

/** Editor-only viewing preference. Kept separate from the export override so
 * finishing an export restores whichever preview mode the user selected. */
export function setMainPreviewEnabled(value: boolean) {
  mainPreviewEnabled = value
}

/** Editor-only explicit scene target. Null follows the scene currently being
 * edited; a concrete id previews that scene without changing editor selection. */
export function setEditorPreviewSceneId(sceneId: string | null) {
  editorPreviewSceneId = sceneId
}

/** Dev invariant plumbing: logical scenes live outside R3F's default root scene,
 * so the pause canary needs the actual portal targets rather than rootState.scene. */
export function setMountedRenderScenes(scenes: Map<string, ThreeScene>) {
  mountedRenderScenes = scenes
}

export function getMountedRenderScenes(): Map<string, ThreeScene> {
  return mountedRenderScenes
}

// ── VisualCopy pull API (separate cache, never part of ObjectState) ──

/** All of a track's copies at the last computed beat ([] for unknown tracks). */
export function getVisualCopies(trackId: string): VisualCopy[] {
  return visualCopiesByTrack.get(trackId) ?? []
}

/** The brightest copy's opacity (1 for unknown tracks). What a PER-TRACK
 *  resource must follow when the object itself is rendered many times - a
 *  single shared scene light, say. Following one chosen copy's opacity instead
 *  makes the resource blink on that copy's private schedule: a Tunnel wraps
 *  copy 0 out of sight once per cycle, which would pulse the light at the
 *  tunnel's phase. The peak still honours a gate that dims every copy. */
export function getPeakVisualCopyOpacity(trackId: string): number {
  const copies = visualCopiesByTrack.get(trackId)
  if (!copies || copies.length === 0) return 1
  let peak = 0
  for (const copy of copies) peak = Math.max(peak, copy.opacity)
  return peak
}

/** One occurrence's copy - what an ObjectRenderer pulls per frame. */
export function getVisualCopy(trackId: string, visualCopyIndex: number): VisualCopy | undefined {
  return visualCopiesByTrack.get(trackId)?.[visualCopyIndex]
}

/** The STRUCTURAL copy count (fixed per resolve; ≥1 for every live object).
 *  Zero only for tracks that resolve to no object. */
export function getVisualCopyCount(trackId: string): number {
  return visualCopyCounts.get(trackId) ?? 0
}

// ── Object-list subscription (VisualScene via useSyncExternalStore) ──
export function subscribeObjects(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
export function getObjectList() {
  return objectList
}
