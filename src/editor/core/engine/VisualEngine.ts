import { resolveProject, type ProjectSnapshot } from './resolve'
import type { ResolvedGraph, ResolvedObject, ObjectState } from './types'

// The engine is a plain module singleton, NOT a zustand/React store: per-frame
// state must never trigger React re-renders. Renderers read it imperatively from
// useFrame. The only React-visible signal is the object LIST (see below).

let graph: ResolvedGraph = { objects: [] }
const states = new Map<string, ObjectState>()

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
  publishList()
}

// ── Pulse: ported verbatim from the old Cube, now computed per-object ──
const DECAY_BEATS = 0.45
const LOWEST_MIDI_PITCH = 24
const PULSE_DAMPENER = 20

function computePulse(obj: ResolvedObject, beat: number): number {
  let closest = Infinity
  let intensity = 1
  for (const n of obj.notes) {
    if (beat < n.blockStartBeat || beat > n.blockEndBeat) continue
    if (n.beat <= beat) {
      const since = beat - n.beat
      if (since < closest) {
        intensity = n.pitch - LOWEST_MIDI_PITCH + 1
        closest = since
      }
    }
  }
  if (closest === Infinity) return 0
  return Math.max(0, (intensity / PULSE_DAMPENER) * (1 - closest / DECAY_BEATS))
}

/** Per frame (runs first, from VisualBeatSync): fill every object's state. */
export function computeAtBeat(beat: number) {
  for (const obj of graph.objects) {
    states.set(obj.trackId, {
      params: obj.params,
      pulse: obj.muted ? 0 : computePulse(obj, beat),
    })
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
