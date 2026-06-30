// Resolved-graph types — derived by the engine, never persisted. The document
// types (Track/Block/Note) live in src/editor/types.ts; the dependency points one
// way (engine → document), which keeps the editor independent of the engine.

/** One of a track's notes, flattened to absolute project beats, carrying the
 *  bounds of its containing block so the engine can tell which notes are "live". */
export interface ResolvedNote {
  beat: number
  blockStartBeat: number
  blockEndBeat: number
  pitch: number
  velocity: number
}

/** A renderable object instance derived from a track. */
export interface ResolvedObject {
  trackId: string
  instrumentId: string
  muted: boolean
  params: Record<string, number>
  notes: ResolvedNote[]
}

export interface ResolvedGraph {
  objects: ResolvedObject[]
}

/** Per-frame state the renderer pulls for one object. */
export interface ObjectState {
  params: Record<string, number>
  pulse: number
}
