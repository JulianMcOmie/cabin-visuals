// Instrument schema types. Kept separate from the core project types.ts (Track/
// Block/Note) since "what an instrument exposes" is a different concern from "what
// a project is". Each instrument owns its own def, colocated with its visual
// component; the registry (./index) just collects them.

import type { FC } from 'react'
import type { StateVector } from '../core/visual/types'

// A param is either numeric-valued (number / select / boolean — stored in track.params)
// or string-valued (color / string — stored in track.stringParams). The union keeps the
// numeric engine paths (localTransform / spec / automation) untouched.
interface ParamBase {
  key: string
  label: string
}
export interface NumberParamDef extends ParamBase {
  type?: 'number'
  min: number
  max: number
  step: number
  default: number
}
export interface SelectParamDef extends ParamBase {
  type: 'select'
  options: { value: number; label: string }[]
  default: number
}
export interface BooleanParamDef extends ParamBase {
  type: 'boolean'
  default: number // 0 or 1
}
export interface ColorParamDef extends ParamBase {
  type: 'color'
  default: string // '#rrggbb'
}
export interface StringParamDef extends ParamBase {
  type: 'string'
  default: string
  multiline?: boolean
}
export type ParamDef = NumberParamDef | SelectParamDef | BooleanParamDef | ColorParamDef | StringParamDef

/** A param whose value is a string (stored in track.stringParams), not a number. */
export function isStringParam(p: ParamDef): p is ColorParamDef | StringParamDef {
  return p.type === 'color' || p.type === 'string'
}
/** A plain numeric slider param (the only kind automation can target). */
export function isNumberParam(p: ParamDef): p is NumberParamDef {
  return p.type === undefined || p.type === 'number'
}

/**
 * A modulation input on an object — a curated, shared vocabulary (scale, energy,
 * hue…) that modulator instruments target. NOT a user-facing knob: it's internal
 * plumbing, bound onto the render in code. `combine` decides how multiple
 * modulators stack on the same port. Unused until the matrix lands.
 */
export interface PortDef {
  key: string
  label: string
  combine: 'add' | 'multiply' | 'max' | 'replace'
  default: number
  range?: [number, number]
}

/** How an ability lane presents pitch in its MIDI editor — a free, per-lane choice
 *  (a pitched piano-roll, drum-style rows, or a single trigger row). Only `pitched`
 *  is wired initially; the field lets an instrument declare intent for later. */
export type EditorKind = 'pitched' | 'drum' | 'trigger'

/**
 * A signature ability of an object instrument — its own MIDI lane. Bespoke and
 * intrinsic: declared *by the instrument*, edited in a nested sub-row, and expressed
 * by the instrument's own render (the code escape hatch for now; a declarative
 * `onAbility` grammar grows from these later). A "lane" here is a whole MIDI editor,
 * not a labelled row. Not generic and not attachable — an ability belongs to one
 * instrument and no other.
 */
export interface AbilityLaneDef {
  key: string
  label: string
  /** Which editor kind this lane uses. Defaults to `pitched`. */
  editor?: EditorKind
  /** Accent colour for the lane's sub-row and its notes. */
  color?: string
}

/** Optional semantic row labels for an instrument's main MIDI editor. */
export interface MidiRowLabelDef {
  label: string
  color?: string
  emphasized?: boolean
  backgroundColor?: string
}

/** An object's transform relative to its parent (identity-ish defaults). Position in
 *  world units, rotation as XYZ Euler radians, scale uniform or per-axis. The engine
 *  composes these down the hierarchy into a world transform (see core/visual). */
export interface LocalTransform {
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: number | [number, number, number]
}

/** Per-frame inputs an instrument's transform derives from. */
export interface TransformCtx {
  params: Record<string, number>
  ports: Record<string, number>
  beat: number
}

export interface ElementLayoutCtx extends TransformCtx {
  i: number
  N: number
  channels: Record<string, number>
}

/** An object / source / shape instrument — renders something. */
export interface ObjectInstrumentDef {
  id: string
  name: string
  kind: 'object'
  params: ParamDef[]
  ports: PortDef[]
  /** This instrument's signature abilities — each becomes a nested MIDI-lane sub-row
   *  on the track, and its notes are expressed by `component`. Omit for none. */
  abilities?: AbilityLaneDef[]
  /** Semantic labels for special MIDI pitches in this object's main piano roll. */
  midiRowLabels?: Record<number, MidiRowLabelDef>
  /** This object's transform relative to its parent, per frame. The engine composes
   *  it with its ancestors' transforms; the component renders at the result. Omit for
   *  a non-transforming object (identity). */
  localTransform?: (ctx: TransformCtx) => LocalTransform
  /** Ensemble instruments can ask the engine to evaluate one state vector per element. */
  elementCount?: (params: Record<string, number>) => number
  layoutState?: (ctx: ElementLayoutCtx, out: StateVector) => void
  /** The R3F visual; pulls its per-frame state by trackId from the engine. */
  component: FC<{ trackId: string }>
  /** A full-frame instrument sizes itself to the viewport (a screen-filling plane) rather
   *  than sitting at a 3D position. The renderer skips the placement transform + the
   *  transform/clone effect chain for these. */
  fullFrame?: boolean
}

/** A modulator / shaper instrument — renders nothing; its trigger notes drive a
 *  port on the object(s) it's routed to. `kind` selects the engine's evaluate fn;
 *  `port` is the (internal, never user-visible) port it targets. */
export interface ModulatorInstrumentDef {
  id: string
  name: string
  kind: 'modulator'
  signal: 'pulse'
  port: string
}

/** A numeric param's schema default (no track/registry lookup). Non-numeric params → 0. */
export function paramDefault(def: ObjectInstrumentDef, key: string): number {
  const p = def.params.find((p) => p.key === key)
  return p && typeof p.default === 'number' ? p.default : 0
}
