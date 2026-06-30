import { resolveProject, type ProjectSnapshot } from './resolve'
import { runMatrix } from './matrix'
import type { ResolvedGraph, ObjectState } from './types'

// The engine is a plain module singleton, NOT a zustand/React store: per-frame
// state must never trigger React re-renders. Renderers read it imperatively from
// useFrame. The only React-visible signal is the object LIST (see below).

let graph: ResolvedGraph = { objects: [], modulators: [] }
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

/**
 * Refresh just the base params on the already-resolved objects, in place. Called
 * synchronously on every edit (not debounced) so slider drags are reactive at
 * 60fps, while the expensive structural resolve stays debounced. Reads params from
 * the same source as resolve (`track.params`), so the engine remains the sole owner
 * of params — `computeAtBeat`/renderers are unchanged. Tracks not yet (or no longer)
 * in the graph are skipped; the debounced setProject reconciles structure shortly.
 */
export function syncParams(p: ProjectSnapshot) {
  for (const obj of graph.objects) {
    const track = p.tracks[obj.trackId]
    if (track) obj.params = track.params ?? {}
  }
}

/** Per frame (runs first, from VisualBeatSync): run the matrix, then stash each
 *  object's params + port values for the renderer to pull. */
export function computeAtBeat(beat: number) {
  const portValuesByObject = new Map<string, Record<string, number>>()
  runMatrix(graph, beat, portValuesByObject)
  for (const obj of graph.objects) {
    states.set(obj.trackId, {
      params: obj.params,
      portValues: portValuesByObject.get(obj.trackId) ?? {},
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
