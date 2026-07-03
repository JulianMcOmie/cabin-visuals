import { Matrix4 } from 'three'
import { resolveProject, type ProjectSnapshot } from './resolve'
import { runMatrix } from './matrix'
import { sampleLane } from './automation'
import { composeLocal } from './transforms'
import type { ResolvedGraph, ObjectState } from './types'

// The engine is a plain module singleton, NOT a zustand/React store: per-frame
// state must never trigger React re-renders. Renderers read it imperatively from
// useFrame. The only React-visible signal is the object LIST (see below).

let graph: ResolvedGraph = { objects: [], modulators: [], routingsByPort: new Map(), tagIndex: new Map() }
// Project bpm, mirrored on every setProject/syncParams — computeAtBeat derives
// secPerBeat from it so instruments can convert beat-ages to seconds.
let bpm = 120
const states = new Map<string, ObjectState>()
// World transforms, reused across frames (one Matrix4 per object). Also the source
// of each object's parent transform during composition.
const worldMatrices = new Map<string, Matrix4>()
const _local = new Matrix4()

// External-store signal for the object list, so VisualScene reconciles the scene
// tree when objects appear/disappear (on resolve) — never per frame.
let objectList: { trackId: string; instrumentId: string }[] = []
const listeners = new Set<() => void>()

function publishList() {
  objectList = graph.objects.map((o) => ({ trackId: o.trackId, instrumentId: o.instrumentId }))
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
  publishList()
}

/**
 * Refresh just the base params on the already-resolved objects, in place. Called
 * synchronously on every edit (not debounced) so slider drags are reactive at
 * 60fps, while the expensive structural resolve stays debounced. Reads params from
 * the same source as resolve (`track.params`), so the engine remains the sole owner
 * of params — `computeAtBeat`/renderers are unchanged. Tracks not yet (or no longer)
 * in the graph are skipped; the debounced setProject reconciles structure shortly.
 */
export function syncParams(p: ProjectSnapshot) {
  bpm = p.bpm
  for (const obj of graph.objects) {
    const track = p.tracks[obj.trackId]
    if (track) obj.params = track.params ?? {}
  }
}

/** Per frame (runs first, from VisualBeatSync): run the matrix, compose each object's
 *  world transform down the hierarchy, then stash state for the renderer to pull.
 *  graph.objects is in parent-before-child order (resolve walks the tree DFS), so a
 *  parent's world is always ready when its children compose. */
export function computeAtBeat(beat: number) {
  const secPerBeat = 60 / bpm
  const portValuesByObject = new Map<string, Record<string, number>>()
  runMatrix(graph, beat, portValuesByObject)
  for (const obj of graph.objects) {
    const portValues = portValuesByObject.get(obj.trackId) ?? {}
    // Automation drives params over time: overlay each lane's sampled value onto the
    // base params for this frame (a pure function of the beat, so scrub == playback).
    let params = obj.params
    if (obj.automations.length) {
      params = { ...obj.params }
      for (const auto of obj.automations) {
        if (auto.keyframes.length) params[auto.param] = sampleLane(auto.keyframes, beat, auto.mode)
      }
    }
    const local = obj.localTransform ? obj.localTransform({ params, ports: portValues, beat }) : {}
    composeLocal(local, _local)

    let world = worldMatrices.get(obj.trackId)
    if (!world) { world = new Matrix4(); worldMatrices.set(obj.trackId, world) }
    const parentWorld = obj.parentId ? worldMatrices.get(obj.parentId) : undefined
    if (parentWorld) world.multiplyMatrices(parentWorld, _local)
    else world.copy(_local)

    // Muted (or soloed-out) objects are hidden, and a `mute` modifier blacks out its span.
    const blackedOut = obj.muted || obj.blackouts.some((r) => beat >= r.start && beat < r.end)
    // Notes live at this beat — pitch-reactive instruments read them (a zero-length note
    // stays "on" for a hair so single-tick triggers still register).
    const activeNotes = obj.notes.filter((n) => beat >= n.beat && beat < n.beat + (n.durationBeats || 0.05))
    states.set(obj.trackId, { beat, secPerBeat, params, portValues, world, blackedOut, stringParams: obj.stringParams, abilityEvents: obj.abilityEvents, notes: obj.notes, activeNotes })
  }
}

/** Pull API for the renderer. */
export function getObjectState(trackId: string): ObjectState | undefined {
  return states.get(trackId)
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
