// Resolved-graph types — derived by the engine, never persisted. The document
// types (Track/Block/Note) live in src/editor/types.ts; the dependency points one
// way (engine → document), which keeps the editor independent of the engine.

import type { Matrix4 } from 'three'
import type { PortDef, LocalTransform, TransformCtx } from '../../instruments/types'

/** One of a track's notes, flattened to absolute project beats, carrying the
 *  bounds of its containing block so the engine can tell which notes are "live". */
export interface ResolvedNote {
  beat: number
  blockStartBeat: number
  blockEndBeat: number
  pitch: number
  velocity: number
  /** Note length in beats — a modifier note's [beat, beat+durationBeats) is its region. */
  durationBeats: number
}

/** A time span (beats) during which a muted object is hidden at render. */
export interface BlackoutRegion {
  start: number
  end: number
}

/** A renderable object instance derived from a track. */
export interface ResolvedObject {
  trackId: string
  instrumentId: string
  /** Hierarchy parent (a track id), for composing transforms down the tree. */
  parentId?: string
  muted: boolean
  params: Record<string, number>
  /** The instrument's ports (from its def), so the matrix knows what to fill. */
  ports: PortDef[]
  /** The instrument's local-transform fn (from its def), composed by the engine. */
  localTransform?: (ctx: TransformCtx) => LocalTransform
  /** The object's notes after its child event modifiers (suppress/add/override) fold in. */
  notes: ResolvedNote[]
  /** Blackout spans from `mute` child modifiers — the object is hidden inside them. */
  blackouts: BlackoutRegion[]
  /** Cross-cutting group labels — a modulator can route to a tag (see Routing). */
  tags: string[]
}

/** A modulator's resolved signal source. Its output is computed once per frame;
 *  ResolvedRoutings fan it out to object ports (one signal → many ports). */
export interface ModulatorInstance {
  id: string
  kind: 'pulse'
  triggers: ResolvedNote[]
}

/** A resolved connection: a modulator's signal drives one object's port, scaled by
 *  `amount`. Scopes (track/tag/subtree) are already expanded to concrete objects. */
export interface ResolvedRouting {
  modulatorId: string
  targetObjectId: string
  targetPort: string
  amount: number
}

export interface ResolvedGraph {
  objects: ResolvedObject[]
  modulators: ModulatorInstance[]
  /** Routings bucketed by target port key (the matrix's per-port input). */
  routingsByPort: Map<string, ResolvedRouting[]>
  /** tag → object trackIds, so tag-scoped routings expand to a group. */
  tagIndex: Map<string, string[]>
}

/** Per-frame state the renderer pulls for one object. */
export interface ObjectState {
  params: Record<string, number>
  portValues: Record<string, number>
  /** True this frame if a mute modifier's region covers the current beat (hide it). */
  blackedOut: boolean
  /** World transform (local composed with all ancestors). Reused across frames —
   *  the renderer reads it imperatively in the same frame, after computeAtBeat. */
  world: Matrix4
}
