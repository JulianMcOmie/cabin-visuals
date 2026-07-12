import { Matrix4 } from 'three'
import { resolveProject, type ProjectSnapshot } from './resolve'
import { evaluatePulse } from './energy'
import { sampleLane } from './automation'
import { DEFAULT_ADSR, evaluateAdsrGain } from './adsr'
import { composeMatrix, localTransformToSV } from './stateVector'
import { identityVisualCopy } from '../visualCopies/identityVisualCopy'
import { resolveVisualCopies } from '../visualCopies/resolveVisualCopies'
import type { VisualCopy } from '../visualCopies/types'
import type { ResolvedGraph, ObjectState, ResolvedEnvelope } from './types'

// The engine is a plain module singleton, NOT a zustand/React store: per-frame
// state must never trigger React re-renders. Renderers read it imperatively from
// useFrame. The only React-visible signal is the object LIST (see below).

let graph: ResolvedGraph = { objects: [], tagIndex: new Map() }
// Project bpm, mirrored on every setProject/syncParams - computeAtBeat derives
// secPerBeat from it so instruments can convert beat-ages to seconds.
let bpm = 120
const states = new Map<string, ObjectState>()
// World transforms, reused across frames (one Matrix4 per object). Also the source
// of each object's parent transform during composition.
const worldMatrices = new Map<string, Matrix4>()
const _local = new Matrix4()

// Per-track VisualCopy cache - deliberately SEPARATE from ObjectState. The
// STRUCTURAL copy count is fixed once per resolve (definitions contract: count
// never depends on beat - MIDI gates opacity, not slots); the copy VALUES
// (matrices/opacity/color shift) refresh imperatively per frame in
// computeAtBeat, so React never reconciles during playback.
const visualCopiesByTrack = new Map<string, VisualCopy[]>()
const visualCopyCounts = new Map<string, number>()
const copyCountWarned = new Set<string>()

/** One structural render-list entry per VisualCopy occurrence. The renderer
 *  mounts one ObjectRenderer per entry; each pulls exactly its copy per frame.
 *  Entry count changes only on resolve (chain/config edits), NEVER from MIDI
 *  gates - hidden copies stay mounted at opacity zero. */
export interface ObjectListEntry {
  trackId: string
  instrumentId: string
  visualCopyIndex: number
}

// External-store signal for the object list, so VisualScene reconciles the scene
// tree when objects appear/disappear (on resolve) - never per frame.
let objectList: ObjectListEntry[] = []
const listeners = new Set<() => void>()

function publishList() {
  objectList = graph.objects.flatMap((o) => {
    const count = Math.max(1, visualCopyCounts.get(o.trackId) ?? 1)
    return Array.from({ length: count }, (_, visualCopyIndex) => ({
      trackId: o.trackId,
      instrumentId: o.instrumentId,
      visualCopyIndex,
    }))
  })
  listeners.forEach((l) => l())
}

