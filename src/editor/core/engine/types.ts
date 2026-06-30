// Resolved-graph types — derived by the engine, never persisted. The document
// types (Track/Block/Note) live in src/editor/types.ts; the dependency points one
// way (engine → document), which keeps the editor independent of the engine.

import type { PortDef } from '../../instruments/types'

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
  /** The instrument's ports (from its def), so the matrix knows what to fill. */
  ports: PortDef[]
  notes: ResolvedNote[]
}

/** A modulator's resolved form: a signal source routed to one object port. */
export interface ModulatorInstance {
  id: string
  kind: 'pulse'
  triggers: ResolvedNote[]
  targetObjectId: string
  targetPort: string
}

export interface ResolvedGraph {
  objects: ResolvedObject[]
  modulators: ModulatorInstance[]
}

/** Per-frame state the renderer pulls for one object. */
export interface ObjectState {
  params: Record<string, number>
  portValues: Record<string, number>
}