/** Re-derive the graph from the project (called debounced, off the edit path). */
export function setProject(p: ProjectSnapshot) {
  graph = resolveProject(p)
  bpm = p.bpm
  // Drop per-object caches for tracks that no longer resolve to an object.
  const live = new Set(graph.objects.map((o) => o.trackId))
  for (const id of states.keys()) if (!live.has(id)) states.delete(id)
  for (const id of worldMatrices.keys()) if (!live.has(id)) worldMatrices.delete(id)
  for (const id of visualCopiesByTrack.keys()) if (!live.has(id)) visualCopiesByTrack.delete(id)
  for (const id of visualCopyCounts.keys()) if (!live.has(id)) visualCopyCounts.delete(id)
  copyCountWarned.clear()
  // Fix each track's STRUCTURAL copy count now, with one evaluation. Counts are
  // beat-independent by contract, so the probe beat is arbitrary; the values are
  // real too, so copies are readable before the first computeAtBeat.
  for (const obj of graph.objects) {
    const copies = resolveVisualCopies(obj.moverAndSplitterChain, 0)
    visualCopyCounts.set(obj.trackId, copies.length)
    visualCopiesByTrack.set(obj.trackId, copies)
  }
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
export function syncParams(p: ProjectSnapshot) {
  bpm = p.bpm
  for (const obj of graph.objects) {
    const track = p.tracks[obj.trackId]
    if (track) {
      obj.params = track.params ?? {}
      obj.stringParams = track.stringParams ?? {}
    }
    // Envelope lanes: keep the slider-driven fields (ADSR/depth/target) live at
    // 60fps like instrument params; structure (notes, target kind) waits for resolve.
    for (const env of obj.envelopes) {
      const eTrack = p.tracks[env.trackId]
      if (!eTrack) continue
      env.adsr = { ...DEFAULT_ADSR, ...eTrack.adsr }
      env.depth = clamp(eTrack.envDepth ?? 1, 0, 1)
      if (env.kind !== 'opacity') env.envTarget = clamp(eTrack.envTarget ?? env.max, env.min, env.max)
      if (env.kind === 'fx' && track) {
        const inst = track.effects?.find((e) => e.id === env.instanceId)
        if (inst && env.key !== undefined) env.fxBase = inst.settings[env.key] ?? env.fxBase
      }
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function clampOpacity(v: number): number {
  return clamp(v, 0, 1)
}

/** Per frame (runs first, from VisualBeatSync): compose each object's world
 *  transform down the hierarchy, then stash state for the renderer to pull.
 *  graph.objects is in parent-before-child order (resolve walks the tree DFS), so a
 *  parent's world is always ready when its children compose. */
export function computeAtBeat(beat: number) {
  const secPerBeat = 60 / bpm
  for (const obj of graph.objects) {
    // The note-pulse signal (the old implicit `energy` port, now direct).
    const energy = !obj.muted && obj.notes.length > 0 ? evaluatePulse(obj.notes, beat) : 0
    // Automation drives params over time: overlay each lane's sampled value onto the
    // base params for this frame (a pure function of the beat, so scrub == playback).
    let params = obj.params
    if (obj.automations.length) {
      params = { ...obj.params }
      for (const auto of obj.automations) {
        if (auto.keyframes.length) params[auto.param] = sampleLane(auto.keyframes, beat, auto.mode)
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
      const gain = evaluateAdsrGain(env.notes, beat, env.adsr)
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
    const local = obj.localTransform ? obj.localTransform({ params, energy, beat }) : {}
    localTransformToSV(local, obj.scratchBase)
    composeMatrix(obj.scratchBase, _local)
    const opacity = clampOpacity(obj.scratchBase.opacity * opacityGate)
    if (parentWorld) world.multiplyMatrices(parentWorld, _local)
    else world.copy(_local)

    // Effect automation lanes sample per frame into an override map the effect
    // wrappers merge over each instance's stored settings ('enabled' as 0/1).
    let effectOverrides: Record<string, Record<string, number>> | undefined
    if (obj.effectAutomations.length) {
      effectOverrides = {}
      for (const ea of obj.effectAutomations) {
        if (!ea.keyframes.length) continue
        ;(effectOverrides[ea.instanceId] ??= {})[ea.key] = sampleLane(ea.keyframes, beat, ea.mode)
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

    // Muted (or soloed-out) objects are hidden, and a `mute` modifier blacks out its span.
    const blackedOut = obj.muted || obj.blackouts.some((r) => beat >= r.start && beat < r.end)
    // Notes live at this beat - pitch-reactive instruments read them (a zero-length note
    // stays "on" for a hair so single-tick triggers still register).
    const activeNotes = obj.notes.filter((n) => beat >= n.beat && beat < n.beat + (n.durationBeats || 0.05))
    states.set(obj.trackId, {
      beat,
      secPerBeat,
      params,
      energy,
      videoPads: obj.videoPads,
      photoPads: obj.photoPads,
      world,
      opacity,
      effectOverrides,
      blackedOut,
      stringParams: obj.stringParams,
      abilityEvents: obj.abilityEvents,
      notes: obj.notes,
      activeNotes,
    })

    // Evaluate the new VisualCopy chain at this beat (pure function of beat +
    // resolved chain, so scrub == playback == export). The structural count was
    // fixed at resolve time; a definition that varies its count with the beat
    // violates its contract, so clamp back to structure rather than let the
    // renderer's occurrence list silently disagree with React's.
    const copies = resolveVisualCopies(obj.moverAndSplitterChain, beat)
    const structuralCount = visualCopyCounts.get(obj.trackId) ?? copies.length
    if (copies.length !== structuralCount) {
      if (!copyCountWarned.has(obj.trackId)) {
        copyCountWarned.add(obj.trackId)
        console.warn(
          `VisualCopy count for track ${obj.trackId} changed with the beat (${copies.length} vs structural ${structuralCount}). ` +
            'Splitter definitions must gate copies by opacity, not by adding/removing slots.',
        )
      }
      while (copies.length < structuralCount) {
        const hidden = identityVisualCopy()
        hidden.opacity = 0
        copies.push(hidden)
      }
      copies.length = structuralCount
    }
    visualCopiesByTrack.set(obj.trackId, copies)
  }
}

/** Pull API for the renderer. */
export function getObjectState(trackId: string): ObjectState | undefined {
  return states.get(trackId)
}

// ── VisualCopy pull API (separate cache, never part of ObjectState) ──

/** All of a track's copies at the last computed beat ([] for unknown tracks). */
export function getVisualCopies(trackId: string): VisualCopy[] {
  return visualCopiesByTrack.get(trackId) ?? []
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
